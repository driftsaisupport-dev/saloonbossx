// app.config.js — Expo dynamic config
// Bridges environment variables (from .env, the shell, or eas.json "env") into
// the app. Nothing read here is secret: it all ends up inside the APK.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const out = {};
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key.startsWith('EXPO_PUBLIC_') || key.startsWith('SBX_')) out[key] = val;
      }
    }
  } catch { /* ignore */ }
  for (const key of Object.keys(process.env)) {
    if ((key.startsWith('EXPO_PUBLIC_') || key.startsWith('SBX_')) && process.env[key]) out[key] = process.env[key];
  }
  return out;
}

function readPublicKeyFile() {
  try {
    return fs.readFileSync(path.join(__dirname, 'license-public.key'), 'utf-8').trim();
  } catch { return ''; }
}

const env = loadEnv();

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    // Ed25519 PUBLIC key. Written by `npm run keygen` to license-public.key.
    licensePubKey: env.EXPO_PUBLIC_LICENSE_PUBKEY || readPublicKeyFile(),
    // Licence server (Google Apps Script /exec URL). Optional.
    licenseUrl: env.EXPO_PUBLIC_LICENSE_URL || '',
    // Must equal RESPONSE_SECRET in the Apps Script's Script Properties.
    responseSecret: env.SBX_RESPONSE_SECRET || '',
    // GitHub repo (owner/repo) that hosts APK releases for in-app update checks.
    updateRepo: env.EXPO_PUBLIC_UPDATE_REPO || '',
    // Old v3 licence keys (SBX-PLAN-EXPIRY-CHECKSUM). Leave blank to use the
    // v3 default so keys already in your sheet keep working.
    legacySecret: env.SBX_LEGACY_SECRET || env.EXPO_PUBLIC_LEGACY_SECRET || '',

    // Selling
    buyUrl: env.EXPO_PUBLIC_BUY_URL || '',
    supportWhatsapp: env.EXPO_PUBLIC_SUPPORT_WHATSAPP || '',
    supportEmail: env.EXPO_PUBLIC_SUPPORT_EMAIL || '',
    trialDays: env.EXPO_PUBLIC_TRIAL_DAYS || '0',
    sellerUpi: env.EXPO_PUBLIC_SELLER_UPI || '',
    sellerName: env.EXPO_PUBLIC_SELLER_NAME || '',
    refundDays: env.EXPO_PUBLIC_REFUND_DAYS || '7',
    // "Make a copy" link of your Cloud Bridge template Sheet (see CLOUD_TEMPLATE_SETUP.md).
    // Shared Cloud Bridge /exec URL (see HOSTED_CLOUD_SETUP.md) — one-tap cloud for every owner.
    cloudUrl: env.EXPO_PUBLIC_CLOUD_URL || '',
    // Booking website for short links (see BOOKING_WEBSITE_SETUP.md).
    bookingSite: env.EXPO_PUBLIC_BOOKING_SITE || '',
    cloudTemplateUrl: env.EXPO_PUBLIC_CLOUD_TEMPLATE_URL || '',
  },
});
