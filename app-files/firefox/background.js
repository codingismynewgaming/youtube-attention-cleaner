/**
 * Single owner for persistent history, preferences, watch intent and badge state.
 */
import { extractVideoId } from './lib/urls.js';
import {
  addSeenVideo, addWatchIntent, getPrefs, getTrackingState, resetSeenVideos, savePrefs
} from './lib/storage.js';

if (typeof globalThis.browser === 'undefined' && typeof chrome !== 'undefined') {
  globalThis.browser = chrome;
}

const tabGreyCounts = new Map();
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isYouTubePage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.youtube.com';
  } catch {
    return false;
  }
}

function isExtensionPage(url) {
  return typeof url === 'string' && url.startsWith(browser.runtime.getURL(''));
}

function senderAllowed(sender) {
  return sender?.id === browser.runtime.id &&
    (!sender.tab || isYouTubePage(sender.tab.url) || isExtensionPage(sender.tab.url));
}

function fromExtensionPage(sender) {
  return senderAllowed(sender) &&
    (isExtensionPage(sender.url) || isExtensionPage(sender.tab?.url));
}

async function updateBadge(tabId, count) {
  try {
    const prefs = await getPrefs();
    await browser.action.setBadgeText({
      tabId,
      text: prefs.enabled && count > 0 ? String(Math.min(count, 999)) : ''
    });
    if (prefs.enabled && count > 0) {
      await browser.action.setBadgeBackgroundColor({ color: '#CC0000', tabId });
    }
  } catch (error) {
    console.warn('[YAC] Badge update failed:', error);
  }
}

async function broadcast(message) {
  const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  await Promise.allSettled(tabs.map(tab =>
    browser.tabs.sendMessage(tab.id, message)
  ));
}

function responseError(error) {
  console.error('[YAC] Background request failed:', error);
  return { ok: false, error: error instanceof TypeError ? 'invalid_request' : 'storage_error' };
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!senderAllowed(sender) || !message || typeof message.type !== 'string') {
    return Promise.resolve({ ok: false, error: 'invalid_sender' });
  }

  return (async () => {
    switch (message.type) {
      case 'GET_STATE':
        return { ok: true, ...(await getTrackingState()) };

      case 'MARK_SEEN': {
        if (!sender.tab || !isYouTubePage(sender.tab.url) ||
            !VIDEO_ID_PATTERN.test(message.videoId)) {
          return { ok: false, error: 'invalid_request' };
        }
        const result = await addSeenVideo(message.videoId, message.generation);
        return { ok: true, ...result };
      }

      case 'WATCH_INTENT': {
        if (!sender.tab || !isYouTubePage(sender.tab.url) ||
            !VIDEO_ID_PATTERN.test(message.videoId)) {
          return { ok: false, error: 'invalid_request' };
        }
        const result = await addWatchIntent(message.videoId);
        return { ok: true, ...result };
      }

      case 'SAVE_PREFS': {
        if (!fromExtensionPage(sender)) return { ok: false, error: 'invalid_sender' };
        const prefs = await savePrefs(message.prefs);
        await broadcast({ type: 'PREFS_CHANGED', prefs });
        await Promise.allSettled([...tabGreyCounts].map(([tabId, count]) =>
          updateBadge(tabId, count)
        ));
        return { ok: true, prefs };
      }

      case 'RESET_SEEN_VIDEOS': {
        if (!fromExtensionPage(sender)) return { ok: false, error: 'invalid_sender' };
        const result = await resetSeenVideos();
        tabGreyCounts.clear();
        await broadcast({ type: 'HISTORY_RESET', generation: result.generation });
        return { ok: true, ...result };
      }

      case 'GREY_COUNT_UPDATE': {
        if (!sender.tab || !Number.isInteger(message.count) || message.count < 0) {
          return { ok: false, error: 'invalid_request' };
        }
        tabGreyCounts.set(sender.tab.id, message.count);
        await updateBadge(sender.tab.id, message.count);
        return { ok: true };
      }

      case 'GET_TAB_COUNT': {
        if (!fromExtensionPage(sender) || !Number.isInteger(message.tabId)) {
          return { ok: false, error: 'invalid_request' };
        }
        if (tabGreyCounts.has(message.tabId)) {
          return { ok: true, count: tabGreyCounts.get(message.tabId) };
        }
        try {
          const reply = await browser.tabs.sendMessage(message.tabId, { type: 'GET_GREY_COUNT' });
          if (Number.isInteger(reply?.count) && reply.count >= 0) {
            tabGreyCounts.set(message.tabId, reply.count);
            return { ok: true, count: reply.count };
          }
        } catch {
          // The active tab may not have a content script yet.
        }
        return { ok: true, count: 0 };
      }

      default:
        return { ok: false, error: 'unknown_request' };
    }
  })().catch(responseError);
});

browser.webNavigation.onCommitted.addListener(async details => {
  if (details.frameId !== 0 || !isYouTubePage(details.url)) return;
  const parsed = new URL(details.url);
  if (parsed.pathname !== '/watch') return;
  const videoId = extractVideoId(details.url);
  if (!videoId) return;
  try {
    await addWatchIntent(videoId);
  } catch (error) {
    console.error('[YAC] Navigation watch intent failed:', error);
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !isYouTubePage(tab.url)) return;
  tabGreyCounts.set(tabId, 0);
  updateBadge(tabId, 0);
});

browser.tabs.onRemoved.addListener(tabId => {
  tabGreyCounts.delete(tabId);
});
