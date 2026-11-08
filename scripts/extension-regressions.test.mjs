import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const writes = [];
const data = new Map();
const storageChangedListeners = [];
const runtimeMessageListeners = [];
const tabCounts = new Map();
const youtubeTabs = [{ id: 1, url: "https://www.youtube.com/results?search_query=unit" }];
const badgeUpdates = [];

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    listeners
  };
}

const storageChanged = event();
const runtimeMessage = event();
const navigationCommitted = event();
const tabUpdated = event();
const tabRemoved = event();

function estimateBytes() {
  let bytes = 0;
  for (const [key, value] of data) {
    bytes += key.length + JSON.stringify(value).length;
  }
  return bytes;
}

const local = {
  QUOTA_BYTES: 2_000_000,
  failWrites: false,
  failRemove: false,
  async get(keys = null) {
    if (keys === null) return Object.fromEntries(data);
    if (typeof keys === "string") {
      return data.has(keys) ? { [keys]: data.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter(key => data.has(key)).map(key => [key, data.get(key)]));
    }
    return Object.fromEntries(Object.keys(keys).filter(key => data.has(key)).map(key => [key, data.get(key)]));
  },
  async set(updates) {
    if (local.failWrites) throw new Error("quota exceeded (test)");
    const next = new Map(data);
    for (const [key, value] of Object.entries(updates)) next.set(key, structuredClone(value));
    const estimated = [...next].reduce((sum, [key, value]) => sum + key.length + JSON.stringify(value).length, 0);
    if (estimated > local.QUOTA_BYTES) throw new Error("quota exceeded (test)");
    const changes = {};
    for (const [key, value] of Object.entries(updates)) {
      changes[key] = { oldValue: data.get(key), newValue: structuredClone(value) };
      data.set(key, structuredClone(value));
    }
    writes.push(structuredClone(updates));
    for (const listener of storageChanged.listeners) listener(changes, "local");
  },
  async remove(keys) {
    if (local.failWrites) throw new Error("quota exceeded (test)");
    if (local.failRemove) throw new Error("remove unavailable (test)");
    const list = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    for (const key of list) {
      if (!data.has(key)) continue;
      changes[key] = { oldValue: data.get(key) };
      data.delete(key);
    }
    for (const listener of storageChanged.listeners) listener(changes, "local");
  },
  async getBytesInUse(keys = null) {
    if (keys === null) return estimateBytes();
    const list = Array.isArray(keys) ? keys : [keys];
    return list.reduce((sum, key) => sum + (data.has(key) ? key.length + JSON.stringify(data.get(key)).length : 0), 0);
  }
};

async function dispatchRuntimeMessage(message, sender = { id: "test-extension", url: "moz-extension://test/popup.html" }) {
  const responses = await Promise.all(runtimeMessage.listeners.map(listener => listener(message, sender)));
  return responses.find(response => response !== undefined);
}

globalThis.browser = {
  runtime: {
    id: "test-extension",
    onMessage: runtimeMessage,
    async sendMessage(message) { return dispatchRuntimeMessage(message); },
    getURL(path) { return `moz-extension://test/${path}`; }
  },
  storage: { local, onChanged: storageChanged },
  tabs: {
    async query() { return youtubeTabs.map(tab => ({ ...tab })); },
    async sendMessage(tabId, message) {
      const tab = youtubeTabs.find(item => item.id === tabId);
      return dispatchRuntimeMessage(message, { id: "test-extension", tab: tab && { ...tab }, url: tab?.url });
    },
    onUpdated: tabUpdated,
    onRemoved: tabRemoved
  },
  webNavigation: { onCommitted: navigationCommitted },
  action: {
    async setBadgeText(update) { badgeUpdates.push(structuredClone(update)); },
    async setBadgeBackgroundColor(update) { badgeUpdates.push(structuredClone(update)); }
  }
};

const storageUrl = pathToFileURL(resolve("app-files/firefox/lib/storage.js")).href;
const storage = await import(storageUrl);
await import(pathToFileURL(resolve("app-files/firefox/background.js")).href);

const idFor = number => `VID${String(number).padStart(8, "0")}`;
const okMessage = async (message, sender) => {
  const response = await dispatchRuntimeMessage(message, sender);
  assert.equal(response?.ok, true, `expected success for ${message.type}, got ${JSON.stringify(response)}`);
  return response;
};

test("legacy history migrates, expired items are removed and watch intent wins", async () => {
  const now = Date.now();
  const fresh = "LEGACY00001";
  const expired = "EXPIRED0001";
  const opened = "OPENED00001";
  await local.set({
    seenChunk0: {
      [fresh]: { firstSeenAt: now, expiresAt: now + 65 * 86400000 },
      [expired]: { firstSeenAt: now - 66 * 86400000, expiresAt: now - 86400000 },
      [opened]: { firstSeenAt: now }
    },
    seenManifest: { count: 3, chunkSize: 500 },
    watchIntent: { [opened]: { markedAt: now, expiresAt: now + 65 * 86400000 } }
  });

  const state = await storage.getTrackingState();
  assert.deepEqual(new Set(state.seenVideoIds), new Set([fresh]));
  assert.deepEqual(new Set(state.watchIntentVideoIds), new Set([opened]));
  const saved = await local.get(["seenChunk0", "seenManifest", "watchIntent"]);
  assert.equal(typeof saved.seenChunk0[fresh], "number");
  assert.equal(saved.seenChunk0[expired], undefined);
  assert.equal(saved.seenChunk0[opened], undefined);
  assert.equal(saved.seenManifest.count, 1);
  assert.equal(saved.seenManifest.chunkSize, 512);
});

test("single background writer preserves simultaneous requests and chunks at its boundary", async () => {
  const reset = await okMessage({ type: "RESET_SEEN_VIDEOS" });
  const firstGeneration = reset.generation;
  const before = await okMessage({ type: "GET_STATE" });
  const both = await Promise.all([
    dispatchRuntimeMessage({ type: "MARK_SEEN", videoId: idFor(1), generation: before.generation },
      { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url }),
    dispatchRuntimeMessage({ type: "MARK_SEEN", videoId: idFor(2), generation: before.generation },
      { id: "test-extension", tab: { id: 2, url: youtubeTabs[0].url }, url: youtubeTabs[0].url })
  ]);
  assert.ok(both.every(result => result?.ok && result.seen));
  const merged = await okMessage({ type: "GET_STATE" });
  assert.ok(merged.seenVideoIds.includes(idFor(1)));
  assert.ok(merged.seenVideoIds.includes(idFor(2)));

  const chunkSize = (await local.get("seenManifest")).seenManifest.chunkSize;
  for (let number = 3; number <= chunkSize + 1; number++) {
    await okMessage({ type: "MARK_SEEN", videoId: idFor(number), generation: firstGeneration },
      { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url });
  }
  const state = await okMessage({ type: "GET_STATE" });
  const all = await local.get(null);
  const chunks = Object.keys(all).filter(key => /^seenChunk\d+$/.test(key));
  assert.ok(chunks.length >= 2, "second chunk should be created at the boundary");
  assert.equal(all.seenManifest.count, state.seenVideoIds.length);
  for (const key of chunks) assert.ok(Object.keys(all[key]).length <= chunkSize, `${key} exceeds chunkSize`);
});

test("watch intent removes history and prevents future marks; reset rejects stale generations", async () => {
  const before = await okMessage({ type: "GET_STATE" });
  const opened = idFor(88);
  await okMessage({ type: "MARK_SEEN", videoId: opened, generation: before.generation },
    { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url });
  await okMessage({ type: "WATCH_INTENT", videoId: opened },
    { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url });
  const openedState = await okMessage({ type: "GET_STATE" });
  assert.ok(!openedState.seenVideoIds.includes(opened));
  assert.ok(openedState.watchIntentVideoIds.includes(opened));
  const reMark = await okMessage({ type: "MARK_SEEN", videoId: opened, generation: openedState.generation },
    { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url });
  assert.equal(reMark.seen, false);

  const staleId = idFor(89);
  const staleGeneration = openedState.generation;
  const reset = await okMessage({ type: "RESET_SEEN_VIDEOS" });
  assert.ok(reset.generation > staleGeneration);
  const stale = await okMessage({ type: "MARK_SEEN", videoId: staleId, generation: staleGeneration },
    { id: "test-extension", tab: { id: 1, url: youtubeTabs[0].url }, url: youtubeTabs[0].url });
  assert.equal(stale.seen, false);
  const afterReset = await okMessage({ type: "GET_STATE" });
  assert.ok(!afterReset.seenVideoIds.includes(staleId));
  assert.equal(afterReset.seenVideoIds.length, 0);
});

test("preferences are validated and a failed storage write is reported", async () => {
  const invalid = await dispatchRuntimeMessage({
    type: "SAVE_PREFS",
    prefs: { enabled: "yes", greyStrength: 300 }
  });
  assert.equal(invalid?.ok, false);

  const saved = await okMessage({
    type: "SAVE_PREFS",
    prefs: { enabled: false, greyStrength: 42 }
  });
  assert.deepEqual(saved.prefs, { enabled: false, greyStrength: 42 });

  local.failWrites = true;
  try {
    const failed = await dispatchRuntimeMessage({ type: "RESET_SEEN_VIDEOS" });
    assert.equal(failed?.ok, false, "write failure must reach popup, not appear successful");
  } finally {
    local.failWrites = false;
  }
});

test("tab badge counts are isolated by tab and reject invalid messages", async () => {
  const tabOne = { id: 1, url: "https://www.youtube.com/results?search_query=unit" };
  const tabTwo = { id: 2, url: "https://www.youtube.com/results?search_query=unit" };
  await dispatchRuntimeMessage({ type: "GREY_COUNT_UPDATE", count: 2 },
    { id: "test-extension", tab: tabOne, url: tabOne.url });
  await dispatchRuntimeMessage({ type: "GREY_COUNT_UPDATE", count: 5 },
    { id: "test-extension", tab: tabTwo, url: tabTwo.url });
  assert.equal((await okMessage({ type: "GET_TAB_COUNT", tabId: 1 })).count, 2);
  assert.equal((await okMessage({ type: "GET_TAB_COUNT", tabId: 2 })).count, 5);

  const bad = await dispatchRuntimeMessage({ type: "MARK_SEEN", videoId: "../bad", generation: 0 },
    { id: "untrusted", tab: { id: 3, url: "https://example.com/" }, url: "https://example.com/" });
  assert.equal(bad?.ok, false);
});

test("extension pages inside their own tabs can read, save, reset and count; they cannot mark videos", async () => {
  const extensionUrl = browser.runtime.getURL("popup/popup.html");
  const sender = {
    id: browser.runtime.id,
    url: extensionUrl,
    tab: { id: 77, url: extensionUrl }
  };

  const state = await okMessage({ type: "GET_STATE" }, sender);
  assert.ok(state.prefs);
  const saved = await okMessage({
    type: "SAVE_PREFS",
    prefs: { enabled: true, greyStrength: 61 }
  }, sender);
  assert.deepEqual(saved.prefs, { enabled: true, greyStrength: 61 });
  await dispatchRuntimeMessage({ type: "GREY_COUNT_UPDATE", count: 5 }, {
    id: browser.runtime.id,
    tab: { ...youtubeTabs[0] },
    url: youtubeTabs[0].url
  });
  assert.equal((await okMessage({ type: "GET_TAB_COUNT", tabId: 1 }, sender)).count, 5);

  const rejected = await dispatchRuntimeMessage({
    type: "MARK_SEEN",
    videoId: "EXTENSION001",
    generation: state.generation
  }, sender);
  assert.equal(rejected?.ok, false, "only a YouTube content tab may commit history");

  const reset = await okMessage({ type: "RESET_SEEN_VIDEOS" }, sender);
  assert.ok(reset.generation > state.generation);

  const mismatched = await dispatchRuntimeMessage({ type: "RESET_SEEN_VIDEOS" }, {
    id: browser.runtime.id,
    url: extensionUrl,
    tab: { id: 78, url: "https://example.com/" }
  });
  assert.equal(mismatched?.ok, false, "both extension page URLs must match the own extension origin");
});

test("legacy chunk repacking publishes every move and obsolete chunk atomically", async () => {
  await local.remove([...data.keys()]);
  writes.length = 0;
  const now = Date.now();
  const movedId = idFor(9999);
  const oldFirstChunk = {};
  for (let number = 100; number < 611; number++) oldFirstChunk[idFor(number)] = now;
  assert.equal(Object.keys(oldFirstChunk).length, 511);
  await local.set({
    seenChunk0: oldFirstChunk,
    seenChunk1: { [movedId]: now },
    seenManifest: { count: 512, chunkSize: 500 },
    historyGeneration: 4,
    historyCleanupAt: now
  });
  writes.length = 0;

  const { readFile } = await import("node:fs/promises");
  const source = await readFile("app-files/firefox/lib/storage.js", "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const freshStorage = await import(dataUrl);
  local.failRemove = true;
  const state = await freshStorage.getTrackingState();
  assert.equal(state.seenVideoIds.length, 512);
  assert.ok(state.seenVideoIds.includes(movedId));

  const migration = writes[0];
  assert.ok(migration, "migration should persist rewritten chunks");
  assert.ok(Object.hasOwn(migration, "seenChunk0"));
  assert.ok(Object.hasOwn(migration, "seenChunk1"));
  assert.deepEqual(migration.seenChunk1, {}, "obsolete key must be cleared in same change event");
  assert.ok(Object.hasOwn(migration.seenChunk0, movedId), "moved history stays in target chunk");
  const persisted = await local.get(["seenChunk0", "seenChunk1", "seenManifest"]);
  assert.equal(persisted.seenManifest.count, 512);
  assert.ok(persisted.seenChunk0[movedId]);
  assert.deepEqual(persisted.seenChunk1, {},
    "a failed cleanup may leave only an empty obsolete chunk");
  assert.ok(state.seenVideoIds.every(id => persisted.seenChunk0[id]));

  await freshStorage.addSeenVideo(idFor(9998), state.generation);
  local.failRemove = true;
  const reset = await freshStorage.resetSeenVideos();
  assert.ok(reset.generation > state.generation, "reset succeeds after its atomic clear");
  const afterReset = await freshStorage.getTrackingState();
  assert.deepEqual(afterReset.seenVideoIds, []);
  assert.deepEqual(afterReset.watchIntentVideoIds, []);
  const emptyChunks = await local.get(["seenChunk0", "seenChunk1"]);
  assert.deepEqual(emptyChunks.seenChunk0, {});
  assert.deepEqual(emptyChunks.seenChunk1, {}, "failed removal leaves a harmless empty key");
  local.failRemove = false;
});
