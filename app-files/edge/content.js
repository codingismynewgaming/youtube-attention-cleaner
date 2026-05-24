/**
 * Content script for YouTube Attention Cleaner extension
 * Tracks viewport visibility and applies grey styling to seen videos
 */
import './lib/browser-shim.js';
import { extractVideoId, classifyPage, isAllowedURL, shouldGreyOnPage, isPrimaryVideo } from './lib/urls.js';
import { addSeenVideo, hasWatchIntent, getAllSeenVideos, isEnabled, getGreyStrength } from './lib/storage.js';

// State tracking
let currentPageType = null;
let isEnabledFlag = false;
let currentGreyStrength = 50;
let greyedElements = new Set();
let seenVideoCache = new Set(); // Cache of seen video IDs
let resetTime = 0; // Timestamp of last reset - prevents immediate re-greying
let currentShortsTrackToken = 0;
const PAGE_DEBUG_REQUEST_EVENT = 'yac:debug-request';
const PAGE_DEBUG_RESPONSE_EVENT = 'yac:debug-response';
const PAGE_DEBUG_ROOT_ID = 'yac-page-debug-root';

// Selectors for video tiles - multiple fallbacks
const SELECTORS = {
  // Primary selectors for different YouTube areas
  FEED_ITEM: 'ytd-rich-item-renderer, ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model',

  // Sidebar selectors for watch page - expanded for current YouTube structure
  // Also includes selectors for videos inside engagement panels and secondary content
  SIDEBAR_ITEM: 'ytd-compact-video-renderer, ytd-compact-autoplay-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer ytd-compact-autoplay-renderer, ytd-watch-next-secondary-results-renderer yt-lockup-view-model, ytd-engagement-panel-section-list-renderer ytd-compact-video-renderer, #secondary yt-lockup-view-model',

  // Link selectors (for canonical watch URL video ID extraction)
  WATCH_LINK: 'a[href*="/watch?"]',
  THUMBNAIL_WRAPPER: 'ytd-thumbnail, .ytd-thumbnail, #thumbnail, .yt-core-image, img.yt-core-image, a#thumbnail',

  // Containers
  FEED_GRID: 'ytd-rich-grid-renderer',
  SIDEBAR_CONTAINER: 'ytd-watch-next-secondary-results-renderer, #secondary.ytd-watch-flexy, #secondary-inner.ytd-watch-flexy, ytd-compact-video-renderer, yt-lockup-view-model, ytd-engagement-panel-section-list-renderer, #secondary, #secondary-inner'
};

const TRACKING_PAGES = new Set(['home', 'subscriptions', 'search']);
const REQUIRED_FULLY_VISIBLE_MS = 2000;
const REQUIRED_OUTSIDE_VIEWPORT_MS = 2000;
const SHORTS_VIEWER_TRACK_MS = 2000;

/**
 * Listen for messages from popup/background
 */
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'RESET_SEEN_VIDEOS') {
    resetSeenVideos();
  }

  if (message.type === 'PREFS_CHANGED') {
    if (message.prefs) {
      isEnabledFlag = message.prefs.enabled;
      currentGreyStrength = message.prefs.greyStrength;

      if (!isEnabledFlag) {
        removeAllGrey();
      } else {
        refreshAllGrey();
      }
    }
  }

  return Promise.resolve();
});

/**
 * Initialize the content script
 */
async function init() {
  console.log('[YAC] Initializing YouTube Attention Cleaner...');
  console.log('[YAC] URL:', window.location.href);
  console.log('[YAC] Hostname allowed:', isAllowedURL(window.location.hostname));

  if (!isAllowedURL(window.location.hostname)) {
    console.log('[YAC] URL not allowed, exiting');
    return;
  }

  try {
    isEnabledFlag = await isEnabled();
    currentGreyStrength = await getGreyStrength();
    seenVideoCache = await getAllSeenVideos();
    console.log('[YAC] Enabled:', isEnabledFlag, 'Grey strength:', currentGreyStrength, 'Seen videos:', seenVideoCache.size);
  } catch(e) {
    console.log('[YAC] Storage error:', e);
  }

  setupScrollRadar();
  setupMutationObserver();
  setupClickCapture();
  setupNavigationHooks();
  setupPageDebugBridge();
  injectGreyStyles();

  console.log('[YAC] Setup complete, scheduling first scan...');
  setTimeout(scanForTiles, 1000);
  setTimeout(scanForTiles, 3000); // Additional scan after more content loads
  setTimeout(scanForTiles, 5000); // Third scan

  // Periodic scan every 10 seconds
  setInterval(() => {
    if (isEnabledFlag) {
      console.log('[YAC] Periodic scan...');
      scanForTiles();
    }
  }, 10000);

  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.prefs) {
        const newPrefs = changes.prefs.newValue;
        if (newPrefs) {
          isEnabledFlag = newPrefs.enabled;
          currentGreyStrength = newPrefs.greyStrength;
          if (!isEnabledFlag) removeAllGrey();
          else refreshAllGrey();
        }
      }
    });
  } catch(e) {
    console.log('[YAC] onChanged listener error:', e);
  }
}

/**
 * Inject CSS styles for grey overlay
 */
function injectGreyStyles() {
  const styleId = 'seen-videos-styles';
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Light mode (default) */
    .seen-video-overlay {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      background: #e0e0e0 !important;
      pointer-events: none !important;
      z-index: 9999 !important;
      border-radius: 8px !important;
      transition: opacity 0.3s ease !important;
    }

    .seen-video-thumbnail {
      filter: grayscale(100%) brightness(0.7) !important;
    }

    /* Dark mode - use darker grey */
    @media (prefers-color-scheme: dark) {
      .seen-video-overlay {
        background: #1a1a1a !important;
      }
    }

    /* YouTube dark mode detection */
    [dark] .seen-video-overlay,
    [data-theme="dark"] .seen-video-overlay,
    .dark .seen-video-overlay,
    .theme-dark .seen-video-overlay {
      background: #1a1a1a !important;
    }
  `;
  document.head.appendChild(style);
  console.log('[YAC] Injected grey styles (dark/light mode aware)');
}

/**
 * Radar polling for tracking tile visibility (bypasses IntersectionObserver issues with virtual DOM)
 */
let radarInterval;

function setupScrollRadar() {
  // Check on scroll and periodically
  window.addEventListener('scroll', () => {
    debounceRadarCheck();
  }, { passive: true });

  // Also run on an interval in case scroll events are missed or DOM changes without scrolling
  radarInterval = setInterval(() => {
    checkRadar();
  }, 1000);
}

let radarTimeout = null;
function debounceRadarCheck() {
  if (radarTimeout) clearTimeout(radarTimeout);
  radarTimeout = setTimeout(() => checkRadar(), 200);
}

function checkRadar() {
  if (!isEnabledFlag || !shouldGreyOnPage(window.location.pathname)) return;

  currentPageType = classifyPage(window.location.pathname);

  if (currentPageType === 'shorts') {
    scheduleShortsViewerTracking();
  }

  const tiles = findAllVideoTiles();

  tiles.forEach((tile) => {
    if (isPrimaryVideo(tile)) return;

    const videoId = getVideoIdFromTile(tile);
    if (!videoId) return;

    if (seenVideoCache.has(videoId)) {
      applyGreyToTile(tile, videoId);
      return;
    }

    if (!TRACKING_PAGES.has(currentPageType) || !isTrackableFeedTile(tile)) {
      return;
    }

    if (!tile._radarState) {
      tile._radarState = {
        state: 'idle',
        visibleSince: null,
        outSince: null
      };
    }

    const state = tile._radarState;
    const isFullyVisible = isTileFullyVisible(tile);
    const isOutsideViewport = isTileOutsideViewport(tile);

    if (isFullyVisible) {
      if (state.state === 'idle') {
        state.state = 'viewing';
        state.visibleSince = Date.now();
        state.outSince = null;
      } else if (state.state === 'viewing') {
        const viewDuration = Date.now() - state.visibleSince;
        if (viewDuration >= REQUIRED_FULLY_VISIBLE_MS) {
          state.state = 'eligible';
        }
      } else if (state.state === 'eligibleOutside') {
        state.state = 'eligible';
        state.outSince = null;
      }
      removeGreyFromTile(tile);
      return;
    }

    if (isOutsideViewport) {
      if (state.state === 'viewing') {
        state.state = 'idle';
        state.visibleSince = null;
        state.outSince = null;
      } else if (state.state === 'eligible') {
        state.state = 'eligibleOutside';
        state.outSince = Date.now();
      } else if (state.state === 'eligibleOutside' && state.outSince) {
        const outsideDuration = Date.now() - state.outSince;
        if (outsideDuration >= REQUIRED_OUTSIDE_VIEWPORT_MS) {
          state.state = 'seen';
          state.outSince = null;
          commitSeenVideo(videoId);
        }
      }
      return;
    }

    if (state.state === 'viewing' || state.state === 'idle') {
      state.state = 'idle';
      state.visibleSince = null;
      state.outSince = null;
    } else if (state.state === 'eligibleOutside') {
      state.state = 'eligible';
      state.outSince = null;
    }
  });
}

async function commitSeenVideo(videoId) {
  if (seenVideoCache.has(videoId)) return;
  seenVideoCache.add(videoId);
  console.log('[YAC] Committing seen video:', videoId);

  const hasIntent = await hasWatchIntent(videoId);
  if (hasIntent) {
    console.log('[YAC] Video has watch intent, not marking as seen:', videoId);
    seenVideoCache.delete(videoId);
    return;
  }

  await addSeenVideo(videoId);
  console.log('[YAC] Saved to storage, applying grey...');
  applyGreyToVideo(videoId);
  updateBadgeCount();
}

function scanForTiles() {
  console.log('[YAC] scanForTiles called');
  console.log('[YAC] isEnabledFlag:', isEnabledFlag, 'shouldGreyOnPage:', shouldGreyOnPage(window.location.pathname));

  if (!isEnabledFlag || !shouldGreyOnPage(window.location.pathname)) {
    console.log('[YAC] Greying disabled or not on allowed page');
    return;
  }

  currentPageType = classifyPage(window.location.pathname);
  console.log('[YAC] Page type:', currentPageType);

  if (currentPageType === 'shorts') {
    scheduleShortsViewerTracking();
  }

  const tiles = findAllVideoTiles();
  console.log('[YAC] Found', tiles.length, 'video tiles');

  tiles.forEach((tile, i) => {
    const videoId = getVideoIdFromTile(tile);
    console.log(`[YAC] Tile ${i}: videoId =`, videoId);
    if (!videoId) return;

    // Skip if recently reset (give 5 second grace period)
    const timeSinceReset = Date.now() - resetTime;
    if (timeSinceReset < 5000) {
      console.log('[YAC] Skipping video, recently reset:', videoId, 'time since reset:', timeSinceReset);
      return;
    }

    if (isPrimaryVideo(tile)) {
      console.log('[YAC] Tile is primary video, skipping');
      return;
    }

    if (seenVideoCache.has(videoId)) {
      console.log('[YAC] Video in cache, greying:', videoId);
      applyGreyToTile(tile, videoId);
    }
  });

  checkRadar();
  updateBadgeCount();
}

function findAllVideoTiles() {
  const tiles = [];

  // Find feed items (home, subscriptions, etc.)
  const feedItems = document.querySelectorAll(SELECTORS.FEED_ITEM);
  console.log('[YAC] SELECTOR:', SELECTORS.FEED_ITEM, 'matched', feedItems.length, 'elements');

  // Find sidebar items (watch page recommendations)
  const sidebarItems = document.querySelectorAll(SELECTORS.SIDEBAR_ITEM);
  console.log('[YAC] SIDEBAR SELECTOR:', SELECTORS.SIDEBAR_ITEM, 'matched', sidebarItems.length, 'elements');

  // Find compact video renderers specifically (sidebar videos on watch page)
  const compactVideos = document.querySelectorAll('ytd-compact-video-renderer');
  console.log('[YAC] Compact video renderers found:', compactVideos.length);

  // Find videos in secondary/engagement panels that might be missed
  const secondaryVideos = document.querySelectorAll('#secondary ytd-video-renderer, #secondary yt-lockup-view-model, ytd-engagement-panel-section-list-renderer ytd-video-renderer, ytd-engagement-panel-section-list-renderer yt-lockup-view-model, ytd-watch-next-secondary-results-renderer ytd-video-renderer, ytd-watch-next-secondary-results-renderer yt-lockup-view-model');
  console.log('[YAC] Secondary/Engagement videos found:', secondaryVideos.length);

  // Also try to find videos in the secondary section with broader selectors
  const secondaryContent = document.querySelector('#secondary');
  let secondaryCompactVideos = [];
  let secondaryLockups = [];
  if (secondaryContent) {
    secondaryCompactVideos = Array.from(secondaryContent.querySelectorAll('ytd-compact-video-renderer'));
    secondaryLockups = Array.from(secondaryContent.querySelectorAll('yt-lockup-view-model'));
    console.log('[YAC] Secondary content compact videos found:', secondaryCompactVideos.length);
    console.log('[YAC] Secondary content lockups found:', secondaryLockups.length);
  }

  // Combine all
  const allItems = [...feedItems, ...sidebarItems, ...compactVideos, ...secondaryVideos, ...secondaryCompactVideos, ...secondaryLockups];

  if (allItems.length === 0) {
    // Debug: what selectors are actually on the page?
    const ytdRich = document.querySelectorAll('ytd-rich-item-renderer').length;
    const ytdRichGridMedia = document.querySelectorAll('ytd-rich-grid-media').length;
    const ytdVideo = document.querySelectorAll('ytd-video-renderer').length;
    const ytdGrid = document.querySelectorAll('ytd-grid-video-renderer').length;
    const ytdCompact = document.querySelectorAll('ytd-compact-video-renderer').length;
    const ytdReel = document.querySelectorAll('ytd-reel-item-renderer').length;
    const sidebar = document.querySelectorAll('ytd-compact-video-renderer').length;
    const secondary = document.querySelectorAll('#secondary ytd-video-renderer').length;
    const lockup = document.querySelectorAll('yt-lockup-view-model').length;
    const engagement = document.querySelectorAll('ytd-engagement-panel-section-list-renderer ytd-video-renderer, ytd-engagement-panel-section-list-renderer yt-lockup-view-model').length;
    console.log('[YAC] Selector breakdown - rich-item:', ytdRich, 'rich-grid-media:', ytdRichGridMedia, 'video:', ytdVideo, 'grid:', ytdGrid, 'compact:', ytdCompact, 'reel:', ytdReel, 'lockup:', lockup, 'sidebar:', sidebar, 'secondary videos:', secondary, 'engagement videos:', engagement);
  }

  allItems.forEach(tile => {
    if (!tiles.includes(tile)) tiles.push(tile);
  });

  console.log('[YAC] Total unique tiles:', tiles.length);
  return tiles;
}

function getVideoIdFromTile(tile) {
  const tileLink = tile.querySelector(SELECTORS.WATCH_LINK);
  if (tileLink) {
    const videoId = extractVideoId(tileLink.href || tileLink.getAttribute('href'));
    if (videoId) return videoId;
  }

  const allLinks = tile.querySelectorAll('a');
  for (const link of allLinks) {
    const videoId = extractVideoId(link.href || link.getAttribute('href'));
    if (videoId) return videoId;
  }

  let parent = tile.parentElement;
  while (parent && parent !== document) {
    const parentLink = parent.querySelector(SELECTORS.WATCH_LINK);
    if (parentLink) {
      const videoId = extractVideoId(parentLink.href || parentLink.getAttribute('href'));
      if (videoId) return videoId;
    }
    parent = parent.parentElement;
  }

  return null;
}

function getCurrentShortVideoId() {
  if (!window.location.pathname.startsWith('/shorts/')) {
    return null;
  }

  return extractVideoId(window.location.href);
}

function scheduleShortsViewerTracking() {
  const videoId = getCurrentShortVideoId();
  if (!videoId || seenVideoCache.has(videoId)) {
    return;
  }

  const token = ++currentShortsTrackToken;
  window.setTimeout(() => {
    if (token !== currentShortsTrackToken) return;
    if (!isEnabledFlag) return;
    if (classifyPage(window.location.pathname) !== 'shorts') return;

    const currentVideoId = getCurrentShortVideoId();
    if (currentVideoId !== videoId) return;

    commitSeenVideo(videoId);
  }, SHORTS_VIEWER_TRACK_MS);
}

function isTrackableFeedTile(tile) {
  if (!tile || tile.hidden) return false;

  const rect = tile.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  return getVideoIdFromTile(tile) !== null;
}

function isTileFullyVisible(tile) {
  const rect = tile.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= windowHeight &&
    rect.right <= windowWidth
  );
}

function isTileInViewport(tile) {
  const rect = tile.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < windowHeight &&
    rect.left < windowWidth
  );
}

function isTileOutsideViewport(tile) {
  const rect = tile.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    (rect.bottom <= 0 || rect.top >= windowHeight || rect.right <= 0 || rect.left >= windowWidth)
  );
}

function setupMutationObserver() {
  console.log('[YAC] Setting up MutationObserver');
  const mutationObserver = new MutationObserver((mutations) => {
    let shouldRescan = false;
    let addedCount = 0;
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length > 0) {
        shouldRescan = true;
        addedCount += mutation.addedNodes.length;
      }
    });
    if (shouldRescan) {
      console.log('[YAC] MutationObserver detected', addedCount, 'added nodes');
      debounceRescan();
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  console.log('[YAC] MutationObserver active on document.body');
}

let rescanTimeout = null;
function debounceRescan() {
  if (rescanTimeout) clearTimeout(rescanTimeout);
  rescanTimeout = setTimeout(() => scanForTiles(), 800);
}

function setupClickCapture() {
  document.addEventListener('click', async (event) => {
    const link = event.target.closest(SELECTORS.WATCH_LINK);
    if (link) {
      const videoId = extractVideoId(link.href || link.getAttribute('href'));
      if (videoId) {
        await browser.runtime.sendMessage({ type: 'WATCH_INTENT', videoId });
        seenVideoCache.delete(videoId);
        removeGreyFromVideo(videoId);
      }
    }
  }, true);
}

function setupNavigationHooks() {
  document.addEventListener('yt-navigate-finish', () => {
    currentShortsTrackToken += 1;
    getAllSeenVideos().then(cache => {
      seenVideoCache = cache;
      refreshAllGrey();
      if (classifyPage(window.location.pathname) === 'shorts') {
        scheduleShortsViewerTracking();
      }
    });
  });

  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    currentShortsTrackToken += 1;
    setTimeout(() => {
      scanForTiles();
    }, 500);
  };
}

function setupPageDebugBridge() {
  try {
    if (typeof exportFunction !== 'function' || !window.wrappedJSObject) {
      console.warn('[YAC Debug] exportFunction bridge unavailable in this environment');
      return;
    }

    const pageWindow = window.wrappedJSObject;
    const existingDebug = pageWindow.seenVideosDebug || {};
    const debugApi = cloneInto(existingDebug, pageWindow);

    debugApi.copySidebarDiagnostics = exportFunction(() => {
      const payload = copySidebarDiagnostics();
      return cloneInto(payload, pageWindow);
    }, pageWindow);

    pageWindow.seenVideosDebug = debugApi;
    console.log('[YAC Debug] Exposed seenVideosDebug bridge to page context');
  } catch (error) {
    console.error('[YAC Debug] Failed to expose page debug bridge:', error);
  }
}

function applyGreyToVideo(videoId) {
  if (!isEnabledFlag) return;
  const tiles = findAllVideoTiles();
  for (const tile of tiles) {
    const id = getVideoIdFromTile(tile);
    if (id === videoId) {
      applyGreyToTile(tile, videoId);
    }
  }
}

async function applyGreyToMatchingTiles() {
  if (!isEnabledFlag) return;

  // Skip if recently reset
  const timeSinceReset = Date.now() - resetTime;
  if (timeSinceReset < 5000) {
    console.log('[YAC] Skipping applyGreyToMatchingTiles, recently reset');
    return;
  }

  const tiles = findAllVideoTiles();
  for (const tile of tiles) {
    const videoId = getVideoIdFromTile(tile);
    if (!videoId) continue;
    if (!seenVideoCache.has(videoId)) continue;

    // Grey instantly from cache (cross-page memory)
    const hasIntent = await hasWatchIntent(videoId);
    if (hasIntent) continue;
    applyGreyToTile(tile, videoId);
  }
  updateBadgeCount();
}

function applyGreyToTile(tile, videoId) {
  if (isPrimaryVideo(tile)) return;

  const greyTarget = getGreyTarget(tile);
  if (!greyTarget) return;

  // Check if THIS SPECIFIC TILE already has grey overlay
  const existingOverlay = greyTarget.querySelector(':scope > .seen-video-overlay');
  if (existingOverlay) {
    console.log('[YAC] Tile already has overlay, updating opacity for:', videoId);
    const opacity = currentGreyStrength / 100;
    existingOverlay.style.opacity = opacity.toString();
    return;
  }

  console.log('[YAC] Creating new overlay for tile:', videoId);
  const overlay = document.createElement('div');
  overlay.className = 'seen-video-overlay';
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 9999;
    border-radius: 8px;
    transition: opacity 0.3s ease;
    opacity: ${currentGreyStrength / 100};
    display: block;
  `;

  // Detect dark mode
  const isDarkMode = document.documentElement.hasAttribute('dark') ||
    document.body.hasAttribute('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches ||
    document.querySelector('meta[name="color-scheme"][content="dark"]') !== null;

  if (isDarkMode) {
    overlay.style.background = '#1a1a1a';
  } else {
    overlay.style.background = '#e0e0e0';
  }

  const computedStyle = window.getComputedStyle(greyTarget);
  if (computedStyle.position === 'static') {
    greyTarget.style.position = 'relative';
  }
  greyTarget.style.overflow = 'hidden';
  greyTarget.appendChild(overlay);

  const thumbnail = tile.querySelector(SELECTORS.THUMBNAIL_WRAPPER);
  if (thumbnail) {
    thumbnail.classList.add('seen-video-thumbnail');
    console.log('[YAC] Added thumbnail class');
  } else {
    // Try to find thumbnail with broader selectors
    const altThumbnail = tile.querySelector('img, ytd-thumbnail img, #thumbnail img');
    if (altThumbnail) {
      altThumbnail.classList.add('seen-video-thumbnail');
      console.log('[YAC] Found alternative thumbnail for:', videoId);
    } else {
      console.log('[YAC] No thumbnail found for:', videoId);
    }
  }

  // Track unique video IDs for badge count
  greyedElements.add(videoId);
  console.log('[YAC] Grey applied to tile for video:', videoId);
}

function refreshAllGrey() {
  document.querySelectorAll('.seen-video-overlay').forEach(el => el.remove());
  document.querySelectorAll('.seen-video-thumbnail').forEach(el => el.classList.remove('seen-video-thumbnail'));
  greyedElements.clear();
  applyGreyToMatchingTiles();
}

function removeGreyFromVideo(videoId) {
  greyedElements.delete(videoId);
  const tiles = findAllVideoTiles();
  tiles.forEach(tile => {
    const id = getVideoIdFromTile(tile);
    if (id === videoId) {
      removeGreyFromTile(tile);
    }
  });
  updateBadgeCount();
}

function removeGreyFromTile(tile) {
  const greyTarget = getGreyTarget(tile);
  const overlay = greyTarget?.querySelector(':scope > .seen-video-overlay');
  if (overlay) overlay.remove();

  const thumbnail = tile.querySelector(SELECTORS.THUMBNAIL_WRAPPER);
  if (thumbnail) thumbnail.classList.remove('seen-video-thumbnail');

  const altThumbnail = tile.querySelector('img, ytd-thumbnail img, #thumbnail img');
  if (altThumbnail) altThumbnail.classList.remove('seen-video-thumbnail');
}

function getGreyTarget(tile) {
  if (!tile) return null;

  return (
    tile.querySelector('.yt-lockup-view-model-wiz') ||
    tile.querySelector('.yt-lockup-view-model-wiz__content-image') ||
    tile.querySelector('.yt-lockup-view-model-wiz__content') ||
    tile.querySelector('#dismissible') ||
    tile.querySelector('#content') ||
    tile.querySelector('#details') ||
    tile.querySelector('ytd-thumbnail') ||
    tile
  );
}

function collectSidebarDiagnostics() {
  const compact = Array.from(document.querySelectorAll('ytd-compact-video-renderer')).slice(0, 5);
  const payload = {
    url: window.location.href,
    pageType: classifyPage(window.location.pathname),
    counts: {
      compact: document.querySelectorAll('ytd-compact-video-renderer').length,
      compactAutoplay: document.querySelectorAll('ytd-compact-autoplay-renderer').length,
      videoRendererInSecondary: document.querySelectorAll('#secondary ytd-video-renderer').length,
      lockupInSecondary: document.querySelectorAll('#secondary yt-lockup-view-model, #secondary ytd-rich-item-renderer, #secondary ytd-rich-grid-media').length,
      secondaryExists: !!document.querySelector('#secondary'),
      secondaryInnerExists: !!document.querySelector('#secondary-inner'),
      watchNextExists: !!document.querySelector('ytd-watch-next-secondary-results-renderer')
    },
    sampleItems: compact.map((el, i) => ({
      i,
      tag: el.tagName,
      videoId: getVideoIdFromTile(el),
      hasDismissible: !!el.querySelector('#dismissible'),
      hasContent: !!el.querySelector('#content'),
      hasDetails: !!el.querySelector('#details'),
      closestSecondary: !!el.closest('#secondary'),
      greyTargetTag: getGreyTarget(el)?.tagName || null,
      greyTargetId: getGreyTarget(el)?.id || null,
      overlayPresentOnTile: !!el.querySelector('.seen-video-overlay'),
      overlayPresentOnGreyTarget: !!getGreyTarget(el)?.querySelector(':scope > .seen-video-overlay'),
      html: el.outerHTML.slice(0, 1200)
    })),
    secondaryHtml: document.querySelector('#secondary')?.innerHTML.slice(0, 3000) || 'NO #secondary'
  };

  return payload;
}

function copySidebarDiagnostics() {
  const payload = collectSidebarDiagnostics();
  const text = JSON.stringify(payload, null, 2);

  navigator.clipboard.writeText(text).then(() => {
    console.log('[YAC Debug] Sidebar diagnostics copied to clipboard');
  }).catch((error) => {
    console.warn('[YAC Debug] navigator.clipboard write failed, trying execCommand fallback:', error);
    const copied = copyTextFallback(text);
    if (copied) {
      console.log('[YAC Debug] Sidebar diagnostics copied via execCommand fallback');
    } else {
      console.warn('[YAC Debug] Clipboard fallback failed, returning diagnostics instead');
    }
  });

  return payload;
}

function copyTextFallback(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch (error) {
    console.warn('[YAC Debug] execCommand copy failed:', error);
    return false;
  }
}

function removeAllGrey() {
  document.querySelectorAll('.seen-video-overlay').forEach(el => el.remove());
  document.querySelectorAll('.seen-video-thumbnail').forEach(el => el.classList.remove('seen-video-thumbnail'));
  greyedElements.clear();
  updateBadgeCount();
}

function updateBadgeCount() {
  // Count actual greyed tiles on the page (not unique video IDs)
  const greyedTileCount = document.querySelectorAll('.seen-video-overlay').length;
  console.log('[YAC] Updating badge count:', greyedTileCount, 'greyed tiles');
  browser.runtime.sendMessage({ type: 'GREY_COUNT_UPDATE', count: greyedTileCount });
}

export async function resetSeenVideos() {
  console.log('[YAC] Resetting all seen videos...');

  // Set reset timestamp BEFORE clearing - this prevents immediate re-greying
  resetTime = Date.now();
  console.log('[YAC] Reset time set to:', resetTime);

  // Clear all grey overlays first
  removeAllGrey();

  // Reset all tile radar states so they start fresh
  const tiles = findAllVideoTiles();
  tiles.forEach(tile => {
    if (tile._radarState) {
      tile._radarState = null;
    }
  });

  // Clear caches
  seenVideoCache.clear();
  greyedElements.clear();

  // Clear storage
  try {
    const result = await browser.storage.local.get(null);
    const keysToDelete = Object.keys(result).filter(
      (k) => k.startsWith('seenChunk') || k === 'seenManifest' || k === 'watchIntent'
    );
    if (keysToDelete.length > 0) await browser.storage.local.remove(keysToDelete);
    console.log('[YAC] Storage cleared successfully');
  } catch (e) {
    console.error('[YAC] Failed to clear storage:', e);
  }

  console.log('[YAC] Reset complete - 5 second grace period active');
}

window.resetSeenVideos = resetSeenVideos;

// Debug helpers - can be called from browser console
window.seenVideosDebug = {
  scan: scanForTiles,
  getCache: () => seenVideoCache,
  getGreyed: () => greyedElements,
  forceGrey: (videoId) => {
    seenVideoCache.add(videoId);
    applyGreyToVideo(videoId);
    console.log('[YAC Debug] Forced grey for video:', videoId);
  },
  testSelectors: () => {
    console.log('[YAC Debug] Testing selectors...');
    const selectors = SELECTORS.FEED_ITEM.split(',').map(s => s.trim());
    selectors.forEach(sel => {
      const count = document.querySelectorAll(sel).length;
      console.log(`[YAC Debug] "${sel}": ${count} matches`);
    });
  },
  testGreyOnFirst: () => {
    const tiles = findAllVideoTiles();
    if (tiles.length === 0) {
      console.log('[YAC Debug] No tiles found');
      return;
    }
    const firstTile = tiles[0];
    const videoId = getVideoIdFromTile(firstTile);
    console.log('[YAC Debug] Testing grey on first tile, videoId:', videoId);
    seenVideoCache.add(videoId);
    applyGreyToTile(firstTile, videoId);
    console.log('[YAC Debug] Applied grey to first tile. Check if it has red border!');
  },
  collectSidebarDiagnostics,
  copySidebarDiagnostics
};

init().catch(console.error);
