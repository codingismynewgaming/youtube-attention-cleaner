/**
 * Background service worker
 * Handles: badge updates, watch intent tracking, navigation-based detection
 */
import { extractVideoId } from './lib/urls.js';
import { addWatchIntent, getPrefs } from './lib/storage.js';

// Current grey count per tab
const tabGreyCounts = new Map();

/**
 * Update badge text for a tab
 * @param {number} tabId
 * @param {number} count
 */
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
    
    await browser.action.setBadgeBackgroundColor({
      color: '#CC0000',
      tabId
    });
  } catch (e) {
    console.error('[YAC Background] Failed to update badge:', e);
  }
}

/**
 * Handle messages from content script and popup
 */
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'PREFS_CHANGED') {
    // Update badge for all YouTube tabs when prefs change
    browser.tabs.query({ url: 'https://www.youtube.com/*' }).then(tabs => {
      tabs.forEach(tab => {
        const count = tabGreyCounts.get(tab.id) || 0;
        updateBadge(tab.id, count);
      });
    });
  }
  
  if (message.type === 'GREY_COUNT_UPDATE' && sender.tab) {
    // Store count for this tab
    tabGreyCounts.set(sender.tab.id, message.count);
    updateBadge(sender.tab.id, message.count);
  }
  
  if (message.type === 'WATCH_INTENT' && message.videoId) {
    // Mark video as watched intent
    addWatchIntent(message.videoId);
  }
  
  if (message.type === 'RESET_SEEN_VIDEOS') {
    // Forward reset command to content script
    console.log('[YAC Background] Reset requested from popup');
    // Content script handles this from its runtime message listener.
  }
  
  return Promise.resolve();
});

/**
 * Track navigation to detect new-tab video opens
 */
browser.webNavigation.onCommitted.addListener(async (details) => {
  // Only track main frame navigations
  if (details.frameId !== 0) return;
  
  const url = details.url;
  
  // Only long-form watch pages count as explicit watch intent.
  // Shorts are tracked separately by the content script.
  if (url.includes('/watch')) {
    const videoId = extractVideoId(url);
    if (videoId) {
      console.log('[YAC Background] 🎬 Watch intent detected via navigation:', videoId);
      await addWatchIntent(videoId);
    }
  }
});

/**
 * Handle tab updates for badge management
 */
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
    // Reset count for this tab when it loads
    tabGreyCounts.set(tabId, 0);
    updateBadge(tabId, 0);
  }
});

/**
 * Clean up when tabs are closed
 */
browser.tabs.onRemoved.addListener((tabId) => {
  tabGreyCounts.delete(tabId);
});

console.log('[YAC Background] Service worker initialized');
