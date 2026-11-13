import test from 'node:test';
import assert from 'node:assert/strict';
import { FINANCE_INSTITUTIONS, checkFinanceIntent, assertDisabledFinanceCatalog } from './manifest.mjs';

test('all seven financial institutions remain unverified and disabled', () => {
  assert.equal(assertDisabledFinanceCatalog(), true);
  assert.equal(new Set(FINANCE_INSTITUTIONS.map(x => x.id)).size, 7);
});
test('real account reads are unavailable, not granted, for every institution', () => {
  for (const entry of FINANCE_INSTITUTIONS) {
    for (const capability of ['accounts.read', 'balances.read', 'transactions.read']) {
      assert.deepEqual(checkFinanceIntent({ institutionId: entry.id, capability }),
        { status: 'unavailable', liveAllowed: false });
    }
  }
});
test('mutating, unsupported and unknown operations deny without I/O', () => {
  for (const capability of ['payments.send', 'transfers.create', 'accounts.write',
    'transactions.delete', 'credentials.read', 'GET /withdraw', '']) {
    assert.deepEqual(checkFinanceIntent({ institutionId: 'paypal', capability }),
      { status: 'denied', liveAllowed: false });
  }
  assert.deepEqual(checkFinanceIntent({ institutionId: 'unknown', capability: 'balances.read' }),
    { status: 'unsupported', liveAllowed: false });
});
test('unverified additions are rejected by catalog invariant', () => {
  const candidate = FINANCE_INSTITUTIONS.map(entry => ({ ...entry }));
  candidate[0].liveConnection = 'enabled';
  assert.throws(() => assertDisabledFinanceCatalog(candidate));
});
