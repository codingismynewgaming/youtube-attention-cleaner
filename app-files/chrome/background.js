/**
 * Background service worker — Chrome/Edge build
 * All imports inlined (Chrome MV3 service workers do not support ES modules)
 */

// ── Shim ──────────────────────────────────────────────────────────────
if (typeof globalThis.browser === 'undefined' && typeof chrome !== 'undefined') {
  globalThis.browser = chrome;
}

// ── Inlined from lib/urls.js ──────────────────────────────────────────
function isValidVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function extractVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    const isYT = parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com';
    const isShort = parsed.hostname === 'youtu.be';
    if (!isYT && !isShort) return null;

    if (parsed.pathname === '/watch') {
      const v = parsed.searchParams.get('v');
      return isValidVideoId(v) ? v : null;
    }
    if (parsed.pathname.startsWith('/shorts/')) {
      const [, , id] = parsed.pathname.split('/');
      return isValidVideoId(id) ? id : null;
    }
    if (isShort) {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return isValidVideoId(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Inlined from lib/storage.js (only what background needs) ──────────
const PREFS_KEY = 'prefs';
const WATCH_INTENT_KEY = 'watchIntent';
const DEFAULT_PREFS = { enabled: true, greyStrength: 75 };

async function getPrefs() {
  try {
    const result = await browser.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(result[PREFS_KEY] || {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

async function addWatchIntent(videoId) {
  try {
    const result = await browser.storage.local.get(WATCH_INTENT_KEY);
    const intents = result[WATCH_INTENT_KEY] || {};
    intents[videoId] = { markedAt: Date.now() };
    await browser.storage.local.set({ [WATCH_INTENT_KEY]: intents });
  } catch (e) {
    console.error('[YAC Storage] Failed to add watch intent:', e);
  }
}

// ── Service worker logic ──────────────────────────────────────────────
const tabGreyCounts = new Map();

async function updateBadge(tabId, count) {
  try {
    const prefs = await getPrefs();
    if (!prefs.enabled) {
      await browser.action.setBadgeText({ text: '', tabId });
      return;
    }
    await browser.action.setBadgeText({
      text: count > 0 ? count.toString() : '',
      tabId
    });
    await browser.action.setBadgeBackgroundColor({ color: '#CC0000', tabId });
  } catch (e) {
    console.error('[YAC Background] Failed to update badge:', e);
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'PREFS_CHANGED') {
    browser.tabs.query({ url: 'https://www.youtube.com/*' }).then(tabs => {
      tabs.forEach(tab => {
        const count = tabGreyCounts.get(tab.id) || 0;
        updateBadge(tab.id, count);
      });
    });
  }
  if (message.type === 'GREY_COUNT_UPDATE' && sender.tab) {
    tabGreyCounts.set(sender.tab.id, message.count);
    updateBadge(sender.tab.id, message.count);
  }
  if (message.type === 'WATCH_INTENT' && message.videoId) {
    addWatchIntent(message.videoId);
  }
  if (message.type === 'RESET_SEEN_VIDEOS') {
    console.log('[YAC Background] Reset requested from popup');
  }
  return Promise.resolve();
});

browser.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (url.includes('/watch')) {
    const videoId = extractVideoId(url);
    if (videoId) {
      console.log('[YAC Background] 🎬 Watch intent via navigation:', videoId);
      await addWatchIntent(videoId);
    }
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
    tabGreyCounts.set(tabId, 0);
    updateBadge(tabId, 0);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabGreyCounts.delete(tabId);
});

console.log('[YAC Background] Service worker initialized');
