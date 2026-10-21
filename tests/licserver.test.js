/** Licence server (google-apps-script/Code.gs) with monthly / yearly keys — runs the real script on a fake Sheet. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const nacl = require('tweetnacl');
const S = require('../tools/lib/sign.js');

function makeCtx() {
  const rows = [];
  const sheet = {
    appendRow: r => rows.push([...r]), setFrozenRows() {}, getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(r => [...r]) }),
    getRange: (r, c) => ({ setValue(v) { (rows[r - 1] ||= [])[c - 1] = v; return this; }, setNumberFormat() { return this; } }),
  };
  const ss = { getSheetByName: () => (rows.length ? sheet : null), insertSheet: () => sheet };
  const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  const ctx = {
    console, JSON, Date, Math, String, Number, Object, Array, parseInt, isNaN,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'RESPONSE_SECRET' ? 'test-secret' : null) }) },
    DriveApp: { getFilesByName: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return {}; } }; } },
    SpreadsheetApp: { open: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      newBlob: s => ({ getBytes: () => Array.from(Buffer.from(String(s))), getDataAsString: () => Buffer.from(s).toString('utf8') }),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', Buffer.from(k)).update(Buffer.from(v)).digest()),
      base64Encode: b => Buffer.from(b.map(x => (x + 256) % 256)).toString('base64'),
      base64DecodeWebSafe: s => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: () => ({ setMimeType() {}, setContent(t) { this.t = t; } }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8'), ctx);
  const req = (post, p) => JSON.parse(ctx[post ? 'doPost' : 'doGet']({ parameter: { ts: String(Date.now()), ...p } }).t);
  return { rows, req };
}

test('licence server: monthly key starts on first activation and keeps its date on reinstall', () => {
  const { rows, req } = makeCtx();
  const pair = nacl.sign.keyPair();
  const { key } = S.makeKey(pair.secretKey, { plan: 'standard', billing: 'monthly', order: 'SPM-1' });
  const a = req(true, { action: 'activate', key, device: 'DEV1' });
  assert.equal(a.valid, true, a.message);
  assert.equal(a.expirySetNow, true);
  assert.match(a.expiry, /^\d{4}-\d{2}-\d{2}$/);
  const expected = new Date(Date.now() + 330 * 60000); expected.setUTCDate(expected.getUTCDate() + 31);
  assert.equal(a.expiry, expected.toISOString().slice(0, 10));
  assert.equal(rows[1][4], a.expiry, 'date written into the Expiry column');
  assert.equal(rows[1][15], 'Monthly', 'Billing column filled');
  // same phone again (reinstall): same date, not restarted
  const again = req(true, { action: 'activate', key, device: 'DEV1' });
  assert.equal(again.valid, true);
  assert.equal(again.expiry, a.expiry);
  assert.equal(again.expirySetNow, false);
  // seller marks it expired in the sheet → server says expired
  rows[1][4] = '2020-01-01';
  assert.match(req(false, { action: 'validate', key, device: 'DEV1' }).message, /expired/i);
});

test('licence server: pre-filled sheet row "366 DAYS" and Date cells work', () => {
  const { rows, req } = makeCtx();
  const pair = nacl.sign.keyPair();
  const { key, payload } = S.makeKey(pair.secretKey, { plan: 'solo', billing: 'yearly', order: 'SOY-1' });
  req(true, { action: 'validate', key: 'x', device: 'D' });             // POST creates the tab (GET never writes)
  rows.push([1, key, 'solo', 1199, S.sheetExpiry(payload), 1, 'AVAILABLE', 0, '', '', '', '', '', '', '', 'Yearly']);
  const a = req(true, { action: 'activate', key, device: 'D9' });
  assert.equal(a.valid, true, a.message);
  assert.equal(a.expirySetNow, true);
  rows[rows.length - 1][4] = new Date('2031-05-06T00:00:00Z');           // Sheets returns Date objects
  const v = req(false, { action: 'validate', key, device: 'D9' });
  assert.equal(v.expiry, '2031-05-06');
  // one-time key unchanged
  const life = S.makeKey(pair.secretKey, { plan: 'multi', billing: 'lifetime', order: 'CHL-1' }).key;
  assert.equal(req(true, { action: 'activate', key: life, device: 'D1' }).expiry, 'LIFETIME');
});

test('licence server: GET is read-only — no auto-register, no device registration, no release', () => {
  const { rows, req } = makeCtx();
  const pair = nacl.sign.keyPair();
  const { key } = S.makeKey(pair.secretKey, { plan: 'multi', billing: 'lifetime', order: 'RO-1' });
  // GET activate of an unknown key: nothing is written at all.
  const g = req(false, { action: 'activate', key, device: 'G1' });
  assert.equal(g.valid, false);
  assert.equal(rows.length, 0, 'GET did not create the tab or a row');
  // POST activate registers the key and this device.
  assert.equal(req(true, { action: 'activate', key, device: 'P1' }).valid, true);
  const before = JSON.stringify(rows);
  // GET activate / validate from a NEW device must not take a slot.
  assert.equal(req(false, { action: 'activate', key, device: 'G2' }).valid, false);
  const v = req(false, { action: 'validate', key, device: 'G3' });
  assert.equal(v.valid, false);
  assert.match(v.message, /not registered/i);
  // GET release must not free the slot.
  assert.equal(req(false, { action: 'release', key, device: 'P1' }).valid, false);
  assert.equal(JSON.stringify(rows), before, 'sheet unchanged by GET requests');
  // The registered device still validates over GET.
  assert.equal(req(false, { action: 'validate', key, device: 'P1' }).valid, true);
});

test('licence server: validate never re-registers a device the seller removed', () => {
  const { rows, req } = makeCtx();
  const pair = nacl.sign.keyPair();
  const { key } = S.makeKey(pair.secretKey, { plan: 'multi', billing: 'lifetime', order: 'RM-1' });
  assert.equal(req(true, { action: 'activate', key, device: 'A' }).valid, true);
  rows[1][8] = '';            // seller clears Device IDs in the sheet
  rows[1][7] = 0;
  for (const post of [false, true]) {
    const v = req(post, { action: 'validate', key, device: 'A' });
    assert.equal(v.valid, false);
    assert.match(v.message, /not registered/i);
  }
  assert.equal(rows[1][8], '', 'device list still empty');
  // POST release then activate is still the supported way back.
  assert.equal(req(true, { action: 'activate', key, device: 'A' }).valid, true);
});
