// Manifest content scripts are classic scripts. Load the ES module after document_idle.
const contentUrl = chrome.runtime.getURL('content.js');
import(contentUrl).catch(error => {
  console.error('[YAC] Content script failed to load:', error);
});
