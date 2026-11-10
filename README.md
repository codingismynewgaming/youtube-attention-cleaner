# Dim + Filter Seen YouTube Videos

*(formerly YouTube Attention Cleaner)*

[Deutsch](#deutsch) · [English](#english)

## Deutsch

**Dim + Filter Seen YouTube Videos** blendet Videokacheln ab, an denen du bereits vorbeigescrollt bist. So fallen neue Empfehlungen leichter auf und Wiederholungen im Feed werden reduziert. Die Erweiterung entfernt keine Videos und verändert YouTubes Empfehlungsalgorithmus nicht.

### Verhalten

- Startseite, Abos und Suchergebnisse: Eine Kachel muss mindestens zwei Sekunden vollständig sichtbar sein und danach mindestens zwei Sekunden vollständig außerhalb des sichtbaren Bereichs liegen. Erst dann wird sie als gesehen gespeichert.
- Auf der Videoseite werden bereits bekannte Empfehlungen in der Seitenleiste abgeblendet. Der Hauptplayer bleibt unverändert.
- Ein geöffnetes Short wird nach zwei aktiven Sekunden erfasst.
- Wenn du ein normales Video gezielt öffnest, wird es von der Ausblendung ausgenommen.
- In ausgeblendeten Tabs pausiert die Erfassung. Angebrochene Erfassungszeiten beginnen beim Zurückkehren neu.
- Das Popup bietet zwei Reiter: **Settings** (Stärke von 0 bis 100 %, Ein-/Ausschalten, Verlauf zurücksetzen) und **Info** (Feedback- und Spendenlinks).
- Menüs bleiben über abgeblendeten Videos sichtbar und bedienbar.

### Support & Spenden

Gefällt dir diese Erweiterung? Statt Bitcoins freue ich mich über einen Kaffee oder eine kleine Spende:

- 🐛 [Submit issue / request feature](https://github.com/codingismynewgaming/youtube-attention-cleaner/issues)
- ☕ [Buy me a coffee](https://buymeacoffee.com/codingiymynewgaming)
- 💳 [Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=ZXHJFTUW9NQK8)
- 💻 [GitHub Repository](https://github.com/codingismynewgaming/youtube-attention-cleaner)

### Datenschutz und Speicherung

Keine Analyse-Dienste, keine eigenen externen Server und kein zusätzliches Konto. Einstellungen, Video-IDs und Zeitstempel bleiben im lokalen Erweiterungsspeicher des Browsers. Verlauf und Öffnungsabsichten laufen nach 65 Tagen ab; abgelaufene Einträge werden bei der Bereinigung entfernt. Über „Reset History“ lässt sich der Verlauf löschen.

YouTube selbst kann unabhängig von dieser Erweiterung Daten verarbeiten. Anmelden ist nur für personalisierte YouTube-Inhalte und Abos erforderlich.

### Browser und Installation

- **Firefox**: Eintrag auf [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-attention-cleaner/). Quellversion: 1.1.0 (erfordert Firefox 112+).
- **Chrome & Edge**: Quellen liegen in `app-files/chrome` und `app-files/edge` bereit.

Für einen lokalen Firefox-Test: In einem separaten Testprofil `about:debugging#/runtime/this-firefox` öffnen, „Temporäres Add-on laden“ wählen und `app-files/firefox/manifest.json` oder das vorbereitete Testpaket auswählen.

### Entwicklung und Prüfungen

Keine externen Laufzeitabhängigkeiten erforderlich. Die Tests verwenden Node.js mit dem integrierten Test-Runner:

```powershell
node --experimental-test-isolation=none --test scripts/*.test.mjs
npx web-ext lint --source-dir app-files/firefox
node scripts/publish-stores.mjs --build-only
```

Integrationstests:
```powershell
python scripts/firefox-smoke.py
python scripts/chromium-smoke.py
```

---

## English

**Dim + Filter Seen YouTube Videos** dims video cards you have already scrolled past, making new recommendations easier to spot and reducing feed fatigue. It does not remove videos or change YouTube's recommendation algorithm.

### Behaviour

- On Home, Subscriptions and Search, a card must be fully visible for at least two seconds, then fully outside the viewport for at least two seconds, before it is saved as seen.
- Previously seen recommendations are dimmed in the Watch sidebar. The main player is left unchanged.
- An opened Short is recorded after two active seconds.
- Regular videos you intentionally open are excluded from dimming.
- Tracking pauses in hidden tabs. Incomplete timing starts over when you return.
- The popup features two tabs: **Settings** (strength slider 0–100%, toggle switch, reset history) and **Info** (direct support and donation links).
- Menus remain visible and usable above dimmed cards.

### Support & Donations

Enjoying this extension? Instead of sending me your Bitcoins, just buy me a coffee or send a donation via PayPal:

- 🐛 [Submit issue / request feature](https://github.com/codingismynewgaming/youtube-attention-cleaner/issues)
- ☕ [Buy me a coffee](https://buymeacoffee.com/codingiymynewgaming)
- 💳 [Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=ZXHJFTUW9NQK8)
- 💻 [GitHub Repository](https://github.com/codingismynewgaming/youtube-attention-cleaner)

### Privacy and storage

No analytics, no external servers operated by the extension and no additional account. Preferences, video IDs and timestamps stay in the browser's local extension storage. History and watch intent expire after 65 days; expired records are removed during cleanup. Use “Reset History” to clear them.

YouTube may process data independently of this extension. Signing in is only needed for personalized YouTube content and subscriptions.

### Browsers and development

- **Firefox**: Public listing on [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-attention-cleaner/). Source version: 1.1.0 (requires Firefox 112+).
- **Chrome & Microsoft Edge**: Sources maintained in `app-files/chrome` and `app-files/edge`.

### Project structure

- `app-files/firefox/`: Firefox extension source.
- `app-files/chrome/`: Chrome extension source.
- `app-files/edge/`: Edge extension source.
- `scripts/`: Regression, smoke and release automation scripts.
- `docs/`: Store metadata, permission justification, screenshots and release notes.
- `builds/`: Local release zip packages.

## License

MIT.
