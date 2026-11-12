# Privacy Policy

**Dim + Filter Seen YouTube Videos**  
Last updated: 12 November 2026

This policy describes what the browser extension stores, why it stores it, and how you can delete it. The extension was previously named YouTube Attention Cleaner. The data handling described here is the same.

The extension does not run a backend, does not create an account, and does not send analytics or telemetry. Everything it remembers stays in your browser's local extension storage (`browser.storage.local` / `chrome.storage.local`).

Chrome's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) still treats this as user data, even when it never leaves the device. This policy exists so that is written down clearly.

## What is stored

The extension stores only what it needs to dim tiles you have already scrolled past, keep clicked videos clear, and remember your settings.

1. **Seen video IDs**  
   The 11-character YouTube video ID of a tile the extension marked as seen, plus a timestamp (`firstSeenAt`). "Seen" means the tile stayed in the viewport for at least two seconds and then left the viewport for two seconds. On a Shorts page, a Short is marked after two seconds in view. This is not the same as YouTube's watch history. Scrolling past a tile can mark it even if you never opened the video.

2. **Watch-intent video IDs**  
   The video ID of a video you opened or clicked, plus a timestamp (`markedAt`). Those tiles stay undimmed.

3. **Settings**  
   Whether the extension is enabled, and the dim strength (an integer from 0 to 100). Defaults are enabled, and strength 75.

4. **Small bookkeeping values**  
   A history generation counter and a timestamp for the last expiry cleanup. These exist so a reset and the 65-day cleanup can run correctly. They are not a browsing profile.

The extension does not store your Google account, your name, your email, your IP address, payment data, or the text of comments. It does not store a full browsing history. Video titles, thumbnails, and page HTML are not written into storage. Only the IDs and the values above are persisted.

## How the data is used

The data is used for one purpose: dimming YouTube video tiles you have already scrolled past, leaving tiles you clicked clear, and applying the dim strength you chose.

It is not used for advertising, remarketing, credit decisions, or any product other than this extension. It is not sold. It is not used to build a profile for anyone else.

## Sharing, servers, and transmission

The extension does not upload this data. There is no developer server in the path. There are no third-party analytics, advertising, or crash SDKs in the package. Remote code is not loaded at runtime.

YouTube itself still sees your normal use of YouTube, as it would without the extension. This policy covers only what the extension stores and what the developer can access. The developer cannot access your local extension storage.

## Retention

- Seen entries and watch-intent entries expire after **65 days**. The extension periodically removes expired IDs from local storage.
- Settings do **not** expire. Enabled state and dim strength stay until you change them, reset only the history, or remove the extension.

## Permissions

The extension asks for the following permissions, and only for the reasons below.

| Permission | Why it is needed |
| :--- | :--- |
| `storage` | To save seen IDs, watch-intent IDs, settings, and the bookkeeping values locally. |
| `tabs` | To read the active tab URL and update the badge or count for the YouTube tab in the popup. |
| `webNavigation` | To notice in-page YouTube navigation (it is a single-page app) and refresh tracking after a history change without a full reload. |
| Host access to `https://www.youtube.com/*` | To run the content script on YouTube, observe tiles, and apply the dimming styles. |

The extension does not request access to other websites.

## How to change or delete the data

- In the extension popup you can change the dim strength, turn the extension off, or reset the seen and watch-intent history. Resetting history does not wipe your settings.
- You can also remove the data by removing the extension. The browser then deletes this extension's local storage, as it normally does for uninstalled extensions.

There is no account to close, and no cloud copy for the developer to delete on your behalf.

## Children

The extension is not directed at children and does not knowingly collect information from children. It also does not collect account or contact information from anyone.

## Changes to this policy

If the data practices change, this file will be updated and the date above will change. For a store listing, the privacy policy URL will point at the current version of this document in the repository.

## Contact

Questions, corrections, or requests about this policy: open an issue at  
https://github.com/codingismynewgaming/youtube-attention-cleaner/issues
