/**
 * Database layer against a REAL SQLite engine (node:sqlite) with Expo modules
 * mocked (tests/helpers/expo). Exercises the money paths end to end:
 * createBill / voidBill / stock / wallet / packages / dues / appointments /
 * restore / login lockout. Skipped on Node versions without node:sqlite.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

let DB, DBX;
try {
  await import('node:sqlite');
  register(new URL('./helpers/expo/hooks.mjs', import.meta.url));
  globalThis.__DEV__ = false;
  ({ DatabaseService: DB, DBX } = await import('../src/database/Database.ts'));
  await DB.initialize();
} catch (e) {
  test('db integration (needs node:sqlite + type stripping)', { skip: String(e?.message || e).slice(0, 120) }, () => {});
}
const run = DB ? test : test.skip;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = ymd(new Date(Date.now() + 86400000));

let svc, client, prod, staff;
const item = (o = {}) => ({ type: 'service', id: svc, name: 'Haircut', price: 500, qty: 1, ...o });
const bill = (o = {}) => ({ client_id: client, staff_id: staff, items: [item()], subtotal: 500, tax_amount: 0, discount_amount: 0, total: 500, payment_method: 'cash', ...o });

run('initialises the full schema at the latest version, new installs at 5% GST', async () => {
  const p = await DB.getSalonProfile();
  assert.equal(p.tax_rate, 5);
  // GST is OFF on a new install: the owner must turn it on.
  assert.equal(await DB.getSetting('gst_enabled'), 'false');
  await DB.updateSalonProfile({ tax_rate: 18 });
  assert.equal((await DBX.getGstAdvice()).show, false, 'no GST advice for a salon that does not charge GST');
  await DB.updateSalonProfile({ tax_rate: 5 });
  await DB.setSetting('gst_enabled', 'true');
  const adv = await DBX.getGstAdvice();
  assert.deepEqual(adv, { currentRate: 5, recommendedRate: 5, show: false });
  await DB.updateSalonProfile({ tax_rate: 18 });
  assert.equal((await DBX.getGstAdvice()).show, true);
  await DBX.dismissGstAdvice();
  assert.equal((await DBX.getGstAdvice()).show, false);
  await DB.updateSalonProfile({ tax_rate: 5 });
  svc = Number(await DB.addService({ name: 'Haircut', price: 500, duration: 30 }));
  client = Number(await DB.addClient({ name: 'Priya', phone: '9876543210' }));
  prod = Number(await DB.addInventoryItem({ name: 'Shampoo', quantity: 3, sell_price: 300, min_stock: 1 }));
  staff = Number(await DB.addStaff({ name: 'Rahul' }));
});

run('GST is opt-in: with GST turned off a bill carrying GST is refused, a plain bill is fine', async () => {
  await DB.setSetting('gst_enabled', 'false');
  await assert.rejects(
    DB.createBill(bill({ subtotal: 500, tax_amount: 25, total: 525, tax_rate: 5 })),
    /GST is turned off/);
  const ok = await DB.createBill(bill());
  assert.ok(ok.billId > 0);
  const b = await DB.getBillById?.(ok.billId) ?? null;
  if (b) assert.equal(Number(b.tax_amount), 0);
  await DB.setSetting('gst_enabled', 'true');
});

run('product stock is deducted inside the bill; shortage refuses the bill without burning a number', async () => {
  const items = [item(), { type: 'product', id: prod, name: 'Shampoo', price: 300, qty: 2 }];
  const r = await DB.createBill(bill({ items, subtotal: 1100, total: 1100 }));
  assert.equal(r.stockHandled, true);
  assert.equal((await DBX.getInventoryItem(prod)).quantity, 1);
  assert.equal(await DB.deductStock(prod, 2), true, 'legacy follow-up call absorbed');
  assert.equal((await DBX.getInventoryItem(prod)).quantity, 1, 'not deducted twice');
  await assert.rejects(DB.createBill(bill({ items: [{ type: 'product', id: prod, name: 'Shampoo', price: 300, qty: 5 }], subtotal: 1500, total: 1500 })), /Only 1 left of Shampoo/);
  const n1 = Number(r.billNumber.split('/').pop());
  const r2 = await DB.createBill(bill());
  assert.equal(Number(r2.billNumber.split('/').pop()), n1 + 1, 'no gap in the series');
  assert.equal(await DB.deductStock(prod, 5), false, 'deductStock never goes below zero');
  // void restores exactly what this bill took
  await DB.voidBill(r.billId, 'test');
  assert.equal((await DBX.getInventoryItem(prod)).quantity, 3);
});

run('concurrent bills get distinct consecutive numbers (write lock)', async () => {
  const rs = await Promise.all([1, 2, 3, 4].map(() => DB.createBill(bill())));
  const nums = rs.map((r) => Number(r.billNumber.split('/').pop())).sort((a, b) => a - b);
  assert.equal(new Set(nums).size, 4);
  assert.equal(nums[3] - nums[0], 3);
});

run('bill integrity: totals must add up; loyalty checked against the real balance', async () => {
  await assert.rejects(DB.createBill(bill({ total: 400 })), /does not match/);
  await assert.rejects(DB.createBill(bill({ subtotal: 900, total: 900 })), /subtotal/);
  const c = await DB.getClient(client);
  await assert.rejects(DB.createBill(bill({ loyalty_points_used: c.loyalty_points + 10, loyalty_discount: c.loyalty_points + 10, total: 500 - c.loyalty_points - 10 })), /loyalty points/);
});

run('credit notes: own series, cannot be voided, cancelled bills cannot be voided twice', async () => {
  const r = await DB.createBill(bill());
  const v = await DB.voidBill(r.billId, 'wrong');
  assert.match(v.creditNoteNumber, /\/CN-\d\d-\d\d\/\d{5}$/);
  await assert.rejects(DB.voidBill(r.billId, 'again'), /already cancelled/);
  await assert.rejects(DB.voidBill(v.creditNoteId, 'x'), /credit note cannot be cancelled/i);
  const next = await DB.createBill(bill());
  assert.equal(Number(next.billNumber.split('/').pop()), Number(r.billNumber.split('/').pop()) + 1, 'CN did not consume an invoice number');
});

run('wallet: top-up with bonus, spend on a bill, refund on void, liability', async () => {
  const t = await DBX.walletTopUp(client, 5000, 'cash', 500, 'Diwali offer');
  assert.equal(t.balance, 5500);
  await assert.rejects(DB.createBill(bill({ wallet_used: 6000, subtotal: 6000, total: 6000, items: [item({ price: 6000 })] })), /wallet has only/);
  const r = await DB.createBill(bill({ wallet_used: 300 }));
  assert.equal(r.walletBalance, 5200);
  const b = await DB.getBill(r.billId);
  assert.deepEqual(b.payment_split, { cash: 200, wallet: 300 });
  await DB.voidBill(r.billId, 'refund');
  assert.equal(await DBX.getWalletBalance(client), 5500);
  assert.deepEqual(await DBX.getWalletLiability(), { clients: 1, amount: 5500 });
  await assert.rejects(DBX.walletAdjust(client, -6000, 'oops'), /wallet has only/);
  assert.equal((await DBX.walletAdjust(client, -500, 'remove bonus')).balance, 5000);
  const tx = await DBX.getWalletTxns(client);
  assert.deepEqual(tx.map((x) => x.kind), ['adjust', 'refund', 'spend', 'bonus', 'topup']);
});

run('pay later: points on money paid now, the rest when collected; double collect refused', async () => {
  await DB.setSetting('loyalty_points_per_100', '10');
  const before = (await DB.getClient(client)).loyalty_points;
  const r = await DB.createBill(bill({ items: [item({ price: 1000 })], subtotal: 1000, total: 1000, payment_method: 'due', payment_split: { cash: 200 } }));
  assert.equal(r.amountDue, 800);
  assert.equal(r.pointsEarned, 20);
  const [a, b2] = await Promise.all([DBX.collectDue(r.billId, 800, 'upi'), DBX.collectDue(r.billId, 800, 'upi')]);
  assert.equal([a.ok, b2.ok].filter(Boolean).length, 1, 'only one collection succeeds');
  assert.equal((await DB.getClient(client)).loyalty_points - before, 100);
});

run('packages: sell, cover a line, void restores the session', async () => {
  await DB.addMembership({ name: 'Cut x3', price: 1200, max_sessions: 3, service_id: svc, duration_days: 90 });
  const m = (await DB.getMemberships()).find((x) => x.name === 'Cut x3');
  const sale = await DB.assignMembership(client, m.id, { paidAmount: 1200, method: 'cash' });
  assert.equal(sale.ok, true, sale.message);
  assert.ok(sale.billNumber);
  const [pkg] = await DB.getClientActivePackages(client);
  assert.equal(pkg.remaining_sessions, 3);
  const r = await DB.createBill(bill({ items: [item({ price: 0, package_cm_id: pkg.id })], subtotal: 0, total: 0 }));
  assert.equal((await DB.getClientActivePackages(client))[0].remaining_sessions, 2);
  await DB.voidBill(r.billId, 'x');
  assert.equal((await DB.getClientActivePackages(client))[0].remaining_sessions, 3);
  await assert.rejects(DB.createBill(bill({ items: [item({ id: 9999, name: 'Facial', price: 0, package_cm_id: pkg.id })], subtotal: 0, total: 0 })), /only be used for its own service/);
  // value package (template with no sessions/value → worth its price)
  await DB.addMembership({ name: 'Gift 2000', price: 2000 });
  const g = (await DB.getMemberships()).find((x) => x.name === 'Gift 2000');
  await DB.assignMembership(client, g.id);
  const gp = (await DB.getClientActivePackages(client)).find((p) => p.name === 'Gift 2000');
  assert.equal(gp.remaining_value, 2000);
  await DB.createBill(bill({ items: [item({ price: 0, list_price: 500, package_cm_id: gp.id })], subtotal: 0, total: 0 }));
  assert.equal((await DB.getClientActivePackages(client)).find((p) => p.name === 'Gift 2000').remaining_value, 1500);
});

run('appointments: impossible / past dates refused, clashes, billed once, advance, reschedule keeps duration, no-shows', async () => {
  await assert.rejects(DB.addAppointment({ client_id: client, staff_id: staff, date: '2026-02-31', start_time: '10:00', end_time: '10:30' }), /not a real date/);
  await assert.rejects(DB.addAppointment({ client_id: client, staff_id: staff, date: '2020-01-01', start_time: '10:00', end_time: '10:30' }), /already passed/);
  const id = Number(await DB.addAppointment({ client_id: client, staff_id: staff, date: tomorrow, start_time: '10:00', end_time: '10:45', advance_amount: 200, advance_method: 'upi' }));
  await assert.rejects(DB.addAppointment({ client_id: client, staff_id: staff, date: tomorrow, start_time: '10:30', end_time: '11:00' }), /CONFLICT: Rahul is already booked at 10:00/);
  const other = Number(await DB.addAppointment({ client_id: client, staff_id: staff, date: tomorrow, start_time: '12:00', end_time: '12:30' }));
  await assert.rejects(DBX.rescheduleAppointment(other, tomorrow, '10:15', ''), /Rahul is already booked at 10:00/);
  await DBX.rescheduleAppointment(other, tomorrow, '15:00', '');
  const moved = (await DB.getAppointments(tomorrow)).find((a) => a.id === other);
  assert.equal(moved.end_time, '15:30', 'duration preserved');
  await assert.rejects(DB.createBill(bill({ appointment_id: id, advance_adjusted: 300 })), /advance is left/);
  const r = await DB.createBill(bill({ appointment_id: id, advance_adjusted: 200 }));
  assert.deepEqual((await DB.getBill(r.billId)).payment_split, { cash: 300, advance: 200 });
  await assert.rejects(DB.createBill(bill({ appointment_id: id })), /This appointment is already billed/);
  await DB.updateAppointmentStatus(other, 'no_show');
  assert.equal((await DB.getClient(client)).no_show_count, 1);
  await DB.updateAppointmentStatus(other, 'confirmed');
  assert.equal((await DB.getClient(client)).no_show_count, 0);
});

run('cash tally / day close and end-of-day cash figures', async () => {
  const today = ymd(new Date());
  const t = await DBX.getCashTally(today);
  assert.ok(t.wallet_topups_cash >= 5000);
  assert.equal(t.expected_cash, Math.round((t.opening_cash + t.cash_sales - t.cash_refunds + t.cash_dues + t.wallet_topups_cash + t.advances_cash - t.cash_expenses) * 100) / 100);
  const closed = await DBX.saveDayClose(today, t.expected_cash - 10, 'short 10', 'owner');
  assert.equal(closed.difference, -10);
  const eod = await DB.getEndOfDayReport(today);
  assert.equal(eod.expectedDrawer, t.expected_cash);
  assert.equal(typeof eod.netCashOnly, 'number');
  const reg = await DBX.getCashRegister(today);
  assert.equal(reg.closing, t.expected_cash);
});

run('queue tokens and consultation notes', async () => {
  const a = await DBX.queueAdd({ client_name: 'Walk-in A' });
  const b = await DBX.queueAdd({ client_name: 'Walk-in B' });
  assert.equal(b.token_no, a.token_no + 1);
  await DBX.queueSetStatus(a.id, 'serving', staff);
  await DBX.queueSetStatus(a.id, 'done');
  const st = await DBX.queueStats();
  assert.equal(st.done, 1); assert.equal(st.waiting, 1);
  const nid = await DBX.addClientNote({ client_id: client, kind: 'allergy', text: 'PPD' });
  assert.match((await DB.getClient(client)).allergies, /PPD/);
  await assert.rejects(DBX.addClientNote({ client_id: client, kind: 'photo', photo_uri: '/etc/passwd' }), /savePhoto/);
  assert.equal((await DBX.listClientNotes(client)).length, 1);
  assert.equal(await DBX.deleteClientNote(nid), true);
});

run('login lockout covers PIN, lock screen and recovery answers', async () => {
  const u = await DB.authCreateUser({ username: 'owner1', display_name: 'O', pin: '1234', role: 'owner', is_owner: true, recovery_question: 'pet?', recovery_answer: 'Tommy' });
  assert.equal(u.ok, true);
  for (let i = 0; i < 4; i++) assert.equal(await DBX.authVerifyPin(u.id, '0000'), false);
  assert.equal(await DBX.authVerifyRecovery(u.id, 'wrong'), false);
  const st = await DBX.authLockStatus(u.id);
  assert.equal(st.locked, true);
  assert.equal(await DBX.authVerifyPin(u.id, '1234'), false, 'correct PIN refused while locked');
  assert.match((await DBX.authLogin('owner1', '1234')).message, /Locked|Try again/);
  assert.equal((await DBX.authRecoverPin(u.id, 'Tommy', '5678')).ok, false, 'recovery also locked');
});

run('restore: unknown/crafted columns dropped, local logins kept, all-or-nothing', async () => {
  const json = JSON.parse(await DB.exportAllData());
  assert.equal(json.format, 6);
  const usersBefore = (await DB.authListUsers()).length;
  json.clients[0]['name"); DROP TABLE bills; --'] = 'x';
  json.clients[0].future_column = 1;
  json.app_users = [{ id: 999, username: 'evil', pin_hash: 'x', pin_salt: 'y', is_owner: 1, role: 'owner' }];
  const res = await DB.importData(JSON.stringify(json));
  assert.equal(res.success, true, res.message);
  assert.ok((await DB.getBills()).length > 0, 'bills survived');
  const users = await DB.authListUsers();
  assert.equal(users.length, usersBefore);
  assert.ok(!users.some((x) => x.username === 'evil'));
  // a damaged file changes nothing
  const bad = JSON.parse(await DB.exportAllData());
  bad.bills = [{ id: 1, bill_number: null }];
  const countBefore = (await DB.getBills()).length;
  const r2 = await DB.importData(JSON.stringify(bad));
  assert.equal(r2.success, false);
  assert.equal((await DB.getBills()).length, countBefore);
});

run('net-of-GST revenue for P&L and commission', async () => {
  await DB.updateStaff(staff, { commission_rate: 10 });
  const s2 = Number(await DB.addStaff({ name: 'Gst Test', commission_rate: 10 }));
  await DB.createBill({ client_id: 0, staff_id: s2, items: [item({ price: 1000 })], subtotal: 1000, tax_amount: 50, total: 1050, payment_method: 'cash' });
  const today = ymd(new Date());
  const perf = (await DB.getStaffPerformance(today, today)).find((x) => x.id === s2);
  assert.equal(perf.total_revenue, 1000);
  assert.equal(perf.commission_earned, 100);
  const pl = await DB.getPLSummary(today, today);
  assert.ok(pl.gstCollected >= 50);
  const gst = await DB.getGSTReport(new Date().getFullYear(), new Date().getMonth() + 1);
  assert.equal(Math.round((gst.summary.totalCGST + gst.summary.totalSGST) * 100), Math.round(gst.summary.totalTaxCollected * 100));
});

run("v5.6: owner PIN guarded, staff PINs unique, paginated bills", async () => {
  const owner = await DB.authCreateUser({ username: 'owner56', display_name: 'O', pin: '1111', role: 'owner', is_owner: true });
  const mgr = await DB.authCreateUser({ username: 'mgr56', display_name: 'M', pin: '2222', role: 'manager' });
  assert.equal(owner.ok && mgr.ok, true);
  const refused = await DBX.authSetPin(owner.id, '3333', false, mgr.id);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /owner/i);
  assert.equal((await DBX.authSetPin(mgr.id, '4444', true, owner.id)).ok, true, 'owner may reset a manager');
  assert.equal((await DBX.authSetPin(owner.id, '5555', false, owner.id)).ok, true, 'owner may change own PIN');
  assert.equal((await DBX.authSetPin(owner.id, '6666')).ok, true, 'old callers (no actor) unchanged');

  const a = Number(await DB.addStaff({ name: 'Pin A', pin_code: '9191' }));
  await assert.rejects(DB.addStaff({ name: 'Pin B', pin_code: '9191' }), /already used by Pin A/);
  const b = Number(await DB.addStaff({ name: 'Pin B', pin_code: '9292' }));
  await assert.rejects(DB.updateStaff(b, { pin_code: '9191' }), /already used/);
  await DB.updateStaff(a, { pin_code: '9191', name: 'Pin A2' });
  assert.equal(Number(await DB.addStaff({ name: 'No pin 1' })) > 0 && Number(await DB.addStaff({ name: 'No pin 2' })) > 0, true, 'empty PINs never clash');

  const all = await DB.getBills();
  const p1 = await DBX.getBillsPage({ limit: 2, offset: 0 });
  assert.equal(p1.rows.length, Math.min(2, all.length));
  assert.equal(p1.hasMore, all.length > 2);
  assert.equal(p1.rows[0].items, undefined, 'no items JSON in list rows');
  const p2 = await DBX.getBillsPage({ limit: 2, offset: 2 });
  assert.ok(!p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)), 'pages do not overlap');
  const voids = await DBX.getBillsPage({ status: 'void', limit: 100 });
  assert.ok(voids.rows.every((r) => r.payment_status === 'cancelled' || r.payment_status === 'credit_note'));
  const today = ymd(new Date());
  const t = await DBX.getBillsPage({ from: today, to: today, limit: 500 });
  assert.ok(t.rows.every((r) => String(r.created_at).startsWith(today)));
});
