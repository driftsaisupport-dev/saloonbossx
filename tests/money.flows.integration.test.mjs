/**
 * Money & data flows end to end against a REAL SQLite engine (node:sqlite)
 * through the real Database.ts, with exact rupee assertions. Bills are built
 * the way BillingScreen builds them (utils/money computeBillTotals +
 * planBillPayment) so a payload the counter can produce is never refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

let DB, DBX, M, INV, SCHEMA;
try {
  await import('node:sqlite');
  register(new URL('./helpers/expo/hooks.mjs', import.meta.url));
  globalThis.__DEV__ = false;
  ({ DatabaseService: DB, DBX } = await import('../src/database/Database.ts'));
  M = await import('../src/utils/money.ts');
  INV = await import('../src/utils/invoice.ts');
  SCHEMA = await import('../src/database/schema.ts');
  await DB.initialize();
  await DB.setSetting('gst_enabled', 'true'); // these flows are for a GST-registered salon
} catch (e) {
  test('money flows (needs node:sqlite + type stripping)', { skip: String(e?.message || e).slice(0, 160) }, () => {});
}
const run = DB ? test : test.skip;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = ymd(new Date());
const tomorrow = ymd(new Date(Date.now() + 86400000));
const PROFILE = { name: 'Glow Salon', gst_number: '27ABCDE1234F1Z5', tax_rate: 5 };

let svcA, svcB, prod, staff, staff2;
const sA = (o = {}) => ({ type: 'service', id: svcA, name: 'Haircut', price: 500, qty: 1, ...o });
const sB = (o = {}) => ({ type: 'service', id: svcB, name: 'Facial', price: 800, qty: 1, ...o });
const pr = (o = {}) => ({ type: 'product', id: prod, name: 'Shampoo', price: 300, qty: 1, ...o });
const newClient = async (name) => Number(await DB.addClient({ name, phone: '' }));
// Appointments with no stylist (staff_id 0) never clash, so one slot serves them all.
const uniqTime = () => ['10:00', '10:30'];

/**
 * Build a createBill payload exactly like BillingScreen.generateBill().
 * o.package: { idx, cm } marks items[idx] as covered by package cm (applyPackage).
 */
function screenPayload(o) {
  let items = (o.items || []).map((x) => ({ ...x }));
  for (const p of o.packages || []) {
    const it = items[p.idx];
    items[p.idx] = { ...it, list_price: Number(it.price) || 0, price: 0, package_cm_id: p.cm, package_name: 'Pkg' };
  }
  const applyGST = !!o.rate;
  const t = M.computeBillTotals({
    items, discountType: o.discountType || 'flat', discountValue: o.discountValue || 0, applyGST,
    ratePct: o.rate || 0, inclusive: !!o.inclusive, clientPoints: o.clientPoints || 0, redeem: !!o.redeem, pointsToRedeem: o.redeem || 0,
  });
  const plan = M.planBillPayment({
    total: t.total, appointmentId: o.appointmentId || 0, aptAdvance: o.aptAdvance || 0,
    walletBal: o.walletBal || 0, useWallet: !!o.useWallet, walletRequested: o.walletRequested ?? null,
    method: o.method || 'cash', split: o.splitFn ? o.splitFn(0) : [0, 0, 0], dueCashNow: o.dueCashNow || 0,
  });
  // The user types split amounts that match "to collect" (the screen refuses otherwise).
  let split = plan.splitData;
  if (plan.usedMethod === 'split' && o.splitFn) {
    const s = o.splitFn(plan.toCollect);
    split = { cash: s[0], upi: s[1], card: s[2] };
  }
  const billItems = items.map(({ maxStock, package_name, ...rest }) => rest);
  return {
    t, plan,
    payload: {
      client_id: o.client || 0, staff_id: o.staff ?? staff, appointment_id: o.appointmentId || 0, queue_id: o.queue || 0, items: billItems,
      subtotal: t.gross, tax_amount: t.taxAmt, taxable_value: t.taxable, tax_rate: applyGST ? o.rate : 0,
      prices_include_gst: applyGST && o.inclusive ? 1 : 0, discount_amount: t.discAmt, discount_type: o.discountType || 'flat',
      loyalty_discount: t.loyaltyAmt, total: t.total, payment_method: plan.usedMethod, payment_split: split,
      wallet_used: plan.walletUsed, advance_adjusted: plan.advanceUsed, created_by: 'test', notes: '',
      loyalty_points_earned: 0, loyalty_points_used: t.loyaltyAmt, is_walkin: o.client ? 0 : 1,
    },
  };
}
async function screenBill(o) {
  const x = screenPayload(o);
  const r = await DB.createBill(x.payload);
  return { ...x, r, bill: await DB.getBill(r.billId) };
}
const sumParts = (b) => Object.values(M.paymentParts(b)).reduce((s, v) => s + M.toPaise(v), 0);

run('setup: catalogue, GSTIN, loyalty 10 pts / ₹100', async () => {
  await DB.updateSalonProfile(PROFILE);
  await DB.setSetting('loyalty_points_per_100', '10');
  svcA = Number(await DB.addService({ name: 'Haircut', price: 500, duration: 30 }));
  svcB = Number(await DB.addService({ name: 'Facial', price: 800, duration: 60 }));
  prod = Number(await DB.addInventoryItem({ name: 'Shampoo', quantity: 10000, sell_price: 300, min_stock: 1 }));
  staff = Number(await DB.addStaff({ name: 'Rahul' }));
  staff2 = Number(await DB.addStaff({ name: 'Sana' }));
});

// ── 1. GST, discounts, loyalty, invoice ─────────────────────────────────────
run('1a GST exclusive 5% + flat discount: exact figures, CGST+SGST, invoice prints the bill\'s own rate', async () => {
  const c = await newClient('Asha');
  const { t, bill } = await screenBill({ client: c, items: [sA(), sB(), pr()], discountValue: 100, rate: 5 });
  assert.deepEqual(t, { gross: 1600, discAmt: 100, maxRedeem: 0, loyaltyAmt: 0, taxable: 1500, taxAmt: 75, total: 1575 });
  assert.equal(bill.subtotal, 1600); assert.equal(bill.discount_amount, 100);
  assert.equal(bill.tax_amount, 75); assert.equal(bill.total, 1575); assert.equal(bill.tax_rate, 5);
  const br = M.invoiceTaxBreakup(bill);
  assert.equal(br.taxable, 1500); assert.equal(br.cgst, 37.5); assert.equal(br.sgst, 37.5);
  // The owner later changes the profile rate: the reprint still shows 5 %.
  await DB.updateSalonProfile({ tax_rate: 18 });
  const html = INV.buildInvoiceHTML(bill, { ...PROFILE, tax_rate: 18 }, '₹');
  assert.match(html, /CGST @2\.5%/); assert.match(html, /SGST @2\.5%/);
  assert.match(html, /Taxable value<\/td><td[^>]*>₹1500</); assert.match(html, /37\.50/);
  assert.match(html, /TOTAL<\/td><td[^>]*>₹1575</);
  assert.doesNotMatch(html, /@9%/);
  const rcpt = INV.buildReceiptHTML(bill, PROFILE, '₹', '80');
  assert.match(rcpt, /CGST 2\.5%/);
  await DB.updateSalonProfile({ tax_rate: 5 });
});

run('1b GST exclusive 18% + percent discount', async () => {
  const c = await newClient('Bina');
  const { t, bill } = await screenBill({ client: c, items: [sA(), sB(), pr()], discountType: 'percent', discountValue: 10, rate: 18 });
  assert.deepEqual(t, { gross: 1600, discAmt: 160, maxRedeem: 0, loyaltyAmt: 0, taxable: 1440, taxAmt: 259.2, total: 1699.2 });
  assert.equal(bill.total, 1699.2); assert.equal(bill.tax_rate, 18);
  const br = M.invoiceTaxBreakup(bill);
  assert.equal(br.taxable, 1440); assert.equal(br.cgst, 129.6); assert.equal(br.sgst, 129.6);
  assert.equal(M.toPaise(br.cgst) + M.toPaise(br.sgst), M.toPaise(bill.tax_amount));
  const html = INV.buildInvoiceHTML(bill, PROFILE, '₹');
  assert.match(html, /CGST @9%/); assert.match(html, /129\.60/);
});

run('1c GST-inclusive pricing 18%: total = net, tax carved out, odd paisa split exactly', async () => {
  const c = await newClient('Chitra');
  const { t, bill } = await screenBill({ client: c, items: [sA(), sB(), pr()], discountValue: 100, rate: 18, inclusive: true });
  assert.deepEqual(t, { gross: 1600, discAmt: 100, maxRedeem: 0, loyaltyAmt: 0, taxable: 1271.19, taxAmt: 228.81, total: 1500 });
  assert.equal(bill.prices_include_gst, 1); assert.equal(bill.total, 1500);
  const br = M.invoiceTaxBreakup(bill);
  assert.equal(br.taxable, 1271.19); assert.equal(br.cgst, 114.41); assert.equal(br.sgst, 114.4);
  assert.equal(M.toPaise(br.taxable) + M.toPaise(br.tax), M.toPaise(bill.total));
  const html = INV.buildInvoiceHTML(bill, PROFILE, '₹');
  assert.match(html, /CGST @9% \(incl\.\)/); assert.match(html, /Prices inclusive of GST/);
  assert.match(html, /Taxable value<\/td><td[^>]*>₹1271\.19</);
  // 5 % inclusive
  const c2 = await newClient('Chitra2');
  const r5 = await screenBill({ client: c2, items: [sA(), sB(), pr()], rate: 5, inclusive: true });
  assert.equal(r5.t.total, 1600); assert.equal(r5.t.taxable, 1523.81); assert.equal(r5.t.taxAmt, 76.19);
  assert.equal(M.invoiceTaxBreakup(r5.bill).taxable, 1523.81);
});

run('1d loyalty redemption comes off BEFORE tax; invoice taxable/GST rows agree; void restores points', async () => {
  const c = await newClient('Deepa');
  await screenBill({ client: c, items: [sA({ price: 2000 })] }); // earns 200 points
  assert.equal((await DB.getClient(c)).loyalty_points, 200);
  const { t, bill, r } = await screenBill({ client: c, clientPoints: 200, redeem: 100, items: [sA(), sB(), pr()], rate: 5 });
  assert.deepEqual(t, { gross: 1600, discAmt: 0, maxRedeem: 200, loyaltyAmt: 100, taxable: 1500, taxAmt: 75, total: 1575 });
  assert.equal(bill.loyalty_points_used, 100);
  assert.equal(r.pointsEarned, 150);
  assert.equal((await DB.getClient(c)).loyalty_points, 250);
  const br = M.invoiceTaxBreakup(bill);
  assert.equal(br.taxable, 1500, 'taxable is after loyalty');
  assert.equal(br.loyaltyBeforeTax, true);
  const html = INV.buildInvoiceHTML(bill, PROFILE, '₹');
  assert.ok(html.indexOf('Loyalty discount') < html.indexOf('CGST'), 'loyalty printed before the GST rows');
  assert.match(html, /Taxable value<\/td><td[^>]*>₹1500</);
  // inclusive + loyalty
  const ti = M.computeBillTotals({ items: [sA(), sB(), pr()], discountType: 'flat', discountValue: 0, applyGST: true, ratePct: 18, inclusive: true, clientPoints: 250, redeem: true, pointsToRedeem: 100 });
  const ri = await screenBill({ client: c, clientPoints: 250, redeem: 100, items: [sA(), sB(), pr()], rate: 18, inclusive: true });
  assert.equal(ri.bill.total, 1500); assert.equal(M.invoiceTaxBreakup(ri.bill).taxable, ti.taxable);
  assert.equal(M.toPaise(M.invoiceTaxBreakup(ri.bill).taxable) + M.toPaise(ri.bill.tax_amount), M.toPaise(ri.bill.total));
  // credit note mirrors the taxable value
  const v = await DB.voidBill(r.billId, 'test');
  const cn = await DB.getBill(v.creditNoteId);
  assert.equal(M.invoiceTaxBreakup(cn).taxable, -1500);
  const cnHtml = INV.buildInvoiceHTML(cn, PROFILE, '₹');
  assert.match(cnHtml, /Credit Note/); assert.match(cnHtml, /Loyalty discount/);
  // GST report: per-bill taxable + tax add up; CGST + SGST == tax
  const now = new Date();
  const g = await DB.getGSTReport(now.getFullYear(), now.getMonth() + 1);
  assert.equal(M.toPaise(g.summary.totalCGST) + M.toPaise(g.summary.totalSGST), M.toPaise(g.summary.totalTaxCollected));
  const row = g.bills.find((x) => x.bill_number === bill.bill_number);
  assert.equal(row.taxable_value, 1500); assert.equal(row.tax_rate, 5);
});

run('1e every counter combination the billing screen can send is accepted and stored consistently', async () => {
  const c = await newClient('Combo');
  await screenBill({ client: c, items: [sA({ price: 100000 })] }); // 10,000 points
  await DBX.walletTopUp(c, 2000000, 'upi', 0);
  await DB.addMembership({ name: 'Cut x5000', price: 1000, max_sessions: 5000, service_id: svcA, duration_days: 365 });
  await DB.addMembership({ name: 'Value 1L', price: 1000000 });
  const ms = await DB.getMemberships();
  const sess = await DB.assignMembership(c, ms.find((m) => m.name === 'Cut x5000').id);
  const val = await DB.assignMembership(c, ms.find((m) => m.name === 'Value 1L').id);
  assert.ok(sess.ok && val.ok);
  const methods = ['cash', 'upi', 'card', 'split', 'due'];
  const wallets = [null, { req: 100 }, { req: null }];
  const advances = [0, 300, 99999];
  const pkgs = [null, sess.clientMembershipId, val.clientMembershipId];
  const gsts = [{}, { rate: 5 }, { rate: 18 }, { rate: 18, inclusive: true }, { rate: 5, inclusive: true }];
  const discs = [{}, { discountValue: 150 }, { discountType: 'percent', discountValue: 12.5 }];
  const loys = [0, 37];
  let n = 0;
  for (const method of methods) for (const w of wallets) for (const adv of advances) for (const pk of pkgs) for (const g of gsts) for (const d of discs) for (const loy of loys) {
    let appointmentId = 0;
    if (adv) {
      const [s, e] = uniqTime();
      appointmentId = Number(await DB.addAppointment({ client_id: c, staff_id: 0, date: tomorrow, start_time: s, end_time: e, advance_amount: adv, advance_method: 'cash' }));
    }
    const cl = await DB.getClient(c);
    const o = {
      client: c, items: [sA({ price: 499.99 }), sB(), pr({ qty: 2 })], method, ...g, ...d,
      clientPoints: cl.loyalty_points, redeem: loy, appointmentId, aptAdvance: adv,
      walletBal: cl.wallet_balance, useWallet: !!w, walletRequested: w ? w.req : null,
      packages: pk ? [{ idx: 0, cm: pk }] : [], dueCashNow: 250,
      splitFn: (tc) => { const a = M.round2(tc / 3); return [a, a, M.round2(tc - a - a)]; },
    };
    const label = JSON.stringify({ method, w, adv, pk, g, d, loy });
    let res;
    try { res = await screenBill(o); } catch (e) { assert.fail(`refused at the counter: ${e.message}\n${label}`); }
    const { bill, t, plan } = res;
    assert.equal(M.toPaise(bill.total), M.toPaise(t.total), label);
    assert.equal(sumParts(bill) + M.toPaise(bill.amount_due), M.toPaise(bill.total), `paid + due = total ${label}`);
    assert.equal(M.toPaise(res.r.amountDue), M.toPaise(plan.dueAmount), `due matches the screen ${label}`);
    if (Number(bill.tax_amount)) {
      const br = M.invoiceTaxBreakup(bill);
      const expectTax = g.inclusive ? M.gstFromInclusive(br.taxable + br.tax, g.rate).tax : M.gstOnExclusive(br.taxable, g.rate);
      assert.ok(Math.abs(M.toPaise(expectTax) - M.toPaise(br.tax)) <= 1, `tax matches taxable ${label}`);
    }
    n++;
  }
  assert.equal(n, 5 * 3 * 3 * 3 * 5 * 3 * 2);
});

// ── 2. Wallet ───────────────────────────────────────────────────────────────
run('2 wallet: top-up + bonus, full and part wallet bills, void refunds wallet & stock, tally and P&L', async () => {
  const c = await newClient('Wallet Wendy');
  const t0 = await DBX.getCashTally(today);
  const pl0 = await DB.getPLSummary(today, today);
  const stock0 = (await DBX.getInventoryItem(prod)).quantity;
  assert.equal((await DBX.walletTopUp(c, 5000, 'cash', 500, 'offer')).balance, 5500);
  const b1 = await screenBill({ client: c, items: [sA({ price: 1200 })], walletBal: 5500, useWallet: true });
  assert.equal(b1.plan.usedMethod, 'wallet');
  assert.equal(b1.r.walletBalance, 4300);
  assert.deepEqual(b1.bill.payment_split, { wallet: 1200 });
  const b2 = await screenBill({ client: c, items: [sA({ price: 5700 }), pr()], walletBal: 4300, useWallet: true, method: 'cash' });
  assert.equal(b2.bill.total, 6000);
  assert.deepEqual(b2.bill.payment_split, { cash: 1700, wallet: 4300 });
  assert.equal(await DBX.getWalletBalance(c), 0);
  assert.equal((await DBX.getInventoryItem(prod)).quantity, stock0 - 1);
  await DB.voidBill(b2.r.billId, 'customer changed mind');
  assert.equal(await DBX.getWalletBalance(c), 4300);
  assert.equal((await DBX.getInventoryItem(prod)).quantity, stock0);
  const t1 = await DBX.getCashTally(today);
  const d = (k) => M.round2(t1[k] - t0[k]);
  assert.equal(d('wallet_topups_cash'), 5000);
  assert.equal(d('cash_sales'), 1700);
  assert.equal(d('cash_refunds'), 1700);
  assert.equal(d('wallet_spent'), 1200, 'net wallet spend after the refund');
  assert.equal(d('expected_cash'), 5000, 'only the top-up cash stays in the drawer');
  const pl1 = await DB.getPLSummary(today, today);
  assert.equal(M.round2(pl1.revenue - pl0.revenue), 1200, 'top-up is not revenue; the wallet bill is');
  const tx = await DBX.getWalletTxns(c);
  assert.deepEqual(tx.map((x) => [x.kind, x.amount]), [['refund', 4300], ['spend', -4300], ['spend', -1200], ['bonus', 500], ['topup', 5000]]);
});

// ── 3. Packages ─────────────────────────────────────────────────────────────
run('3 packages: sell by UPI, redeem across bills, void restores a session; value package; package paid from wallet', async () => {
  const c = await newClient('Pooja');
  const t0 = await DBX.getCashTally(today);
  await DB.addMembership({ name: 'Cut x5', price: 2000, max_sessions: 5, service_id: svcA, duration_days: 90 });
  const m5 = (await DB.getMemberships()).find((x) => x.name === 'Cut x5');
  const sale = await DB.assignMembership(c, m5.id, { paidAmount: 2000, method: 'upi' });
  assert.equal(sale.ok, true, sale.message);
  const saleBill = await DB.getBill(sale.billId);
  assert.equal(saleBill.total, 2000); assert.equal(saleBill.payment_method, 'upi');
  assert.equal(M.round2((await DBX.getCashTally(today)).received.upi - t0.received.upi), 2000);
  const cm = sale.clientMembershipId;
  const left = async () => (await DB.getClientActivePackages(c)).find((p) => p.id === cm)?.remaining_sessions;
  const r1 = await screenBill({ client: c, items: [sA(), pr()], packages: [{ idx: 0, cm }], rate: 5 });
  assert.equal(r1.bill.total, 315); assert.equal(r1.bill.items[0].price, 0);
  const r2 = await screenBill({ client: c, items: [sA()], packages: [{ idx: 0, cm }] });
  assert.equal(r2.bill.total, 0);
  assert.equal(await left(), 3);
  await DB.voidBill(r1.r.billId, 'x');
  assert.equal(await left(), 4);
  // a used package's sale cannot be cancelled
  await assert.rejects(DB.voidBill(sale.billId, 'x'), /already been used/);
  // value package
  await DB.addMembership({ name: 'Gift 1000', price: 1000 });
  const g = (await DB.getMemberships()).find((x) => x.name === 'Gift 1000');
  const gs = await DB.assignMembership(c, g.id, { paidAmount: 1000, method: 'cash' });
  const gcm = gs.clientMembershipId;
  const vleft = async () => (await DB.getClientActivePackages(c)).find((p) => p.id === gcm)?.remaining_value;
  assert.equal(await vleft(), 1000);
  const rv = await screenBill({ client: c, items: [sA()], packages: [{ idx: 0, cm: gcm }] });
  assert.equal(await vleft(), 500);
  await DB.voidBill(rv.r.billId, 'x');
  assert.equal(await vleft(), 1000);
  // package paid from the wallet
  await DBX.walletTopUp(c, 3000, 'upi');
  const visits0 = (await DB.getClient(c)).total_visits;
  const ws = await DB.assignMembership(c, m5.id, { paidAmount: 2000, method: 'wallet' });
  assert.equal(ws.ok, true, ws.message);
  assert.equal(await DBX.getWalletBalance(c), 1000);
  assert.deepEqual((await DB.getBill(ws.billId)).payment_split, { wallet: 2000 });
  const bad = await DB.assignMembership(c, m5.id, { paidAmount: 2000, method: 'wallet' });
  assert.equal(bad.ok, false); assert.match(bad.message, /wallet has only/);
  await DB.voidBill(ws.billId, 'sold by mistake');
  assert.equal(await DBX.getWalletBalance(c), 3000);
  assert.ok(!(await DB.getClientActivePackages(c)).some((p) => p.id === ws.clientMembershipId), 'cancelled package is gone');
  assert.equal((await DB.getClient(c)).total_visits, visits0, 'package sales never count as visits (sale or void)');
});

// ── 4. Appointments ─────────────────────────────────────────────────────────
run('4 appointment advance, billed once, reschedule keeps duration and rejects clashes, no-shows', async () => {
  const c = await newClient('Anita');
  const t0 = await DBX.getCashTally(today);
  const id = Number(await DB.addAppointment({ client_id: c, staff_id: staff2, date: tomorrow, start_time: '11:00', end_time: '12:00', advance_amount: 2000, advance_method: 'upi' }));
  const t1 = await DBX.getCashTally(today);
  assert.equal(M.round2(t1.received.upi - t0.received.upi), 2000);
  assert.equal(M.round2(t1.advances_cash - t0.advances_cash), 0, 'a UPI advance is not drawer cash');
  const apt = await DB.getAppointment(id);
  const left = M.round2(apt.advance_amount - (apt.advance_used || 0));
  const r = await screenBill({ client: c, items: [sA({ price: 5000 })], appointmentId: id, aptAdvance: left, method: 'cash' });
  assert.equal(r.plan.toCollect, 3000);
  assert.deepEqual(r.bill.payment_split, { cash: 3000, advance: 2000 });
  const t2 = await DBX.getCashTally(today);
  assert.equal(M.round2(t2.cash_sales - t1.cash_sales), 3000);
  assert.equal(M.round2(t2.advance_adjusted - t1.advance_adjusted), 2000);
  await assert.rejects(screenBill({ client: c, items: [sA()], appointmentId: id, aptAdvance: 0 }), /already billed/);
  await assert.rejects(DBX.rescheduleAppointment(id, tomorrow, '15:00'), /already billed/);
  // reschedule
  const a2 = Number(await DB.addAppointment({ client_id: c, staff_id: staff2, date: tomorrow, start_time: '13:00', end_time: '13:45' }));
  await assert.rejects(DBX.rescheduleAppointment(a2, tomorrow, '11:30'), /Sana is already booked at 11:00/);
  await DBX.rescheduleAppointment(a2, tomorrow, '16:10');
  const moved = await DB.getAppointment(a2);
  assert.equal(moved.start_time, '16:10'); assert.equal(moved.end_time, '16:55');
  // no-show count
  await DB.updateAppointmentStatus(a2, 'no_show');
  assert.equal((await DB.getClient(c)).no_show_count, 1);
  await DB.updateAppointmentStatus(a2, 'no_show');
  assert.equal((await DB.getClient(c)).no_show_count, 1, 'marking twice counts once');
  await DB.updateAppointmentStatus(a2, 'confirmed');
  assert.equal((await DB.getClient(c)).no_show_count, 0);
  // voiding the bill frees the appointment and its advance
  await DB.voidBill(r.r.billId, 'x');
  const back = await DB.getAppointment(id);
  assert.equal(back.converted_to_bill, 0); assert.equal(back.advance_used, 0);
});

// ── 5. Pay later ────────────────────────────────────────────────────────────
run('5 pay later: two part collections, points as paid, dues report, void refunds what was collected', async () => {
  const c = await newClient('Dues Dinesh');
  const t0 = await DBX.getCashTally(today);
  const r = await screenBill({ client: c, items: [sA({ price: 1000 })], method: 'due', dueCashNow: 0 });
  assert.equal(r.r.amountDue, 1000); assert.equal(r.r.pointsEarned, 0);
  assert.equal((await DBX.collectDue(r.r.billId, 300, 'cash')).remaining, 700);
  assert.equal((await DB.getClient(c)).loyalty_points, 30);
  assert.equal((await DBX.collectDue(r.r.billId, 250, 'upi')).remaining, 450);
  assert.equal((await DB.getClient(c)).loyalty_points, 50);
  const dues = await DBX.getDueBills(c);
  assert.equal(dues.length, 1); assert.equal(dues[0].amount_due, 450);
  const over = await DBX.collectDue(r.r.billId, 451, 'cash');
  assert.equal(over.ok, false);
  const t1 = await DBX.getCashTally(today);
  assert.equal(M.round2(t1.cash_dues - t0.cash_dues), 300);
  assert.equal(M.round2(t1.expected_cash - t0.expected_cash), 300);
  // cancelling the bill gives back the 550 actually collected (300 cash + 250 UPI)
  const v = await DB.voidBill(r.r.billId, 'dispute');
  const cn = await DB.getBill(v.creditNoteId);
  assert.deepEqual(cn.payment_split, { cash: -300, upi: -250 });
  const t2 = await DBX.getCashTally(today);
  assert.equal(M.round2(t2.cash_refunds - t1.cash_refunds), 300);
  assert.equal(M.round2(t2.expected_cash - t0.expected_cash), 0, 'drawer back where it started');
  assert.equal((await DB.getClient(c)).loyalty_points, 0);
  assert.equal((await DBX.getDueBills(c)).length, 0);
  // partial pay-later at the counter: ₹250 now, the screen never sends more than "to collect"
  const p2 = await screenBill({ client: c, items: [sA({ price: 200 })], method: 'due', dueCashNow: 250 });
  assert.equal(p2.bill.payment_status, 'paid'); assert.equal(p2.r.amountDue, 0);
});

run('5b concurrent createBill + collectDue (write lock): no lost update, no number clash', async () => {
  const c = await newClient('Rush Hour');
  const due = await screenBill({ client: c, items: [sA({ price: 1000 })], method: 'due' });
  const jobs = [];
  for (let i = 0; i < 4; i++) {
    jobs.push(screenBill({ client: c, items: [sA()] }).then((x) => x.r));
    jobs.push(DBX.collectDue(due.r.billId, 100, i % 2 ? 'upi' : 'cash'));
  }
  const out = await Promise.all(jobs);
  const bills = out.filter((x) => x.billNumber);
  assert.equal(new Set(bills.map((b) => b.billNumber)).size, 4);
  assert.ok(out.filter((x) => 'remaining' in x).every((x) => x.ok));
  const b = await DB.getBill(due.r.billId);
  assert.equal(b.amount_due, 600);
  assert.equal((await DBX.getDueCollections(today, today)).filter((p) => p.bill_id === due.r.billId).length, 4);
  // one collection bigger than what is left races another: only what fits succeeds
  const [x, y] = await Promise.all([DBX.collectDue(due.r.billId, 400, 'cash'), DBX.collectDue(due.r.billId, 400, 'cash')]);
  assert.equal([x.ok, y.ok].filter(Boolean).length, 1);
  assert.equal((await DB.getBill(due.r.billId)).amount_due, 200);
});

// ── 6. Numbering ────────────────────────────────────────────────────────────
run('6 credit notes have their own series; a new financial year starts both at 1', async () => {
  const c = await newClient('Numbers');
  const serial = (n) => Number(String(n).split('/').pop());
  const a = await screenBill({ client: c, items: [sA()] });
  const v1 = await DB.voidBill(a.r.billId, 'x');
  const b = await screenBill({ client: c, items: [sA()] });
  const v2 = await DB.voidBill(b.r.billId, 'x');
  assert.equal(serial(b.r.billNumber), serial(a.r.billNumber) + 1);
  assert.equal(serial(v2.creditNoteNumber), serial(v1.creditNoteNumber) + 1);
  assert.match(v1.creditNoteNumber, /\/CN-\d\d-\d\d\//);
  const realFy = DB._financialYear;
  try {
    DB._financialYear = () => '99-00';
    const n1 = await screenBill({ client: c, items: [sA()] });
    assert.match(n1.r.billNumber, /\/99-00\/00001$/);
    const cn = await DB.voidBill(n1.r.billId, 'x');
    assert.match(cn.creditNoteNumber, /\/CN-99-00\/00001$/);
    const n2 = await screenBill({ client: c, items: [sA()] });
    assert.match(n2.r.billNumber, /\/99-00\/00002$/);
  } finally { DB._financialYear = realFy; }
  const back = await screenBill({ client: c, items: [sA()] });
  assert.equal(serial(back.r.billNumber), serial(b.r.billNumber) + 1, 'current year continues unaffected');
});

// ── 8. Queue ────────────────────────────────────────────────────────────────
run('8 walk-in queue: tokens restart per day, average wait', async () => {
  const a = await DBX.queueAdd({ client_name: 'Q1' });
  const b = await DBX.queueAdd({ client_name: 'Q2' });
  assert.equal(b.token_no, a.token_no + 1);
  // yesterday's tokens do not continue today's series
  const yesterday = ymd(new Date(Date.now() - 86400000));
  const raw = globalThis.__sbxDb;
  await raw.runAsync("INSERT INTO walkin_queue (token_no,date,client_name,status,created_at) VALUES (77,?,'old','done',?)", yesterday, `${yesterday} 10:00:00`);
  const c = await DBX.queueAdd({ client_name: 'Q3' });
  assert.equal(c.token_no, b.token_no + 1);
  const tomorrowFirst = await raw.getFirstAsync('SELECT MAX(token_no) AS m FROM walkin_queue WHERE date=?', tomorrow);
  assert.equal(tomorrowFirst.m, null);
  // wait times: Q1 waited 10 min, Q2 20 min → 15
  await raw.runAsync("UPDATE walkin_queue SET created_at=?, called_at=?, status='serving' WHERE id=?", `${today} 09:00:00`, `${today} 09:10:00`, a.id);
  await raw.runAsync("UPDATE walkin_queue SET created_at=?, called_at=?, status='done' WHERE id=?", `${today} 09:00:00`, `${today} 09:20:00`, b.id);
  const st = await DBX.queueStats(today);
  assert.equal(st.avgWaitMin, 15); assert.equal(st.serving, 1); assert.equal(st.done, 1); assert.equal(st.waiting, 1);
  assert.equal((await DBX.queueStats(yesterday)).done, 1);
});

// ── 9. Day close ────────────────────────────────────────────────────────────
run('9 day close: drawer formula, idempotent per date, next day opens with the counted cash', async () => {
  const c = await newClient('Drawer');
  const t0 = await DBX.getCashTally(today);
  await screenBill({ client: c, items: [sA({ price: 1000 })], method: 'cash' });                                   // +1000 cash
  await screenBill({ client: c, items: [sA({ price: 900 })], method: 'split', splitFn: () => [400, 500, 0] });       // +400 cash
  const refund = await screenBill({ client: c, items: [sA({ price: 250 })], method: 'cash' });                        // +250 cash
  await DB.voidBill(refund.r.billId, 'x');                                                                             // −250 cash
  const due = await screenBill({ client: c, items: [sA({ price: 600 })], method: 'due', dueCashNow: 100 });          // +100 cash
  await DBX.collectDue(due.r.billId, 200, 'cash');                                                                     // +200 cash
  await DBX.walletTopUp(c, 700, 'cash', 70);                                                                           // +700 cash
  const [s, e] = uniqTime();
  await DB.addAppointment({ client_id: c, staff_id: 0, date: tomorrow, start_time: s, end_time: e, advance_amount: 150, advance_method: 'cash' }); // +150
  await DB.addExpense({ category: 'Tea', amount: 80, date: today, payment_method: 'cash' });                          // −80
  await DB.addExpense({ category: 'Rent', amount: 5000, date: today, payment_method: 'upi' });                        // not cash
  const t1 = await DBX.getCashTally(today);
  const d = (k) => M.round2(t1[k] - t0[k]);
  assert.equal(d('cash_sales'), 1000 + 400 + 250 + 100);
  assert.equal(d('cash_refunds'), 250);
  assert.equal(d('cash_dues'), 200);
  assert.equal(d('wallet_topups_cash'), 700);
  assert.equal(d('advances_cash'), 150);
  assert.equal(d('cash_expenses'), 80);
  assert.equal(d('expected_cash'), 1000 + 400 + 250 - 250 + 100 + 200 + 700 + 150 - 80);
  assert.equal(t1.expected_cash, M.round2(t1.opening_cash + t1.cash_sales - t1.cash_refunds + t1.cash_dues + t1.wallet_topups_cash + t1.advances_cash - t1.cash_expenses));
  const first = await DBX.saveDayClose(today, t1.expected_cash + 20, 'extra 20', 'owner');
  assert.equal(first.difference, 20);
  const again = await DBX.saveDayClose(today, t1.expected_cash, 'recount', 'owner');
  assert.equal(again.difference, 0);
  assert.equal((await DBX.listDayCloses(100)).filter((x) => x.date === today).length, 1, 'one close per date');
  const next = await DBX.getCashTally(tomorrow);
  assert.equal(next.opening_source, 'last_close');
  assert.equal(next.opening_cash, t1.expected_cash);
  const eod = await DB.getEndOfDayReport(today);
  assert.equal(eod.expectedDrawer, t1.expected_cash);
});

// ── 10. Queue token billed once; held advances on cancelled / no-show bookings ─
run('10 a queue token is billed once (void frees it); cancelled booking advance is listed and refunded through the tally', async () => {
  const c = await newClient('Token Tara');
  const q = await DBX.queueAdd({ client_name: 'Token Tara', client_id: c });
  const r = await screenBill({ client: c, items: [sA()] , queue: q.id });
  const row = async () => (await DBX.queueList(today)).find((x) => x.id === q.id);
  assert.equal((await row()).bill_id, r.r.billId);
  assert.equal((await row()).status, 'done');
  await assert.rejects(screenBill({ client: c, items: [sA()], queue: q.id }), /already billed/);
  await DB.voidBill(r.r.billId, 'wrong');
  assert.equal((await row()).bill_id, 0, 'voiding the bill frees the token');
  const r2 = await screenBill({ client: c, items: [sA()], queue: q.id });
  assert.equal((await row()).bill_id, r2.r.billId);

  const [s, e] = uniqTime();
  const apt = Number(await DB.addAppointment({ client_id: c, staff_id: 0, date: tomorrow, start_time: s, end_time: e, advance_amount: 400, advance_method: 'cash' }));
  assert.ok(!(await DBX.getAdvancesToRefund()).some((x) => x.id === apt), 'a live booking is not listed');
  await DB.deleteAppointment(apt);
  const listed = (await DBX.getAdvancesToRefund()).find((x) => x.id === apt);
  assert.equal(listed.amount, 400);
  const t0 = await DBX.getCashTally(today);
  assert.equal((await DBX.markAdvanceRefunded(apt, 'cash')).amount, 400);
  await assert.rejects(DBX.markAdvanceRefunded(apt, 'cash'), /Nothing is left/);
  const t1 = await DBX.getCashTally(today);
  assert.equal(M.round2(t1.advances_cash - t0.advances_cash), -400);
  assert.equal(M.round2(t1.expected_cash - t0.expected_cash), -400);
  assert.ok(!(await DBX.getAdvancesToRefund()).some((x) => x.id === apt));
  // re-opened and billed later: the refunded advance can no longer be used
  await DB.updateAppointmentStatus(apt, 'confirmed');
  await assert.rejects(screenBill({ client: c, items: [sA()], appointmentId: apt, aptAdvance: 400 }), /Only ₹0 advance is left/);
  const ok = await screenBill({ client: c, items: [sA()], appointmentId: apt, aptAdvance: 0 });
  assert.equal(ok.bill.total, 500);
  // a no-show with an advance is listed too
  const [s2, e2] = uniqTime();
  const ns = Number(await DB.addAppointment({ client_id: c, staff_id: 0, date: tomorrow, start_time: s2, end_time: e2, advance_amount: 250, advance_method: 'upi' }));
  await DB.updateAppointmentStatus(ns, 'no_show');
  assert.equal((await DBX.getAdvancesToRefund()).find((x) => x.id === ns).amount, 250);
});

// ── 11. Advance bigger than the bill ────────────────────────────────────────
run('11 unused advance goes to the client wallet (not counted again), void reverses it; a walk-in\'s is listed for refund', async () => {
  const c = await newClient('Big Advance');
  const [s, e] = uniqTime();
  const apt = Number(await DB.addAppointment({ client_id: c, staff_id: 0, date: tomorrow, start_time: s, end_time: e, advance_amount: 2000, advance_method: 'upi' }));
  const t0 = await DBX.getCashTally(today);
  const pl0 = await DB.getPLSummary(today, today);
  const g0 = await DB.getGSTReport(new Date().getFullYear(), new Date().getMonth() + 1);
  const r = await screenBill({ client: c, items: [sA({ price: 1500 })], appointmentId: apt, aptAdvance: 2000, rate: 5 });
  assert.equal(r.bill.total, 1575);
  assert.deepEqual(r.bill.payment_split, { advance: 1575 });
  assert.equal(r.r.advanceToWallet, 425);
  assert.equal(r.r.walletBalance, 425);
  assert.equal(await DBX.getWalletBalance(c), 425);
  const tx = (await DBX.getWalletTxns(c))[0];
  assert.deepEqual([tx.kind, tx.method, tx.amount, tx.note], ['topup', 'advance', 425, `Unused advance from booking #${apt}`]);
  assert.equal((await DB.getAppointment(apt)).advance_used, 2000);
  const t1 = await DBX.getCashTally(today);
  for (const k of ['expected_cash', 'wallet_topups_cash', 'cash_sales']) assert.equal(M.round2(t1[k] - t0[k]), 0, k);
  assert.equal(M.round2(t1.received.upi - t0.received.upi), 0, 'not received again');
  const pl1 = await DB.getPLSummary(today, today);
  assert.equal(M.round2(pl1.revenue - pl0.revenue), 1500, 'only the bill is revenue');
  const g1 = await DB.getGSTReport(new Date().getFullYear(), new Date().getMonth() + 1);
  assert.equal(M.round2(g1.summary.totalTaxCollected - g0.summary.totalTaxCollected), 75);
  assert.ok(!(await DBX.getAdvancesToRefund()).some((x) => x.id === apt));
  // void → wallet debited, advance back on the appointment
  await DB.voidBill(r.r.billId, 'redo');
  assert.equal(await DBX.getWalletBalance(c), 0);
  const back = await DB.getAppointment(apt);
  assert.equal(back.advance_used, 0); assert.equal(back.converted_to_bill, 0);
  // spent wallet credit blocks the void
  const r2 = await screenBill({ client: c, items: [sA({ price: 1000 })], appointmentId: apt, aptAdvance: 2000 });
  assert.equal(r2.r.advanceToWallet, 1000);
  await screenBill({ client: c, items: [sA({ price: 600 })], walletBal: 1000, useWallet: true });
  await assert.rejects(DB.voidBill(r2.r.billId, 'x'), /already spent the unused advance/);
  // walk-in (no client): nothing to a wallet, listed for refund
  const [s2, e2] = uniqTime();
  const w = Number(await DB.addAppointment({ client_id: 0, staff_id: 0, date: tomorrow, start_time: s2, end_time: e2, advance_amount: 800, advance_method: 'cash' }));
  const rw = await screenBill({ client: 0, items: [sA()], appointmentId: w, aptAdvance: 800 });
  assert.equal(rw.r.advanceToWallet, 0);
  assert.equal((await DBX.getAdvancesToRefund()).find((x) => x.id === w).amount, 300);
  const t2 = await DBX.getCashTally(today);
  await DBX.markAdvanceRefunded(w, 'cash');
  assert.equal(M.round2((await DBX.getCashTally(today)).expected_cash - t2.expected_cash), -300);
});

// ── 7. Backup round trip (last: it rewrites the database) ──────────────────
run('7 backup export → wipe → import preserves every table (wallet, notes, queue, day close, packages); logins kept; junk ignored', async () => {
  const c = await newClient('Backup Bhavna');
  await DBX.walletTopUp(c, 1000, 'cash', 100);
  await DBX.addClientNote({ client_id: c, kind: 'formula', text: '6.0 + 20vol' });
  const u = await DB.authCreateUser({ username: 'owner7', display_name: 'O', pin: '1357', role: 'owner', is_owner: true });
  assert.equal(u.ok, true);
  const json = JSON.parse(await DB.exportAllData());
  assert.equal(json.format, SCHEMA.BACKUP_FORMAT_VERSION);
  const counts = {};
  for (const t of SCHEMA.BACKUP_TABLES) counts[t] = (json[t] || []).length;
  for (const t of ['client_wallet_txns', 'client_notes', 'walkin_queue', 'day_close', 'memberships', 'client_memberships', 'bills', 'due_payments', 'appointments']) {
    assert.ok(counts[t] > 0, `${t} has rows in the backup`);
  }
  const usersBefore = (await DB.authListUsers()).map((x) => x.username).sort();
  const liab = await DBX.getWalletLiability();
  const pkgLiab = await DB.getPackageLiability();
  const billsBefore = (await DB.getBills()).map((b) => [b.bill_number, b.total, b.payment_status, JSON.stringify(b.payment_split)]);
  // junk the restore must ignore
  json.evil_table = [{ id: 1 }];
  json.client_wallet_txns[0]['amount"); DROP TABLE clients; --'] = 1;
  json.day_close[0].hacked = 'x';
  json.app_users = [{ id: 999, username: 'intruder', pin_hash: 'x', pin_salt: 'y', is_owner: 1, role: 'owner' }];
  await DBX.wipeBusinessData();
  assert.equal(await DBX.getWalletBalance(c), 0);
  const res = await DB.importData(JSON.stringify(json));
  assert.equal(res.success, true, res.message);
  const raw = globalThis.__sbxDb;
  for (const t of SCHEMA.BACKUP_TABLES) {
    if (t === 'app_users') continue;
    const n = (await raw.getFirstAsync(`SELECT COUNT(*) AS n FROM "${t}"`)).n;
    const expected = t === 'settings' ? n : counts[t];
    assert.equal(n, expected, `${t} row count`);
  }
  assert.deepEqual(await DBX.getWalletLiability(), liab);
  assert.deepEqual(await DB.getPackageLiability(), pkgLiab);
  assert.equal(await DBX.getWalletBalance(c), 1100);
  assert.equal((await DBX.listClientNotes(c))[0].text, '6.0 + 20vol');
  assert.deepEqual((await DB.getBills()).map((b) => [b.bill_number, b.total, b.payment_status, JSON.stringify(b.payment_split)]), billsBefore);
  assert.deepEqual((await DB.authListUsers()).map((x) => x.username).sort(), usersBefore, 'this phone\'s logins kept by default');
  assert.ok(await raw.getFirstAsync("SELECT 1 AS x FROM sqlite_master WHERE name='clients'"), 'clients table intact');
  assert.ok(res.warnings.some((w) => /client_wallet_txns/.test(w)));
  // numbering continues after the restore (counters travelled in settings)
  const after = await screenBill({ client: c, items: [sA()] });
  assert.ok(!billsBefore.some((b) => b[0] === after.r.billNumber), 'no duplicate invoice number after restore');
});

run('document title: Tax Invoice only with GSTIN and GST; Bill of Supply; plain Bill', () => {
  const t = INV.documentTitle;
  assert.equal(t({ tax_amount: 25 }, { gst_number: '27ABCDE1234F1Z5' }), 'Tax Invoice');
  assert.equal(t({ tax_amount: 0 }, { gst_number: '27ABCDE1234F1Z5' }), 'Bill of Supply');
  assert.equal(t({ tax_amount: 0 }, { gst_number: '' }), 'Bill');
  assert.equal(t({ tax_amount: 25 }, {}), 'Bill');
  assert.equal(t({ tax_amount: -25, payment_status: 'credit_note' }, { gst_number: '27ABCDE1234F1Z5' }), 'Credit Note');
});
