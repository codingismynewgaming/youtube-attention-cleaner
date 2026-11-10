# Projektinfo

Dim + Filter Seen YouTube Videos (vormals YouTube Attention Cleaner) ist eine WebExtension für Firefox, Chrome und Edge, die bereits wahrgenommene YouTube-Videokacheln visuell abblendet. Ziel: neue Empfehlungen besser erkennbar machen, mit geringer Hintergrundlast und lokal gespeicherten Daten.

## Technik und Entscheidungen

- JavaScript-Module, Manifest V3; Firefox nutzt eine Hintergrund-Eventpage, Chromium/Edge einen Modul-Service-Worker.
- Drei Quellvarianten unter `app-files/`; fachlich identische Content-, Popup- und Speicherlogik. Chromium/Edge ergänzen den Namespace-Shim.
- Alle dauerhaften Schreibzugriffe laufen zentral über den Hintergrundprozess. Content und Popup verwenden Runtime-Nachrichten.
- Popup mit Reiter-Navigation: Settings (Abblendstärke, Ein/Aus, Reset) und Info (Support, GitHub, Spendenlinks).
- Persistente Reset-Generation verhindert alte Schreibanfragen nach einem Reset.
- Verlauf in Blöcken zu 512 IDs, kompakte Zeitstempel, Migration alter Objekteinträge. Aufbewahrung 65 Tage.
- IntersectionObserver, gezielte MutationObserver und einmalige Timer ersetzen Intervall-Scans. Ausgeblendete Tabs pausieren.
- Kachelzustände sind an Video-IDs gebunden. Unterkacheln werden dedupliziert; IDs werden nur innerhalb der jeweiligen Kachel gesucht.
- Darstellung über eine nicht klickfangende Fläche mit z-index 1. Kein erzwungenes overflow:hidden auf Karten.
- GET_STATE, MARK_SEEN, WATCH_INTENT, SAVE_PREFS, RESET_SEEN_VIDEOS und GET_TAB_COUNT bilden die Hintergrund-Schnittstelle. GET_GREY_COUNT fragt bei Bedarf den Content-Zähler ab.

## Befehle

```powershell
node --experimental-test-isolation=none --test scripts/*.test.mjs
python scripts/firefox-smoke.py
python scripts/chromium-smoke.py
npx web-ext lint --source-dir app-files/firefox
node scripts/publish-stores.mjs --build-only
```

## Release

Version 1.1.0 vorbereitet. Pakete für Firefox, Chrome und Microsoft Edge liegen unter `builds/` bereit. Store-Metadaten, Berechtigungsbegründungen und 1280x800-Screenshots befinden sich unter `docs/`.
