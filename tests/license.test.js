/**
 * Licence round trip: keys issued by tools/issue-license.js must verify in the
 * app's real licenseCrypto.ts. This test would have caught the launch-blocker
 * where ~75% of genuine keys were rejected as "wrong format".
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const nacl = require('tweetnacl');

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pair = nacl.sign.keyPair();
process.env.EXPO_PUBLIC_LICENSE_PUBKEY = b64url(pair.publicKey);

function loadCrypto() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/licenseCrypto.ts'), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  const req = (id) => (id === 'tweetnacl' ? nacl : id === 'expo-constants' ? { default: {} } : require(id));
  new Function('require', 'module', 'exports', out)(req, m, m.exports);
  return m.exports;
}
const { verifyKey } = loadCrypto();

function issue(payload, secretKey = pair.secretKey) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return `SBX-${b64url(bytes)}-${b64url(nacl.sign.detached(new Uint8Array(bytes), secretKey))}`;
}

test('every genuine key verifies (500 random keys)', () => {
  for (let i = 0; i < 500; i++) {
    const k = issue({ p: 'standard', e: 'LIFETIME', o: 'ORD-' + i + '-' + Math.random(), i: Date.now() });
    const r = verifyKey(k);
    assert.ok(r.valid, `key ${i} rejected: ${r.reason}\n${k}`);
  }
});

test('key survives WhatsApp-style whitespace and line breaks', () => {
  const k = issue({ p: 'academy', e: 'LIFETIME', o: 'W1', i: 1 });
  const mangled = '  ' + k.slice(0, 40) + '\n' + k.slice(40, 90) + ' ' + k.slice(90) + '\n';
  assert.ok(verifyKey(mangled).valid);
});

test('uppercased key is rejected (keys are case-sensitive)', () => {
  const k = issue({ p: 'solo', e: 'LIFETIME', o: 'U1', i: 1 });
  assert.equal(verifyKey(k.toUpperCase()).valid, false);
});

test('key signed by someone else is rejected', () => {
  const k = issue({ p: 'academy', e: 'LIFETIME', o: 'X', i: 1 }, nacl.sign.keyPair().secretKey);
  assert.equal(verifyKey(k).valid, false);
});

test('tampered plan is rejected', () => {
  const k = issue({ p: 'solo', e: 'LIFETIME', o: 'T', i: 1 });
  const parts = k.slice(4);
  const sig = parts.slice(-86);
  const forged = `SBX-${b64url(Buffer.from(JSON.stringify({ p: 'academy', e: 'LIFETIME', o: 'T', i: 1 })))}-${sig}`;
  assert.equal(verifyKey(forged).valid, false);
});

test('expired key is rejected, future key accepted', () => {
  assert.equal(verifyKey(issue({ p: 'standard', e: '2020-01-01', o: 'E', i: 1 })).valid, false);
  assert.ok(verifyKey(issue({ p: 'standard', e: '2099-01-01', o: 'F', i: 1 })).valid);
});

// ── v3 keys already written into the licence sheet ────────────────────────
const crypto = require('crypto');
const V3_SECRET = 'SaloonBossX_OfflineValidation_v3';
const v3 = (plan, expiry) => {
  const sum = crypto.createHash('sha256')
    .update(`SBX:${plan}:${expiry}:${V3_SECRET}`).digest('hex').slice(0, 8).toUpperCase();
  return `SBX-${plan}-${expiry}-${sum}`;
};

test('v3 sheet keys still activate', () => {
  const r = verifyKey('SBX-ACADEMY-2099-04-20-31AE611A');
  assert.ok(r.valid, r.reason);
  assert.equal(r.payload.p, 'academy');
  assert.equal(r.payload.legacy, true);
});

test('v3 old plan names map to current plans', () => {
  assert.equal(verifyKey(v3('STARTER', 'LIFETIME')).payload.p, 'solo');
  assert.equal(verifyKey(v3('PRO', 'LIFETIME')).payload.p, 'standard');
  assert.equal(verifyKey(v3('BUSINESS', 'LIFETIME')).payload.p, 'multi');
  assert.equal(verifyKey(v3('ACADEMY', 'LIFETIME')).payload.p, 'academy');
});

test('v3 key is case-insensitive and ignores stray spaces', () => {
  const k = v3('ACADEMY', '2099-04-20');
  assert.ok(verifyKey(k.toLowerCase()).valid);
  assert.ok(verifyKey(' ' + k + '\n').valid);
});

test('v3 key with a wrong checksum or expired date is rejected', () => {
  assert.equal(verifyKey('SBX-ACADEMY-2099-04-20-00000000').valid, false);
  assert.equal(verifyKey(v3('ACADEMY', '2020-01-01')).valid, false);
});

test('a made-up key that is neither format gives a clear message', () => {
  const r = verifyKey('SBX-PRO-LIFETIME-ABCD1234');
  assert.equal(r.valid, false);
  assert.match(r.reason, /not valid|format/);
});
