/**
 * Release builder and store submission helper for Dim + Filter Seen YouTube Videos.
 * Supports Firefox (AMO via web-ext), Chrome Web Store API V2, and Microsoft Edge Add-ons API V1.1.
 * 
 * Usage:
 *   node scripts/publish-stores.mjs --build-only
 *   node scripts/publish-stores.mjs --target firefox
 *   node scripts/publish-stores.mjs --target chrome
 *   node scripts/publish-stores.mjs --target edge
 *   node scripts/publish-stores.mjs --target all
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUILDS_DIR = join(ROOT, 'builds');

const VARIANTS = ['firefox', 'chrome', 'edge'];

function getVersion() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'app-files', 'firefox', 'manifest.json'), 'utf8'));
  return manifest.version;
}

function getWebExtCommand() {
  const localNpmCmd = join(process.env.APPDATA || '', 'npm', 'web-ext.cmd');
  if (existsSync(localNpmCmd)) {
    return `"${localNpmCmd}"`;
  }
  return 'npx --yes web-ext';
}

function buildZip(variant, version) {
  if (!existsSync(BUILDS_DIR)) {
    mkdirSync(BUILDS_DIR, { recursive: true });
  }

  const sourceDir = join(ROOT, 'app-files', variant);
  const zipName = `dim-filter-seen-youtube-videos-${variant}-v${version}.zip`;
  const zipPath = join(BUILDS_DIR, zipName);

  const webExt = getWebExtCommand();
  execSync(`${webExt} build --source-dir "${sourceDir}" --artifacts-dir "${BUILDS_DIR}" --filename "${zipName}" --overwrite-dest`, {
    stdio: 'inherit'
  });

  console.log(`[Build] Created ${zipPath}`);
  return zipPath;
}

async function uploadChrome(zipPath) {
  const clientId = process.env.CHROME_CLIENT_ID;
  const clientSecret = process.env.CHROME_CLIENT_SECRET;
  const refreshToken = process.env.CHROME_REFRESH_TOKEN;
  const itemId = process.env.CHROME_ITEM_ID || 'f3ae853b-1b15-463c-8707-bc8e9d3ffbc2';

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[Chrome] Skipping upload: CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, or CHROME_REFRESH_TOKEN not set.');
    console.warn('Once the item is created in the Chrome Web Store Developer Console, set these environment variables.');
    return;
  }

  console.log('[Chrome] Requesting access token via OAuth2...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`[Chrome] Token exchange failed: ${JSON.stringify(tokenData)}`);

  const accessToken = tokenData.access_token;
  console.log(`[Chrome] Uploading package for item ${itemId}...`);
  const zipData = readFileSync(zipPath);
  const uploadRes = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${itemId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-goog-api-version': '2'
    },
    body: zipData
  });
  const uploadData = await uploadRes.json();
  console.log('[Chrome] Upload result:', uploadData);

  if (process.env.CHROME_AUTO_PUBLISH === 'true') {
    console.log('[Chrome] Submitting item for review...');
    const pubRes = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-goog-api-version': '2'
      }
    });
    const pubData = await pubRes.json();
    console.log('[Chrome] Publish result:', pubData);
  }
}

async function uploadEdge(zipPath) {
  const productId = process.env.EDGE_PRODUCT_ID;
  const clientId = process.env.EDGE_CLIENT_ID;
  const clientSecret = process.env.EDGE_CLIENT_SECRET;
  const tenantId = process.env.EDGE_TENANT_ID;

  if (!productId || !clientId || !clientSecret || !tenantId) {
    console.warn('[Edge] Skipping upload: EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_CLIENT_SECRET, or EDGE_TENANT_ID not set.');
    console.warn('Once the product is created in Microsoft Partner Center, set these environment variables.');
    return;
  }

  console.log('[Edge] Requesting Azure AD access token...');
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://api.addons.microsoftedge.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`[Edge] Token request failed: ${JSON.stringify(tokenData)}`);

  const accessToken = tokenData.access_token;
  console.log(`[Edge] Uploading draft package for product ${productId}...`);
  const zipData = readFileSync(zipPath);
  const uploadRes = await fetch(`https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/zip'
    },
    body: zipData
  });
  console.log('[Edge] Upload status:', uploadRes.status, uploadRes.statusText);

  if (process.env.EDGE_AUTO_PUBLISH === 'true') {
    console.log('[Edge] Submitting product draft for certification...');
    const pubRes = await fetch(`https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    console.log('[Edge] Publish submission status:', pubRes.status, pubRes.statusText);
  }
}

function getWebExtCommand() {
  const localNpmCmd = join(process.env.APPDATA || '', 'npm', 'web-ext.cmd');
  if (existsSync(localNpmCmd)) {
    return `"${localNpmCmd}"`;
  }
  return 'npx --yes web-ext';
}

function uploadFirefox() {
  const issuer = process.env.AMO_JWT_ISSUER;
  const secret = process.env.AMO_JWT_SECRET;

  if (!issuer || !secret) {
    console.warn('[Firefox] Skipping AMO sign: AMO_JWT_ISSUER or AMO_JWT_SECRET not set.');
    console.warn('Generate your API key and secret at https://addons.mozilla.org/developers/addon/api/key/');
    return;
  }

  const webExt = getWebExtCommand();
  console.log(`[Firefox] Submitting listed release via ${webExt}...`);
  execSync(`${webExt} sign --source-dir app-files/firefox --artifacts-dir builds --channel=listed --api-key="${issuer}" --api-secret="${secret}"`, {
    stdio: 'inherit'
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isBuildOnly = args.includes('--build-only') || args.length === 0;
  const targetIndex = args.indexOf('--target');
  const target = targetIndex !== -1 ? args[targetIndex + 1] : 'all';

  const version = getVersion();
  console.log(`[Release] Version ${version}`);

  const packages = {};
  for (const variant of VARIANTS) {
    packages[variant] = buildZip(variant, version);
  }

  if (isBuildOnly) {
    console.log('[Release] Packages built successfully. To upload, supply environment credentials and use --target <store>.');
    return;
  }

  if (target === 'firefox' || target === 'all') {
    uploadFirefox();
  }
  if (target === 'chrome' || target === 'all') {
    await uploadChrome(packages.chrome);
  }
  if (target === 'edge' || target === 'all') {
    await uploadEdge(packages.edge);
  }
}

main().catch(err => {
  console.error('[Release Error]', err);
  process.exit(1);
});
