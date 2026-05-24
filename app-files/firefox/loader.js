/**
 * Loader for content script to support ES modules in Firefox
 */
console.log('[YAC Loader] Starting content script loader...');
console.log('[YAC Loader] document.readyState:', document.readyState);

function loadContentScript() {
  console.log('[YAC Loader] Loading content script...');
  (async () => {
    try {
      const src = browser.runtime.getURL('content.js');
      console.log('[YAC Loader] Importing from:', src);
      await import(src);
      console.log('[YAC Loader] Content script module loaded successfully');
    } catch (error) {
      console.error('[YAC Loader] Failed to load content script module:', error);
      console.error('[YAC Loader] Error stack:', error.stack);
    }
  })();
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadContentScript);
} else {
  loadContentScript();
}
