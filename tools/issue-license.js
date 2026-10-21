#!/usr/bin/env node
/**
 * Issue ONE licence key.
 *
 *   npm run issue -- --plan standard --billing yearly  --order UPI-1234
 *   npm run issue -- --plan solo     --billing monthly --order UPI-1235
 *   npm run issue -- --plan multi    --billing lifetime --order INV-77 --devices 5
 *   npm run issue -- --plan standard --days 14 --order TRIAL-9      (fixed-date trial)
 *
 * Monthly / yearly keys start counting when the customer activates them.
 */
const { makeKey, loadSecret, sheetExpiry, PRICES, PLAN_NAME } = require('./lib/sign');
const args = process.argv.slice(2);
const arg = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : f; };
try {
  const plan = arg('plan', 'standard'), billing = arg('billing', 'lifetime'), order = arg('order', '');
  if (!order) throw new Error('--order is required (your invoice / UPI reference), so the key can be traced and revoked.');
  const { key, payload } = makeKey(loadSecret(), { plan, billing, order, devices: arg('devices', ''), days: arg('days', '') });
  console.log('\n' + key + '\n');
  console.log(`plan     ${PLAN_NAME[plan]} (${plan})`);
  console.log(`billing  ${payload.b}   price ₹${PRICES[plan][billing] ?? '-'}`);
  console.log(`expiry   ${sheetExpiry(payload)}`);
  console.log(`order    ${order}\n`);
} catch (e) { console.error('\n✖ ' + e.message + '\n'); process.exit(1); }
