/**
 * v5.6 money / rules / write-lock logic — pure modules, imported straight from
 * the TypeScript sources (Node 22.18+ strips types). No device needed.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let M, R, L, B;
try {
  M = await import('../src/utils/money.ts');
  R = await import('../src/utils/rules.ts');
  L = await import('../src/database/writeLock.ts');
  B = await import('../src/utils/bytes.ts');
} catch (e) {
  test('logic tests (need Node 22.18+)', { skip: `skipped: ${String(e.message).slice(0, 80)}` }, () => {});
}
const run = M ? test : test.skip;

// ── money ───────────────────────────────────────────────────────────────────
run('paise conversion rounds half away from zero without float drift', () => {
  assert.equal(M.toPaise(1.005), 101);
  assert.equal(M.toPaise(-1.005), -101);
  assert.equal(M.toPaise('12.345'), 1235);
  assert.equal(M.toPaise(undefined), 0);
  assert.equal(M.toPaise(NaN), 0);
  assert.equal(M.round2(0.1 + 0.2), 0.3);
  assert.equal(M.addMoney(0.1, 0.2, 0.3), 0.6);
  assert.equal(M.subMoney(10, 9.99), 0.01);
});

run('CGST + SGST always add back to the tax exactly', () => {
  for (const tax of [0, 0.01, 0.05, 9, 10.01, 10.02, 17.99, 123.45, 99999.99]) {
    const { cgst, sgst } = M.splitGst(tax);
    assert.equal(M.addMoney(cgst, sgst), tax, `tax ${tax}`);
    assert.ok(Math.abs(M.toPaise(cgst) - M.toPaise(sgst)) <= 1);
  }
  assert.deepEqual(M.splitGst(10.01), { cgst: 5.01, sgst: 5 });
  assert.deepEqual(M.splitGst(-10.01), { cgst: -5.01, sgst: -5 }); // credit note
  // the old (tax/2).toFixed(2) printed 5.01 + 5.01 = 10.02 for 10.01
});

run('GST exclusive / inclusive and invoice breakup', () => {
  assert.equal(M.gstOnExclusive(1000, 5), 50);
  assert.equal(M.gstOnExclusive(333.33, 18), 60);
  assert.deepEqual(M.gstFromInclusive(1050, 5), { taxable: 1000, tax: 50 });
  const inc = M.gstFromInclusive(999, 18);
  assert.equal(M.addMoney(inc.taxable, inc.tax), 999);
  assert.deepEqual(M.invoiceTaxBreakup({ subtotal: 1000, discount_amount: 100, tax_amount: 45 }), { taxable: 900, tax: 45, cgst: 22.5, sgst: 22.5, loyaltyBeforeTax: false });
  // v5.6 bills: loyalty off before tax, taxable recorded in the ledger (string or object)
  assert.equal(M.invoiceTaxBreakup({ subtotal: 1600, loyalty_discount: 100, tax_amount: 75, ledger: '{"taxable":1500}' }).taxable, 1500);
  assert.equal(M.invoiceTaxBreakup({ subtotal: -1600, tax_amount: -75, ledger: { taxable: -1500 } }).taxable, -1500);
  assert.equal(M.billTaxableValue({ subtotal: 1600, discount_amount: 100, loyalty_discount: 100, tax_amount: 70 }), 1400);
  assert.equal(M.billTaxableValue({ subtotal: 1600, discount_amount: 100, loyalty_discount: 100, tax_amount: 213.56, prices_include_gst: 1 }), 1186.44);
  assert.equal(M.invoiceTaxBreakup({ subtotal: 1050, discount_amount: 0, tax_amount: 50, prices_include_gst: 1 }).taxable, 1000);
});

run('bill total check: exclusive and inclusive prices', () => {
  assert.equal(M.expectedBillTotal({ subtotal: 1000, discount_amount: 100, tax_amount: 45, loyalty_discount: 20 }), 925);
  assert.equal(M.expectedBillTotal({ subtotal: 1050, discount_amount: 50, tax_amount: 47.62, prices_include_gst: true }), 1000);
  assert.equal(M.expectedBillTotal({ subtotal: 100, discount_amount: 200, tax_amount: 0 }), 0);
});

run('loyalty points only on money actually paid', () => {
  assert.equal(M.loyaltyPointsFor(999.99, 10), 90);
  assert.equal(M.loyaltyPointsFor(1000, 10), 100);
  assert.equal(M.loyaltyPointsFor(0, 10), 0);
  assert.equal(M.loyaltyPointsFor(-500, 10), 0);
});

run('paymentParts reads every historical bill shape', () => {
  assert.deepEqual(M.paymentParts({ payment_method: 'cash', payment_split: '{}', total: 500 }), { cash: 500, upi: 0, card: 0, wallet: 0, advance: 0 });
  assert.equal(M.paymentParts({ payment_method: 'upi', payment_split: {}, total: 500 }).upi, 500);
  assert.deepEqual(M.paymentParts({ payment_method: 'split', payment_split: '{"cash":200,"upi":300}', total: 500 }), { cash: 200, upi: 300, card: 0, wallet: 0, advance: 0 });
  assert.equal(M.paymentParts({ payment_method: 'due', payment_split: { cash: 100 }, total: 500 }).cash, 100);
  assert.equal(M.paymentParts({ payment_method: 'due', payment_split: {}, total: 500 }).cash, 0);
  assert.deepEqual(M.paymentParts({ payment_method: 'cash', payment_split: { cash: 400, wallet: 100 }, total: 500 }), { cash: 400, upi: 0, card: 0, wallet: 100, advance: 0 });
  // legacy credit note: copied positive split, negative total → negative parts
  assert.equal(M.paymentParts({ payment_method: 'split', payment_split: { cash: 200, upi: 300 }, total: -500 }).cash, -200);
  assert.equal(M.paymentParts({ payment_method: 'cash', payment_split: '{}', total: -500 }).cash, -500);
  assert.equal(M.paymentParts({ payment_method: 'cash', payment_split: 'not json', total: 50 }).cash, 50);
});

run('allocatePayment validates and stores the split', () => {
  const a = M.allocatePayment({ method: 'cash', total: 500, wallet: 100, advance: 50 });
  assert.deepEqual(a.parts, { cash: 350, upi: 0, card: 0, wallet: 100, advance: 50 });
  assert.equal(a.amountDue, 0);
  assert.deepEqual(a.storedSplit, { cash: 350, wallet: 100, advance: 50 });
  // unchanged storage for plain bills
  assert.deepEqual(M.allocatePayment({ method: 'upi', split: {}, total: 500 }).storedSplit, {});
  assert.deepEqual(M.allocatePayment({ method: 'split', split: { cash: 200, upi: 300 }, total: 500 }).storedSplit, { cash: 200, upi: 300, card: 0 });
  // pay later with advance
  const d = M.allocatePayment({ method: 'due', split: { cash: 100 }, total: 500 });
  assert.equal(d.paidNow, 100); assert.equal(d.amountDue, 400);
  // errors
  assert.throws(() => M.allocatePayment({ method: 'split', split: { cash: 100 }, total: 500 }), /add up/);
  assert.throws(() => M.allocatePayment({ method: 'cash', total: 100, wallet: 150 }), /more than the bill/);
  assert.throws(() => M.allocatePayment({ method: 'due', split: { cash: 600 }, total: 500 }), /more than the bill/);
  assert.throws(() => M.allocatePayment({ method: 'wallet', total: 500, wallet: 100 }), /Wallet covers only/);
  assert.equal(M.allocatePayment({ method: 'wallet', total: 500, wallet: 500 }).parts.wallet, 500);
});

run('cash tally: only cash counts in the drawer', () => {
  const t = M.computeCashTally({
    opening: 1000,
    bills: [
      { payment_method: 'cash', payment_split: '{}', total: 500, payment_status: 'paid' },
      { payment_method: 'upi', payment_split: '{}', total: 800, payment_status: 'paid' },
      { payment_method: 'split', payment_split: { cash: 200, card: 300 }, total: 500, payment_status: 'paid' },
      { payment_method: 'due', payment_split: { cash: 150 }, total: 600, payment_status: 'due' },
      { payment_method: 'cash', payment_split: { cash: 250, wallet: 250 }, total: 500, payment_status: 'paid' },
      { payment_method: 'cash', payment_split: { cash: -300 }, total: -300, payment_status: 'credit_note' },
      { payment_method: 'cash', payment_split: { advance: 400 }, total: 400, payment_status: 'paid' },
    ],
    duePayments: [{ amount: 100, method: 'cash' }, { amount: 50, method: 'upi' }],
    walletTopups: [{ amount: 5000, method: 'cash' }, { amount: 2000, method: 'upi' }],
    advances: [{ amount: 300, method: 'cash' }],
    expenses: [{ amount: 120, payment_method: 'cash' }, { amount: 999, payment_method: 'upi' }, { amount: 30, payment_method: '' }],
  });
  assert.equal(t.cash_sales, 500 + 200 + 150 + 250);
  assert.equal(t.cash_refunds, 300);
  assert.equal(t.cash_dues, 100);
  assert.equal(t.wallet_topups_cash, 5000);
  assert.equal(t.advances_cash, 300);
  assert.equal(t.cash_expenses, 150);
  assert.equal(t.expected_cash, 1000 + 1100 - 300 + 100 + 5000 + 300 - 150);
  assert.equal(t.received.upi, 800 + 50 + 2000);
  assert.equal(t.received.card, 300);
  assert.equal(t.wallet_spent, 250);
  assert.equal(t.advance_adjusted, 400);
});

// ── rules ───────────────────────────────────────────────────────────────────
run('dates and times: impossible values are rejected', () => {
  assert.equal(R.isValidYmd('2026-02-28'), true);
  assert.equal(R.isValidYmd('2028-02-29'), true);
  assert.equal(R.isValidYmd('2026-02-29'), false);
  assert.equal(R.isValidYmd('2026-02-31'), false);
  assert.equal(R.isValidYmd('2026-13-01'), false);
  assert.equal(R.isValidYmd('2026-2-3'), false);
  assert.equal(R.isValidHHMM('23:59'), true);
  assert.equal(R.isValidHHMM('24:00'), false);
  assert.equal(R.isValidHHMM('9:30'), false);
  assert.equal(R.addDaysYmd('2026-03-31', 1), '2026-04-01');
  assert.equal(R.addDaysYmd('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(R.stampRange('2026-10-12'), ['2026-10-12 00:00:00', '2026-10-13 00:00:00']);
  assert.deepEqual(R.stampRange('2026-10-01', '2026-10-31'), ['2026-10-01 00:00:00', '2026-11-01 00:00:00']);
  assert.equal(R.timesOverlap('10:00', '11:00', '10:30', '11:30'), true);
  assert.equal(R.timesOverlap('10:00', '11:00', '11:00', '11:30'), false);
  assert.equal(R.minToHHMM(R.hhmmToMin('09:45') + 75), '11:00');
  assert.equal(R.financialYear(new Date(2027, 1, 12)), '26-27');
  assert.equal(R.financialYear(new Date(2026, 3, 1)), '26-27');
  assert.equal(R.financialYear(new Date(2026, 2, 31)), '25-26');
});

run('lockout escalates and reports attempts left', () => {
  assert.equal(R.lockoutMinutes(4), 0);
  assert.equal(R.lockoutMinutes(5), 5);
  assert.equal(R.lockoutMinutes(6), 10);
  assert.equal(R.lockoutMinutes(7), 20);
  assert.equal(R.lockoutMinutes(30), 1440);
  const now = Date.parse('2026-10-12T10:00:00Z');
  assert.deepEqual(R.lockState(0, '', now), { locked: false, until: '', attemptsLeft: 5 });
  assert.deepEqual(R.lockState(3, '', now), { locked: false, until: '', attemptsLeft: 2 });
  assert.equal(R.lockState(5, '2026-10-12T10:05:00.000Z', now).locked, true);
  assert.equal(R.lockState(5, '2026-10-12T10:05:00.000Z', now).attemptsLeft, 0);
  // after the lock expires one more wrong guess re-locks (longer)
  assert.deepEqual(R.lockState(5, '2026-10-12T09:59:00.000Z', now), { locked: false, until: '', attemptsLeft: 1 });
});

run('fixed salary prorates but never exceeds the base', () => {
  assert.equal(R.proratedFixedSalary(26000, 26, 26), 26000);
  assert.equal(R.proratedFixedSalary(26000, 26, 30), 26000); // worked Sundays: capped
  assert.equal(R.proratedFixedSalary(26000, 26, 13), 13000);
  assert.equal(R.proratedFixedSalary(26000, 0, 10), 26000);
  assert.equal(R.proratedFixedSalary(-5, 26, 10), 0);
});

run('queue tokens restart daily; stats', () => {
  assert.equal(R.nextTokenNo(null), 1);
  assert.equal(R.nextTokenNo(0), 1);
  assert.equal(R.nextTokenNo(41), 42);
  const st = R.computeQueueStats([
    { status: 'waiting', created_at: '2026-10-12 10:00:00', called_at: '' },
    { status: 'serving', created_at: '2026-10-12 10:00:00', called_at: '2026-10-12 10:20:00' },
    { status: 'done', created_at: '2026-10-12 09:00:00', called_at: '2026-10-12 09:10:00' },
    { status: 'left', created_at: '2026-10-12 09:00:00', called_at: '' },
  ]);
  assert.deepEqual(st, { waiting: 1, serving: 1, done: 1, left: 1, avgWaitMin: 15 });
});

run('credit-note serial seeding and identifier quoting', () => {
  assert.equal(R.maxSerial(['SOS/CN-26-27/00012', 'SOS/CN-26-27/00003', 'junk']), 12);
  assert.equal(R.maxSerial([]), 0);
  assert.equal(R.quoteIdent('created_at'), '"created_at"');
  assert.throws(() => R.quoteIdent('x; DROP TABLE bills'), /Invalid column name/);
  assert.throws(() => R.quoteIdent('a"b'), /Invalid column name/);
});

// ── bytes (update verification) ─────────────────────────────────────────────
run('base64 → bytes → sha256 hex matches node crypto on the raw bytes', async () => {
  const crypto = await import('node:crypto');
  const raw = crypto.randomBytes(1000 + Math.floor(Math.random() * 50));
  const bytes = B.base64ToBytes(raw.toString('base64'));
  assert.deepEqual(Buffer.from(bytes), raw);
  assert.deepEqual(Buffer.from(B.base64ToBytes(raw.toString('base64url'))), raw);
  const hex = B.bytesToHex(crypto.createHash('sha256').update(bytes).digest());
  assert.equal(hex, crypto.createHash('sha256').update(raw).digest('hex'));
  // the old bug: hashing the base64 TEXT gives a different digest
  assert.notEqual(crypto.createHash('sha256').update(raw.toString('base64')).digest('hex'), hex);
  assert.throws(() => B.base64ToBytes('ab$c'), /Invalid base64/);
});

// ── write lock ──────────────────────────────────────────────────────────────
function fakeConn() {
  const log = [];
  let inTxn = false;
  return {
    log,
    async execAsync(sql) {
      await new Promise((r) => setTimeout(r, 1));
      if (sql === 'BEGIN IMMEDIATE') { if (inTxn) throw new Error('cannot start a transaction within a transaction'); inTxn = true; }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { if (!inTxn) throw new Error('no transaction is active'); inTxn = false; }
      log.push(sql);
    },
    async runAsync(tag) { await new Promise((r) => setTimeout(r, 1)); log.push(`run:${tag}:${inTxn ? 'txn' : 'auto'}`); },
  };
}

run('write lock: concurrent transactions never interleave; a failure rolls back only itself', async () => {
  const lock = L.createWriteLock();
  const c = fakeConn();
  const a = lock.withTxn(c, async (tx) => { await tx.runAsync('a1'); await tx.runAsync('a2'); return 'A'; });
  const b = lock.withTxn(c, async (tx) => { await tx.runAsync('b1'); throw new Error('b failed'); });
  const single = lock.exclusive(() => c.runAsync('single'));
  const d = lock.withTxn(c, async (tx) => { await tx.runAsync('d1'); return 'D'; });
  const res = await Promise.allSettled([a, b, single, d]);
  assert.equal(res[0].value, 'A');
  assert.match(res[1].reason.message, /b failed/);
  assert.equal(res[3].value, 'D');
  assert.deepEqual(c.log, [
    'BEGIN IMMEDIATE', 'run:a1:txn', 'run:a2:txn', 'COMMIT',
    'BEGIN IMMEDIATE', 'run:b1:txn', 'ROLLBACK',
    'run:single:auto',
    'BEGIN IMMEDIATE', 'run:d1:txn', 'COMMIT',
  ]);
  assert.equal(lock.busy, false);
});

run('write lock: a waiter that times out gets a clear error and the queue keeps moving', async () => {
  const lock = L.createWriteLock({ waitTimeoutMs: 20 });
  let release;
  const holder = lock.exclusive(() => new Promise((r) => { release = r; }));
  await assert.rejects(lock.exclusive(async () => 'never'), /busy finishing another save/);
  release('ok');
  assert.equal(await holder, 'ok');
  assert.equal(await lock.exclusive(async () => 'next'), 'next');
});

// ── release packaging ───────────────────────────────────────────────────────
run('release packaging never includes the licence signing key or secrets', () => {
  const { isForbidden, gitignoreProblem } = require('../tools/lib/releaseFiles.js');
  for (const p of ['keys/private.key', 'keys/anything.txt', 'other/x.key', '.env', '.env.production', 'android/app/release.keystore', 'a/b.jks', 'credentials.json'])
    assert.equal(isForbidden(p), true, p);
  for (const p of ['license-public.key', '.env.example', 'keys/.gitkeep', 'src/database/Database.ts', 'App.tsx'])
    assert.equal(isForbidden(p), false, p);
  assert.equal(gitignoreProblem('node_modules/\nkeys/*.key\n'), '');
  assert.match(gitignoreProblem('node_modules/\nkeys/private.key\n'), /keys\/\*\.key/);
  const { buildZip, zipNames } = require('../tools/package-release.js');
  const z = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'src/b.ts', data: Buffer.from('x') }]);
  assert.deepEqual(zipNames(z), ['a.txt', 'src/b.ts']);
});

run('billing screen maths: totals and payment plan always satisfy createBill', () => {
  const t = M.computeBillTotals({ items: [{ price: 500, qty: 1 }, { price: 800, qty: 1 }, { price: 300, qty: 1 }], discountType: 'percent', discountValue: 10, applyGST: true, ratePct: 18, inclusive: false, clientPoints: 50, redeem: true, pointsToRedeem: 40 });
  assert.deepEqual(t, { gross: 1600, discAmt: 160, maxRedeem: 50, loyaltyAmt: 40, taxable: 1400, taxAmt: 252, total: 1652 });
  assert.equal(M.expectedBillTotal({ subtotal: t.gross, discount_amount: t.discAmt, tax_amount: t.taxAmt, loyalty_discount: t.loyaltyAmt }), t.total);
  // advance bigger than the bill → fully covered, nothing to collect
  const p1 = M.planBillPayment({ total: 1000, appointmentId: 7, aptAdvance: 2500, walletBal: 900, useWallet: true, method: 'upi' });
  assert.deepEqual([p1.advanceUsed, p1.walletUsed, p1.toCollect, p1.usedMethod], [1000, 0, 0, 'wallet']);
  // pay-later "paid now" more than what is left is clamped (createBill would refuse it)
  const p2 = M.planBillPayment({ total: 1000, walletBal: 900, useWallet: true, method: 'due', dueCashNow: 250 });
  assert.deepEqual([p2.walletUsed, p2.toCollect, p2.splitData.cash, p2.dueAmount], [900, 100, 100, 0]);
  const a2 = M.allocatePayment({ method: p2.usedMethod, split: p2.splitData, total: 1000, wallet: p2.walletUsed });
  assert.equal(a2.amountDue, 0);
  // typed wallet amount above the balance is capped; garbage is flagged
  assert.equal(M.planBillPayment({ total: 1000, walletBal: 300, useWallet: true, walletRequested: 5000, method: 'cash' }).walletUsed, 300);
  assert.equal(M.planBillPayment({ total: 1000, walletBal: 300, useWallet: true, walletRequested: NaN, method: 'cash' }).walletInvalid, true);
});
