/** Shared by the key tools. Prices / days MUST match src/services/licensePlans.ts. */
const nacl = require('tweetnacl');
const fs = require('fs');
const path = require('path');

const PLANS = ['solo', 'standard', 'multi', 'academy'];
const PLAN_NAME = { solo: 'Solo', standard: 'Salon Pro', multi: 'Chain', academy: 'Salon + Academy' };
const BILLINGS = ['monthly', 'yearly', 'lifetime'];
const TERM_DAYS = { monthly: 31, yearly: 366 };
// INR prices (v6 universal edition): yearly = 10 × monthly; lifetime (legacy keys) = 2 × yearly.
const PRICES = {
  solo:     { monthly: 499,  yearly: 4990,  lifetime: 9980 },
  standard: { monthly: 999,  yearly: 9990,  lifetime: 19980 },
  multi:    { monthly: 2499, yearly: 24990, lifetime: 49980 },
  academy:  { monthly: 1499, yearly: 14990, lifetime: 29980 },
};
const DEVICES = { solo: 1, standard: 1, multi: 3, academy: 2 };

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

function loadSecret(root = path.join(__dirname, '..', '..')) {
  const p = path.join(root, 'keys', 'private.key');
  if (!fs.existsSync(p)) throw new Error('keys/private.key not found. Run: npm run keygen (once ever).');
  return fromB64url(fs.readFileSync(p, 'utf8').trim());
}

/** One signed key. billing: monthly | yearly | lifetime. days overrides with a fixed-date key (trials). */
function makeKey(sk, { plan, billing = 'lifetime', order, devices, days }) {
  if (!PLANS.includes(plan)) throw new Error(`Unknown plan "${plan}". Use: ${PLANS.join(', ')}`);
  if (!BILLINGS.includes(billing)) throw new Error(`Unknown billing "${billing}". Use: ${BILLINGS.join(', ')}`);
  const payload = { p: plan, e: 'LIFETIME', o: order, i: Math.floor(Date.now() / 1000), b: billing };
  if (days) { payload.e = new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10); payload.b = 'trial'; }
  else if (billing !== 'lifetime') { payload.e = 'TERM'; payload.t = TERM_DAYS[billing]; }
  if (devices) payload.d = Number(devices);
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { key: `SBX-${b64url(bytes)}-${b64url(nacl.sign.detached(bytes, sk))}`, payload };
}

/** What goes in the sheet's Expiry column before first activation. */
const sheetExpiry = (payload) => (payload.e === 'TERM' ? `${payload.t} DAYS` : payload.e);

module.exports = { PLANS, PLAN_NAME, BILLINGS, TERM_DAYS, PRICES, DEVICES, loadSecret, makeKey, sheetExpiry, b64url };
