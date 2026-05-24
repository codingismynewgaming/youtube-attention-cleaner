/**
 * Storage utilities with local storage persistence and 65-day expiry
 */

const SEEN_PREFIX = 'seenChunk';
const MANIFEST_KEY = 'seenManifest';
const PREFS_KEY = 'prefs';
const WATCH_INTENT_KEY = 'watchIntent';
const RETENTION_DAYS = 65;
let storageWriteChain = Promise.resolve();

function withStorageWriteLock(task) {
  const nextWrite = storageWriteChain.then(task, task);
  storageWriteChain = nextWrite.catch(() => {});
  return nextWrite;
}

// Default preferences
export const DEFAULT_PREFS = {
  enabled: true,
  greyStrength: 75, // 0-100%
};

/**
 * Get storage quota info
 * @returns {Promise<{quota: number, bytesInUse: number}>}
 */
export async function getQuotaInfo() {
  try {
    const quota = browser.storage.local.QUOTA_BYTES || 5242880; // Default ~5MB
    const bytesInUse = await browser.storage.local.getBytesInUse();
    return { quota, bytesInUse };
  } catch (e) {
    console.warn('[Storage] Quota API not available, using defaults');
    return { quota: 5242880, bytesInUse: 0 };
  }
}

/**
 * Calculate optimal chunk size based on quota
 * @returns {Promise<number>} - Number of video IDs per chunk
 */
export async function calculateChunkSize() {
  const { quota } = await getQuotaInfo();
  // Average video ID entry: ~30 bytes (11 char ID + timestamp + overhead)
  const avgEntrySize = 30;
  // Use 50% of quota for headroom
  const safeQuota = Math.floor(quota * 0.5);
  return Math.floor(safeQuota / avgEntrySize);
}

/**
 * Get all preferences
 * @returns {Promise<Object>}
 */
export async function getPrefs() {
  try {
    const result = await browser.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(result[PREFS_KEY] || {}) };
  } catch (e) {
    console.warn('[Storage] Failed to get prefs, using defaults');
    return DEFAULT_PREFS;
  }
}

/**
 * Save preferences
 * @param {Object} prefs - Preferences to save
 */
export async function savePrefs(prefs) {
  return withStorageWriteLock(async () => {
    try {
    await browser.storage.local.set({ [PREFS_KEY]: prefs });
  } catch (e) {
    console.error('[Storage] Failed to save prefs:', e);
  }
  });
}

/**
 * Check if extension is enabled
 * @returns {Promise<boolean>}
 */
export async function isEnabled() {
  const prefs = await getPrefs();
  return prefs.enabled;
}

/**
 * Get grey strength (0-100)
 * @returns {Promise<number>}
 */
export async function getGreyStrength() {
  const prefs = await getPrefs();
  return prefs.greyStrength;
}

/**
 * Get current timestamp
 * @returns {number}
 */
function now() {
  return Date.now();
}

/**
 * Check if timestamp is expired (older than 65 days)
 * @param {number} timestamp - Milliseconds since epoch
 * @returns {boolean}
 */
export function isExpired(timestamp) {
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return now() - timestamp > retentionMs;
}

/**
 * Get expiry timestamp (65 days from now)
 * @returns {number}
 */
export function getExpiryTimestamp() {
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return now() + retentionMs;
}

/**
 * Add a video ID to seen storage with chunking
 * @param {string} videoId - The video ID to store
 * @param {number} timestamp - First seen timestamp (optional, defaults to now)
 */
export async function addSeenVideo(videoId, timestamp = now()) {
  return withStorageWriteLock(async () => {
    try {
    // Get manifest
    const result = await browser.storage.local.get(MANIFEST_KEY);
    const manifest = result[MANIFEST_KEY] || { count: 0, chunkSize: await calculateChunkSize() };
    
    // Find which chunk this ID belongs to
    const chunkIndex = Math.floor(0 / manifest.chunkSize); // Always add to first chunk for simplicity
    
    // Get or create first chunk
    const chunkKey = `${SEEN_PREFIX}0`;
    const chunkResult = await browser.storage.local.get(chunkKey);
    const chunk = chunkResult[chunkKey] || {};
    
    // Add video if not already present
    if (!chunk[videoId]) {
      chunk[videoId] = {
        firstSeenAt: timestamp,
        expiresAt: getExpiryTimestamp()
      };
      
      // Save chunk
      await browser.storage.local.set({ [chunkKey]: chunk });
      
      // Update manifest if needed
      if (Object.keys(chunk).length === 1) {
        await browser.storage.local.set({ [MANIFEST_KEY]: manifest });
      }
    }
  } catch (e) {
    console.error('[Storage] Failed to add seen video:', e);
  }
  });
}

/**
 * Get all non-expired seen video IDs from local storage
 * @returns {Promise<Set<string>>}
 */
export async function getAllSeenVideos() {
  try {
    const seenIds = new Set();
    
    const localResult = await browser.storage.local.get(null);
    for (const [key, value] of Object.entries(localResult)) {
      if (key.startsWith(SEEN_PREFIX) && typeof value === 'object') {
        for (const [videoId, data] of Object.entries(value)) {
          if (data && !isExpired(data.firstSeenAt)) {
            seenIds.add(videoId);
          }
        }
      }
    }
    
    return seenIds;
  } catch (e) {
    console.error('[Storage] Failed to get all seen videos:', e);
    return new Set();
  }
}

/**
 * Check if video ID is in seen storage
 * @param {string} videoId - The video ID to check
 * @returns {Promise<boolean>}
 */
export async function isSeenVideo(videoId) {
  try {
    const localResult = await browser.storage.local.get(null);
    for (const [key, value] of Object.entries(localResult)) {
      if (key.startsWith(SEEN_PREFIX) && typeof value === 'object') {
        if (value[videoId]) {
          return !isExpired(value[videoId].firstSeenAt);
        }
      }
    }
    
    return false;
  } catch (e) {
    console.error('[Storage] Failed to check seen video:', e);
    return false;
  }
}

/**
 * Clean up expired entries from all chunks
 */
export async function cleanupExpired() {
  return withStorageWriteLock(async () => {
    try {
    const result = await browser.storage.local.get(null);
    const updates = {};
    
    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith(SEEN_PREFIX) && typeof value === 'object') {
        const cleanedChunk = {};
        for (const [videoId, data] of Object.entries(value)) {
          if (!isExpired(data.firstSeenAt)) {
            cleanedChunk[videoId] = data;
          }
        }
        updates[key] = cleanedChunk;
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await browser.storage.local.set(updates);
    }
  } catch (e) {
    console.error('[Storage] Cleanup failed:', e);
  }
  });
}

/**
 * Mark video as watch intent (should not be greyed)
 * @param {string} videoId
 */
export async function addWatchIntent(videoId) {
  return withStorageWriteLock(async () => {
    try {
    const result = await browser.storage.local.get(WATCH_INTENT_KEY);
    const watchIntent = result[WATCH_INTENT_KEY] || {};
    
    watchIntent[videoId] = {
      markedAt: now(),
      expiresAt: getExpiryTimestamp()
    };
    
    await browser.storage.local.set({ [WATCH_INTENT_KEY]: watchIntent });
  } catch (e) {
    console.error('[Storage] Failed to add watch intent:', e);
  }
  });
}

/**
 * Check if video has watch intent
 * @param {string} videoId
 * @returns {Promise<boolean>}
 */
export async function hasWatchIntent(videoId) {
  try {
    const result = await browser.storage.local.get(WATCH_INTENT_KEY);
    const watchIntent = result[WATCH_INTENT_KEY] || {};
    
    if (watchIntent[videoId]) {
      return !isExpired(watchIntent[videoId].markedAt);
    }
    
    return false;
  } catch (e) {
    console.error('[Storage] Failed to check watch intent:', e);
    return false;
  }
}

/**
 * Get count of seen videos (non-expired)
 * @returns {Promise<number>}
 */
export async function getSeenCount() {
  const seen = await getAllSeenVideos();
  return seen.size;
}
