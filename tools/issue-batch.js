#!/usr/bin/env node
/**
 * Pre-generate a stock of keys as a CSV for the "Keys Master" tab of your
 * "SaloonBossX Licenses" Google Sheet (File → Import → Append to current sheet).
 *
 *   npm run batch -- --plan standard --billing yearly --count 50
 *   npm run batch -- --all                       (every plan × monthly + one-time, 20 each)
 *
 * After each sale: take the next AVAILABLE row of that plan + billing, fill in
 * Customer Name / Phone / Sale Date / Amount Paid, send the key on WhatsApp.
 */
const fs = require('fs');
const path = require('path');
const { makeKey, loadSecret, sheetExpiry, PRICES, DEVICES, PLANS, BILLINGS, PLAN_NAME } = require('./lib/sign');

const args = process.argv.slice(2);
const arg = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : f; };
const CODE = { solo: 'SO', standard: 'SP', multi: 'CH', academy: 'AC' };
const BCODE = { monthly: 'M', yearly: 'Y', lifetime: 'L' };

try {
  const sk = loadSecret();
  const all = args.includes('--all');
  const count = Math.min(1000, Number(arg('count', all ? '20' : '50')) || 50);
  const combos = all ? PLANS.flatMap(p => ['monthly', 'lifetime'].map(b => [p, b])) : [[arg('plan', 'standard'), arg('billing', 'lifetime')]];
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const header = ['#', 'License Key', 'Plan', 'Price', 'Expiry', 'Max Devices', 'Status', 'Devices Used', 'Device IDs', 'Customer Name', 'Customer Phone', 'Customer Email', 'Sale Date', 'Amount Paid', 'Notes', 'Billing'];
  const rows = [header];
  let n = 0;
  for (const [plan, billing] of combos) {
    for (let i = 1; i <= count; i++) {
      const order = `${CODE[plan]}${BCODE[billing]}-${stamp}-${String(i).padStart(4, '0')}`;
      const { key, payload } = makeKey(sk, { plan, billing, order });
      rows.push([++n, key, plan, PRICES[plan][billing], sheetExpiry(payload), DEVICES[plan], 'AVAILABLE', 0, '', '', '', '', '', '', `${PLAN_NAME[plan]} · Order ${order}`, billing[0].toUpperCase() + billing.slice(1)]);
    }
  }
  const out = path.join(__dirname, '..', 'keys', `keys-${all ? 'all' : combos[0].join('-')}-${stamp}-${Date.now() % 100000}.csv`);
  fs.writeFileSync(out, rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), { mode: 0o600 });
  console.log(`\n${n} keys → ${path.relative(process.cwd(), out)}\nInside keys/ (never commit). Treat it like cash.\n`);
} catch (e) { console.error('\n✖ ' + e.message + '\n'); process.exit(1); }
