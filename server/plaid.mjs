// Explicit Plaid read-only allowlist; no payment/transfer capabilities.
const HOSTS = Object.freeze({ sandbox: 'https://sandbox.plaid.com', development: 'https://development.plaid.com', production: 'https://production.plaid.com' });
const ALLOWED = new Set(['/link/token/create', '/item/public_token/exchange', '/accounts/get', '/accounts/balance/get', '/transactions/sync', '/transactions/refresh', '/item/get', '/item/remove', '/institutions/get_by_id']);
export const PROVIDERS = Object.freeze(['Navy Federal Credit Union', 'Cash App', 'Varo', 'Capital One', 'Marcus by Goldman Sachs', 'Discover', 'PayPal']);
export function matchesInstitution(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = {
    'Navy Federal Credit Union': ['navyfederalcreditunion', 'navyfederal'],
    'Cash App': ['cashapp', 'cashappbanking'],
    'Varo': ['varo', 'varobank'],
    'Capital One': ['capitalone', 'capitalonebank'],
    'Marcus by Goldman Sachs': ['marcusbygoldmansachs', 'marcusgoldmansachs', 'marcus'],
    'Discover': ['discover', 'discoverbank'],
    'PayPal': ['paypal', 'paypalus']
  };
  return (groups[expected] || []).includes(normalize(actual));
}
export function centsFromProvider(value, invert = false) {
  // Plaid sends JSON numbers. Reject invalid precision rather than silently rounding.
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('Unsupported provider amount');
  const numberText = value.toString();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(numberText)) throw new Error('Unsupported provider precision');
  const [a, b = ''] = numberText.split('.');
  const negative = a.startsWith('-');
  const units = BigInt(a.replace('-', '')) * 100n + BigInt((b + '00').slice(0, 2));
  const signed = negative ? -units : units;
  return (invert ? -signed : signed).toString();
}
export function cleanAccounts(accounts) {
  if (!Array.isArray(accounts)) throw new Error('Invalid provider accounts');
  return accounts.slice(0, 60).filter(a => a && typeof a.account_id === 'string').map(a => {
    const balance = a.balances || {};
    const currency = balance.iso_currency_code === 'USD' ? 'USD' : null;
    return { id: a.account_id, name: String(a.name || 'Account').slice(0, 80),
      type: String(a.type || '').slice(0, 20), subtype: String(a.subtype || '').slice(0, 30),
      mask: typeof a.mask === 'string' ? a.mask.slice(-4) : null,
      currency, currentCents: currency && balance.current != null ? centsFromProvider(balance.current) : null,
      availableCents: currency && balance.available != null ? centsFromProvider(balance.available) : null };
  });
}
export function cleanTx(row) {
  if (!row || typeof row.transaction_id !== 'string' || typeof row.account_id !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    row.iso_currency_code !== 'USD') return null;
  return { id: row.transaction_id, accountId: row.account_id, date: row.date,
    description: String(row.merchant_name || row.name || 'Transaction').slice(0, 220),
    cents: centsFromProvider(row.amount, true), pending: Boolean(row.pending) };
}
export function applySync(oldRows, pages) {
  const map = new Map((oldRows || []).map(row => [row.id, row]));
  for (const page of pages) {
    for (const entry of page.removed || []) if (typeof entry.transaction_id === 'string') map.delete(entry.transaction_id);
    for (const entry of [...(page.added || []), ...(page.modified || [])]) {
      const tx = cleanTx(entry); if (tx) map.set(tx.id, tx);
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10000);
}

export function makePlaid(env = process.env, request = fetch) {
  const environment = env.GOREE_PLAID_ENV || 'sandbox';
  const enabled = Boolean(env.GOREE_PLAID_CLIENT_ID && env.GOREE_PLAID_SECRET && HOSTS[environment]);
  const paidBalance = enabled && env.GOREE_PLAID_REALTIME_BALANCE === 'true';
  const paidTxRefresh = enabled && env.GOREE_PLAID_TRANSACTION_REFRESH === 'true';
  // Repeated page opens must never trigger a new billable request every time.
  const PAID_COOLDOWN_MS = 30 * 60 * 1000;
  const lastPaidAttempts = new Map();
  function takePaidAllowance(item, operation, previousTime) {
    const cacheKey = item.id + '|' + operation;
    const previous = Math.max(lastPaidAttempts.get(cacheKey) || 0, Date.parse(previousTime || '') || 0);
    const now = Date.now();
    if (now - previous < PAID_COOLDOWN_MS) return null;
    lastPaidAttempts.set(cacheKey, now); // Recorded before the call even if it fails.
    return new Date(now).toISOString();
  }
  async function call(path, input = {}) {
    if (!enabled) throw new Error('Plaid is not configured');
    if (!ALLOWED.has(path)) throw new Error('Forbidden provider operation');
    if (path === '/accounts/balance/get' && !paidBalance) throw new Error('Real-time balance not enabled');
    if (path === '/transactions/refresh' && !paidTxRefresh) throw new Error('On-demand transaction refresh not enabled');
    const response = await request(HOSTS[environment] + path, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'PLAID-CLIENT-ID': env.GOREE_PLAID_CLIENT_ID, 'PLAID-SECRET': env.GOREE_PLAID_SECRET },
      body: JSON.stringify(input), signal: AbortSignal.timeout(25000)
    });
    let body;
    try { body = await response.json(); } catch { throw new Error('Provider response was not JSON'); }
    if (!response.ok || body.error_code) {
      const code = typeof body.error_code === 'string' ? body.error_code : 'PROVIDER_ERROR';
      const error = new Error('Provider request failed: ' + code);
      error.code = code;
      throw error;
    }
    return body;
  }
  async function createLinkToken() {
    const body = await call('/link/token/create', {
      user: { client_user_id: 'goreecloud-finances-owner' }, client_name: 'GoreeCloud Finances',
      products: ['transactions'], country_codes: ['US'], language: 'en'
    });
    return body.link_token;
  }
  async function exchange(publicToken) {
    const body = await call('/item/public_token/exchange', { public_token: publicToken });
    return { accessToken: body.access_token, itemId: body.item_id };
  }
  async function remove(accessToken) { await call('/item/remove', { access_token: accessToken }); }
  async function institution(accessToken) {
    const item = await call('/item/get', { access_token: accessToken });
    const id = item.item?.institution_id;
    if (typeof id !== 'string' || !id) throw new Error('Provider institution not confirmed');
    const details = await call('/institutions/get_by_id', { institution_id: id, country_codes: ['US'] });
    const name = details.institution?.name;
    if (typeof name !== 'string' || !name) throw new Error('Provider institution name unavailable');
    return { id, name };
  }
  async function sync(item) {
    const target = { ...item };
    // Optional paid calls use a 30-minute local cooldown; ordinary reads happen
    // on every open. Freshness is the provider's timestamp, not the request time.
    if (paidTxRefresh) {
      const stamp = takePaidAllowance(item, 'transactions', item.lastPaidTxRefreshAt);
      if (stamp) {
        target.lastPaidTxRefreshAt = stamp;
        await call('/transactions/refresh', { access_token: target.accessToken });
      }
    }
    const balanceStamp = paidBalance ? takePaidAllowance(item, 'balance', item.lastPaidBalanceAt) : null;
    const [accounts, details] = await Promise.all([
      call(balanceStamp ? '/accounts/balance/get' : '/accounts/get', { access_token: target.accessToken }),
      call('/item/get', { access_token: target.accessToken })
    ]);
    if (balanceStamp) target.lastPaidBalanceAt = balanceStamp;

    // Plaid can mutate the feed during pagination. On the special mutation error
    // all pages must be discarded and the entire loop restarted from the original
    // cursor. Never persist partial pages, and cap retries to avoid endless loops.
    const originalCursor = target.cursor || undefined;
    let pages, cursor, finished;
    for (let attempt = 0; attempt < 3; attempt++) {
      pages = [];
      cursor = originalCursor;
      finished = false;
      try {
        for (let index = 0; index < 40; index++) {
          const page = await call('/transactions/sync', {
            access_token: target.accessToken, ...(cursor ? { cursor } : {}), count: 500
          });
          if (typeof page.next_cursor !== 'string' || !page.next_cursor ||
              typeof page.has_more !== 'boolean' || !Array.isArray(page.added) ||
              !Array.isArray(page.modified) || !Array.isArray(page.removed)) {
            throw new Error('Invalid provider transaction page');
          }
          if (page.has_more && page.next_cursor === cursor) throw new Error('Provider cursor made no progress');
          pages.push(page);
          cursor = page.next_cursor;
          if (!page.has_more) { finished = true; break; }
        }
        if (!finished) throw new Error('Provider pagination exceeded safe limit');
        break;
      } catch (error) {
        if (error.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
        throw error;
      }
    }
    target.accounts = cleanAccounts(accounts.accounts);
    target.transactions = applySync(item.transactions || [], pages);
    target.cursor = cursor;
    target.lastChecked = new Date().toISOString();
    target.lastProviderUpdate = details.item?.status?.transactions?.last_successful_update || null;
    target.lastError = null;
    target.balanceSource = balanceStamp ? 'on-demand' : 'cached';
    return target;
  }
  return { enabled, environment, paidBalance, paidTxRefresh, createLinkToken, exchange, institution, remove, sync, call };
}
