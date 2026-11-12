/**
 * Observe YouTube cards without polling the entire page.
 * History writes belong to the background process.
 */
import { extractVideoId, classifyPage, isAllowedURL, shouldGreyOnPage, isPrimaryVideo } from './lib/urls.js';
import { isExpired } from './lib/storage.js';

const api = globalThis.browser || globalThis.chrome;
const TILE_SELECTOR = 'ytd-rich-item-renderer, ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-compact-autoplay-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model-v2';
const TRACKING_PAGES = new Set(['home', 'subscriptions', 'search']);
const VISIBLE_MS = 2000;
const OUTSIDE_MS = 2000;
const states = new Map();
const tilesByVideo = new Map();
const seenIds = new Set();
const watchIntentIds = new Set();
const pendingCommits = new Map();
const pendingTiles = new Set();
let prefs = { enabled: true, greyStrength: 75 };
let generation = 0;
let pageType = 'other';
let currentURL = '';
let intersectionObserver;
let mutationObserver;
let scheduledFrame = null;
let shortsTimer = null;
let shortsVideoId = null;
let lastBadgeCount = -1;
let badgeQueued = false;
let pruneNeeded = false;
let ready = false;

function reportError(error) {
  console.error('[YAC]', error instanceof Error ? error.message : error);
}

async function request(message) {
  const response = await api.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response?.error || 'The extension background is unavailable.');
  }
  return response;
}

function isActive() {
  return ready && prefs.enabled && !document.hidden && shouldGreyOnPage(location.pathname);
}

function injectGreyStyles() {
  if (document.getElementById('seen-videos-styles')) return;
  const style = document.createElement('style');
  style.id = 'seen-videos-styles';
  style.textContent = `
    .seen-video-overlay {
      position: absolute !important;
      inset: 0 !important;
      background: #e0e0e0 !important;
      pointer-events: none !important;
      /* YouTube menus must remain above this card-local effect. */
      z-index: 1 !important;
      border-radius: 8px !important;
    }
    [dark] .seen-video-overlay,
    [data-theme="dark"] .seen-video-overlay {
      background: #1a1a1a !important;
    }
    .seen-video-thumbnail {
      filter: grayscale(100%) brightness(0.7) !important;
    }
  `;
  document.head.appendChild(style);
}

function getVideoIdFromTile(tile) {
  // Never climb into a different card or the feed to borrow another video's ID.
  for (const link of tile.querySelectorAll('a[href]')) {
    const id = extractVideoId(link.href || link.getAttribute('href'));
    if (id) return id;
  }
  return null;
}

function getGreyTarget(tile) {
  return tile.querySelector('.yt-lockup-view-model-wiz') ||
    tile.querySelector('#dismissible') ||
    tile.querySelector('#content') ||
    tile.querySelector('ytd-thumbnail') || tile;
}

function cancelTileTimer(state) {
  if (state.timer !== null) window.clearTimeout(state.timer);
  state.timer = null;
}

function resetEligibility(state) {
  cancelTileTimer(state);
  state.phase = 'idle';
  state.since = null;
}

function removeGrey(state) {
  state.overlay?.remove();
  state.overlay = null;
  state.thumbnail?.classList.remove('seen-video-thumbnail');
  state.thumbnail = null;
  if (state.positionChange) {
    const { target, value, priority } = state.positionChange;
    if (target.style.getPropertyValue('position') === 'relative' &&
        !target.style.getPropertyPriority('position')) {
      if (value) target.style.setProperty('position', value, priority);
      else target.style.removeProperty('position');
    }
    state.positionChange = null;
  }
  state.target = null;
  queueBadgeUpdate();
}

function applyGrey(state) {
  if (!prefs.enabled || prefs.greyStrength === 0 ||
      !seenIds.has(state.videoId) || watchIntentIds.has(state.videoId) ||
      isPrimaryVideo(state.tile)) {
    removeGrey(state);
    return;
  }
  const target = getGreyTarget(state.tile);
  if (state.target !== target || !state.overlay?.isConnected) {
    removeGrey(state);
    state.target = target;
    if (getComputedStyle(target).position === 'static') {
      state.positionChange = {
        target,
        value: target.style.getPropertyValue('position'),
        priority: target.style.getPropertyPriority('position')
      };
      target.style.setProperty('position', 'relative');
    }
    const overlay = document.createElement('div');
    overlay.className = 'seen-video-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    target.appendChild(overlay);
    state.overlay = overlay;
    state.thumbnail = state.tile.querySelector('ytd-thumbnail, a#thumbnail, .yt-lockup-view-model-wiz__content-image, img');
    state.thumbnail?.classList.add('seen-video-thumbnail');
  }
  state.overlay.style.opacity = String(prefs.greyStrength / 100);
  queueBadgeUpdate();
}

function queueBadgeUpdate() {
  if (badgeQueued) return;
  badgeQueued = true;
  queueMicrotask(() => {
    badgeQueued = false;
    let count = 0;
    for (const state of states.values()) {
      if (state.overlay?.isConnected) count += 1;
    }
    if (count === lastBadgeCount) return;
    lastBadgeCount = count;
    api.runtime.sendMessage({ type: 'GREY_COUNT_UPDATE', count }).catch(reportError);
  });
}

function bindVideo(state) {
  const videoId = getVideoIdFromTile(state.tile);
  if (state.videoId === videoId) return;
  if (state.videoId) {
    const oldTiles = tilesByVideo.get(state.videoId);
    oldTiles?.delete(state);
    if (!oldTiles?.size) tilesByVideo.delete(state.videoId);
  }
  resetEligibility(state);
  removeGrey(state);
  state.videoId = videoId;
  if (videoId) {
    if (!tilesByVideo.has(videoId)) tilesByVideo.set(videoId, new Set());
    tilesByVideo.get(videoId).add(state);
  }
}

function releaseTile(state) {
  resetEligibility(state);
  removeGrey(state);
  intersectionObserver?.unobserve(state.tile);
  states.delete(state.tile);
  pendingTiles.delete(state.tile);
  const sameVideo = tilesByVideo.get(state.videoId);
  sameVideo?.delete(state);
  if (!sameVideo?.size) tilesByVideo.delete(state.videoId);
}

function armTimer(state, delay) {
  if (state.timer !== null) return;
  state.timer = window.setTimeout(() => {
    state.timer = null;
    evaluateTile(state);
  }, Math.max(1, delay));
}

function evaluateTile(state) {
  if (!state.tile.isConnected) {
    releaseTile(state);
    return;
  }
  bindVideo(state);
  if (!state.videoId || isPrimaryVideo(state.tile)) {
    resetEligibility(state);
    removeGrey(state);
    return;
  }
  applyGrey(state);
  if (!isActive() || !TRACKING_PAGES.has(pageType) ||
      seenIds.has(state.videoId) || watchIntentIds.has(state.videoId)) {
    resetEligibility(state);
    return;
  }

  const rect = state.tile.getBoundingClientRect();
  if (state.tile.hidden || rect.width <= 0 || rect.height <= 0) {
    resetEligibility(state);
    return;
  }
  const width = window.innerWidth || document.documentElement.clientWidth;
  const height = window.innerHeight || document.documentElement.clientHeight;
  const fullyVisible = rect.top >= 0 && rect.left >= 0 &&
    rect.bottom <= height && rect.right <= width;
  const outside = rect.bottom <= 0 || rect.top >= height ||
    rect.right <= 0 || rect.left >= width;
  const now = Date.now();

  if (fullyVisible) {
    if (state.phase === 'idle') {
      state.phase = 'viewing';
      state.since = now;
    }
    if (state.phase === 'viewing') {
      const remaining = VISIBLE_MS - (now - state.since);
      if (remaining > 0) armTimer(state, remaining);
      else {
        cancelTileTimer(state);
        state.phase = 'eligible';
        state.since = null;
      }
    } else if (state.phase === 'outside') {
      cancelTileTimer(state);
      state.phase = 'eligible';
      state.since = null;
    }
  } else if (outside && (state.phase === 'eligible' || state.phase === 'outside')) {
    if (state.phase === 'eligible') {
      state.phase = 'outside';
      state.since = now;
    }
    const remaining = OUTSIDE_MS - (now - state.since);
    if (remaining > 0) armTimer(state, remaining);
    else {
      cancelTileTimer(state);
      state.phase = 'committed';
      commitSeenVideo(state.videoId).catch(reportError);
    }
  } else if (state.phase === 'viewing') {
    resetEligibility(state);
  } else if (state.phase === 'outside') {
    cancelTileTimer(state);
    state.phase = 'eligible';
    state.since = null;
  }
}

async function commitSeenVideo(videoId) {
  if (!isActive() || seenIds.has(videoId) || watchIntentIds.has(videoId)) return;
  if (pendingCommits.has(videoId)) return pendingCommits.get(videoId);
  const requestGeneration = generation;
  const operation = request({
    type: 'MARK_SEEN', videoId, generation: requestGeneration
  }).then(response => {
    if (generation !== requestGeneration || response.generation !== generation) return;
    if (response.seen) {
      seenIds.add(videoId);
      for (const state of tilesByVideo.get(videoId) || []) applyGrey(state);
    }
  }).finally(() => {
    if (pendingCommits.get(videoId) === operation) pendingCommits.delete(videoId);
  });
  pendingCommits.set(videoId, operation);
  return operation;
}

function outerTile(element) {
  let tile = element.closest(TILE_SELECTOR);
  while (tile?.parentElement?.closest(TILE_SELECTOR)) {
    tile = tile.parentElement.closest(TILE_SELECTOR);
  }
  return tile;
}

function addTile(tile) {
  if (!tile?.isConnected) return;
  const outer = outerTile(tile);
  if (outer !== tile) {
    addTile(outer);
    return;
  }
  // A late wrapper can replace a previously discovered inner card.
  for (const child of tile.querySelectorAll(TILE_SELECTOR)) {
    if (states.has(child)) releaseTile(states.get(child));
  }
  let state = states.get(tile);
  if (!state) {
    state = {
      tile, videoId: null, phase: 'idle', since: null, timer: null,
      overlay: null, target: null, thumbnail: null, positionChange: null
    };
    states.set(tile, state);
    intersectionObserver.observe(tile);
  }
  evaluateTile(state);
}

function collectTiles(root) {
  if (!(root instanceof Element)) return;
  const parentTile = outerTile(root);
  if (parentTile) pendingTiles.add(parentTile);
  for (const tile of root.querySelectorAll(TILE_SELECTOR)) {
    if (!tile.parentElement?.closest(TILE_SELECTOR)) pendingTiles.add(tile);
  }
}

function scheduleTileUpdates() {
  if (!isActive() || scheduledFrame !== null) return;
  if (!pendingTiles.size && !pruneNeeded) {
    scheduleShortsTracking();
    return;
  }
  scheduledFrame = requestAnimationFrame(() => {
    scheduledFrame = null;
    if (pruneNeeded) {
      pruneNeeded = false;
      for (const state of states.values()) {
        if (!state.tile.isConnected) releaseTile(state);
      }
    }
    const work = [...pendingTiles];
    pendingTiles.clear();
    for (const tile of work) addTile(tile);
    scheduleShortsTracking();
  });
}

function discoverTiles() {
  collectTiles(document.body);
  scheduleTileUpdates();
}

function cancelShortsTimer() {
  if (shortsTimer !== null) window.clearTimeout(shortsTimer);
  shortsTimer = null;
  shortsVideoId = null;
}

function scheduleShortsTracking() {
  const id = pageType === 'shorts' ? extractVideoId(location.href) : null;
  if (!isActive() || !id || seenIds.has(id) || watchIntentIds.has(id)) {
    cancelShortsTimer();
    return;
  }
  if (shortsVideoId === id && shortsTimer !== null) return;
  cancelShortsTimer();
  shortsVideoId = id;
  shortsTimer = window.setTimeout(() => {
    shortsTimer = null;
    if (!isActive() || pageType !== 'shorts' ||
        extractVideoId(location.href) !== id) return;
    commitSeenVideo(id).catch(reportError);
  }, VISIBLE_MS);
}

function stopTracking() {
  if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = null;
  intersectionObserver?.disconnect();
  mutationObserver?.disconnect();
  cancelShortsTimer();
  for (const state of states.values()) resetEligibility(state);
}

function resumeTracking() {
  stopTracking();
  pageType = classifyPage(location.pathname);
  if (!isActive()) return;
  mutationObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href']
  });
  for (const state of states.values()) {
    if (!state.tile.isConnected) releaseTile(state);
    else intersectionObserver.observe(state.tile);
  }
  discoverTiles();
}

function resetLocalHistory(nextGeneration) {
  if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= generation) return;
  generation = nextGeneration;
  seenIds.clear();
  watchIntentIds.clear();
  pendingCommits.clear();
  cancelShortsTimer();
  for (const state of states.values()) {
    resetEligibility(state);
    removeGrey(state);
    if (isActive()) pendingTiles.add(state.tile);
  }
  scheduleTileUpdates();
}

function applyPrefs(nextPrefs) {
  prefs = {
    enabled: typeof nextPrefs.enabled === 'boolean' ? nextPrefs.enabled : prefs.enabled,
    greyStrength: Number.isFinite(nextPrefs.greyStrength)
      ? Math.max(0, Math.min(100, nextPrefs.greyStrength)) : prefs.greyStrength
  };
  for (const state of states.values()) applyGrey(state);
  resumeTracking();
}

function entryTimestamp(entry, field) {
  return typeof entry === 'number' ? entry : entry?.[field];
}

function updateHistoryFromStorage(changes, area) {
  if (area !== 'local' || !ready) return;
  if (changes.historyGeneration) resetLocalHistory(changes.historyGeneration.newValue);
  const affected = new Set();
  if (changes.watchIntent) {
    for (const id of watchIntentIds) affected.add(id);
    watchIntentIds.clear();
    for (const [id, entry] of Object.entries(changes.watchIntent.newValue || {})) {
      const timestamp = entryTimestamp(entry, 'markedAt');
      if (Number.isFinite(timestamp) && !isExpired(timestamp)) watchIntentIds.add(id);
      affected.add(id);
    }
  }
  const chunkChanges = Object.entries(changes).filter(([key]) => /^seenChunk\d+$/.test(key));
  // A cleanup may move IDs between chunks in one atomic storage change.
  for (const [, change] of chunkChanges) {
    for (const id of Object.keys(change.oldValue || {})) {
      seenIds.delete(id);
      affected.add(id);
    }
  }
  for (const [, change] of chunkChanges) {
    for (const [id, entry] of Object.entries(change.newValue || {})) {
      const timestamp = entryTimestamp(entry, 'firstSeenAt');
      if (Number.isFinite(timestamp) && !isExpired(timestamp)) seenIds.add(id);
      affected.add(id);
    }
  }
  for (const id of affected) {
    for (const state of tilesByVideo.get(id) || []) {
      resetEligibility(state);
      applyGrey(state);
      if (isActive()) pendingTiles.add(state.tile);
    }
  }
  if (changes.prefs?.newValue) applyPrefs(changes.prefs.newValue);
  scheduleTileUpdates();
}

function handleNavigation() {
  if (currentURL === location.href) return;
  currentURL = location.href;
  stopTracking();
  for (const state of [...states.values()]) releaseTile(state);
  pendingTiles.clear();
  resumeTracking();
}

function captureWatchIntent(event) {
  if (!prefs.enabled || (event.type === 'auxclick' && event.button !== 1)) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link) return;
  const url = new URL(link.href, location.href);
  if (url.pathname !== '/watch') return;
  const videoId = extractVideoId(url.href);
  if (!videoId) return;
  // Protect immediately, before navigation or storage notifications arrive.
  watchIntentIds.add(videoId);
  for (const state of tilesByVideo.get(videoId) || []) {
    resetEligibility(state);
    removeGrey(state);
  }
  request({ type: 'WATCH_INTENT', videoId }).catch(reportError);
}

async function init() {
  if (!isAllowedURL(location.hostname)) return;
  // Subscribe first so a concurrent tab cannot update history between the
  // initial snapshot and listener registration.
  const startupChanges = [];
  api.storage.onChanged.addListener((changes, area) => {
    if (!ready) startupChanges.push([changes, area]);
    else updateHistoryFromStorage(changes, area);
  });
  const state = await request({ type: 'GET_STATE' });
  prefs = state.prefs;
  generation = state.generation;
  for (const id of state.seenVideoIds) seenIds.add(id);
  for (const id of state.watchIntentVideoIds) watchIntentIds.add(id);
  injectGreyStyles();
  intersectionObserver = new IntersectionObserver(entries => {
    if (!isActive()) return;
    for (const entry of entries) {
      const tileState = states.get(entry.target);
      if (tileState) evaluateTile(tileState);
    }
  }, { threshold: [0, 1] });
  mutationObserver = new MutationObserver(mutations => {
    if (!isActive()) return;
    for (const mutation of mutations) {
      // Own overlays never trigger another discovery pass.
      if (mutation.type === 'attributes') {
        const tile = outerTile(mutation.target);
        if (tile) pendingTiles.add(tile);
      } else {
        let relevantRemoval = false;
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && !node.classList.contains('seen-video-overlay')) {
            collectTiles(node);
          }
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof Element && !node.classList.contains('seen-video-overlay')) {
            relevantRemoval = true;
            if (node.matches(TILE_SELECTOR) || node.querySelector(TILE_SELECTOR)) pruneNeeded = true;
          }
        }
        if (relevantRemoval) {
          const tile = outerTile(mutation.target);
          if (tile) pendingTiles.add(tile);
        }
      }
    }
    if (pendingTiles.size || pruneNeeded) scheduleTileUpdates();
  });

  api.runtime.onMessage.addListener(message => {
    if (message?.type === 'PREFS_CHANGED' && message.prefs) applyPrefs(message.prefs);
    if (message?.type === 'HISTORY_RESET') resetLocalHistory(message.generation);
    if (message?.type === 'GET_GREY_COUNT') {
      let count = 0;
      for (const state of states.values()) if (state.overlay?.isConnected) count += 1;
      return Promise.resolve({ count });
    }
    // Do not answer commands belonging to the background.
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTracking();
    else resumeTracking();
  });
  document.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('popstate', handleNavigation);
  document.addEventListener('click', captureWatchIntent, true);
  document.addEventListener('auxclick', captureWatchIntent, true);
  window.addEventListener('pagehide', stopTracking);
  window.addEventListener('pageshow', resumeTracking);
  ready = true;
  for (const [changes, area] of startupChanges) updateHistoryFromStorage(changes, area);
  startupChanges.length = 0;
  currentURL = location.href;
  resumeTracking();
  queueBadgeUpdate();
}

init().catch(reportError);
