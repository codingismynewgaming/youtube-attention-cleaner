/**
 * Chrome compatibility shim — maps chrome.* APIs to browser.* namespace.
 * Import this at the top of every module that uses browser.* APIs.
 * Firefox: globalThis.browser is already defined → no-op.
 * Chrome: creates browser.* aliases pointing to chrome.* APIs.
 */
if (typeof globalThis.browser === 'undefined' && typeof chrome !== 'undefined') {
  globalThis.browser = chrome;
}
