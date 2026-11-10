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
import crypto from 'node:crypto';
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

function uploadFirefox() {
  const issuer = (process.env.AMO_JWT_ISSUER || '').trim();
  const secret = (process.env.AMO_JWT_SECRET || '').trim();

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

async function checkAuth() {
  console.log('[Auth Check] Testing credentials for all three stores...\n');

  // Firefox
  const amoIssuer = (process.env.AMO_JWT_ISSUER || '').trim();
  const amoSecret = (process.env.AMO_JWT_SECRET || '').trim();
  if (amoIssuer && amoSecret) {
    console.log('✓ Firefox (AMO): API credentials configured (Issuer present).');
  } else {
    console.log('✗ Firefox (AMO): Missing AMO_JWT_ISSUER or AMO_JWT_SECRET.');
  }

  // Chrome
  const chromeClientId = process.env.CHROME_CLIENT_ID;
  const chromeClientSecret = process.env.CHROME_CLIENT_SECRET;
  const chromeRefreshToken = process.env.CHROME_REFRESH_TOKEN;
  if (chromeClientId && chromeClientSecret && chromeRefreshToken) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: chromeClientId,
          client_secret: chromeClientSecret,
          refresh_token: chromeRefreshToken,
          grant_type: 'refresh_token'
        })
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        console.log('✓ Chrome Web Store: OAuth2 token exchange successful.');
      } else {
        console.log(`✗ Chrome Web Store: Token exchange failed (${data.error || 'invalid credentials'}).`);
      }
    } catch (err) {
      console.log(`✗ Chrome Web Store: Network error (${err.message}).`);
    }
  } else {
    console.log('✗ Chrome Web Store: Missing CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, or CHROME_REFRESH_TOKEN.');
  }

  // Edge
  const edgeProductId = process.env.EDGE_PRODUCT_ID;
  const edgeClientId = process.env.EDGE_CLIENT_ID;
  const edgeClientSecret = process.env.EDGE_CLIENT_SECRET;
  const edgeTenantId = process.env.EDGE_TENANT_ID;
  if (edgeClientId && edgeClientSecret && edgeTenantId) {
    try {
      const res = await fetch(`https://login.microsoftonline.com/${edgeTenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: edgeClientId,
          client_secret: edgeClientSecret,
          scope: 'https://api.addons.microsoftedge.microsoft.com/.default',
          grant_type: 'client_credentials'
        })
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        console.log('✓ Microsoft Edge: Azure AD token acquisition successful.');
      } else {
        console.log(`✗ Microsoft Edge: Token acquisition failed (${data.error || 'invalid credentials'}).`);
      }
    } catch (err) {
      console.log(`✗ Microsoft Edge: Network error (${err.message}).`);
    }
  } else {
    console.log('✗ Microsoft Edge: Missing EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_CLIENT_SECRET, or EDGE_TENANT_ID.');
  }
}

function createAmoJwt(issuer, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    jti: crypto.randomBytes(16).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function updateAmoListing() {
  const issuer = (process.env.AMO_JWT_ISSUER || '').trim();
  const secret = (process.env.AMO_JWT_SECRET || '').trim();
  if (!issuer || !secret) {
    console.warn('[AMO Listing] Missing AMO_JWT_ISSUER or AMO_JWT_SECRET.');
    return;
  }
  const jwt = createAmoJwt(issuer, secret);
  const addonId = 'youtube-attention-cleaner@codingismynewgaming.github';
  const listingData = JSON.parse(readFileSync(join(ROOT, 'docs', 'amo-listing-v1.1.0.json'), 'utf8'));

  const payload = {
    name: {
      'en-US': listingData.name,
      'de': listingData.name
    },
    summary: {
      'en-US': listingData.summary['en-US'],
      'de': listingData.summary['de']
    },
    description: {
      'en-US': listingData.description['en-US'],
      'de': listingData.description['de']
    }
  };

  console.log(`[AMO Listing] Updating listing details on Mozilla Add-ons for ${addonId}...`);
  const res = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${addonId}/`, {
    method: 'PATCH',
    headers: {
      'Authorization': `JWT ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    console.warn('[AMO Listing] API response:', res.status, data);
  } else {
    console.log('[AMO Listing] Successfully updated AMO listing name to:', data.name);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--update-amo-listing')) {
    await updateAmoListing();
    return;
  }
  if (args.includes('--check-auth')) {
    await checkAuth();
    return;
  }
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
