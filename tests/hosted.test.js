/**
 * v4 shared ("hosted") Cloud Bridge: ONE script deployed by the seller serves
 * many salons. Runs the REAL BranchSync.gs against in-memory Google mocks.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const gas = require('./helpers/gasMock');

function salon(chainId, branchId = 'br01') {
  const secret = crypto.randomBytes(32).toString('hex');
  return {
    chainId, branchId, secret,
    async call(action, payload, extra = {}, sec = secret) {
      const body = JSON.stringify(payload);
      const ts = Date.now();
      const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      const sig = crypto.createHmac('sha256', sec).update(`${action}|${chainId}|${branchId}|${ts}|${digest}`).digest('hex');
      const res = await gas.fetch('x', { body: JSON.stringify({ action, chainId, branchId, ts, sig, payload: body, ...extra }) });
      return res.json();
    },
  };
}
// Tomorrow in INDIA time — the booking server validates dates/times in IST.
const date = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
const profile = (name) => ({
  enabled: true, salonName: name, services: [{ key: 'k1', name: 'Haircut', price: 300, duration: 30 }],
  staff: [{ id: 1, name: 'Priya' }], hours: { open: '10:00', close: '20:00', closedDays: [] }, slot: 30, leadMin: 0, maxDays: 14, busy: {},
});

test('hosted: many salons on one script, isolated, no Sheet, encrypted summaries', async () => {
  const a = salon('aaaa1111bb');
  const b = salon('cccc2222dd');
  const ha = await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  assert.equal(ha.ok, true);
  assert.equal(ha.hosted, true);
  assert.ok(ha.version >= 4);
  assert.equal(ha.sheetUrl, undefined, 'no Google Sheet in shared mode');
  assert.equal((await b.call('hello', { hosted: true }, { claimSecret: b.secret })).ok, true, 'a second salon can join the same script');

  // Re-claiming an existing salon with another secret must not take it over.
  const thief = salon('aaaa1111bb');
  assert.equal((await thief.call('hello', { hosted: true }, { claimSecret: thief.secret })).error, 'auth');

  // Each salon gets its own folder under one parent.
  const parent = gas.rootDrive.folders.find(f => f.name === 'SaloonBossX Cloud');
  assert.ok(parent, 'one parent folder');
  assert.deepEqual(parent.folders.map(f => f.name).sort(), ['aaaa1111bb', 'cccc2222dd']);

  // Encrypted summary is stored as-is and never written to a sheet.
  assert.equal((await a.call('push_summary', { branchName: 'Vashi', summary: {}, enc: 'SBX1:iv:ct:mac' })).ok, true);
  const pa = await a.call('pull_branches', {});
  assert.equal(pa.branches.length, 1);
  assert.equal(pa.branches[0].enc, 'SBX1:iv:ct:mac');
  assert.equal(Object.keys(gas.sheets).length, 0);
  assert.equal((await b.call('pull_branches', {})).branches.length, 0, 'salon B cannot see salon A');

  // Backups: shared cloud rotates one file per weekday, overwritten in place (no trash growth).
  for (let i = 0; i < 9; i++) await a.call('push_backup', { name: `d${i}`, data: 'x' + i, hosted: true });
  const bl = (await a.call('list_backups', { all: true })).backups;
  assert.equal(bl.length, 1);
  assert.match(bl[0].name, /^backup-(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\.sbx$/);
  const bdir = gas.rootDrive.folders.find(f => f.name === 'SaloonBossX Cloud').folders.find(f => f.name === 'aaaa1111bb').folders.find(f => f.name === 'backups').folders[0];
  assert.equal(bdir.files.filter(f => f.trashed).length, 0, 'nothing trashed');
  assert.equal((await a.call('get_backup', { fileId: bl[0].id })).data, 'x8', 'latest content kept');
  // B cannot fetch A's backup by id.
  const aid = (await a.call('list_backups', { branchId: '' })).backups[0].id;
  const steal = await b.call('get_backup', { fileId: aid });
  assert.notEqual(steal.ok, true, 'cross-salon backup read is refused');
});

test('hosted: booking links carry chain-branch, requests scrubbed after delivery', async () => {
  const a = salon('eeee3333ff', 'bb11');
  const b = salon('gggg4444hh', 'bb11');   // same branch id, different salon
  await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  await b.call('hello', { hosted: true }, { claimSecret: b.secret });
  await a.call('push_booking', profile('Salon A'));
  await b.call('push_booking', profile('Salon B'));

  const pageA = gas.ctx.doGet({ parameter: { book: 'eeee3333ff-bb11' } });
  const pageB = gas.ctx.doGet({ parameter: { book: 'gggg4444hh-bb11' } });
  assert.match(pageA.title, /Salon A/);
  assert.match(pageB.title, /Salon B/);
  assert.ok(pageA.html.includes('"eeee3333ff-bb11"'), 'the page submits with the full key');
  assert.ok(!/Salon A/.test(gas.ctx.doGet({ parameter: { book: 'bb11' } }).title || ''), 'bare key is ambiguous with many salons');
  assert.ok(!/Salon/.test(gas.ctx.doGet({ parameter: { book: 'zzzz9999zz-bb11' } }).title || ''), 'unknown salon');

  const f = { services: ['k1'], date, time: '11:00', name: 'Riya', phone: '9876543210', note: 'hi' };
  assert.equal(gas.ctx.submitBooking('eeee3333ff-bb11', f).ok, true);
  assert.equal(gas.ctx.submitBooking('gggg4444hh-bb11', f).ok, true, 'same slot at another salon is fine');
  assert.equal(gas.ctx.submitBooking('nope0000no-bb11', f).ok, false);

  const got = await a.call('get_bookings', {});
  assert.equal(got.requests.length, 1);
  assert.equal(got.requests[0].name, 'Riya', 'the phone receives the full request');
  assert.equal(got.requests[0].phone, '9876543210');
  assert.equal((await b.call('get_bookings', {})).requests[0].name, 'Riya');

  // Cloud copy is scrubbed: only the slot remains.
  const folder = gas.rootDrive.folders.find(x => x.name === 'SaloonBossX Cloud').folders.find(x => x.name === 'eeee3333ff');
  const file = folder.folders.find(x => x.name === 'booking').files.find(x => x.name === 'bb11.requests.json' && !x.trashed);
  const stored = JSON.parse(file.content).requests[0];
  assert.equal(stored.name, '');
  assert.equal(stored.phone, '');
  assert.equal(stored.note, '');
  assert.equal(stored.time, '11:00', 'slot still blocks double booking');
  assert.equal(gas.ctx.submitBooking('eeee3333ff-bb11', { ...f, phone: '9000000001' }).ok, false, 'scrubbed slot still blocks');

  // 3-a-day limit still works after scrubbing (hash of the number is kept).
  gas.ctx.submitBooking('eeee3333ff-bb11', { ...f, time: '13:00' });
  gas.ctx.submitBooking('eeee3333ff-bb11', { ...f, time: '14:00' });
  assert.equal(gas.ctx.submitBooking('eeee3333ff-bb11', { ...f, time: '15:00' }).ok, false, 'max 3 per phone per day');
});

test('hosted: public POST fallback books when google.script.run is blocked', async () => {
  const a = salon('iiii5555jj', 'bb99');
  await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  await a.call('push_booking', profile('Salon C'));
  const page = gas.ctx.doGet({ parameter: { book: 'iiii5555jj-bb99' } }).html;
  assert.ok(page.includes('U="https://script.google.com/macros/s/TESTDEPLOY/exec"'), 'page knows its own /exec URL');
  const post = async (form) => JSON.parse(gas.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'public_book', key: 'iiii5555jj-bb99', form }) } }).text);
  const ok = await post({ services: ['k1'], date, time: '12:00', name: 'Asha', phone: '9822233344' });
  assert.equal(ok.ok, true);
  const bad = await post({ services: ['k1'], date, time: '12:00', name: 'X', phone: '1' });
  assert.equal(bad.ok, false, 'same validation as the normal path');
  assert.equal((await a.call('get_bookings', {})).requests[0].name, 'Asha');
});

test('hosted: acknowledged delivery never loses a booking; resolved requests free the slot', async () => {
  const a = salon('kkkk6666ll', 'bb22');
  await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  await a.call('push_booking', profile('Salon D'));
  const key = 'kkkk6666ll-bb22';
  const f = { services: ['k1'], date, time: '15:00', name: 'Meera', phone: '9833344455' };
  assert.equal(gas.ctx.submitBooking(key, f).ok, true);

  const first = await a.call('get_bookings', { ack: [], resolved: [] });
  assert.equal(first.requests.length, 1);
  // Reply "lost": the phone asks again without acking — it gets the request again, details intact.
  const again = await a.call('get_bookings', { ack: [], resolved: [] });
  assert.equal(again.requests.length, 1, 're-delivered until acknowledged');
  assert.equal(again.requests[0].name, 'Meera');
  const id = again.requests[0].id;
  const third = await a.call('get_bookings', { ack: [id], resolved: [] });
  assert.equal(third.requests.length, 0, 'acknowledged → not sent again');
  const folder = gas.rootDrive.folders.find(x => x.name === 'SaloonBossX Cloud').folders.find(x => x.name === 'kkkk6666ll');
  const file = () => JSON.parse(folder.folders.find(x => x.name === 'booking').files.find(x => x.name === 'bb22.requests.json').content).requests[0];
  assert.equal(file().name, '', 'scrubbed after the ack');

  assert.equal(gas.ctx.submitBooking(key, { ...f, phone: '9000000002' }).ok, false, 'slot held while pending');
  await a.call('get_bookings', { ack: [], resolved: [{ id, status: 'declined' }] });
  assert.equal(file().status, 'declined');
  assert.equal(gas.ctx.submitBooking(key, { ...f, phone: '9000000002', name: 'Next' }).ok, true, 'declined request frees the slot');
});

test('hosted: abuse limits', async () => {
  const a = salon('mmmm7777nn', 'bb33');
  await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  // Invalid branch ids are refused before anything is created.
  const bad = salon('mmmm7777nn', '../x');
  bad.secret = a.secret;
  assert.equal((await bad.call('push_backup', { data: 'x' }, {}, a.secret)).error, 'bad_branch');
  // Branch cap per salon.
  for (let i = 0; i < 30; i++) { const b = salon('mmmm7777nn', `br${String(i).padStart(3, '0')}`); assert.equal((await b.call('push_summary', { branchName: 'x', enc: 'e' }, {}, a.secret)).ok, true); }
  const extra = salon('mmmm7777nn', 'br999');
  assert.equal((await extra.call('push_summary', { branchName: 'x', enc: 'e' }, {}, a.secret)).error, 'too_many');
  // A sheet is never created on the shared cloud, even if a request asks for it.
  const c = salon('oooo8888pp');
  await c.call('hello', { hosted: false, chainName: 'Sheet please' }, { claimSecret: c.secret });
  assert.equal(Object.keys(gas.sheets).length, 0);
});

test('short links: salon name slugs, unique, JSON API for the booking website', async () => {
  const a = salon('qqqq1111rr', 'bb44');
  const b = salon('ssss2222tt', 'bb55');
  await a.call('hello', { hosted: true }, { claimSecret: a.secret });
  await b.call('hello', { hosted: true }, { claimSecret: b.secret });
  const pa = { ...profile('Glow Beauty'), reviewUrl: 'https://g.page/r/abc/review' };
  const ra = await a.call('push_booking', { ...pa, slug: 'Glow Beauty Vashi!' });
  assert.equal(ra.slug, 'glow-beauty-vashi');
  const rb = await b.call('push_booking', { ...profile('Other Glow'), slug: 'glow-beauty-vashi' });
  assert.equal(rb.slug, 'glow-beauty-vashi-2', 'taken name gets a number');
  assert.equal((await a.call('push_booking', { ...pa, slug: 'glow-beauty-vashi' })).slug, 'glow-beauty-vashi', 're-publishing keeps the same link');
  assert.equal((await a.call('push_booking', { ...pa, slug: 'api' })).slug, '', 'reserved words refused');

  const api = JSON.parse(gas.ctx.doGet({ parameter: { api: '1', s: 'glow-beauty-vashi' } }).text);
  assert.equal(api.ok, true);
  assert.equal(api.profile.salonName, 'Glow Beauty');
  assert.equal(api.profile.reviewUrl, 'https://g.page/r/abc/review');
  assert.equal(api.key, 'qqqq1111rr-bb44');
  assert.equal(JSON.parse(gas.ctx.doGet({ parameter: { api: '1', s: 'glow-beauty-vashi-2' } }).text).profile.salonName, 'Other Glow');
  assert.equal(JSON.parse(gas.ctx.doGet({ parameter: { api: '1', s: 'nobody-here' } }).text).ok, false);
  // The long key still works in the API and the old page.
  assert.equal(JSON.parse(gas.ctx.doGet({ parameter: { api: '1', s: 'qqqq1111rr-bb44' } }).text).ok, true);
  assert.match(gas.ctx.doGet({ parameter: { book: 'glow-beauty-vashi' } }).title, /Glow Beauty/);

  // Booking through the slug, the way the website does it.
  const post = (key, form) => JSON.parse(gas.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'public_book', key, form }) } }).text);
  const ok = post('glow-beauty-vashi', { services: ['k1'], date, time: '16:00', name: 'Kavya', phone: '9845612378' });
  assert.equal(ok.ok, true, ok.message);
  assert.equal((await a.call('get_bookings', { ack: [] })).requests[0].name, 'Kavya');

  // A link name that copies another salon's key is refused, and real keys always win.
  const hij = await b.call('push_booking', { ...profile('Thief'), slug: 'qqqq1111rr-bb44' });
  assert.equal(hij.slug, '', 'cannot register a salon key as a link name');
  assert.equal(JSON.parse(gas.ctx.doGet({ parameter: { api: '1', s: 'qqqq1111rr-bb44' } }).text).profile.salonName, 'Glow Beauty');
  const hexy = await b.call('push_booking', { ...profile('Thief'), slug: 'abcdef0123456789-abcdef012345' });
  assert.equal(hexy.slug, '', 'key-looking names refused (could match a future salon)');

  // Abuse guard: at most 5 links per branch.
  for (let i = 0; i < 6; i++) await a.call('push_booking', { ...profile('Glow Beauty'), slug: `spam-name-${i}x` });
  const links = gas.rootDrive.folders.find(x => x.name === 'SaloonBossX Cloud').folders.find(x => x.name === '_links').files.map(f => f.name);
  assert.ok(links.filter(n => n.startsWith('spam-name')).length <= 4, 'capped');
});
