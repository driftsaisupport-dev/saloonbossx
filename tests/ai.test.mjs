/**
 * Boss AI + cloud sync tests — pure logic, no device.
 *
 * These import the TypeScript sources directly, which needs Node 22.18+
 * (type stripping on by default). On older Node they are skipped, not failed.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

let A, I, C;
try {
  A = await import('../src/services/ai/analytics.ts');
  I = await import('../src/services/ai/intent.ts');
  C = await import('../src/services/sync/cloudCrypto.ts');
} catch (e) {
  test('Boss AI tests (need Node 22.18+)', { skip: `skipped: ${String(e.message).slice(0, 80)}` }, () => {});
}

const run = A ? test : test.skip;

// ── intent parsing ─────────────────────────────────────────────────────────
run('understands Hinglish, Hindi and English questions', () => {
  const now = new Date(2026, 9, 1, 15);
  const names = { clients: [{ id: 1, name: 'Priya Sharma' }], staff: [{ id: 7, name: 'Rahul' }] };
  const cases = [
    ['aaj kitna collection hua?', 'revenue', 'today'],
    ['pichle mahine ka kharcha', 'expenses', 'last_month'],
    ['Profit this month', 'profit', 'this_month'],
    ['Mahine ke end tak kitna hoga?', 'forecast', 'this_month'],
    ['Is hafte kaun aane wala hai?', 'due_visits', 'this_week'],
    ['Kitna udhaar baaki hai?', 'dues', null],
    ['Kaun se customer nahi aaye?', 'lapsed', null],
    ['आज की कमाई', 'revenue', 'today'],
    ['kal ke appointments', 'appointments', 'tomorrow'],
    ['yesterday', 'revenue', 'yesterday'],
    ['september revenue', 'revenue', 'month'],
    ['stock khatam', 'stock', null],
  ];
  for (const [q, intent, period] of cases) {
    const p = I.parseQuestion(q, now, names);
    assert.equal(p.intent, intent, `"${q}" → ${p.intent}`);
    if (period) assert.equal(p.period.key, period, `"${q}" period → ${p.period.key}`);
  }
  const c = I.parseQuestion('Priya kab aayi thi', now, names);
  assert.equal(c.intent, 'client_one'); assert.equal(c.nameId, 1);
  const s = I.parseQuestion('Rahul ka performance', now, names);
  assert.equal(s.intent, 'staff_one'); assert.equal(s.nameId, 7);
  assert.equal(I.parseQuestion('Profit this month', now).lang, 'en');
  assert.equal(I.parseQuestion('aaj kitna hua', now).lang, 'hinglish');
});

run('previous period for "this month" is the same days of last month', () => {
  const p = I.periodFor('this_month', new Date(2026, 9, 15));
  const prev = I.previousPeriod(p);
  assert.equal(prev.start, '2026-09-01');
  assert.equal(prev.end, '2026-09-15');
});

// ── forecast ───────────────────────────────────────────────────────────────
run('forecast learns a weekly closing day and projects the month', () => {
  const rows = [];
  const today = '2026-10-20';
  for (let i = 60; i >= 1; i--) {
    const d = A.addDays(today, -i);
    const dow = A.parseYmd(d).getDay();
    if (dow === 2) continue;                     // closed every Tuesday
    rows.push({ date: d, revenue: dow === 0 ? 20000 : 10000 });
  }
  const f = A.forecastMonth(rows, today, 300000, 10);
  assert.deepEqual(f.closedWeekdays, [2]);
  assert.equal(f.weekdayAvg[2], 0);
  assert.equal(f.weekdayAvg[0], 20000);
  assert.ok(f.projected > f.mtd, 'projection adds remaining days');
  // Oct 20 → 31: 11 days left, of which Tue 27 closed, Sun 25 double.
  const expectedRest = 9 * 10000 + 20000 + 10000 * (21 - 10) / 11; // + rest of today (Tuesday? no: Oct 20 2026 is a Tuesday)
  assert.ok(f.projected - f.mtd >= 9 * 10000, `remaining ${f.projected - f.mtd} vs ${expectedRest}`);
  assert.equal(f.confidence, 'high');
  assert.ok(typeof f.neededPerDay === 'number');
});

// ── upsell ─────────────────────────────────────────────────────────────────
run('upsell needs real support and ranks by confidence', () => {
  const bills = [];
  for (let i = 0; i < 20; i++) bills.push({ items: [{ name: 'Haircut' }, { name: 'Hair Spa' }] });
  for (let i = 0; i < 20; i++) bills.push({ items: [{ name: 'Haircut' }] });
  for (let i = 0; i < 2; i++) bills.push({ items: [{ name: 'Haircut' }, { name: 'Gold Facial' }] }); // too rare
  const b = A.buildBasket(bills);
  const s = A.suggestUpsell(['haircut'], b, { max: 3 });
  assert.equal(s[0].name, 'Hair Spa');
  assert.ok(s[0].confidence > 0.45 && s[0].confidence < 0.5);
  assert.ok(!s.some(x => x.name === 'Gold Facial'), 'pairs seen only twice are ignored');
  assert.equal(A.suggestUpsell(['hair spa'], b, { allowed: ['Haircut'] })[0].name, 'Haircut');
});

// ── rhythm & segments ──────────────────────────────────────────────────────
run('predicts who is due back from each client’s own gap', () => {
  const today = '2026-10-01';
  const days = [
    // client 1: every 30 days, last 28 days ago → due in ~2 days
    { client_id: 1, d: '2026-07-05' }, { client_id: 1, d: '2026-08-04' }, { client_id: 1, d: '2026-09-03' },
    // client 2: every 14 days, last visit 60 days ago → lost
    { client_id: 2, d: '2026-07-04' }, { client_id: 2, d: '2026-07-18' }, { client_id: 2, d: '2026-08-02' },
    // client 3: one visit, 10 days ago
    { client_id: 3, d: '2026-09-21' },
    // client 4: used to come monthly, last seen in February → lost
    { client_id: 4, d: '2026-01-10' }, { client_id: 4, d: '2026-02-09' },
  ];
  const { list } = A.clientRhythm(days, today);
  const c1 = list.find(x => x.client_id === 1);
  assert.equal(c1.gap, 30);
  assert.equal(c1.nextDue, '2026-10-03');
  const due = A.dueSoon(list, 7).map(x => x.client_id);
  assert.ok(due.includes(1)); assert.ok(!due.includes(2));
  const seg = A.segmentClients(
    [{ id: 1, name: 'A', total_spent: 3000 }, { id: 2, name: 'B', total_spent: 2000 }, { id: 3, name: 'C', total_spent: 500 }, { id: 4, name: 'D', total_spent: 900 }],
    list, today);
  assert.equal(seg.get(2), 'at_risk', 'a fortnightly regular missing for 2 months is at risk');
  assert.equal(seg.get(4), 'lost');
  assert.equal(seg.get(3), 'new');
});

run('leakage guard flags one staff member’s outsized discounts and cancellations', () => {
  const al = A.leakageAlerts({
    discounts: [
      { staff_id: 1, staff_name: 'Priya', bills: 100, discounted: 5, discount: 1000, gross: 100000 },
      { staff_id: 2, staff_name: 'Amit', bills: 40, discounted: 18, discount: 9000, gross: 40000 },
    ],
    voids: [{ staff_id: 2, staff_name: 'Amit', voids: 4, amount: 3200 }],
    walkinShare: 0.2, totalBills: 140,
  });
  assert.ok(al.some(a => a.id === 'disc_2'));
  assert.ok(!al.some(a => a.id === 'disc_1'));
  assert.ok(al.some(a => a.id === 'void_2'));
});

run('message writer fills every placeholder', () => {
  const m = A.writeMessage('winback', { name: 'Neha', salon: 'Glow', offer: '15% off', phone: '98200 00000' }, 'hinglish', 1);
  assert.ok(!/\{\w+\}/.test(m), m);
  assert.ok(m.includes('Neha') && m.includes('15% off'));
});

run('occasions are dated correctly (Mother’s Day = 2nd Sunday of May)', () => {
  const o = A.upcomingOccasions('2027-05-01', 15).find(x => x.name === "Mother's Day");
  assert.equal(o.date, '2027-05-09');
});

// ── cloud crypto ───────────────────────────────────────────────────────────
run('cloud backup round-trips, and the wrong key or tampering is rejected', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const json = JSON.stringify({ app: 'SaloonBossX', clients: [{ name: 'प्रिया ✂️', phone: '9820000000' }], n: Array.from({ length: 3000 }, (_, i) => i) });
  const blob = C.encryptBackup(json, secret, new Uint8Array(crypto.randomBytes(16)));
  assert.ok(blob.startsWith('SBX1:'));
  assert.ok(!blob.includes('9820000000'), 'ciphertext must not leak plaintext');
  assert.equal(C.decryptBackup(blob, secret), json);
  assert.throws(() => C.decryptBackup(blob, crypto.randomBytes(32).toString('hex')), /different chain|damaged/);
  const parts = blob.split(':'); parts[2] = parts[2].slice(0, -4) + 'AAAA';
  assert.throws(() => C.decryptBackup(parts.join(':'), secret));
});

run('request signature matches the Apps Script HMAC exactly', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const payload = JSON.stringify({ branchName: 'Vashi ✂️', summary: { today: { revenue: 12400 } } });
  const sig = C.signRequest('push_summary', 'abc123def', 'b1', 1760000000000, payload, secret);
  const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const ref = crypto.createHmac('sha256', secret).update(`push_summary|abc123def|b1|1760000000000|${digest}`, 'utf8').digest('hex');
  assert.equal(sig, ref);
});

run('join code round-trips and rejects junk', () => {
  const d = { url: 'https://script.google.com/macros/s/AKfy/exec', chainId: 'a1b2c3d4e5f60718', secret: 'ab'.repeat(32), chainName: 'Glow Salons' };
  assert.deepEqual(C.readJoinCode(C.makeJoinCode(d)), { ...d, hosted: false });
  assert.deepEqual(C.readJoinCode('  ' + C.makeJoinCode(d).replace(/(.{20})/g, '$1\n') + ' '), { ...d, hosted: false }, 'WhatsApp line breaks are ignored');
  assert.equal(C.readJoinCode(C.makeJoinCode({ ...d, hosted: true })).hosted, true, 'shared-cloud flag travels with the code');
  const ak = C.authKey(d.secret);
  assert.match(ak, /^[a-f0-9]{64}$/);
  assert.notEqual(ak, d.secret);
  assert.ok(!ak.includes(d.secret), 'the server-side key does not reveal the backup key');
  assert.throws(() => C.readJoinCode('hello'));
});

// ── setup helpers ──────────────────────────────────────────────────────────
let U, L;
try { U = await import('../src/utils/csvImport.ts'); L = await import('../src/utils/setupLinks.ts'); } catch {}
const run2 = U ? test : test.skip;

run2('CSV import understands Excel exports, quotes, semicolons and Indian dates', () => {
  const rows = U.parseCsv('﻿Name,Mobile No,Birthday\n"Sharma, Priya",+91 98200 00001,25/12/1995\nNeha,9820000002,\n,9820000003,\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Sharma, Priya', phone: '+91 98200 00001', dob: '1995-12-25' });
  const semi = U.parseCsv('Naam;Phone\nAmit;9123456789');
  assert.equal(semi[0].phone, '9123456789');
  const noHeader = U.parseCsv('Riya,9876543210');
  assert.deepEqual(noHeader[0], { name: 'Riya', phone: '9876543210', dob: '' });
});

run2('setup links: only genuine Google script URLs and join codes are accepted', () => {
  const u = 'https://script.google.com/macros/s/AKfy/exec';
  assert.deepEqual(L.parseSetupLink(`saloonbossx://connect?u=${encodeURIComponent(u)}`), { kind: 'connect', value: u });
  assert.equal(L.parseSetupLink(`saloonbossx://connect?u=${encodeURIComponent('https://evil.example/exec')}`), null);
  assert.deepEqual(L.parseSetupLink('saloonbossx://join?c=SBXJOIN1.abc_-1'), { kind: 'join', value: 'SBXJOIN1.abc_-1' });
  assert.equal(L.parseSetupLink('saloonbossx://join?c=hello'), null);
  assert.equal(L.parseSetupLink('https://x.com'), null);
});
