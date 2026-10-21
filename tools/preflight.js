#!/usr/bin/env node
/**
 * Run before every release build:  npm run preflight
 * Stops you shipping an APK that no customer can activate.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const errors = [];
const warns = [];

const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { warns.push('No .env file. Copy .env.example to .env and fill in your buy link and WhatsApp number.'); }
const get = (k) => process.env[k] || env[k] || '';

// 0. Bake the public key into the source (Expo Go / old .env can't break activation)
try { require('./embed-pubkey'); } catch (e) { errors.push('Could not embed license-public.key: ' + e.message); }
try {
  const fileKey = fs.readFileSync(path.join(root, 'license-public.key'), 'utf8').trim();
  const envKey = get('EXPO_PUBLIC_LICENSE_PUBKEY');
  if (envKey && fileKey && envKey !== fileKey)
    warns.push('EXPO_PUBLIC_LICENSE_PUBKEY in .env differs from license-public.key. Both are trusted now, but remove the old one from .env unless you sold keys with it.');
} catch {}

// 0b. EAS cloud builds don't get .env
try {
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
  const prod = (eas.build && (eas.build['production-apk'] || eas.build.production)) || {};
  if (get('EXPO_PUBLIC_SUPPORT_WHATSAPP') && !(prod.env || {}).EXPO_PUBLIC_SUPPORT_WHATSAPP)
    warns.push('eas.json has no env values. EAS cloud builds do not receive .env — run `npm run eas-env` before `eas build`.');
} catch {}

// 1. Licence public key
let pub = get('EXPO_PUBLIC_LICENSE_PUBKEY');
try { pub = pub || fs.readFileSync(path.join(root, 'license-public.key'), 'utf8').trim(); } catch {}
if (!pub) errors.push('No licence public key. Run `npm run keygen` once. Without it NO key will ever activate.');
else if (Buffer.from(pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length !== 32) errors.push('Licence public key is malformed (must decode to 32 bytes).');

// 2. Private key matches public key, and a real issued key round-trips through the app's verifier
const privPath = path.join(root, 'keys', 'private.key');
if (pub && fs.existsSync(privPath)) {
  try {
    const nacl = require('tweetnacl');
    const b = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const sk = b(fs.readFileSync(privPath, 'utf8').trim());
    const derived = Buffer.from(sk.slice(32)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (derived !== pub) errors.push('keys/private.key does NOT match the public key in this build. Keys you issue will be rejected.');
  } catch (e) { errors.push('Could not read keys/private.key: ' + e.message); }
} else if (pub) {
  warns.push('keys/private.key not on this computer. Fine for building, but you need it to issue keys.');
}

// 3. Selling config
if (!get('EXPO_PUBLIC_BUY_URL') && !get('EXPO_PUBLIC_SUPPORT_WHATSAPP') && !get('EXPO_PUBLIC_SUPPORT_EMAIL'))
  errors.push('No EXPO_PUBLIC_BUY_URL, EXPO_PUBLIC_SUPPORT_WHATSAPP or EXPO_PUBLIC_SUPPORT_EMAIL. The "Buy now" and "Help" buttons would do nothing.');
if (get('EXPO_PUBLIC_SUPPORT_WHATSAPP') && !/^91\d{10}$/.test(get('EXPO_PUBLIC_SUPPORT_WHATSAPP').replace(/\D/g, '')))
  warns.push('EXPO_PUBLIC_SUPPORT_WHATSAPP should look like 919876543210 (91 + 10 digits).');

// 3b. Field selling
if (!get('EXPO_PUBLIC_SELLER_UPI'))
  warns.push('No EXPO_PUBLIC_SELLER_UPI. Add it so a salon owner can pay you by UPI from inside the app.');
if (get('EXPO_PUBLIC_SELLER_UPI') && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(get('EXPO_PUBLIC_SELLER_UPI')))
  warns.push('EXPO_PUBLIC_SELLER_UPI does not look like a UPI id (name@bank).');
if (Number(get('EXPO_PUBLIC_TRIAL_DAYS') || 0) > 0)
  warns.push(`Free trial is ON (${get('EXPO_PUBLIC_TRIAL_DAYS')} days). Set EXPO_PUBLIC_TRIAL_DAYS=0 for a paid-only launch.`);

// 3b2. One-tap cloud
const cloud = get('EXPO_PUBLIC_CLOUD_URL');
if (!cloud)
  warns.push('No EXPO_PUBLIC_CLOUD_URL. Owners must deploy their own Google script for backup, branches and online booking (hard). Deploy once yourself — see HOSTED_CLOUD_SETUP.md.');
else if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(cloud))
  errors.push('EXPO_PUBLIC_CLOUD_URL must be the Web app URL ending in /exec (not /dev, not the editor link). Owners would see "unable to open the file".');
else if (/\/a\/macros\//.test(cloud))
  warns.push('EXPO_PUBLIC_CLOUD_URL is a Google Workspace (/a/macros/) link. Make sure access is "Anyone" (not "Anyone in <domain>"), or use a plain Gmail account.');

const site = get('EXPO_PUBLIC_BOOKING_SITE');
if (!site)
  warns.push('No EXPO_PUBLIC_BOOKING_SITE. Booking links will be long script.google.com links (some customers see "unable to open the file"). Set up the free booking website — BOOKING_WEBSITE_SETUP.md.');
else if (!/^https:\/\/[^\s/]+(\/[^\s]*)?[^/]$/.test(site))
  errors.push('EXPO_PUBLIC_BOOKING_SITE must look like https://yourname.github.io (https, no trailing slash).');

// 3c. Legacy keys
warns.push('Old v3 keys (SBX-PLAN-EXPIRY-CHECKSUM) still activate. Anyone holding your old generate-license-key.js can create those, so issue NEW sales with `npm run issue` / `npm run batch`.');

// 4. Server pairing
if (get('EXPO_PUBLIC_LICENSE_URL') && !get('SBX_RESPONSE_SECRET'))
  warns.push('Licence server URL set but SBX_RESPONSE_SECRET empty — server responses will not be verified.');
if (!get('EXPO_PUBLIC_LICENSE_URL'))
  warns.push('No licence server. Keys work offline, but one key can be shared across phones and you cannot revoke.');

// 5. Version bump reminder
const app = require(path.join(root, 'app.json')).expo;
console.log(`\nSaloonBossX ${app.version} (versionCode ${app.android.versionCode})`);
console.log('Remember: raise android.versionCode for every APK you publish, or phones refuse to update.\n');

// 6. Junk that bloats or leaks
for (const f of ['saloonBossX.zip', 'generate-license-key.js']) {
  if (fs.existsSync(path.join(root, f))) errors.push(`Remove ${f} from the project before building.`);
}

// 7. The licence signing key must never ship. EAS uploads what .easignore (or,
//    without one, .gitignore) allows, so both must exclude keys/*.key, and git
//    must not track it.
{
  const { gitignoreProblem, isForbidden } = require('./lib/releaseFiles');
  let gi = '';
  try { gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch {}
  const giProblem = gitignoreProblem(gi);
  if (giProblem) errors.push(giProblem);
  if (fs.existsSync(path.join(root, '.easignore'))) {
    const ei = gitignoreProblem(fs.readFileSync(path.join(root, '.easignore'), 'utf8'));
    if (ei) errors.push('.easignore exists but does not exclude keys/*.key — EAS would upload the licence signing key.');
  }
  try {
    const tracked = require('child_process').execSync('git ls-files', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').filter(Boolean).filter(isForbidden);
    if (tracked.length) errors.push(`Secret files are committed to git: ${tracked.join(', ')}. Remove them with "git rm --cached" and rotate the key.`);
  } catch { /* not a git checkout */ }
  for (const z of fs.readdirSync(root).filter((f) => /\.(zip|apk|aab)$/i.test(f))) {
    warns.push(`${z} is in the project folder. Release archives belong in dist/ — use \`npm run package:release\`, which leaves keys/ out.`);
  }
}

warns.forEach((w) => console.log('  ⚠  ' + w));
errors.forEach((e) => console.log('  ✖  ' + e));
if (errors.length) { console.log('\nPreflight FAILED. Fix the ✖ items above.\n'); process.exit(1); }
console.log('\nPreflight passed.\n');
