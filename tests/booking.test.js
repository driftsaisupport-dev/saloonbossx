/**
 * Online booking — runs the REAL Apps Script (google-apps-script/BranchSync.gs)
 * against in-memory Google mocks, signing requests exactly like the app.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const gas = require('./helpers/gasMock');

const secret = crypto.randomBytes(32).toString('hex');
const chainId = 'abcd1234ef';
const branchId = 'br01';
async function call(action, payload, extra = {}) {
  const body = JSON.stringify(payload);
  const ts = Date.now();
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`${action}|${chainId}|${branchId}|${ts}|${digest}`).digest('hex');
  const res = await gas.fetch('x', { body: JSON.stringify({ action, chainId, branchId, ts, sig, payload: body, ...extra }) });
  return res.json();
}
// Tomorrow in INDIA time — the booking server validates dates/times in IST.
const date = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);

test('booking: publish, customer request, pull once, validation, no double booking', async () => {
  assert.equal((await call('hello', { chainName: 'T' }, { claimSecret: secret })).ok, true);
  assert.ok((await call('ping', {})).version >= 2);
  const profile = {
    enabled: true, salonName: 'Glow <script>', services: [{ key: 'k1', name: 'Haircut', price: 300, duration: 30 }],
    staff: [{ id: 1, name: 'Priya' }], hours: { open: '10:00', close: '20:00', closedDays: [] }, slot: 30, leadMin: 0, maxDays: 14,
    busy: { [date]: [{ s: '10:00', e: '10:30', staff: 1 }] },
  };
  assert.equal((await call('push_booking', profile)).ok, true);

  const page = gas.ctx.doGet({ parameter: { book: branchId } }).html;
  assert.ok(!page.includes('Glow <script>'), 'salon name is escaped inside the page');
  assert.ok(page.includes('Glow \\u003cscript\\u003e'));

  const f = { services: ['k1'], date, time: '11:00', name: 'Riya', phone: '9876543210' };
  assert.equal(gas.ctx.submitBooking(branchId, { ...f, phone: '12345' }).ok, false, 'bad phone');
  assert.equal(gas.ctx.submitBooking(branchId, { ...f, time: '10:00' }).ok, false, 'busy slot (only 1 stylist)');
  assert.equal(gas.ctx.submitBooking(branchId, { ...f, services: ['nope'] }).ok, false, 'unknown service');
  const bot = gas.ctx.submitBooking(branchId, { ...f, website: 'spam' });
  assert.equal(bot.ok, true, 'honeypot looks successful to bots…');
  const good = gas.ctx.submitBooking(branchId, f);
  assert.equal(good.ok, true);
  assert.equal(gas.ctx.submitBooking(branchId, { ...f, phone: '9123456789' }).ok, false, 'same slot cannot be requested twice');

  const pulled = await call('get_bookings', {});
  assert.equal(pulled.requests.length, 1, '…but nothing is stored for them');
  assert.equal(pulled.requests[0].name, 'Riya');
  assert.equal((await call('get_bookings', {})).requests.length, 0, 'delivered once');

  for (let i = 0; i < 2; i++) gas.ctx.submitBooking(branchId, { ...f, time: `1${3 + i}:00` });
  assert.equal(gas.ctx.submitBooking(branchId, { ...f, time: '16:00' }).ok, false, 'max 3 requests per phone per day');

  const forged = await gas.fetch('x', { body: JSON.stringify({ action: 'get_bookings', chainId, branchId, ts: Date.now(), sig: 'bad', payload: '{}' }) });
  assert.equal((await forged.json()).error, 'auth', 'requests cannot be read without the secret');
});

test('booking: server validates hours, closed days, lead time, window, real date/time and staff', async () => {
  // Runs after the test above (same chain), so `hello` has been done already.
  const ist = (ms) => new Date(ms + 330 * 60000);
  const plusDays = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
  const d2 = plusDays(2);
  const closedDow = new Date(`${d2}T00:00:00Z`).getUTCDay();
  const profile = {
    enabled: true, salonName: 'Rules', services: [{ key: 'k1', name: 'Haircut', price: 300, duration: 60 }],
    staff: [{ id: 7, name: 'Asha' }], hours: { open: '10:00', close: '20:00', closedDays: [closedDow] },
    slot: 30, leadMin: 120, maxDays: 5, busy: {},
  };
  assert.equal((await call('push_booking', profile)).ok, true);
  const f = { services: ['k1'], date: plusDays(1), time: '12:00', name: 'Neha', staffId: 0 };
  let n = 0;
  const book = (o) => gas.ctx.submitBooking(branchId, { ...f, phone: `98000000${String(n++).padStart(2, '0')}`, ...o });

  assert.match(book({ date: d2 }).message, /closed/i, 'closed day');
  assert.match(book({ time: '09:30' }).message, /between 10:00 and 20:00/, 'before opening');
  assert.match(book({ time: '19:30' }).message, /between/, 'service would run past closing');
  assert.match(book({ date: '2026-02-31' }).message, /valid date/i, 'impossible date');
  assert.match(book({ time: '25:00' }).message, /valid time/i, 'impossible time');
  assert.match(book({ time: '12:5' }).message, /pick a date and time/i, 'malformed time');
  assert.match(book({ date: plusDays(-1) }).message, /passed/i, 'yesterday');
  assert.match(book({ date: plusDays(6) }).message, /5 days ahead/, 'beyond maxDays');
  assert.match(book({ staffId: 99 }).message, /stylist from the list/i, 'unknown staff id');

  // Lead time: today, less than 120 minutes from now (only checkable when that is still inside opening hours).
  const now = ist(Date.now());
  const soon = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
  if (soon >= 600 && soon + 60 <= 1200 && now.getUTCDay() !== closedDow) {
    const hh = String(Math.floor(soon / 60)).padStart(2, '0'), mm = String(soon % 60).padStart(2, '0');
    assert.match(book({ date: plusDays(0), time: `${hh}:${mm}` }).message, /120 minutes ahead/);
  }

  assert.equal(book({ staffId: 7 }).ok, true, 'valid request with a real stylist is accepted');
});
