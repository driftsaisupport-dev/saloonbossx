/**
 * Universal edition: countries, currency, phones, tax and prices.
 * Imports the TypeScript sources directly (Node 22.18+ type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let R, P;
try { R = await import('../src/config/regions.ts'); P = await import('../src/services/licensePlans.ts'); } catch (e) { R = null; P = null; }
const run = (name, fn) => test(name, { skip: R ? false : 'needs Node 22.18+' }, fn);

run('every region is complete and sold in a priced currency', () => {
  const codes = new Set();
  for (const r of R.REGIONS) {
    assert.ok(!codes.has(r.code), `duplicate ${r.code}`); codes.add(r.code);
    for (const k of ['name', 'flag', 'currency', 'symbol', 'locale']) assert.ok(r[k], `${r.code}.${k}`);
    assert.ok(r.tax.name && r.tax.idLabel && r.tax.presets.length, `${r.code} tax`);
    assert.ok(r.pay.label && r.pay.fieldLabel, `${r.code} pay`);
    assert.ok(r.phoneLen[0] <= r.phoneLen[1], `${r.code} phone length`);
    assert.ok(P.MONTHLY_PRICE_BOOK[r.currency], `${r.code}: ${r.currency} has a price list`);
    assert.ok(R.SALON_PRICE_FACTOR[r.currency], `${r.code}: ${r.currency} has a salon price factor`);
  }
  assert.ok(R.REGIONS.length >= 39, '38 countries + rest of world');
});

run('India keeps working exactly as before', () => {
  const IN = R.setRegion('IN');
  assert.equal(R.normalisePhone('+91 98765 43210'), '9876543210');
  assert.equal(R.normalisePhone('09876543210'), '9876543210');
  assert.equal(R.normalisePhone('12345'), '');
  assert.equal(R.normalisePhone('5876543210'), '', 'Indian mobiles start 6–9');
  assert.equal(R.internationalPhone('9876543210'), '919876543210');
  assert.equal(R.fmtCompact(150000), '₹1.5L');
  assert.equal(R.fmtCompact(25000000), '₹2.5Cr');
  assert.equal(R.fmtMoney(123456), '₹1,23,456');
  assert.ok(R.splitsTax(), 'CGST + SGST');
  assert.ok(R.usesUpi());
  assert.ok(R.validTaxId('27ABCDE1234F1Z5'));
  assert.ok(!R.validTaxId('27ABCDE'));
  assert.equal(R.localPrice(300), 300);
  assert.equal(R.priceRoundStep(), 10);
  assert.equal(IN.tax.name, 'GST');
});

run('United Kingdom: £, VAT, 07… mobiles, no CGST split', () => {
  R.setRegion('GB');
  assert.equal(R.curSym(), '£');
  assert.equal(R.normalisePhone('07700 900123'), '7700900123');
  assert.equal(R.normalisePhone('+44 7700 900123'), '7700900123');
  assert.equal(R.internationalPhone('7700900123'), '447700900123');
  assert.equal(R.normalisePhone('+91 98765 43210'), '+919876543210', 'a tourist keeps their own country code');
  assert.equal(R.internationalPhone('+919876543210'), '919876543210');
  assert.equal(R.fmtCompact(150000), '£150K');
  assert.equal(R.fmtCompact(2500000), '£2.5M');
  assert.equal(R.taxName(), 'VAT');
  assert.ok(!R.splitsTax());
  assert.ok(!R.usesUpi());
  assert.equal(R.localPrice(300), 24, '₹300 haircut ≈ £24 on a London menu');
  assert.equal(R.priceRoundStep(), 1);
});

run('United States, UAE, Brazil, Kenya phones', () => {
  R.setRegion('US');
  assert.equal(R.normalisePhone('(415) 555-0132'), '4155550132');
  assert.equal(R.normalisePhone('+1 415 555 0132'), '4155550132');
  assert.equal(R.internationalPhone('4155550132'), '14155550132');
  R.setRegion('AE');
  assert.equal(R.normalisePhone('050 123 4567'), '501234567');
  assert.equal(R.internationalPhone('501234567'), '971501234567');
  R.setRegion('BR');
  assert.equal(R.normalisePhone('(11) 91234-5678'), '11912345678');
  R.setRegion('KE');
  assert.equal(R.normalisePhone('0712 345678'), '712345678');
  assert.equal(R.payLabel(), 'M-Pesa');
  R.setRegion('IN');
});

run('detects the country from the phone locale', () => {
  assert.equal(R.detectRegionCode('en-GB'), 'GB');
  assert.equal(R.detectRegionCode('pt_BR'), 'BR');
  assert.equal(R.detectRegionCode('en-IN'), 'IN');
  assert.equal(R.detectRegionCode('is-IS'), 'XX', 'unknown country → rest of world (US$)');
  assert.equal(R.regionForSymbol('₹'), 'IN');
  assert.equal(R.regionForSymbol('£'), 'GB');
});

run('subscription prices: monthly and yearly in local currency, yearly = 2 months free', () => {
  const usd = P.pricesFor('USD');
  assert.deepEqual([usd.solo.monthly, usd.standard.monthly, usd.multi.monthly, usd.academy.monthly], [19, 39, 99, 59]);
  assert.equal(usd.standard.yearly, 390);
  assert.equal(P.pricesFor('INR').standard.yearly, 9990);
  assert.equal(P.priceOf('standard', 'monthly', 'GBP'), 32);
  assert.equal(P.currencyOfPrices('ISK'), 'USD', 'unpriced currency falls back to US$');
  assert.deepEqual(P.SHOWN_BILLINGS, ['monthly', 'yearly']);
});

run('European number format: 1.234,5', () => {
  R.setRegion('DE');
  assert.equal(R.fmtMoney(1234.5), '€1.234,5');
  R.setRegion('IN');
});

test('booking server accepts local mobiles for the salon country and keeps India strict', () => {
  const gas = require('./helpers/gasMock.js');
  const f = gas.ctx.bookingPhone_;
  assert.equal(f({}, '+91 98765 43210'), '9876543210', 'old profiles (no dial) are India');
  assert.equal(f({}, '12345678'), '');
  const uk = { dial: '44', phoneLen: [10, 10] };
  assert.equal(f(uk, '07700 900123'), '7700900123');
  assert.equal(f(uk, '+44 7700 900123'), '7700900123');
  assert.equal(f(uk, '+1 415 555 0132'), '+14155550132');
  assert.equal(f(uk, '123'), '');
  assert.equal(gas.ctx.tzMin_({ tzMin: 60 }), 60);
  assert.equal(gas.ctx.tzMin_({}), 330);
});
