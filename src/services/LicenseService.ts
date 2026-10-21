import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import HmacSHA256 from 'crypto-js/hmac-sha256';
import Base64 from 'crypto-js/enc-base64';
import { Platform } from 'react-native';
import { DatabaseService } from '../database/Database';
import { LICENSE_PLANS, type PlanId, type LicensePlan, type Billing, priceOf, currencyOfPrices } from './licensePlans';
import { getRegion } from '../config/regions';
import { verifyKey, cleanKey, deviceBinding, type LicensePayload } from './licenseCrypto';
import { TRIAL_DAYS, openCheckout } from '../config/sales';

export { LICENSE_PLANS };
export type { PlanId, LicensePlan };

let GOOGLE_SCRIPT_URL = '';
let RESPONSE_SECRET = '';
try {
  GOOGLE_SCRIPT_URL = process.env.EXPO_PUBLIC_LICENSE_URL || '';
  const extra = require('expo-constants').default?.expoConfig?.extra || {};
  if (!GOOGLE_SCRIPT_URL) GOOGLE_SCRIPT_URL = extra.licenseUrl || '';
  RESPONSE_SECRET = process.env.SBX_RESPONSE_SECRET || extra.responseSecret || '';
} catch { /* offline-only build */ }

// Everything about the licence now lives in SecureStore. license_plan and
// license_expiry used to sit in the plaintext settings table, which meant they
// travelled inside every backup — editing one line of a backup JSON upgraded
// the user to the academy tier for free.
const K = {
  key: 'license_key',
  plan: 'license_plan',
  expiry: 'license_expiry',
  binding: 'license_binding',
  email: 'license_email',
  name: 'license_name',
  activatedAt: 'license_activated_at',
  lastCheck: 'license_last_check',
  device: 'license_device',
  billing: 'license_billing',
  used: 'license_used_orders',
} as const;
/** Days the app keeps working after a monthly / yearly plan ends, so a salon is never stopped mid-day. */
export const GRACE_DAYS = 3;

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDaysYmd = (from: string, n: number) => { const [y, m, d] = from.split('-').map(Number); return ymdLocal(new Date(y, m - 1, d + n)); };
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const daysUntil = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); const end = new Date(y, m - 1, d, 23, 59, 59).getTime(); return Math.floor((end - Date.now()) / 86400000); };
export const billingOf = (p: LicensePayload): Billing =>
  p.e === 'LIFETIME' ? 'lifetime' : (p.b === 'monthly' || p.b === 'yearly') ? p.b : (Number(p.t) || 0) > 60 ? 'yearly' : 'monthly';
// Kept outside K so deactivate() never resets the trial clock.
const TRIAL_KEY = 'trial_started_at';

async function sGet(k: string): Promise<string> {
  try { return (await SecureStore.getItemAsync(k)) || ''; } catch { return ''; }
}
async function sSet(k: string, v: string): Promise<void> {
  try { await SecureStore.setItemAsync(k, v); } catch { /* keychain unavailable */ }
}
async function sDel(k: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(k); } catch { /* already gone */ }
}

// Revalidation is cached for a day. The old build called the Apps Script web
// app on every single launch; a few thousand customers opening the app a few
// times a day exhausts the daily quota and then every activation fails at once.
const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const LicenseService = {
  async getDeviceId(): Promise<string> {
    const cached = await sGet(K.device);
    if (cached) return cached;

    let raw = '';
    try {
      raw = Platform.OS === 'android'
        ? (Application.getAndroidId?.() || '')
        : ((await Application.getIosIdForVendorAsync()) || '');
    } catch { /* fall through to random */ }

    if (!raw) raw = `${Date.now()}-${Math.random()}`;

    const id = (await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256, `SBX::${raw}`
    )).slice(0, 24).toUpperCase();

    await sSet(K.device, id);
    return id;
  },

  /**
   * Verify the server's HMAC over its own response.
   *
   * This used to log a warning and carry on, which made the check decorative —
   * a hostile DNS answer or a captive portal could forge an activation. A
   * failed signature is now a hard reject. Only call this when RESPONSE_SECRET
   * is actually configured — the caller treats "no secret" as "cannot verify"
   * (handled like the server being unreachable), never as "verified".
   */
  _verifyResponseSignature(data: any, key: string, deviceId: string): boolean {
    if (!data?.sig || !data?.ts) return false;
    if (Math.abs(Date.now() - Number(data.ts)) > 5 * 60 * 1000) return false;

    const message = [
      cleanKey(key).toUpperCase(), String(deviceId).trim(), 'true',
      String(data.plan), String(data.expiry), String(data.ts),
    ].join('|');

    const expected = Base64.stringify(HmacSHA256(message, RESPONSE_SECRET));
    return expected === data.sig;
  },

  /** Ask the server to register this device. Failure is not fatal. */
  async _registerOnline(
    key: string, deviceId: string, email = '', name = ''
  ): Promise<{ reached: boolean; allowed: boolean; message: string; expiry?: string; expirySetNow?: boolean }> {
    if (!GOOGLE_SCRIPT_URL) return { reached: false, allowed: true, message: '' };

    const url =
      `${GOOGLE_SCRIPT_URL}?action=activate` +
      `&key=${encodeURIComponent(cleanKey(key))}` +
      `&device=${encodeURIComponent(deviceId)}` +
      `&ts=${Date.now()}` +
      `&email=${encodeURIComponent(email)}` +
      `&name=${encodeURIComponent(name)}`;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      // Activation changes the sheet. Apps Script only allows that mutation
      // through doPost; keeping the arguments in the URL preserves its
      // e.parameter parsing while preventing GET retries from registering a device.
      const res = await fetch(url, { method: 'POST', signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();

      // Only "revoked" and "device limit" are genuine licensing decisions the
      // server is authoritative on. Everything else it can send back — "not
      // found" (auto-registration raced or failed), "Server error" (an
      // uncaught exception in Code.gs), "Server busy" (lock timeout), "Request
      // expired" (clock skew) — is a backend hiccup, not proof the key is
      // illegitimate: the key's Ed25519 signature (and its embedded expiry)
      // were already verified locally before this call. Treating those as
      // fatal used to lock a paying customer out on every Apps Script error.
      if (data?.valid === false && /revoked|device limit/i.test(data.message || '')) {
        return { reached: true, allowed: false, message: data.message };
      }
      if (data?.valid === true) {
        if (!RESPONSE_SECRET) {
          // This build has no signing secret configured, so we have no way to
          // tell a real "valid" response from a forged one (a hostile DNS
          // answer or captive portal). Do not trust it — but don't punish a
          // paying customer for a missing env var either, so treat this the
          // same as the server being unreachable: the Ed25519 key check
          // already passed locally, and the device cap simply won't be
          // enforced across devices until a properly-configured build reaches it.
          return { reached: false, allowed: true, message: '' };
        }
        if (!this._verifyResponseSignature(data, key, deviceId)) {
          return { reached: true, allowed: false, message: 'Could not verify the activation response. Try again on a trusted network.' };
        }
        // Signed: the server's expiry for a monthly / yearly key is trustworthy.
        return { reached: true, allowed: true, message: data?.message || '', expiry: isYmd(data.expiry) ? data.expiry : undefined, expirySetNow: !!data.expirySetNow };
      }
      if (data?.valid === false) {
        return { reached: false, allowed: true, message: '' };
      }
      return { reached: true, allowed: true, message: data?.message || '' };
    } catch {
      return { reached: false, allowed: true, message: '' };
    }
  },

  /**
   * Activate a licence key.
   *
   * The signature check is the authority and works with no network at all. The
   * server is consulted only to enforce the device cap across devices; if it
   * cannot be reached, the local device binding still prevents the key being
   * reused elsewhere.
   */
  async activateWithKey(
    key: string, email = '', name = ''
  ): Promise<{ success: boolean; message: string; plan: string }> {
    const clean = cleanKey(key);
    if (!clean) return { success: false, message: 'Enter your licence key.', plan: '' };

    const result = verifyKey(clean);
    if (!result.valid || !result.payload) {
      return { success: false, message: result.reason || 'That licence key is not valid.', plan: '' };
    }

    const payload: LicensePayload = result.payload;
    const deviceId = await this.getDeviceId();

    const currentKey = await sGet(K.key);
    const sameKey = !!currentKey && cleanKey(currentKey) === clean;
    const existingBinding = await sGet(K.binding);
    const thisBinding = await deviceBinding(clean, deviceId);
    // A different key on this phone is a renewal or an upgrade — always allowed.
    if (sameKey && existingBinding && existingBinding !== thisBinding) {
      return {
        success: false,
        message: 'This key is already activated on another device. Deactivate it there first, or contact support to transfer it.',
        plan: '',
      };
    }
    // A monthly / yearly key adds its days once. Typing an old renewal key again must not add more.
    // order id → end date it gave. Survives "Remove licence", so removing and
    // re-adding a monthly key can never restart its month.
    let used: Record<string, string> = {};
    try { const raw = await sGet(K.used); used = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(raw.split(',').filter(Boolean).map(o => [o, ''])); } catch { used = {}; }
    const reused = payload.e === 'TERM' && !sameKey && !!payload.o && payload.o in used;
    if (reused) {
      const cur = await this.getStatus().catch(() => null);
      if (cur?.activated && !cur.trial) {
        return { success: false, message: 'This renewal key was already used on this phone. Buy a new key to extend your plan.', plan: '' };
      }
    }

    const online = await this._registerOnline(clean, deviceId, email, name);
    if (online.reached && !online.allowed) {
      return { success: false, message: online.message || 'This licence could not be activated.', plan: '' };
    }

    // Legacy (v3) keys are checksummed with a secret that ships inside the app
    // bundle — unlike v4's Ed25519 signature, that checksum can be computed by
    // anyone, so passing it proves nothing on its own. A v3 key is only ever
    // written into the sheet by hand, never auto-registered, so requiring the
    // server to actually confirm it exists closes that gap without touching
    // v4 keys (which stay fully offline-capable) or breaking any real,
    // already-issued v3 key (which the server will confirm once reachable).
    if (payload.legacy && !online.reached) {
      return {
        success: false,
        message: 'Could not reach the licence server to confirm this key. Connect to the internet and try again.',
        plan: '',
      };
    }

    // Work out the expiry.
    let expiry = payload.e;
    if (payload.e === 'TERM') {
      const today = ymdLocal(new Date());
      if (sameKey && isYmd(await sGet(K.expiry))) {
        expiry = await sGet(K.expiry);                       // re-activating the same key: no extra days
      } else if (reused && isYmd(used[payload.o!])) {
        expiry = used[payload.o!];                           // key used here before: same end date as then
      } else {
        // Renewing early? The new days are added after the current end date (same plan).
        const cur = await this.getStatus().catch(() => null);
        const from = cur?.activated && !cur.trial && cur.plan === payload.p && isYmd(cur.expiry) && cur.expiry > today ? cur.expiry : today;
        expiry = addDaysYmd(from, Number(payload.t));
      }
      if (online.expiry) {
        // The licence server remembers when this key was first used, so a
        // reinstall cannot restart the month. Only a first-ever activation stacks.
        expiry = online.expirySetNow ? (online.expiry > expiry ? online.expiry : expiry) : online.expiry;
      }
      if (daysUntil(expiry) < -GRACE_DAYS) {
        return { success: false, message: `This key's plan ended on ${expiry}. Buy a renewal key to continue — your data is safe.`, plan: '' };
      }
    }

    await sSet(K.key, clean);
    await sSet(K.plan, payload.p);
    await sSet(K.expiry, expiry);
    await sSet(K.billing, billingOf(payload));
    if (payload.o) {
      used[payload.o] = expiry;
      const keep = Object.keys(used).slice(-80);
      await sSet(K.used, JSON.stringify(Object.fromEntries(keep.map(k => [k, used[k]]))));
    }
    await sSet(K.binding, thisBinding);
    await sSet(K.activatedAt, new Date().toISOString());
    await sSet(K.lastCheck, String(Date.now()));
    if (email) await sSet(K.email, email);
    if (name) await sSet(K.name, name);

    const until = payload.e === 'TERM' ? ` Valid until ${expiry}.` : payload.e === 'LIFETIME' ? ' Lifetime licence.' : '';
    return {
      success: true,
      plan: payload.p,
      message: (online.reached
        ? 'Activated.'
        : 'Activated offline. We will confirm with the server next time you are online.') + until,
    };
  },

  /** Backwards-compatible alias. */
  async activate(key: string) {
    return this.activateWithKey(key, '', '');
  },

  /** Trial state. Trial runs on the Standard plan so owners see the full product. */
  async getTrial(): Promise<{ started: boolean; active: boolean; daysLeft: number; available: boolean }> {
    const raw = await sGet(TRIAL_KEY);
    if (!raw) return { started: false, active: false, daysLeft: 0, available: TRIAL_DAYS > 0 };
    const startedAt = Number(raw) || 0;
    const end = startedAt + TRIAL_DAYS * 86400000;
    // A clock moved backwards before the start is treated as expired.
    const active = TRIAL_DAYS > 0 && Date.now() >= startedAt - 86400000 && Date.now() < end;
    const daysLeft = active ? Math.max(1, Math.ceil((end - Date.now()) / 86400000)) : 0;
    return { started: true, active, daysLeft, available: false };
  },

  async startTrial(): Promise<{ success: boolean; message: string }> {
    if (TRIAL_DAYS <= 0) return { success: false, message: 'Free trial is not available.' };
    const t = await this.getTrial();
    if (t.started) {
      return t.active
        ? { success: true, message: `Trial active: ${t.daysLeft} days left.` }
        : { success: false, message: 'Your free trial has ended. Buy a licence to keep using SaloonBossX — all your data is safe.' };
    }
    await sSet(TRIAL_KEY, String(Date.now()));
    return { success: true, message: `Your ${TRIAL_DAYS}-day free trial has started.` };
  },

  async getStatus(): Promise<{
    activated: boolean; plan: PlanId | null; expiry: string; daysLeft: number; trial: boolean;
    billing?: Billing; grace?: boolean;
  }> {
    const key = await sGet(K.key);
    if (!key) {
      const t = await this.getTrial();
      if (t.active) return { activated: true, plan: 'standard', expiry: 'TRIAL', daysLeft: t.daysLeft, trial: true };
      return { activated: false, plan: null, expiry: '', daysLeft: 0, trial: false };
    }

    // Re-verify the signature every time. Nothing is trusted just because it is
    // in storage — a rooted device could have edited it.
    const result = verifyKey(key);
    if (!result.valid || !result.payload) {
      return { activated: false, plan: null, expiry: '', daysLeft: 0, trial: false };
    }

    const { p: plan, e: keyExpiry } = result.payload;
    const billing = billingOf(result.payload);

    if (keyExpiry === 'TERM') {
      const exp = await sGet(K.expiry);
      if (!isYmd(exp)) return { activated: false, plan, expiry: '', daysLeft: 0, trial: false, billing };
      const left = daysUntil(exp);
      if (left < -GRACE_DAYS) return { activated: false, plan, expiry: exp, daysLeft: 0, trial: false, billing };
      return { activated: true, plan, expiry: exp, daysLeft: Math.max(0, left), trial: false, billing, grace: left < 0 };
    }

    const expiry = keyExpiry;
    let daysLeft = 36500;
    if (expiry !== 'LIFETIME') {
      const exp = new Date(expiry.replace(/-/g, '/'));
      daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000);
      if (daysLeft < 0) return { activated: false, plan, expiry, daysLeft: 0, trial: false };
    }

    return { activated: true, plan, expiry, daysLeft, trial: false, billing };
  },

  /** Open checkout / UPI for a renewal of the current plan (or a chosen one). */
  async renew(plan?: PlanId, billing?: Billing, email = '', name = '') {
    const st = await this.getStatus();
    const p = plan || st.plan || 'standard';
    const b = billing || (st.billing === 'lifetime' ? 'yearly' : st.billing) || 'yearly';
    return this.purchaseViaWebCheckout(p, email, name, b);
  },

  async hasFeature(
    feature: 'multi_location' | 'academy' | 'staff_management' | 'gst_reports'
  ): Promise<boolean> {
    const { activated, plan } = await this.getStatus();
    if (!activated || !plan) return false;
    switch (feature) {
      case 'academy':           return plan === 'academy';
      case 'multi_location':    return plan === 'multi' || plan === 'academy';
      case 'staff_management':  return plan !== 'solo';
      case 'gst_reports':       return plan !== 'solo';
      default:                  return false;
    }
  },

  async getLicenseInfo() {
    const status = await this.getStatus();
    return {
      ...status,
      key: await sGet(K.key),
      email: await sGet(K.email),
      name: await sGet(K.name),
      activatedAt: await sGet(K.activatedAt),
      planDetails: status.plan ? LICENSE_PLANS[status.plan] : null,
    };
  },

  /**
   * Periodic server check, for revocation only.
   *
   * Fails open by design: if the server is gone, throttled, or the URL is
   * blank, the licence keeps working. A one-time purchase must not stop
   * working because a Google Apps Script quota ran out.
   */
  async revalidate(force = false): Promise<{ ok: boolean; message?: string }> {
    const key = await sGet(K.key);
    if (!key) return { ok: true };
    if (!GOOGLE_SCRIPT_URL) return { ok: true };

    if (!force) {
      const last = Number(await sGet(K.lastCheck) || 0);
      if (Date.now() - last < REVALIDATE_INTERVAL_MS) return { ok: true };
    }

    const deviceId = await this.getDeviceId();
    const url =
      `${GOOGLE_SCRIPT_URL}?action=validate` +
      `&key=${encodeURIComponent(key)}&device=${encodeURIComponent(deviceId)}&ts=${Date.now()}`;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();

      await sSet(K.lastCheck, String(Date.now()));

      // Seller extended a monthly / yearly key in the sheet (e.g. renewed by UPI
      // without a new key): pick up the later date. Only signed answers count.
      if (data?.valid === true && isYmd(data.expiry) && RESPONSE_SECRET && this._verifyResponseSignature(data, key, deviceId)) {
        const v = verifyKey(key);
        const cur = await sGet(K.expiry);
        if (v.valid && v.payload?.e === 'TERM' && (!isYmd(cur) || data.expiry > cur)) await sSet(K.expiry, data.expiry);
      }

      // Only an explicitly authoritative negative locks the app.
      if (data?.valid === false && /revoked/i.test(data.message || '')) {
        await this.deactivate();
        return { ok: false, message: data.message };
      }
      return { ok: true };
    } catch {
      return { ok: true };
    }
  },

  async purchaseViaWebCheckout(planId: PlanId, email: string, name = '', billing: Billing = 'yearly') {
    const plan = LICENSE_PLANS[planId];
    const deviceId = await this.getDeviceId();
    const currency = currencyOfPrices(getRegion().currency);
    const ok = await openCheckout({ planId, planName: plan.name, price: priceOf(planId, billing, currency), currency, country: getRegion().code, email, name, deviceId, billing });
    return ok
      ? { success: true, message: '' }
      : { success: false, message: 'Could not open checkout. Please contact the seller who gave you this app.' };
  },

  /**
   * User-initiated "move to a new phone". Frees this device's slot on the
   * server (best effort) and then clears the licence locally.
   */
  async releaseDevice(): Promise<void> {
    const key = await sGet(K.key);
    if (key && GOOGLE_SCRIPT_URL) {
      try {
        const deviceId = await this.getDeviceId();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        await fetch(
          `${GOOGLE_SCRIPT_URL}?action=release&key=${encodeURIComponent(key)}` +
          `&device=${encodeURIComponent(deviceId)}&ts=${Date.now()}`,
          { method: 'POST', signal: ctrl.signal }
        );
        clearTimeout(t);
      } catch { /* offline — support can clear it from the sheet */ }
    }
    await this.deactivate();
  },

  async deactivate(): Promise<void> {
    for (const k of Object.values(K)) {
      if (k === K.device || k === K.used) continue; // keep the device id and used-key history
      await sDel(k);
    }
    try {
      await DatabaseService.setSetting('license_plan', '');
      await DatabaseService.setSetting('license_expiry', '');
    } catch { /* db may not be open */ }
  },
};

export default LicenseService;
