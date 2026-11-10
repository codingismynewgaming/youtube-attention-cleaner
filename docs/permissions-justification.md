# Permissions Justification & Compliance Statement

## 1. Required Permissions

- **`storage`**
  - **Justification**: Used exclusively to locally persist seen video IDs, user preferences (such as dimming strength and enabled state), and timestamps within the browser's `chrome.storage.local`. No personal data or browsing history is transmitted to external servers.

- **`tabs`**
  - **Justification**: Required to query the active tab URL and communicate badge/count updates for the active YouTube tab to the extension popup interface.

- **`webNavigation`**
  - **Justification**: Used to detect in-page YouTube Single Page Application (SPA) navigation transitions (history state changes) to properly re-initialize and refresh the video tracking state when users browse within YouTube without a full page reload.

- **`https://www.youtube.com/*` (Host Permissions)**
  - **Justification**: Essential to inject content scripts into YouTube pages (`youtube.com`) to observe viewed video elements as the user scrolls, detect watched or scrolled-past video IDs, and apply the lightweight dimming CSS overlays.

---

## 2. Single Purpose Statement
"Dim + Filter Seen YouTube Videos" is a productivity extension dedicated entirely to reducing digital fatigue and distraction on YouTube by automatically identifying and dimming video cards that the user has already scrolled past, helping users focus on new content.

---

## 3. Remote Code Declaration
The extension contains **zero remote code**. All JavaScript, CSS, icons, and HTML popup views are 100% packaged locally within the extension bundle. No external scripts are downloaded, evaluated, or executed at runtime.
