# Dim + Filter Seen YouTube Videos

*(formerly YouTube Attention Cleaner)*

[Deutsch](#deutsch) · [English](#english)

## Deutsch

Kennst du das? Du bist auf YouTube unterwegs und siehst im Feed immer wieder dieselben Empfehlungen, an denen du längst vorbeigescrollt bist. Der Algorithmus zeigt sie dir trotzdem noch fünfmal.

Genau da setzt diese Erweiterung an. Sie blockiert nichts weg und fummelt nicht an YouTubes Empfehlungslogik herum. Stattdessen macht sie etwas ganz Pragmatisches: Sobald eine Videokachel kurz sichtbar war und du daran vorbeigescrollt bist, wird sie dezent abgeblendet. Neue Videos stechen sofort ins Auge, Wiederholungen treten in den Hintergrund.

### Wie es funktioniert

- **Smarte Erkennung**: Eine Kachel muss mindestens zwei Sekunden im Bild und danach zwei Sekunden aus dem Bild sein, bevor sie als gesehen gilt. Kein hektisches Flackern beim schnellen Durchscrollen.
- **Echte Klicks bleiben klar**: Videos, die du gezielt anklickst und anschaust, werden natürlich nicht ausgegraut.
- **Seitenleiste & Shorts**: Greift auf der Startseite, in den Abos, in den Suchergebnissen und bei Empfehlungen neben dem Video.
- **Volle Kontrolle im Popup**: Schieberegler für die Abblendstärke (0 bis 100 %), Hauptschalter und Verlauf per Klick zurücksetzen.
- **Info- & Support-Tab**: Schneller Draht zu GitHub-Issues und Kaffeekasse, falls dir das Tool im Alltag Zeit spart.

### Support & Spenden

Gefällt dir das Tool? Statt Bitcoins freue ich mich über einen Kaffee oder eine kleine Unterstützung:

- 🐛 [Submit issue / request feature](https://github.com/codingismynewgaming/youtube-attention-cleaner/issues)
- ☕ [Buy me a coffee](https://buymeacoffee.com/codingiymynewgaming)
- 💳 [Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=ZXHJFTUW9NQK8)
- 💻 [GitHub Repository](https://github.com/codingismynewgaming/youtube-attention-cleaner)

### Datenschutz

Keine Analyse-Dienste, keine externen Server und kein Account nötig. Alle IDs, Zeitstempel und Einstellungen bleiben ausschließlich im lokalen Speicher deines Browsers und laufen nach 65 Tagen automatisch ab.

---

## English

Ever notice how YouTube keeps serving you the exact same video recommendations you decided not to click five minutes ago? You keep scrolling past them, and they keep showing up.

This extension solves that without any heavy-handed blocking or messing with YouTube's recommendation algorithm. It does one practical thing: once you've genuinely scrolled past a video tile, it dims it down. New recommendations pop out at a glance; repeats fade quietly into the background.

### How it works

- **Smart visibility checks**: A video card must be visible for at least two seconds and then scrolled out of view for two seconds before it's marked as seen. Fast scrolling won't accidentally dim anything.
- **Videos you actually watch stay clear**: Clicking and watching a video prevents it from getting dimmed.
- **Works across YouTube**: Home feed, Subscriptions, Search results, and sidebar recommendations on watch pages.
- **Simple popup controls**: Dial in your preferred dim strength from 0 to 100%, toggle off when needed, or wipe history in one click.
- **Info & Support tab**: Quick links to report issues on GitHub or buy a coffee if it saves you daily screen frustration.

### Support & Donations

Enjoying this tool? Instead of sending Bitcoins, buy me a coffee or support development:

- 🐛 [Submit issue / request feature](https://github.com/codingismynewgaming/youtube-attention-cleaner/issues)
- ☕ [Buy me a coffee](https://buymeacoffee.com/codingiymynewgaming)
- 💳 [Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=ZXHJFTUW9NQK8)
- 💻 [GitHub Repository](https://github.com/codingismynewgaming/youtube-attention-cleaner)

### Privacy

No tracking, no analytics, no external servers, and no account required. Everything stays in your browser's local storage and expires automatically after 65 days.

### Installation & Development

- **Firefox**: [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-attention-cleaner/)
- **Chrome & Edge**: Packages available in `builds/` and sources in `app-files/chrome` and `app-files/edge`.

Run local regression tests:
```powershell
node --experimental-test-isolation=none --test scripts/*.test.mjs
```

## License

MIT.
