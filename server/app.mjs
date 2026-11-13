// Loopback-only single-owner service. Deliberately not an Internet-facing auth server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { makeVault, validUsername, validPassword } from './vault.mjs';
import { makePlaid, PROVIDERS, matchesInstitution } from './plaid.mjs';
import finance from '../app/finance.js';
const STATIC = Object.freeze({ '/': ['web/index.html', 'text/html'], '/app.js': ['web/app.js', 'text/javascript'], '/style.css': ['web/style.css', 'text/css'], '/tokens.css': ['app/gc-tokens.css', 'text/css'] });
const ROOT = resolve(import.meta.dirname, '..');
const STALE_SESSION_MS = 30 * 60 * 1000;
const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const baseDataFile = () => join(homedir(), '.local', 'share', 'goreecloud-finances', 'vault.json');
const randomId = () => randomBytes(32).toString('hex');
const mask = n => (n == null ? null : String(n));
const sizeLimit = 2_200_000;

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}
function fail(res, status, message) { json(res, status, { error: message }); }
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('JSON required'), { status: 415 });
  let bytes = 0, parts = [];
  for await (const part of req) {
    bytes += part.length;
    if (bytes > sizeLimit) throw Object.assign(new Error('Request too large'), { status: 413 });
    parts.push(part);
  }
  try { const value = JSON.parse(Buffer.concat(parts).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw Object.assign(new Error('Invalid JSON object'), { status: 400 }); }
}
// Returns only locally stored rows. Does not contact a bank or imply freshness.
function transactionRows(state) {
  const transactions = [];
  for (const imported of state.imports) {
    for (const t of imported.rows) transactions.push({ source: 'csv', institution: imported.institution, account: imported.label,
      date: t.date, description: t.description, cents: mask(t.cents), pending: false });
  }
  for (const item of state.items) {
    const names = new Map((item.accounts || []).map(x => [x.id, x.name]));
    for (const t of item.transactions || []) transactions.push({ source: 'plaid', institution: item.institution,
      account: names.get(t.accountId) || 'Account', date: t.date, description: t.description, cents: mask(t.cents), pending: t.pending });
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  return transactions;
}
function listTransactions(state, input) {
  const bad = () => { throw Object.assign(new Error('Invalid transaction search filters'), { status: 400 }); };
  const query = input.query === undefined ? '' : input.query;
  const institution = input.institution === undefined ? 'all' : input.institution;
  const source = input.source === undefined ? 'all' : input.source;
  const start = input.start === undefined ? '' : input.start;
  const end = input.end === undefined ? '' : input.end;
  const page = input.page === undefined ? 0 : input.page;
  const pageSize = input.pageSize === undefined ? 50 : input.pageSize;
  if (typeof query !== 'string' || query.length > 160 ||
    (institution !== 'all' && !PROVIDERS.includes(institution)) ||
    !['all', 'csv', 'plaid'].includes(source) ||
    typeof start !== 'string' || typeof end !== 'string' ||
    (start && !finance.isValidDate(start)) || (end && !finance.isValidDate(end)) ||
    (start && end && start > end) ||
    !Number.isSafeInteger(page) || page < 0 || page > 100000 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) bad();
  const needle = query.trim().toLocaleLowerCase('en-US');
  const allRows = transactionRows(state);
  const filtered = allRows.filter(row =>
    (institution === 'all' || row.institution === institution) &&
    (source === 'all' || row.source === source) &&
    (!start || row.date >= start) && (!end || row.date <= end) &&
    (!needle || (row.description + ' ' + row.institution + ' ' + row.account).toLocaleLowerCase('en-US').includes(needle)));
  const offset = page * pageSize;
  return {
    rows: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    totalStored: allRows.length,
    page, pageSize,
    hasMore: offset + pageSize < filtered.length,
    note: 'Search covers locally stored records only. Imported and provider rows may overlap; bank data may be delayed.'
  };
}
function jsonDashboard(state, options) {
  const institutions = PROVIDERS.map(name => {
    const items = state.items.filter(x => x.institution === name);
    const imports = state.imports.filter(x => x.institution === name);
    return { name, connected: items.length > 0, accounts: items.flatMap(x => (x.accounts || []).map(a => ({ ...a, itemId: x.id, institution: name, checkedAt: x.lastChecked || null, providerUpdatedAt: x.lastProviderUpdate || null, balanceSource: x.balanceSource || 'cached' }))),
      links: items.map(x => ({ id: x.id, status: x.lastError ? 'error' : (x.lastChecked ? 'checked' : 'pending'), error: x.lastError || null,
        checkedAt: x.lastChecked || null, providerUpdatedAt: x.lastProviderUpdate || null,
        balanceSource: x.balanceSource || 'cached', paidNotice: x.paidNotice || null })),
      importedRows: imports.reduce((sum, x) => sum + x.rows.length, 0) };
  });
  // Data minimization: the overview carries counts and account summaries, not
  // an unsolicited transaction dump. The owner requests pages explicitly.
  const totalTransactions = state.imports.reduce((n, x) => n + x.rows.length, 0) +
    state.items.reduce((n, x) => n + (x.transactions || []).length, 0);
  return { providers: institutions, totalTransactions,
    linkedItems: state.items.length, importBatches: state.imports.length, plaidEnabled: options.plaid.enabled,
    paidBalance: options.plaid.paidBalance, paidTxRefresh: options.plaid.paidTxRefresh,
    paidRequested: Boolean(options.plaid.paidRequested), paidLimitsReady: Boolean(options.plaid.paidLimitsReady),
    info: 'Cached balances and transaction updates depend on the institution/provider; a new sync check is not a guarantee of new bank data.' };
}
export function createFinanceServer({ dataFile = baseDataFile(), plaid = makePlaid(), port = 8787 } = {}) {
  const vault = makeVault(dataFile);
  const sessions = new Map();
  const fails = new Map();
  let queue = Promise.resolve();
  const exclusive = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  function sessionFor(req) {
    const text = String(req.headers.cookie || '');
    const id = /(?:^|;\s*)gc_fin_session=([a-f0-9]{64})(?:;|$)/.exec(text)?.[1];
    const value = id ? sessions.get(id) : null;
    if (!value) return null;
    const now = Date.now();
    if (now - value.used > STALE_SESSION_MS || now - value.created > ABSOLUTE_SESSION_MS) {
      sessions.delete(id); value.key.fill(0); return null;
    }
    value.used = now;
    return { ...value, id };
  }
  function newSession(unlocked, res) {
    const id = randomId(), csrf = randomId();
    sessions.set(id, { key: unlocked.key, username: unlocked.username, csrf, created: Date.now(), used: Date.now() });
    res.setHeader('Set-Cookie', 'gc_fin_session=' + id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200');
    return { authenticated: true, username: unlocked.username, csrf };
  }
  function dropSession(id, res) {
    if (id && sessions.has(id)) { sessions.get(id).key.fill(0); sessions.delete(id); }
    res.setHeader('Set-Cookie', 'gc_fin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  }
  async function mutating(req, session) {
    if (req.headers['x-gc-request'] !== 'finances') throw Object.assign(new Error('Request header required'), { status: 403 });
    if (session && req.headers['x-gc-csrf'] !== session.csrf) throw Object.assign(new Error('Invalid CSRF token'), { status: 403 });
    return body(req);
  }
  // The session holds the encryption key; no password or decrypted vault is kept on disk.
  async function load(session) {
    // Loading via a key avoids re-deriving a password and works with idle sessions.
    return vault.readWithKey(session.key);
  }
  async function save(session, state) { await vault.save(session.key, state); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.plaid.com; connect-src 'self' https://sandbox.plaid.com https://development.plaid.com https://production.plaid.com; frame-src https://cdn.plaid.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const host = String(req.headers.host || '');
      if (!['127.0.0.1:' + (server.address()?.port ?? port), 'localhost:' + (server.address()?.port ?? port)].includes(host)) return fail(res, 403, 'Invalid local host');
      if (url.search) return fail(res, 400, 'Query parameters not accepted');
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + host) return fail(res, 403, 'Cross-origin requests denied');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [relative, mime] = STATIC[url.pathname];
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(await readFile(join(ROOT, relative))); return;
      }
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const session = sessionFor(req);
        return json(res, 200, { setupRequired: !(await vault.exists()), authenticated: Boolean(session), username: session?.username || null, csrf: session?.csrf || null });
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return fail(res, 404, 'Not found');
      const session = sessionFor(req);
      const input = await mutating(req, session);
      if (url.pathname === '/api/setup') {
        if (!validUsername(input.username) || !validPassword(input.password)) return fail(res, 400, 'Username must be 3–32 safe characters; password must have 12–256 characters');
        const result = await exclusive(async () => {
          if (await vault.exists()) return null;
          return vault.setup(input.username, input.password);
        });
        if (!result) return fail(res, 409, 'Account setup is already complete');
        return json(res, 201, newSession(result, res));
      }
      if (url.pathname === '/api/login') {
        return exclusive(async () => {
        const record = fails.get('login') || { count: 0, until: 0 };
        if (record.until > Date.now()) return fail(res, 429, 'Too many attempts; try again later');
        if (!validUsername(input.username) || typeof input.password !== 'string' || input.password.length > 256) return fail(res, 401, 'Invalid username or password');
        try {
          const unlocked = await vault.unlock(input.username, input.password);
          fails.delete('login');
          return json(res, 200, newSession(unlocked, res));
        } catch {
          record.count += 1;
          if (record.count >= 5) { record.until = Date.now() + FAIL_WINDOW_MS; record.count = 0; }
          fails.set('login', record);
          return fail(res, 401, 'Invalid username or password');
        }
        });
      }
      if (!session) return fail(res, 401, 'Sign in required');
      if (url.pathname === '/api/logout') { dropSession(session.id, res); return json(res, 200, { authenticated: false }); }
      if (url.pathname === '/api/password/change') {
        if (!validPassword(input.currentPassword) || !validPassword(input.newPassword)) {
          return fail(res, 400, 'Both passwords must be 12–256 characters and valid');
        }
        return json(res, 200, await exclusive(async () => {
          // Re-authenticate with the current password. Serialize with writes and logins.
          const rotated = await vault.rotate(session.key, input.currentPassword, input.newPassword);
          for (const existing of sessions.values()) existing.key.fill(0);
          sessions.clear();
          return { ...newSession(rotated, res), otherSessionsRevoked: true };
        }));
      }
      if (url.pathname === '/api/dashboard') return json(res, 200, jsonDashboard(await load(session), { plaid }));
      if (url.pathname === '/api/transactions') return json(res, 200, listTransactions(await load(session), input));
      if (url.pathname === '/api/import') return json(res, 200, await exclusive(async () => {
        if (typeof input.csv !== 'string' || input.csv.length > 2_000_000 || !PROVIDERS.includes(input.institution)) throw Object.assign(new Error('Invalid statement'), { status: 400 });
        let rows;
        try { rows = finance.parseStatement(input.csv, input.institution, input.label || 'Primary'); }
        catch (error) { throw Object.assign(new Error(error.message), { status: 400 }); }
        const state = await load(session);
        const previous = state.imports.flatMap(x => x.rows.map(row => ({ ...row, cents: BigInt(row.cents) })));
        const merged = finance.mergeStatements(previous, [rows]);
        if (merged.added) {
          // mergeStatements knows the occurrence-aware signatures across imports.
          // Do not filter only by a set of existing signatures: doing so can
          // acknowledge a third identical row without storing the third occurrence.
          const added = merged.records.slice(previous.length).map(x => ({
            date: x.date, description: x.description, cents: x.cents.toString(), key: x.key
          }));
          state.imports.push({ institution: input.institution, label: (input.label || 'Primary').trim(), rows: added });
          await save(session, state);
        }
        return { added: merged.added, duplicates: merged.duplicates };
      }));
      if (url.pathname === '/api/link-token') {
        if (!plaid.enabled) return fail(res, 503, 'Provider linking not configured');
        if (!PROVIDERS.includes(input.institution)) return fail(res, 400, 'Unknown institution');
        return json(res, 200, { linkToken: await plaid.createLinkToken() });
      }
      if (url.pathname === '/api/relink-token') {
        if (!plaid.enabled) return fail(res, 503, 'Provider linking not configured');
        if (typeof input.itemId !== 'string' || !input.itemId || input.itemId.length > 256) {
          return fail(res, 400, 'Invalid connection');
        }
        const item = (await load(session)).items.find(x => x.id === input.itemId);
        if (!item) return fail(res, 404, 'Connection not found');
        // Existing Plaid access tokens remain server-side in the encrypted vault.
        // Update mode takes an access_token and does NOT exchange a new public token.
        return json(res, 200, { linkToken: await plaid.createUpdateLinkToken(item.accessToken) });
      }
      if (url.pathname === '/api/relink-complete') {
        if (!plaid.enabled) return fail(res, 503, 'Provider linking not configured');
        if (typeof input.itemId !== 'string' || !input.itemId || input.itemId.length > 256) {
          return fail(res, 400, 'Invalid connection');
        }
        return json(res, 200, await exclusive(async () => {
          const state = await load(session), index = state.items.findIndex(x => x.id === input.itemId);
          if (index < 0) throw Object.assign(new Error('Connection not found'), { status: 404 });
          const old = state.items[index];
          const verified = await plaid.institution(old.accessToken);
          if (verified.id !== old.institutionId || !matchesInstitution(old.institution, verified.name)) {
            throw Object.assign(new Error('Linked institution identity changed; refresh refused'), { status: 409 });
          }
          try {
            state.items[index] = await plaid.sync(old);
            await save(session, state);
            return { checked: true, success: true, note: 'Provider data may still be cached.' };
          } catch {
            state.items[index] = { ...old, lastChecked: new Date().toISOString(),
              lastError: 'Reconnect completed; data refresh failed. Retry or review provider authorization.' };
            await save(session, state);
            return { checked: true, success: false, note: 'Provider data was not refreshed.' };
          }
        }));
      }
      if (url.pathname === '/api/connect') {
        if (!plaid.enabled) return fail(res, 503, 'Provider linking not configured');
        if (!PROVIDERS.includes(input.institution) || typeof input.publicToken !== 'string' || input.publicToken.length > 400 || !input.publicToken) return fail(res, 400, 'Invalid link result');
        return json(res, 200, await exclusive(async () => {
          const state = await load(session);
          if (state.items.length >= 15) throw Object.assign(new Error('Connection limit reached'), { status: 400 });
          const connected = await plaid.exchange(input.publicToken);
          let verified;
          try {
            verified = await plaid.institution(connected.accessToken);
            if (!matchesInstitution(input.institution, verified.name)) throw new Error('Institution does not match selected card');
          } catch (error) {
            await plaid.remove(connected.accessToken).catch(() => {});
            throw Object.assign(new Error('Could not verify the linked institution'), { status: 400 });
          }
          if (state.items.some(x => x.id === connected.itemId)) return { connected: true, repeated: true };
          let item = { id: connected.itemId, accessToken: connected.accessToken, institution: input.institution,
            institutionId: verified.id, accounts: [], transactions: [], cursor: null, lastChecked: null,
            lastProviderUpdate: null, lastError: null, balanceSource: 'cached' };
          try { item = await plaid.sync(item); }
          catch { item.lastError = 'Linked, but first sync is not ready; retry refresh'; }
          state.items.push(item);
          await save(session, state);
          return { connected: true, pending: Boolean(item.lastError) };
        }));
      }
      if (url.pathname === '/api/refresh') {
        return json(res, 200, await exclusive(async () => {
          const state = await load(session);
          let successes = 0, failures = 0;
          // Bound independent provider checks so opening the dashboard is faster
          // without issuing unbounded concurrent requests. Commit all results
          // together after the checks finish, never a partially updated vault.
          let nextIndex = 0;
          const workers = Math.min(3, state.items.length);
          await Promise.all(Array.from({ length: workers }, async () => {
            while (true) {
              const i = nextIndex++;
              if (i >= state.items.length) return;
              const old = state.items[i];
              try { state.items[i] = await plaid.sync(old); successes++; }
              catch {
                state.items[i] = { ...old, lastChecked: new Date().toISOString(),
                  lastError: 'Refresh failed; previous data retained. Reconnect may be required.' };
                failures++;
              }
            }
          }));
          await save(session, state);
          return { checked: state.items.length, successes, failures, checkedAt: new Date().toISOString(), note: 'Checks do not guarantee the bank has released new records.' };
        }));
      }
      if (url.pathname === '/api/disconnect') {
        return json(res, 200, await exclusive(async () => {
          const state = await load(session), item = state.items.find(x => x.id === input.itemId);
          if (!item) throw Object.assign(new Error('Connection not found'), { status: 404 });
          await plaid.remove(item.accessToken);
          state.items = state.items.filter(x => x.id !== input.itemId);
          await save(session, state);
          return { disconnected: true };
        }));
      }
      return fail(res, 404, 'Unknown action');
    } catch (error) {
      // No incoming CSV, password, token or provider response is ever written to logs.
      const code = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
      fail(res, code, code === 500 ? 'Operation failed; check local configuration or retry' : error.message);
    }
  });
  return { server, vault, plaid, sessions };
}
