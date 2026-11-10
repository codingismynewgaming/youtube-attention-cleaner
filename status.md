# Status

Stand: 10.11.2026. Version 1.1.0 vorbereitet. Rebranding auf „Dim + Filter Seen YouTube Videos“.

## Umgesetzt für v1.1.0

- Rebranding aller Manifeste, Dokumente und Metadaten auf „Dim + Filter Seen YouTube Videos“ (v1.1.0).
- Popup erweitert um Dark-Mode-Tab-Navigation mit Settings- und Info-Bereich.
- Vier Spenden- und Support-Buttons (Issues, Buy Me a Coffee, PayPal, GitHub) mit sicherer `tabs.create`-Öffnung integriert.
- Store-Listings für Firefox (AMO), Chrome Web Store und Microsoft Edge Partner Center unter `docs/` hinterlegt.
- Permission Justifications für `storage`, `tabs`, `webNavigation` und `host_permissions` dokumentiert.
- Automatisierte Erstellung von drei Store-Screenshots in 1280x800 Pixel (RGB-Modus, keine Alpha-Transparenz) via Playwright.
- Einheitliches Release- und Upload-Skript `scripts/publish-stores.mjs` für Firefox, Chrome API V2 und Edge API V1.1.
- Chromium-Smoke-Test um den nativen Edge-Kanal (`msedge`) erweitert.

## Ausgeführte Prüfungen

- 30/30 Node-Regressionstests über alle drei Quellvarianten bestanden (inkl. Popup-Tab-Wechsel und Link-Klicks).
- Firefox 157.0.1 mit Selenium/geckodriver: 10/10 Integrationsprüfungen bestanden (keine Fehler in der Konsole).
- Chromium und Microsoft Edge 156.0.4314.58: Beide Browser erfolgreich mit echtem Service-Worker, Popup und YouTube-Injektion getestet.
- `web-ext lint`: 0 Fehler.
- `web-ext build`: Saubere Release-Pakete für Firefox, Chrome und Edge in `builds/` erzeugt.
