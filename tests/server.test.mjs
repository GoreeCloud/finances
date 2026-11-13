import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createFinanceServer } from '../server/app.mjs';
import { makeVault } from '../server/vault.mjs';
import { backupVault, restoreVault } from '../cli/vault-backup.mjs';
import { makePlaid, centsFromProvider, applySync, matchesInstitution } from '../server/plaid.mjs';

async function setup(plaid) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'finances-test-'));
  const file = path.join(folder, 'private', 'vault.json');
  const app = createFinanceServer({ dataFile: file, plaid: plaid || makePlaid({}), port: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  let cookie = '', csrf = '';
  async function send(route, payload = {}, opts = {}) {
    const response = await fetch(base + '/api/' + route, { method: opts.method || 'POST', headers: {
      'content-type': 'application/json', 'x-gc-request': 'finances', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-gc-csrf': csrf } : {}), ...(opts.headers || {})
    }, ...(opts.method === 'GET' ? {} : { body: JSON.stringify(payload) }) });
    const value = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (value.csrf) csrf = value.csrf;
    return { code: response.status, value, response };
  }
  return { app, base, file, folder, send, setCookie(v) { cookie = v; }, setCsrf(v) { csrf = v; }, get cookie() { return cookie; }, get csrf() { return csrf; },
    async close() { await new Promise(resolve => app.server.close(resolve)); await rm(folder, { recursive: true, force: true }); } };
}
const PASS = 'A long unique sample passphrase!42';
const CSV = 'date,description,amount\n2026-11-01,Example income,123.45\n2026-11-02,Example expense,-2.00\n';

test('create one local account; unlock encrypted imports across login; no plaintext is stored', async t => {
  const h = await setup(); t.after(() => h.close());
  assert.equal((await h.send('status', {}, { method: 'GET' })).value.setupRequired, true);
  assert.equal((await h.send('setup', { username: 'owner_1', password: PASS })).code, 201);
  assert.equal((await h.send('setup', { username: 'another', password: PASS })).code, 409);
  assert.equal((await h.send('import', { institution: 'PayPal', label: 'Pocket', csv: 'bad,data\n' })).code, 400);
  const imported = await h.send('import', { institution: 'PayPal', label: 'Pocket', csv: CSV });
  assert.deepEqual([imported.code, imported.value.added], [200, 2]);
  const repeated = await h.send('import', { institution: 'PayPal', label: 'Pocket', csv: CSV });
  assert.equal(repeated.value.duplicates, 2);
  const dashboard = await h.send('dashboard');
  assert.equal(dashboard.value.totalTransactions, 2);
  assert.equal(dashboard.value.linkedItems, 0);
  assert.equal(dashboard.value.providers.length, 7);
  assert.equal(dashboard.value.providers.find(p => p.name === 'PayPal').importedRows, 2);
  const raw = await readFile(h.file, 'utf8');
  assert.ok(!raw.includes('Example income') && !raw.includes('123.45') && !raw.includes(PASS));
  assert.equal((await h.send('logout')).code, 200);
  assert.equal((await h.send('dashboard')).code, 401);
  assert.equal((await h.send('login', { username: 'owner_1', password: PASS })).code, 200);
  assert.equal((await h.send('dashboard')).value.totalTransactions, 2);
});

test('authentication rejects wrong password and missing CSRF and blocks host confusion', async t => {
  const h = await setup(); t.after(() => h.close());
  assert.equal((await h.send('setup', { username: 'owner_1', password: 'weak' })).code, 400);
  assert.equal((await h.send('setup', { username: 'owner_1', password: PASS })).code, 201);
  const csrf = h.csrf; h.setCsrf('wrong');
  assert.equal((await h.send('dashboard')).code, 403);
  h.setCsrf(csrf);
  assert.equal((await h.send('dashboard', {}, { headers: { origin: 'http://attacker.invalid' } })).code, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request(h.base + '/api/dashboard', { method: 'POST', headers: { host: 'evil.invalid', cookie: h.cookie,
      'x-gc-request': 'finances', 'x-gc-csrf': csrf, 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(hostStatus, 403);
  await h.send('logout');
  assert.equal((await h.send('login', { username: 'owner_1', password: 'bad-password!' })).code, 401);
  assert.equal((await h.send('login', { username: 'owner_1', password: PASS })).code, 200);
});

test('refresh on each opening requests linked provider, preserving errors and returning freshness notes', async t => {
  let calls = 0;
  const plaid = { enabled: true, paidBalance: false, paidTxRefresh: false,
    async createLinkToken() { return 'link-sandbox'; },
    async exchange() { return { itemId: 'item-1', accessToken: 'VERY_PRIVATE_SAMPLE' }; },
    async institution() { return { id: 'ins-test', name: 'PayPal' }; },
    async remove() {},
    async sync(item) { calls++; return { ...item, accounts: [{ id: 'account1', name: 'Wallet', mask: '0001', type: 'depository', currency: 'USD', currentCents: '5000' }],
      transactions: [{ id: 't1', accountId: 'account1', date: '2026-11-01', description: 'Example', cents: '100' }],
      lastChecked: new Date().toISOString(), lastProviderUpdate: '2026-11-13T00:00:00Z', lastError: null }; }
  };
  const h = await setup(plaid); t.after(() => h.close());
  await h.send('setup', { username: 'owner_1', password: PASS });
  const link = await h.send('link-token', { institution: 'PayPal' }); assert.equal(link.value.linkToken, 'link-sandbox');
  const connected = await h.send('connect', { institution: 'PayPal', publicToken: 'public-demo' });
  assert.equal(connected.value.connected, true);
  assert.equal(calls, 1);
  const refresh = await h.send('refresh'); assert.equal(refresh.value.successes, 1); assert.equal(calls, 2);
  const dash = await h.send('dashboard');
  assert.equal(dash.value.providers.find(x => x.name === 'PayPal').accounts[0].currentCents, '5000');
  assert.ok(!JSON.stringify(dash.value).includes('VERY_PRIVATE_SAMPLE'));
  assert.equal((await h.send('disconnect', { itemId: 'item-1' })).value.disconnected, true);
  assert.equal((await h.send('dashboard')).value.linkedItems, 0);
});

test('mismatched real institution is rejected and provider token revoked', async t => {
  let removed = 0;
  const plaid = { enabled: true, paidBalance: false, paidTxRefresh: false,
    async exchange() { return { itemId: 'item-2', accessToken: 'sample' }; },
    async institution() { return { id: 'ins-1', name: 'Capital One' }; },
    async remove() { removed++; } };
  const h = await setup(plaid); t.after(() => h.close());
  await h.send('setup', { username: 'owner_1', password: PASS });
  assert.equal((await h.send('connect', { institution: 'PayPal', publicToken: 'test' })).code, 400);
  assert.equal(removed, 1);
  assert.equal((await h.send('dashboard')).value.linkedItems, 0);
});

test('plaid adapter denies paid and payment endpoints and validates exact cents', async () => {
  const calls = [];
  const fake = makePlaid({ GOREE_PLAID_CLIENT_ID: 'id', GOREE_PLAID_SECRET: 'secret', GOREE_PLAID_ENV: 'sandbox' },
    async (url, args) => { calls.push(url); return { ok: true, async json() { return { accounts: [], item: { status: { transactions: {} } }, next_cursor: 'cursor', has_more: false, added: [], modified: [], removed: [] }; } }; });
  await assert.rejects(() => fake.call('/transfer/create', {}), /Forbidden/);
  await assert.rejects(() => fake.call('/accounts/balance/get', {}), /not enabled/);
  await assert.rejects(() => fake.call('/transactions/refresh', {}), /not enabled/);
  assert.equal(calls.length, 0);
  assert.equal(centsFromProvider(0.1), '10');
  assert.equal(centsFromProvider(2.25, true), '-225');
  assert.throws(() => centsFromProvider(0.123), /precision/);
  assert.equal(matchesInstitution('Capital One', 'Capital One'), true);
  assert.equal(matchesInstitution('PayPal', 'Capital One'), false);
  assert.equal(applySync([{ id: 'old', date: '2026-01-01', cents: '100' }], [{ removed: [{ transaction_id: 'old' }], added: [{ transaction_id: 'new', account_id: 'a', date: '2026-01-02', iso_currency_code: 'USD', amount: 2.25, name: 'Purchase' }] }]).length, 1);
});

test('vault permissions fail closed and bad password cannot decrypt', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'finance-permissions-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const parent = path.join(folder, 'vault'); const file = path.join(parent, 'data.json');
  const vault = makeVault(file); const created = await vault.setup('myowner', PASS);
  assert.equal(created.username, 'myowner');
  assert.equal((await vault.unlock('myowner', PASS)).username, 'myowner');
  await assert.rejects(() => vault.unlock('myowner', PASS + 'x'), /Invalid username or password/);
  const forbidden = path.join(folder, 'public'); await mkdir(forbidden, { mode: 0o777 });
  await (await import('node:fs/promises')).chmod(forbidden, 0o777);
  await assert.rejects(() => makeVault(path.join(forbidden, 'data.json')).setup('ownerfoo', PASS), /must not be accessible/);
  created.key.fill(0);
});

// Security regression: rotation re-encrypts the same data with a fresh key and
// salt; old sessions and old passwords must immediately lose access.
test('owner can rotate vault password; old credentials and sessions are revoked without data loss', async t => {
  const h = await setup(); t.after(() => h.close());
  assert.equal((await h.send('setup', { username: 'owner_1', password: PASS })).code, 201);
  assert.equal((await h.send('import', { institution: 'PayPal', label: 'Wallet', csv: CSV })).value.added, 2);
  const oldCookie = h.cookie, oldCsrf = h.csrf;
  const before = JSON.parse(await readFile(h.file, 'utf8'));
  assert.equal((await h.send('password/change', { currentPassword: 'a completely wrong password', newPassword: 'A new secure password 44' })).code, 401);
  assert.equal((await h.send('dashboard')).value.totalTransactions, 2);
  assert.equal((await h.send('password/change', { currentPassword: PASS, newPassword: PASS })).code, 400);
  const changed = await h.send('password/change', { currentPassword: PASS, newPassword: 'A new secure password 44' });
  assert.equal(changed.code, 200);
  assert.equal(changed.value.otherSessionsRevoked, true);
  assert.notEqual(h.cookie, oldCookie);
  assert.notEqual(h.csrf, oldCsrf);
  const after = JSON.parse(await readFile(h.file, 'utf8'));
  assert.notEqual(before.salt, after.salt);
  assert.notEqual(before.ciphertext, after.ciphertext);
  assert.ok(!JSON.stringify(after).includes('Example income'));
  assert.equal((await h.send('dashboard')).value.totalTransactions, 2);
  h.setCookie(oldCookie); h.setCsrf(oldCsrf);
  assert.equal((await h.send('dashboard')).code, 401);
  assert.equal((await h.send('login', { username: 'owner_1', password: PASS })).code, 401);
  assert.equal((await h.send('login', { username: 'owner_1', password: 'A new secure password 44' })).code, 200);
  assert.equal((await h.send('dashboard')).value.totalTransactions, 2);
});

test('Plaid pagination mutation restarts from the original cursor and discards partial pages', async () => {
  const seen = [];
  let attempt = 0;
  const fake = makePlaid({ GOREE_PLAID_CLIENT_ID: 'id', GOREE_PLAID_SECRET: 'secret', GOREE_PLAID_ENV: 'sandbox' }, async (url, args) => {
    const endpoint = new URL(url).pathname, input = JSON.parse(args.body);
    if (endpoint === '/accounts/get') return { ok: true, async json() { return { accounts: [] }; } };
    if (endpoint === '/item/get') return { ok: true, async json() { return { item: { status: { transactions: { last_successful_update: '2026-11-13T00:00:00Z' } } } }; } };
    if (endpoint !== '/transactions/sync') throw Error('Unexpected endpoint: ' + endpoint);
    seen.push(input.cursor);
    if (input.cursor === 'old') attempt++;
    if (attempt === 1 && input.cursor === 'page-one') return { ok: false, async json() { return { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }; } };
    const tx = id => ({ transaction_id: id, account_id: 'a1', date: '2026-11-12', iso_currency_code: 'USD', amount: 1.25, name: id });
    if (input.cursor === 'old') return { ok: true, async json() { return { added: [tx(attempt === 1 ? 'discard-me' : 'keep-me')], modified: [], removed: [], next_cursor: 'page-one', has_more: true }; } };
    return { ok: true, async json() { return { added: [tx('second-page')], modified: [], removed: [], next_cursor: 'done', has_more: false }; } };
  });
  const result = await fake.sync({ id: 'item1', accessToken: 'synthetic', cursor: 'old', transactions: [] });
  assert.deepEqual(seen, ['old', 'page-one', 'old', 'page-one']);
  assert.deepEqual(new Set(result.transactions.map(x => x.id)), new Set(['keep-me', 'second-page']));
  assert.equal(result.cursor, 'done');
  assert.ok(!result.transactions.some(x => x.id === 'discard-me'));
});

test('paid refresh calls are suppressed within cooldown, but routine reads still run', async () => {
  const paths = [];
  const fake = makePlaid({ GOREE_PLAID_CLIENT_ID: 'id', GOREE_PLAID_SECRET: 'secret', GOREE_PLAID_ENV: 'sandbox',
    GOREE_PLAID_REALTIME_BALANCE: 'true', GOREE_PLAID_TRANSACTION_REFRESH: 'true' }, async (url) => {
    const endpoint = new URL(url).pathname; paths.push(endpoint);
    if (endpoint === '/accounts/balance/get' || endpoint === '/accounts/get') return { ok: true, async json() { return { accounts: [] }; } };
    if (endpoint === '/item/get') return { ok: true, async json() { return { item: { status: { transactions: {} } } }; } };
    if (endpoint === '/transactions/refresh') return { ok: true, async json() { return {}; } };
    if (endpoint === '/transactions/sync') return { ok: true, async json() { return { added: [], modified: [], removed: [], next_cursor: 'new-cursor', has_more: false }; } };
    throw Error('Unexpected paid endpoint');
  });
  const one = await fake.sync({ id: 'item-paid', accessToken: 'fake', cursor: null, transactions: [] });
  const two = await fake.sync(one);
  assert.equal(paths.filter(p => p === '/transactions/refresh').length, 1);
  assert.equal(paths.filter(p => p === '/accounts/balance/get').length, 1);
  assert.equal(paths.filter(p => p === '/accounts/get').length, 1);
  assert.equal(paths.filter(p => p === '/transactions/sync').length, 2);
  assert.equal(one.balanceSource, 'on-demand');
  assert.equal(two.balanceSource, 'cached');
  assert.ok(one.lastPaidTxRefreshAt);
  assert.ok(two.lastPaidBalanceAt);
});

test('invalid Plaid transaction pages fail closed rather than advancing the cursor', async () => {
  const fake = makePlaid({ GOREE_PLAID_CLIENT_ID: 'id', GOREE_PLAID_SECRET: 'secret' }, async (url) => ({
    ok: true, async json() {
      if (url.endsWith('/accounts/get')) return { accounts: [] };
      if (url.endsWith('/item/get')) return { item: { status: { transactions: {} } } };
      return { added: [], next_cursor: 'next', has_more: true };
    }
  }));
  const original = { id: 'i', accessToken: 'test', cursor: 'savepoint', transactions: [] };
  await assert.rejects(fake.sync(original), /Invalid provider transaction page/);
  assert.equal(original.cursor, 'savepoint');
});

// Backup and recovery must preserve sealed ciphertext without overwriting an owner vault.
test('local encrypted backup and restore preserve vault; reject overwrite and unsafe input', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'finances-backup-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'original', 'vault.json');
  const vault = makeVault(source);
  const setup = await vault.setup('backupowner', PASS);
  await vault.save(setup.key, { version: 1, items: [], imports: [{ institution: 'PayPal', label: 'Test', rows: [] }] });
  setup.key.fill(0);
  const backup = await backupVault(source, path.join(folder, 'backups'));
  assert.equal((await stat(backup)).mode & 0o077, 0);
  assert.equal((await readFile(backup, 'utf8')).includes(PASS), false);
  const destination = path.join(folder, 'restored', 'vault.json');
  await restoreVault(backup, destination);
  const restored = makeVault(destination);
  assert.equal((await restored.unlock('backupowner', PASS)).state.imports.length, 1);
  await assert.rejects(restoreVault(backup, destination), /EEXIST/);
  const link = path.join(folder, 'pretend-backup.json');
  await symlink(backup, link);
  await assert.rejects(restoreVault(link, path.join(folder, 'unused', 'vault.json')));
  await chmod(backup, 0o644);
  await assert.rejects(restoreVault(backup, path.join(folder, 'unused', 'vault.json')), /private regular file/);
  await chmod(backup, 0o600);
  const invalid = path.join(folder, 'bad.json');
  await writeFile(invalid, JSON.stringify({ version: 1, username: 'fake' }), { mode: 0o600 });
  await assert.rejects(restoreVault(invalid, path.join(folder, 'unused', 'vault.json')), /Invalid encrypted vault backup metadata/);
});


test('parallel incorrect logins cannot bypass the five-attempt cooldown', async t => {
  const h = await setup(); t.after(() => h.close());
  assert.equal((await h.send('setup', { username: 'owner_1', password: PASS })).code, 201);
  await h.send('logout');
  const attempts = await Promise.all(Array.from({ length: 6 }, () =>
    h.send('login', { username: 'owner_1', password: 'a bad but sufficiently long password' })));
  const codes = attempts.map(a => a.code).sort();
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  assert.equal((await h.send('login', { username: 'owner_1', password: PASS })).code, 429);
});
