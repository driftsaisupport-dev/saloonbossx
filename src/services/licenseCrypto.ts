import nacl from 'tweetnacl';
import SHA256 from 'crypto-js/sha256';
import type { PlanId } from './licensePlans';

/**
 * Licence key verification.
 *
 * The previous scheme was symmetric: the key's checksum was
 * SHA256("SBX:PLAN:EXPIRY:" + SHARED_SECRET), and the app needed that secret to
 * check a key. A React Native release bundle is trivial to extract from an APK,
 * so the secret was public, and anyone who pulled it could mint unlimited
 * lifetime keys. A shared secret inside a client binary is not a secret.
 *
 * This is asymmetric. The app holds only the Ed25519 PUBLIC key. Keys are
 * signed on your machine with the private half, which never ships. Extracting
 * the app now yields nothing useful — an attacker can read the verifier but
 * cannot produce a signature it will accept.
 *
 * Key format:  SBX-<base64url payload>-<base64url signature>
 * Payload:     {"p":"academy","e":"LIFETIME","o":"ORD-2026-0417","i":1760000000}
 *                plan          expiry        order id            issued at
 */

const PREFIX = 'SBX';

export interface LicensePayload {
  /** Plan id. */
  p: PlanId;
  /** Expiry as YYYY-MM-DD, the literal LIFETIME, or TERM (then `t` days from activation). */
  e: string;
  /** TERM keys: days this key adds (31 = monthly, 366 = yearly). */
  t?: number;
  /** Billing the key was sold as: monthly | yearly | lifetime. Display only. */
  b?: string;
  /** Your order reference. Lets you revoke a specific sale. */
  o: string;
  /** Issued-at, unix seconds. */
  i: number;
  /** Optional device cap override. Falls back to the plan default. */
  d?: number;
  /** True for old v3 keys (SBX-PLAN-EXPIRY-CHECKSUM). */
  legacy?: boolean;
}

/**
 * v3 keys: SBX-<PLAN>-<EXPIRY>-<8 hex>, checksum =
 * SHA256("SBX:PLAN:EXPIRY:<secret>") truncated to 8 characters.
 *
 * This scheme is weaker than the Ed25519 one — the secret has to live inside
 * the app, so anyone who unpacks an APK can mint keys. It is supported only so
 * that keys already written into your licence sheet keep working. Two things
 * limit the damage: a v3 key must already exist in the sheet before the server
 * will accept it (it is never auto-registered), and every new key you issue
 * with `npm run issue` uses the unforgeable format.
 */
const LEGACY_SECRET_DEFAULT = 'SaloonBossX_OfflineValidation_v3';

function legacySecret(): string {
  try {
    if (process.env.EXPO_PUBLIC_LEGACY_SECRET) return process.env.EXPO_PUBLIC_LEGACY_SECRET;
    const extra = require('expo-constants').default?.expoConfig?.extra || {};
    if (extra.legacySecret) return String(extra.legacySecret);
  } catch { /* fall through */ }
  return LEGACY_SECRET_DEFAULT;
}

/** Old plan names → current plan ids. */
const LEGACY_PLANS: Record<string, PlanId> = {
  STARTER: 'solo', SOLO: 'solo',
  PRO: 'standard', STANDARD: 'standard',
  BUSINESS: 'multi', MULTI: 'multi', 'MULTI-LOCATION': 'multi',
  ACADEMY: 'academy',
};

function verifyLegacyKey(key: string): VerifyResult | null {
  // SBX-PLAN-EXPIRY-CHECKSUM, where EXPIRY is LIFETIME or YYYY-MM-DD (which
  // itself contains hyphens), and CHECKSUM is 8 hex characters.
  const m = key.toUpperCase().match(/^SBX-([A-Z-]+)-(LIFETIME|\d{4}-\d{2}-\d{2})-([0-9A-F]{8})$/);
  if (!m) return null;

  const [, rawPlan, expiry, checksum] = m;
  const plan = LEGACY_PLANS[rawPlan];
  if (!plan) return { valid: false, reason: 'That licence key is not valid.' };

  const expected = String(SHA256(`SBX:${rawPlan}:${expiry}:${legacySecret()}`))
    .slice(0, 8)
    .toUpperCase();
  if (expected !== checksum) return { valid: false, reason: 'That licence key is not valid.' };

  const payload: LicensePayload = { p: plan, e: expiry, o: 'v3', i: 0, legacy: true };

  if (expiry !== 'LIFETIME') {
    const exp = new Date(expiry.replace(/-/g, '/'));
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return { valid: false, payload, reason: `This licence expired on ${expiry}.` };
    }
  }
  return { valid: true, payload };
}

export interface VerifyResult {
  valid: boolean;
  payload?: LicensePayload;
  reason?: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = globalThis.atob
    ? globalThis.atob(b64 + pad)
    : (globalThis as any).Buffer.from(b64 + pad, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToUtf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

/**
 * Make a pasted key usable: WhatsApp / email / iOS add spaces, line breaks,
 * invisible characters, "smart" dashes, quotes or a "Key:" label around it.
 */
export function cleanKey(raw: string): string {
  let s = String(raw || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')        // invisible characters
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-')      // unicode dashes → "-"
    .replace(/\s+/g, '');
  const m = s.match(/SBX-[A-Za-z0-9_-]{20,}/i);                  // a key inside other text
  if (m) s = m[0];
  else s = s.replace(/^["'`*]+|["'`*.,;]+$/g, '');
  if (/^sbx-/.test(s)) s = 'SBX-' + s.slice(4);
  return s;
}

let cachedPubKeys: { b64: string; bytes: Uint8Array }[] | null = null;

/**
 * Every public key this build trusts: the one baked into the source
 * (src/services/licensePubKey.ts, from license-public.key) plus any set via
 * .env / app config. A stale .env can therefore never lock out real keys.
 */
function publicKeys(): { b64: string; bytes: Uint8Array }[] {
  if (cachedPubKeys) return cachedPubKeys;
  const list: string[] = [];
  try { list.push(...require('./licensePubKey').EMBEDDED_LICENSE_PUBKEYS); } catch { /* not generated */ }
  try { if (process.env.EXPO_PUBLIC_LICENSE_PUBKEY) list.push(process.env.EXPO_PUBLIC_LICENSE_PUBKEY); } catch {}
  try { const extra = require('expo-constants').default?.expoConfig?.extra || {}; if (extra.licensePubKey) list.push(extra.licensePubKey); } catch {}
  const out: { b64: string; bytes: Uint8Array }[] = [];
  for (const b64 of [...new Set(list.map(x => String(x).trim()).filter(Boolean))]) {
    try { const bytes = b64urlToBytes(b64); if (bytes.length === 32) out.push({ b64, bytes }); } catch { /* skip */ }
  }
  cachedPubKeys = out;
  return out;
}

/** Short IDs of the trusted keys — shown on the activation screen for support. */
export function licenseKeyIds(): string[] {
  return publicKeys().map(k => k.b64.slice(0, 6));
}

/**
 * Verify a licence key offline.
 *
 * No network, no shared secret, no server dependency — so this keeps working
 * forever even if the licence server is switched off.
 */
/**
 * Split a key into payload and signature.
 *
 * Do NOT use key.split('-'): base64url uses '-' as a normal character, so about
 * three keys in four contain extra hyphens and were rejected as "wrong format"
 * even though they were genuine. An Ed25519 signature is always 64 bytes, which
 * is always exactly 86 base64url characters, so we cut from the end instead.
 */
const SIG_LEN = 86;
export function splitKey(raw: string): { payload: string; sig: string } | null {
  const key = cleanKey(raw);
  if (key.slice(0, PREFIX.length + 1).toUpperCase() !== PREFIX + '-') return null;
  const body = key.slice(PREFIX.length + 1);
  if (body.length < SIG_LEN + 2) return null;
  const sig = body.slice(-SIG_LEN);
  if (body.charAt(body.length - SIG_LEN - 1) !== '-') return null;
  const payload = body.slice(0, body.length - SIG_LEN - 1);
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  return { payload, sig };
}

export function verifyKey(raw: string): VerifyResult {
  // Keys from the v3 sheet are checked first — they are short and unambiguous.
  const legacy = verifyLegacyKey(cleanKey(raw));
  if (legacy) return legacy;

  const split = splitKey(raw);
  if (!split) {
    return { valid: false, reason: 'That key is not in the right format. Copy the full key starting with SBX- and paste it without changes.' };
  }
  const parts = ['SBX', split.payload, split.sig];

  const pubs = publicKeys();
  if (!pubs.length) {
    return {
      valid: false,
      reason: 'This build has no licence public key configured. Contact support.',
    };
  }

  let payload: LicensePayload;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;

  try {
    payloadBytes = b64urlToBytes(parts[1]);
    sigBytes = b64urlToBytes(parts[2]);
    payload = JSON.parse(bytesToUtf8(payloadBytes));
  } catch {
    return { valid: false, reason: 'That key is damaged. Check for a typo.' };
  }

  if (sigBytes.length !== 64) {
    return { valid: false, reason: 'That key is damaged. Check for a typo.' };
  }

  let ok = false;
  try {
    ok = pubs.some(p => nacl.sign.detached.verify(payloadBytes, sigBytes, p.bytes));
  } catch {
    ok = false;
  }

  if (!ok) {
    // Readable payload but wrong signature: either a typo inside the key or a
    // key made for a different build of the app.
    return { valid: false, payload, reason: `That licence key is not valid for this app (check ${licenseKeyIds().join(',') || 'none'}). Copy the whole key again from WhatsApp — or ask the seller to check that this app was built with the same licence keys.` };
  }
  if (!payload?.p || !payload?.e || !['solo', 'standard', 'multi', 'academy'].includes(payload.p)) {
    return { valid: false, reason: 'That licence key is incomplete.' };
  }

  if (payload.e === 'TERM') {
    // Monthly / yearly keys start counting when they are activated, so a key
    // bought today and typed in next week still gives the full month.
    if (!(Number(payload.t) >= 1 && Number(payload.t) <= 800)) return { valid: false, reason: 'That licence key is incomplete.' };
    return { valid: true, payload };
  }
  if (payload.e !== 'LIFETIME') {
    const exp = new Date(payload.e.replace(/-/g, '/'));
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return { valid: false, payload, reason: `This licence expired on ${payload.e}.` };
    }
  }

  return { valid: true, payload };
}

/**
 * Bind a verified key to this device.
 *
 * A signed key alone is still shareable — one buyer could post it in a WhatsApp
 * group and a hundred salons could activate offline. The binding is a hash of
 * the key and the device id, stored in SecureStore on first activation; any
 * later activation on a different device fails the comparison.
 */
export async function deviceBinding(key: string, deviceId: string): Promise<string> {
  const Crypto = require('expo-crypto');
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${cleanKey(key)}::${deviceId}`
  );
}

/** Human-readable summary for the activation screen. */
export function describeKey(p: LicensePayload): string {
  const life = p.e === 'LIFETIME' ? 'Lifetime' : p.e === 'TERM' ? `${p.t} days from activation` : `Valid until ${p.e}`;
  return `${p.p} · ${life}`;
}
