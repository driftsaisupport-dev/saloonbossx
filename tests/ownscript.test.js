/** Owner's own script (not the shared cloud): one salon only, old links stay safe. */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const gas = require('./helpers/gasMock');

function salon(chainId, branchId = 'br01') {
  const secret = crypto.randomBytes(32).toString('hex');
  return {
    secret,
    async call(action, payload, extra = {}) {
      const body = JSON.stringify(payload);
      const ts = Date.now();
      const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      const sig = crypto.createHmac('sha256', secret).update(`${action}|${chainId}|${branchId}|${ts}|${digest}`).digest('hex');
      return (await gas.fetch('x', { body: JSON.stringify({ action, chainId, branchId, ts, sig, payload: body, ...extra }) })).json();
    },
  };
}

test('own script: second salon refused, so an old ?book=<branch> link cannot be hijacked', async () => {
  const owner = salon('owner0001aa', 'br01');
  assert.equal((await owner.call('hello', { chainName: 'Mine' }, { claimSecret: owner.secret })).ok, true);
  assert.ok(Object.keys(gas.sheets).length === 1, 'own script still gets its Sheet dashboard');
  await owner.call('push_booking', { enabled: true, salonName: 'Real Salon', services: [{ key: 'k', name: 'Cut', price: 1, duration: 30 }], staff: [], hours: { open: '10:00', close: '20:00', closedDays: [] }, slot: 30, leadMin: 0, maxDays: 7, busy: {} });

  const attacker = salon('aaaa0000aa', 'br01');
  const r = await attacker.call('hello', { hosted: true }, { claimSecret: attacker.secret });
  assert.equal(r.error, 'taken', 'cannot add a second salon to an owner script, even claiming "hosted"');
  assert.match(gas.ctx.doGet({ parameter: { book: 'br01' } }).title, /Real Salon/, 'old bare link still opens the real salon');
  assert.match(gas.ctx.doGet({ parameter: { book: 'owner0001aa-br01' } }).title, /Real Salon/, 'new-style link works too');
});
