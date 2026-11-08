/**
 * Persistent history. Mutating functions are called only by the background script.
 * Each extension background instance serializes writes across all YouTube tabs.
 */
const SEEN_PREFIX = 'seenChunk';
const MANIFEST_KEY = 'seenManifest';
const PREFS_KEY = 'prefs';
const WATCH_INTENT_KEY = 'watchIntent';
const GENERATION_KEY = 'historyGeneration';
const CLEANUP_KEY = 'historyCleanupAt';
const RETENTION_MS = 65 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 512;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHUNK_KEY_PATTERN = /^seenChunk\d+$/;

export const DEFAULT_PREFS = { enabled: true, greyStrength: 75 };

let loadPromise;
let writeChain = Promise.resolve();
let state;

function withWriteLock(task) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => {});
  return next;
}

function timestampOf(value, field) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return value[field];
  return NaN;
}

export function isExpired(timestamp) {
  return !Number.isFinite(timestamp) || Date.now() - timestamp > RETENTION_MS;
}

export function getExpiryTimestamp() {
  return Date.now() + RETENTION_MS;
}

function normalisePrefs(prefs) {
  return {
    enabled: typeof prefs?.enabled === 'boolean' ? prefs.enabled : DEFAULT_PREFS.enabled,
    greyStrength: Number.isFinite(prefs?.greyStrength)
      ? Math.max(0, Math.min(100, Math.round(prefs.greyStrength)))
      : DEFAULT_PREFS.greyStrength
  };
}

function strictPrefs(prefs) {
  if (!prefs || typeof prefs.enabled !== 'boolean' ||
      !Number.isInteger(prefs.greyStrength) ||
      prefs.greyStrength < 0 || prefs.greyStrength > 100) {
    throw new TypeError('Invalid preferences');
  }
  return { enabled: prefs.enabled, greyStrength: prefs.greyStrength };
}

function seenChunkKeys(data) {
  return Object.keys(data).filter(key => CHUNK_KEY_PATTERN.test(key))
    .sort((a, b) => Number(a.slice(SEEN_PREFIX.length)) - Number(b.slice(SEEN_PREFIX.length)));
}

function serialiseChunks(seen) {
  const chunks = [];
  let chunk = {};
  let count = 0;
  for (const [id, timestamp] of seen) {
    if (count === CHUNK_SIZE) {
      chunks.push(chunk);
      chunk = {};
      count = 0;
    }
    chunk[id] = timestamp;
    count += 1;
  }
  chunks.push(chunk);
  return chunks;
}

function serialiseIntents(intents) {
  return Object.fromEntries(intents);
}

async function initialise() {
  const raw = await browser.storage.local.get(null);
  const seen = new Map();
  const intents = new Map();
  const oldChunkKeys = seenChunkKeys(raw);
  let migrationNeeded = !raw[MANIFEST_KEY] ||
    raw[MANIFEST_KEY].chunkSize !== CHUNK_SIZE ||
    !Number.isInteger(raw[MANIFEST_KEY].count);
  let expiredFound = false;

  for (const key of oldChunkKeys) {
    const chunk = raw[key];
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
      migrationNeeded = true;
      continue;
    }
    if (Object.keys(chunk).length > CHUNK_SIZE) migrationNeeded = true;
    for (const [id, value] of Object.entries(chunk)) {
      const stamp = timestampOf(value, 'firstSeenAt');
      if (!VIDEO_ID_PATTERN.test(id) || isExpired(stamp)) {
        expiredFound = true;
        continue;
      }
      if (typeof value !== 'number') migrationNeeded = true;
      const previous = seen.get(id);
      if (previous === undefined || stamp < previous) seen.set(id, stamp);
    }
  }

  const oldIntents = raw[WATCH_INTENT_KEY];
  if (oldIntents && typeof oldIntents === 'object' && !Array.isArray(oldIntents)) {
    for (const [id, value] of Object.entries(oldIntents)) {
      const stamp = timestampOf(value, 'markedAt');
      if (!VIDEO_ID_PATTERN.test(id) || isExpired(stamp)) {
        expiredFound = true;
        continue;
      }
      if (typeof value !== 'number') migrationNeeded = true;
      intents.set(id, stamp);
    }
  }

  // Watch intent wins even for entries written by previous extension versions.
  for (const id of intents.keys()) {
    if (seen.delete(id)) migrationNeeded = true;
  }
  if (raw[MANIFEST_KEY]?.count !== seen.size) migrationNeeded = true;
  const generation = Number.isSafeInteger(raw[GENERATION_KEY]) && raw[GENERATION_KEY] >= 0
    ? raw[GENERATION_KEY] : 0;
  if (raw[GENERATION_KEY] !== generation) migrationNeeded = true;
  const lastCleanup = Number.isFinite(raw[CLEANUP_KEY]) ? raw[CLEANUP_KEY] : 0;
  const prefs = normalisePrefs(raw[PREFS_KEY]);

  const chunks = serialiseChunks(seen);
  if (oldChunkKeys.length !== chunks.length || chunks.some((chunk, index) =>
    JSON.stringify(raw[`${SEEN_PREFIX}${index}`] || {}) !== JSON.stringify(chunk)
  )) migrationNeeded = true;
  state = { seen, intents, generation, prefs, lastCleanup, chunks, nextChunkIndex: chunks.length - 1 };
  if (migrationNeeded || expiredFound || Date.now() - lastCleanup >= CLEANUP_INTERVAL_MS) {
    await persistAll(oldChunkKeys);
  }
  return state;
}

async function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = initialise().catch(error => {
      loadPromise = undefined;
      state = undefined;
      throw error;
    });
  }
  return loadPromise;
}

async function persistAll(oldKeys = []) {
  const chunks = serialiseChunks(state.seen);
  const updates = {
    [MANIFEST_KEY]: { count: state.seen.size, chunkSize: CHUNK_SIZE },
    [WATCH_INTENT_KEY]: serialiseIntents(state.intents),
    [GENERATION_KEY]: state.generation,
    [CLEANUP_KEY]: Date.now()
  };
  chunks.forEach((chunk, index) => { updates[`${SEEN_PREFIX}${index}`] = chunk; });
  const obsolete = oldKeys.filter(key => Number(key.slice(SEEN_PREFIX.length)) >= chunks.length);
  // Publish deletions and moved entries in one storage change event for content caches.
  for (const key of obsolete) updates[key] = {};
  await browser.storage.local.set(updates);
  state.chunks = chunks;
  state.nextChunkIndex = chunks.length - 1;
  state.lastCleanup = updates[CLEANUP_KEY];
  if (obsolete.length) {
    try {
      await browser.storage.local.remove(obsolete);
    } catch {
      // Obsolete chunks were already emptied by the successful set above.
      console.warn('[YAC Storage] Empty chunk cleanup deferred');
    }
  }
}

async function cleanupIfDue() {
  await ensureLoaded();
  if (Date.now() - state.lastCleanup < CLEANUP_INTERVAL_MS) return;
  const before = state.seen.size + state.intents.size;
  for (const [id, stamp] of state.seen) if (isExpired(stamp)) state.seen.delete(id);
  for (const [id, stamp] of state.intents) if (isExpired(stamp)) state.intents.delete(id);
  if (before !== state.seen.size + state.intents.size) {
    await persistAll(state.chunks.map((_, index) => `${SEEN_PREFIX}${index}`));
  } else {
    state.lastCleanup = Date.now();
    await browser.storage.local.set({ [CLEANUP_KEY]: state.lastCleanup });
  }
}

export async function getTrackingState() {
  return withWriteLock(async () => {
    await ensureLoaded();
    await cleanupIfDue();
    return {
      prefs: { ...state.prefs },
      seenVideoIds: [...state.seen].filter(([, stamp]) => !isExpired(stamp)).map(([id]) => id),
      watchIntentVideoIds: [...state.intents].filter(([, stamp]) => !isExpired(stamp)).map(([id]) => id),
      generation: state.generation
    };
  });
}

export async function getHistoryGeneration() {
  return (await getTrackingState()).generation;
}

export async function getPrefs() {
  await ensureLoaded();
  await writeChain;
  return { ...state.prefs };
}

export async function isEnabled() {
  return (await getPrefs()).enabled;
}

export async function getGreyStrength() {
  return (await getPrefs()).greyStrength;
}

export async function getAllSeenVideos() {
  return new Set((await getTrackingState()).seenVideoIds);
}

export async function getWatchIntentVideoIds() {
  return new Set((await getTrackingState()).watchIntentVideoIds);
}

export async function isSeenVideo(videoId) {
  return (await getAllSeenVideos()).has(videoId);
}

export async function hasWatchIntent(videoId) {
  return (await getWatchIntentVideoIds()).has(videoId);
}

export async function getSeenCount() {
  return (await getTrackingState()).seenVideoIds.length;
}

export async function getQuotaInfo() {
  return {
    quota: browser.storage.local.QUOTA_BYTES ?? 5242880,
    bytesInUse: await browser.storage.local.getBytesInUse()
  };
}

export async function calculateChunkSize() {
  return CHUNK_SIZE;
}

export async function savePrefs(prefs) {
  return withWriteLock(async () => {
    await ensureLoaded();
    const next = strictPrefs(prefs);
    await browser.storage.local.set({ [PREFS_KEY]: next });
    state.prefs = next;
    return next;
  });
}

export async function addSeenVideo(videoId, generation, timestamp = Date.now()) {
  return withWriteLock(async () => {
    await ensureLoaded();
    await cleanupIfDue();
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new TypeError('Invalid video ID');
    if (!Number.isSafeInteger(generation) || generation !== state.generation) {
      return { generation: state.generation, seen: false };
    }
    if (state.intents.has(videoId) && isExpired(state.intents.get(videoId))) {
      state.lastCleanup = 0;
      await cleanupIfDue();
    }
    if (state.intents.has(videoId)) return { generation: state.generation, seen: false };
    if (state.seen.has(videoId) && isExpired(state.seen.get(videoId))) {
      state.lastCleanup = 0;
      await cleanupIfDue();
    }
    if (state.seen.has(videoId)) return { generation: state.generation, seen: true };
    let index = state.nextChunkIndex;
    while (Object.keys(state.chunks[index] || {}).length >= CHUNK_SIZE) index += 1;
    const chunk = { ...(state.chunks[index] || {}), [videoId]: timestamp };
    await browser.storage.local.set({
      [`${SEEN_PREFIX}${index}`]: chunk,
      [MANIFEST_KEY]: { count: state.seen.size + 1, chunkSize: CHUNK_SIZE }
    });
    state.seen.set(videoId, timestamp);
    state.chunks[index] = chunk;
    state.nextChunkIndex = Object.keys(chunk).length === CHUNK_SIZE ? index + 1 : index;
    return { generation: state.generation, seen: true };
  });
}

export async function addWatchIntent(videoId) {
  return withWriteLock(async () => {
    await ensureLoaded();
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new TypeError('Invalid video ID');
    if (state.seen.has(videoId) && isExpired(state.seen.get(videoId))) {
      state.lastCleanup = 0;
      await cleanupIfDue();
    }
    const hadSeen = state.seen.has(videoId);
    const intents = new Map(state.intents);
    intents.set(videoId, Date.now());
    const updates = { [WATCH_INTENT_KEY]: serialiseIntents(intents) };
    if (hadSeen) {
      const index = state.chunks.findIndex(chunk => Object.hasOwn(chunk, videoId));
      if (index >= 0) {
        const chunk = { ...state.chunks[index] };
        delete chunk[videoId];
        updates[`${SEEN_PREFIX}${index}`] = chunk;
        updates[MANIFEST_KEY] = { count: state.seen.size - 1, chunkSize: CHUNK_SIZE };
        await browser.storage.local.set(updates);
        state.chunks[index] = chunk;
        state.nextChunkIndex = Math.min(state.nextChunkIndex, index);
      } else {
        throw new Error('History index mismatch');
      }
      state.seen.delete(videoId);
    } else {
      await browser.storage.local.set(updates);
    }
    state.intents = intents;
    return { generation: state.generation };
  });
}

export async function resetSeenVideos() {
  return withWriteLock(async () => {
    await ensureLoaded();
    const generation = state.generation + 1;
    const updates = {
      [GENERATION_KEY]: generation,
      [WATCH_INTENT_KEY]: {},
      [MANIFEST_KEY]: { count: 0, chunkSize: CHUNK_SIZE },
      [SEEN_PREFIX + '0']: {},
      [CLEANUP_KEY]: Date.now()
    };
    for (let i = 1; i < state.chunks.length; i++) updates[`${SEEN_PREFIX}${i}`] = {};
    await browser.storage.local.set(updates);
    state.seen.clear();
    state.intents.clear();
    state.generation = generation;
    state.chunks = [{}];
    state.nextChunkIndex = 0;
    state.lastCleanup = updates[CLEANUP_KEY];
    const obsolete = Object.keys(updates).filter(key =>
      CHUNK_KEY_PATTERN.test(key) && key !== SEEN_PREFIX + '0');
    if (obsolete.length) {
      try {
        await browser.storage.local.remove(obsolete);
      } catch {
        // Reset is complete; the remaining keys contain empty objects.
        console.warn('[YAC Storage] Empty chunk cleanup deferred');
      }
    }
    return { generation };
  });
}

export async function cleanupExpired() {
  return withWriteLock(async () => {
    await ensureLoaded();
    state.lastCleanup = 0;
    await cleanupIfDue();
  });
}
