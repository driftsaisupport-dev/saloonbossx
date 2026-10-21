/** Licence keys: monthly / yearly / one-time, signed by the real tools/lib/sign.js. */
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
const S = require('../tools/lib/sign.js');

import { register } from 'node:module';
// crypto-js sub-paths have no "exports" map; let ESM resolve "crypto-js/sha256" like Metro does.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (/^crypto-js\\/[a-z0-9-]+$/.test(spec)) return next(spec + '.js', ctx);
  return next(spec, ctx);
}`));

const pair = nacl.sign.keyPair();
process.env.EXPO_PUBLIC_LICENSE_PUBKEY = S.b64url(pair.publicKey);
let C, P;
try { C = await import('../src/services/licenseCrypto.ts'); P = await import('../src/services/licensePlans.ts'); }
catch (e) { test('licence tests (need Node 22.18+)', { skip: String(e.message).slice(0, 80) }, () => {}); }
const run = C ? test : test.skip;

run('monthly, yearly and one-time keys verify; tampering fails', () => {
  for (const billing of ['monthly', 'yearly', 'lifetime']) {
    const { key, payload } = S.makeKey(pair.secretKey, { plan: 'standard', billing, order: 'T-' + billing });
    const r = C.verifyKey(key);
    assert.equal(r.valid, true, billing);
    assert.equal(r.payload.b, billing);
    if (billing === 'lifetime') assert.equal(r.payload.e, 'LIFETIME');
    else { assert.equal(r.payload.e, 'TERM'); assert.equal(r.payload.t, billing === 'monthly' ? 31 : 366); }
    assert.equal(S.sheetExpiry(payload), billing === 'lifetime' ? 'LIFETIME' : `${payload.t} DAYS`);
    // flip one character in the payload → signature fails
    const bad = key.replace(/^SBX-(.)/, (m, ch) => 'SBX-' + (ch === 'A' ? 'B' : 'A'));
    assert.equal(C.verifyKey(bad).valid, false);
  }
  const other = nacl.sign.keyPair();
  assert.equal(C.verifyKey(S.makeKey(other.secretKey, { plan: 'solo', billing: 'yearly', order: 'X' }).key).valid, false, 'a key from another private key is rejected');
});

run('yearly is two months free in every currency; plans climb in price; tools match the app', () => {
  for (const plan of S.PLANS) {
    const p = P.PRICES[plan];
    assert.ok(p.monthly * 12 > p.yearly, `${plan}: 12 × monthly must cost more than yearly`);
    assert.ok(p.lifetime > p.yearly, `${plan}: legacy one-time above yearly`);
    assert.deepEqual(S.PRICES[plan], p, `${plan}: tools/lib/sign.js prices match the app`);
  }
  assert.deepEqual(P.SHOWN_BILLINGS, ['monthly', 'yearly'], 'only monthly and yearly are sold');
  for (const cur of Object.keys(P.MONTHLY_PRICE_BOOK)) {
    const t = P.pricesFor(cur);
    assert.ok(t.solo.monthly < t.standard.monthly && t.standard.monthly < t.academy.monthly && t.academy.monthly < t.multi.monthly, `${cur}: plan order`);
    for (const plan of S.PLANS) assert.equal(P.yearlySavingPct(plan, cur), 17, `${cur}/${plan}: yearly saves ~17%`);
  }
  assert.deepEqual(S.TERM_DAYS, P.TERM_DAYS);
});
