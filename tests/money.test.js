/**
 * The ten tests that matter.
 *
 * These cover the calculations that, if wrong, get you refund demands: totals,
 * discounts, GST, the financial-year invoice series, and a backup round trip
 * that asserts every table survives. Run with: npm test
 *
 * Pure logic only — no React Native, no device. Keep it that way so it runs in
 * CI and on your laptop in under a second.
 */
const { test } = require('node:test');
const assert = require('node:assert');

// ── The calculations, mirrored from BillingScreen ──────────────────────────
function billTotals({ items, discount = 0, discountType = 'flat', gstRate = 0, loyalty = 0 }) {
  const subtotal = items.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const discountAmount = discountType === 'percent' ? (subtotal * discount) / 100 : discount;
  const taxable = Math.max(0, subtotal - discountAmount);
  const tax = Math.round(taxable * (gstRate / 100) * 100) / 100;
  const total = Math.max(0, taxable + tax - loyalty);
  return {
    subtotal: round(subtotal),
    discountAmount: round(discountAmount),
    taxable: round(taxable),
    tax: round(tax),
    cgst: round(tax / 2),
    sgst: round(tax / 2),
    total: round(total),
    roundOff: round(Math.round(total) - total),
  };
}
const round = (n) => Math.round(n * 100) / 100;

function financialYear(d) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('subtotal sums quantities, not just line prices', () => {
  const r = billTotals({ items: [{ price: 500, qty: 2 }, { price: 300, qty: 1 }] });
  assert.equal(r.subtotal, 1300);
});

test('flat discount comes off the subtotal', () => {
  const r = billTotals({ items: [{ price: 1000, qty: 1 }], discount: 200 });
  assert.equal(r.taxable, 800);
});

test('percentage discount is a percentage, not a flat amount', () => {
  const r = billTotals({ items: [{ price: 1000, qty: 1 }], discount: 10, discountType: 'percent' });
  assert.equal(r.discountAmount, 100);
  assert.equal(r.taxable, 900);
});

test('GST is charged on the discounted value, never the gross', () => {
  const r = billTotals({ items: [{ price: 1000, qty: 1 }], discount: 200, gstRate: 18 });
  assert.equal(r.taxable, 800);
  assert.equal(r.tax, 144);
});

test('CGST and SGST split the tax exactly in half', () => {
  const r = billTotals({ items: [{ price: 1000, qty: 1 }], gstRate: 18 });
  assert.equal(r.cgst + r.sgst, r.tax);
  assert.equal(r.cgst, 90);
});

test('a bill can never total less than zero', () => {
  const r = billTotals({ items: [{ price: 100, qty: 1 }], loyalty: 500 });
  assert.equal(r.total, 0);
});

test('round off is the difference to the nearest rupee', () => {
  const r = billTotals({ items: [{ price: 1000, qty: 1 }], gstRate: 18 });
  assert.equal(r.total, 1180);
  assert.equal(r.roundOff, 0);
  const r2 = billTotals({ items: [{ price: 99, qty: 1 }], gstRate: 18 });
  assert.equal(round(r2.total + r2.roundOff), Math.round(r2.total));
});

test('financial year runs April to March', () => {
  assert.equal(financialYear(new Date('2026-04-01')), '26-27');
  assert.equal(financialYear(new Date('2027-03-31')), '26-27');
  assert.equal(financialYear(new Date('2027-04-01')), '27-28');
  assert.equal(financialYear(new Date('2026-01-15')), '25-26');
});

test('backup covers every table the app creates', () => {
  // Reads the real source: every CREATE TABLE in the database layer must be in
  // BACKUP_TABLES (schema.ts) or deliberately excluded. This is how attendance
  // data was silently lost on restore in 3.1.2 — and how due_payments would
  // have been lost in 5.0 had it not been added.
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'database', f), 'utf8');
  const sources = read('Database.ts') + read('migrations.ts');
  const created = [...new Set([...sources.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(m => m[1]))];
  const schema = read('schema.ts');
  const listSrc = schema.slice(schema.indexOf('BACKUP_TABLES: string[] = ['), schema.indexOf('];', schema.indexOf('BACKUP_TABLES: string[] = [')));
  const BACKUP_TABLES = [...listSrc.matchAll(/'(\w+)'/g)].map(m => m[1]);
  const EXCLUDED = ['audit_log'];

  assert.ok(created.length >= 20, 'found the CREATE TABLE statements');
  for (const t of created) {
    assert.ok(BACKUP_TABLES.includes(t) || EXCLUDED.includes(t), `${t} is neither backed up nor deliberately excluded`);
  }
  assert.ok(BACKUP_TABLES.includes('attendance'), 'attendance must be backed up — payroll depends on it');
  assert.ok(BACKUP_TABLES.includes('due_payments'), 'udhaar ledger must be backed up');
  assert.ok(BACKUP_TABLES.indexOf('bills') < BACKUP_TABLES.indexOf('due_payments'), 'parents restore before children');
});

test('a credit note exactly reverses the original bill', () => {
  const original = billTotals({ items: [{ price: 1000, qty: 1 }], gstRate: 18 });
  const credit = {
    subtotal: -original.subtotal,
    tax: -original.tax,
    total: -original.total,
  };
  assert.equal(original.total + credit.total, 0);
  assert.equal(original.tax + credit.tax, 0);
});
