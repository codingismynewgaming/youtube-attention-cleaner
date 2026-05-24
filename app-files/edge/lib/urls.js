/**
 * URL utilities for YouTube video ID extraction and page classification
 */

function isValidVideoId(videoId) {
  return /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

/**
 * Extract the canonical video ID from supported YouTube video URLs.
 * Trusted forms:
 * - `/watch?v=...`
 * - `/shorts/...`
 * - `youtu.be/...`
 * @param {string} url - The URL or href to parse
 * @returns {string|null} - The video ID or null if not found
 */
export function extractVideoId(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    const isYoutubeHost = parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com';
    const isShortHost = parsed.hostname === 'youtu.be';

    if (!isYoutubeHost && !isShortHost) {
      return null;
    }

    if (parsed.pathname === '/watch') {
      const videoId = parsed.searchParams.get('v');
      return isValidVideoId(videoId) ? videoId : null;
    }

    if (parsed.pathname.startsWith('/shorts/')) {
      const [, , shortId] = parsed.pathname.split('/');
      return isValidVideoId(shortId) ? shortId : null;
    }

    if (isShortHost) {
      const shortId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return isValidVideoId(shortId) ? shortId : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Classify YouTube page type from pathname
 * @param {string} pathname - window.location.pathname
 * @returns {string} - 'home' | 'subscriptions' | 'watch' | 'shorts' | 'search' | 'other'
 */
export function classifyPage(pathname) {
  if (!pathname) return 'other';
  
  // Home feed
  if (pathname === '/' || pathname === '/feed/guide') {
    return 'home';
  }
  
  // Subscriptions feed
  if (pathname === '/feed/subscriptions') {
    return 'subscriptions';
  }
  
  // Watch page
  if (pathname === '/watch') {
    return 'watch';
  }

  if (pathname === '/results') {
    return 'search';
  }
  
  // Shorts (standalone)
  if (pathname.startsWith('/shorts/')) {
    return 'shorts';
  }
  
  return 'other';
}

/**
 * Check if URL is on youtube.com domain (allowlist check)
 * @param {string} hostname - window.location.hostname
 * @returns {boolean}
 */
export function isAllowedURL(hostname) {
  return hostname === 'www.youtube.com' || hostname === 'youtube.com';
}

/**
 * Get the allowlist of URL pathnames where greying should be active
 * @returns {string[]} - Array of pathname patterns
 */
export function getAllowedPathnames() {
  return [
    '/',                      // Home
    '/feed/subscriptions',    // Subscriptions
    '/watch',                 // Watch page (sidebar only)
    '/results',               // Search results
    '/shorts/',               // Shorts viewer
  ];
}

/**
 * Check if current page should have greying active
 * @param {string} pathname - window.location.pathname
 * @returns {boolean}
 */
export function shouldGreyOnPage(pathname) {
  return (
    pathname === '/' ||
    pathname === '/feed/subscriptions' ||
    pathname === '/watch' ||
    pathname === '/results' ||
    pathname.startsWith('/shorts/')
  );
}

/**
 * Check if element is in the sidebar (watch page related videos)
 * vs primary video player
 * @param {HTMLElement} el - The element to check
 * @returns {boolean} - true if in sidebar (can grey), false if primary (should not grey)
 */
export function isSidebarVideo(el) {
  // Direct element type checks - compact videos and reel items are always sidebar
  const tagName = el.tagName?.toUpperCase?.() || '';
  const isCompactVideo = tagName === 'YTD-COMPACT-VIDEO-RENDERER';
  const isReelItem = tagName === 'YTD-REEL-ITEM-RENDERER';

  if (isCompactVideo || isReelItem) {
    return true;
  }

  // Check if element is within the secondary results container
  const inSidebarContainer = el.closest('ytd-watch-next-secondary-results-renderer') !== null;
  const inEngagementPanel = el.closest('ytd-engagement-panel-section-list-renderer') !== null;
  const inSecondaryColumn = el.closest('#secondary.ytd-watch-flexy') !== null;
  const inSecondaryInner = el.closest('#secondary-inner.ytd-watch-flexy') !== null;
  const inSecondary = el.closest('#secondary') !== null;
  const inSecondaryInnerGeneric = el.closest('#secondary-inner') !== null;
  const inItemSection = el.closest('ytd-item-section-renderer') !== null &&
    el.closest('#primary') === null; // Item sections in primary are playlists

  return inSidebarContainer || inEngagementPanel || inSecondaryColumn ||
         inSecondaryInner || inSecondary || inSecondaryInnerGeneric || inItemSection;
}

/**
 * Check if element is the primary video player (should never grey)
 * @param {HTMLElement} el - The element to check
 * @returns {boolean} - true if this is the primary video
 */
export function isPrimaryVideo(el) {
  // First check if it's clearly in sidebar (can't be primary)
  if (isSidebarVideo(el)) {
    return false;
  }

  // Check if it's in the primary player area (not sidebar)
  // Primary player: ytd-player, ytd-watch-flexy #primary (main column)
  const inPrimary = el.closest('ytd-player') !== null;
  const inPrimaryColumn = el.closest('#primary.ytd-watch-flexy') !== null ||
    el.closest('ytd-watch-flexy > #primary') !== null;

  return inPrimary || inPrimaryColumn;
}
