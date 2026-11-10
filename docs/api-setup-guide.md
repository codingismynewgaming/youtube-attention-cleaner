# API-Einrichtung für automatisierte Store-Releases

Unser Release-Skript `scripts/publish-stores.mjs` unterstützt den vollautomatischen Paket-Upload und die Veröffentlichung für alle drei Stores über Umgebungsvariablen.

Prüfe den aktuellen Status deiner Zugangsdaten jederzeit mit:
```powershell
node scripts/publish-stores.mjs --check-auth
```

---

## 1. Google Chrome Web Store API V2

Für automatisierte Uploads in den Chrome Web Store benötigst du ein Google Cloud Projekt mit aktivierter Chrome Web Store API sowie OAuth2-Zugangsdaten.

### Schritte:
1. **Google Cloud Console öffnen**:
   - Gehe zu [console.cloud.google.com](https://console.cloud.google.com/) und erstelle ein Projekt (z. B. `Chrome-Store-Publisher`).
2. **API aktivieren**:
   - Suche unter „APIs & Dienste“ nach der **Chrome Web Store API** und aktiviere sie.
3. **OAuth-Zustimmungsbildschirm einrichten**:
   - Wähle Nutzertyp **Extern**.
   - Trage App-Name und Support-E-Mail ein.
   - Füge deine eigene Google-E-Mail unter „Testnutzer“ hinzu.
4. **OAuth 2.0-Client-ID erstellen**:
   - Gehe zu „Anmeldedaten“ > „Anmeldedaten erstellen“ > „OAuth-Client-ID“.
   - Anwendungstyp: **Desktop-App**.
   - Notiere dir `Client-ID` und `Client-Secret`.
5. **Refresh-Token generieren**:
   - Öffne den [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
   - Klicke oben rechts auf das Zahnrad-Symbol, aktiviere *Use your own OAuth credentials* und trage deine `Client-ID` und dein `Client-Secret` ein.
   - Trage unter Schritt 1 bei *Input your own scopes* ein:
     `https://www.googleapis.com/auth/chromewebstore`
   - Klicke auf *Authorize APIs* und bestätige mit deinem Entwickler-Google-Konto.
   - Klicke unter Schritt 2 auf *Exchange authorization code for tokens* und kopiere den generierten **Refresh token**.

### PowerShell-Variablen setzen:
```powershell
[Environment]::SetEnvironmentVariable("CHROME_CLIENT_ID", "deine_client_id.apps.googleusercontent.com", "User")
[Environment]::SetEnvironmentVariable("CHROME_CLIENT_SECRET", "dein_client_secret", "User")
[Environment]::SetEnvironmentVariable("CHROME_REFRESH_TOKEN", "dein_refresh_token", "User")
[Environment]::SetEnvironmentVariable("CHROME_ITEM_ID", "deine_extension_id_aus_dem_dashboard", "User")
```

---

## 2. Microsoft Edge Add-ons Publish API V1.1

Microsoft nutzt Microsoft Entra ID (Azure AD) Client Credentials für die Authentifizierung an der Edge Add-ons API.

### Schritte:
1. **Azure Portal / Entra ID öffnen**:
   - Gehe zu [portal.azure.com](https://portal.azure.com/) unter **Microsoft Entra ID** > **App-Registrierungen** > **Neue Registrierung**.
   - Name: `Edge-Addon-Publisher`.
   - Kontotyp: *Nur Konten in diesem Organisationsverzeichnis*.
   - Notiere dir die **Anwendungs-ID (Client-ID)** und die **Verzeichnis-ID (Mandanten-ID/Tenant-ID)**.
2. **Client-Geheimnis erstellen**:
   - Gehe unter der erstellten App zu **Zertifikate & Geheimnisse** > **Neues Clientgeheimnis**.
   - Kopiere den erzeugten geheimen **Wert** (Client-Secret).
3. **API-Berechtigung im Partner Center verknüpfen**:
   - Gehe ins [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview).
   - Klicke oben rechts auf das Zahnrad (Einstellungen) > **Entwicklereinstellungen** > **Benutzer** oder **Azure AD-Anwendungen**.
   - Füge deine registrierte Entra-ID-App hinzu und weise ihr die Rolle **Manager** zu.
4. **Produkt-ID ermitteln**:
   - Öffne deine Erweiterung im Partner Center Dashboard.
   - Kopiere die **Produkt-ID** (GUID) aus der URL oder den Produkteinstellungen.

### PowerShell-Variablen setzen:
```powershell
[Environment]::SetEnvironmentVariable("EDGE_PRODUCT_ID", "deine_produkt_guid", "User")
[Environment]::SetEnvironmentVariable("EDGE_CLIENT_ID", "deine_azure_client_id", "User")
[Environment]::SetEnvironmentVariable("EDGE_CLIENT_SECRET", "dein_azure_client_secret", "User")
[Environment]::SetEnvironmentVariable("EDGE_TENANT_ID", "deine_azure_tenant_id", "User")
```

---

## 3. Releases ausführen

Sobald die Variablen gesetzt sind, führt ein einziger Befehl den kompletten Upload aus:

```powershell
# Nur Firefox:
node scripts/publish-stores.mjs --target firefox

# Nur Chrome:
node scripts/publish-stores.mjs --target chrome

# Nur Edge:
node scripts/publish-stores.mjs --target edge

# Alle drei Stores gleichzeitig:
node scripts/publish-stores.mjs --target all
```
