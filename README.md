# YouTube Attention Cleaner

[Deutsch](#deutsch) · [English](#english)

## Deutsch

YouTube Attention Cleaner blendet Videokacheln ab, an denen du bereits vorbeigescrollt bist. So fallen neue Empfehlungen leichter auf. Die Erweiterung entfernt keine Videos und verändert YouTubes Empfehlungen nicht.

### Verhalten

- Startseite, Abos und Suchergebnisse: Eine Kachel muss mindestens zwei Sekunden vollständig sichtbar sein und danach mindestens zwei Sekunden vollständig außerhalb des sichtbaren Bereichs liegen. Erst dann wird sie als gesehen gespeichert.
- Auf der Videoseite werden bereits bekannte Empfehlungen in der Seitenleiste abgeblendet. Der Hauptplayer bleibt unverändert.
- Ein geöffnetes Short wird nach zwei aktiven Sekunden erfasst.
- Wenn du ein normales Video gezielt öffnest, wird es von der Ausblendung ausgenommen.
- In ausgeblendeten Tabs pausiert die Erfassung. Angebrochene Erfassungszeiten beginnen beim Zurückkehren neu.
- Stärke von 0 bis 100 Prozent, Ein-/Ausschalten und Zurücksetzen sind im Popup verfügbar. Bei 0 Prozent bleibt die Darstellung unverändert.
- Menüs bleiben über abgeblendeten Videos sichtbar und bedienbar.

### Datenschutz und Speicherung

Keine Analyse-Dienste, keine eigenen externen Server und kein zusätzliches Konto. Einstellungen, Video-IDs und Zeitstempel bleiben im lokalen Erweiterungsspeicher des Browsers. Verlauf und Öffnungsabsichten laufen nach 65 Tagen ab; abgelaufene Einträge werden bei der Bereinigung entfernt. Über „Reset History“ lässt sich der Verlauf löschen.

YouTube selbst kann unabhängig von dieser Erweiterung Daten verarbeiten. Anmelden ist nur für personalisierte YouTube-Inhalte und Abos erforderlich.

### Browser und Installation

Der veröffentlichte Firefox-Eintrag ist auf [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-attention-cleaner/) verfügbar. Die Quellversion ist 1.0.1. Der Firefox-Quellstand erfordert mindestens Firefox 112.

Chrome- und Edge-Quellen werden mitgepflegt. Ein Chrome- oder Edge-Store-Release gehört derzeit nicht zum Veröffentlichungsumfang.

Für einen lokalen Firefox-Test: In einem separaten Testprofil `about:debugging#/runtime/this-firefox` öffnen, „Temporäres Add-on laden“ wählen und `app-files/firefox/manifest.json` oder das vorbereitete Testpaket auswählen. Ein unsigniertes Testpaket ist keine dauerhafte Store-Installation.

### Entwicklung und Prüfungen

Keine zusätzlichen JavaScript-Pakete erforderlich. Die Regressionstests verwenden Node.js mit eingebautem Test-Runner:

```powershell
node --experimental-test-isolation=none --test scripts/*.test.mjs
web-ext lint --source-dir app-files/firefox
web-ext build --source-dir app-files/firefox --artifacts-dir builds --filename youtube-attention-cleaner-firefox-v1.0.1.zip
```

Der Firefox-Integrationstest benötigt bereits installiertes Firefox, Selenium und geckodriver. Der Chromium-Test benötigt Playwright und dessen vorhandenen Chromium-Browser. Er nutzt ein temporäres Profil, öffnet YouTube ohne Anmeldung und prüft auch Einstellungen und Reset:

```powershell
python scripts/firefox-smoke.py
python scripts/chromium-smoke.py
```

GitHub-Release, AMO-Einreichung, Mozilla-Prüfung und tatsächliche Veröffentlichung sind getrennte Schritte. Releases werden erst nach Funktionstest und Freigabe eingereicht.

## English

YouTube Attention Cleaner dims video cards you have already scrolled past, making new recommendations easier to spot. It does not remove videos or change YouTube's recommendation algorithm.

### Behaviour

- On Home, Subscriptions and Search, a card must be fully visible for at least two seconds, then fully outside the viewport for at least two seconds, before it is saved as seen.
- Previously seen recommendations are dimmed in the Watch sidebar. The main player is left unchanged.
- An opened Short is recorded after two active seconds.
- Regular videos you intentionally open are excluded from dimming.
- Tracking pauses in hidden tabs. Incomplete timing starts over when you return.
- The popup offers strength from 0 to 100 percent, an enable switch and history reset. Zero percent leaves the appearance unchanged.
- Menus remain visible and usable above dimmed cards.

### Privacy and storage

No analytics, no external servers operated by the extension and no additional account. Preferences, video IDs and timestamps stay in the browser's local extension storage. History and watch intent expire after 65 days; expired records are removed during cleanup. Use “Reset History” to clear them.

YouTube may process data independently of this extension. Signing in is only needed for personalized YouTube content and subscriptions.

### Browsers and development

The public Firefox listing is available on [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-attention-cleaner/). The source version is 1.0.1. The Firefox source requires Firefox 112 or later. Chrome and Edge sources are maintained; publishing to those stores is outside the current release scope.

See the commands above for Node.js regression tests, Firefox lint/build and the Selenium integration check. Test packages are unsigned and intended for temporary loading in a separate profile. Store submission and publication require the release's final approval.

## Project structure

- `app-files/firefox/`: Firefox extension source.
- `app-files/chrome/`: Chrome extension source.
- `app-files/edge/`: Edge extension source.
- `scripts/`: Regression and browser integration checks.
- `docs/`: Release notes and prepared store metadata.
- `builds/`: Local release artifacts, excluded from source control.

## License

MIT.
