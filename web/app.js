/* GoreeCloud Finances: no browser persistence; requests only to the local, authenticated API.
 * Plaid is invoked only after an explicit Connect action. */
'use strict';
(() => {
  const $ = name => document.getElementById(name);
  const PROVIDERS = ['Navy Federal Credit Union', 'Cash App', 'Varo', 'Capital One', 'Marcus by Goldman Sachs', 'Discover', 'PayPal'];
  let csrf = null, details = null, mask = false, refreshing = false, linkBusy = false;
  const integer = new Intl.NumberFormat('en-US');
  const action = (tag, text, className) => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
  function alertStatus(message, error = false) { $('messages').textContent = message; $('messages').style.color = error ? 'var(--gc-negative)' : 'var(--gc-text)'; }
  function showStatus(message, mode = '') { $('status-line').textContent = message; $('status-line').dataset.state = mode; }
  function cents(text) {
    if (text == null) return '—';
    if (mask) return '••••••';
    try { let n = BigInt(text), negative = n < 0n; if (negative) n = -n;
      return (negative ? '−' : '') + '$' + (n / 100n).toLocaleString('en-US') + '.' + (n % 100n).toString().padStart(2, '0'); }
    catch { return '—'; }
  }
  function dateLabel(value) {
    if (!value) return 'Not available';
    const time = new Date(value);
    return Number.isNaN(time.valueOf()) ? 'Unknown time' : time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
  async function api(path, data = {}) {
    const response = await fetch('/api/' + path, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-GC-Request': 'finances', ...(csrf ? { 'X-GC-CSRF': csrf } : {}) },
      body: JSON.stringify(data) });
    let body = {}; try { body = await response.json(); } catch { /* no body */ }
    if (!response.ok) throw new Error(body.error || 'The request failed (' + response.status + ')');
    return body;
  }
  function screen(name) { $('auth').hidden = name === 'dashboard'; $('dashboard').hidden = name !== 'dashboard'; $('logout').hidden = name !== 'dashboard'; }
  function authScreen(setup) {
    csrf = null; details = null; screen('auth');
    $('auth-heading').textContent = setup ? 'Make it yours.' : 'Welcome back.';
    $('auth-eyebrow').textContent = setup ? 'ONE-TIME LOCAL SETUP' : 'OWNER ACCESS';
    $('auth-copy').textContent = setup ? 'Create a local GoreeCloud Finances account. Your password encrypts the data on this device.' : 'Sign in to your private financial dashboard.';
    $('auth-submit').textContent = setup ? 'Create my account' : 'Unlock dashboard';
    $('password').autocomplete = setup ? 'new-password' : 'current-password';
    $('auth-form').dataset.setup = setup ? 'yes' : 'no';
    $('auth-note').textContent = setup ? 'Your password is required to decrypt the vault and cannot be recovered. Use a unique, strong password, and keep it safe. This is not a bank password.' : 'This password unlocks the app only. Bank credentials are entered only into an approved institution/provider connection flow.';
    $('username').focus();
  }
  function accountTotals() {
    let depository = 0n, credit = 0n, hasDepository = false, hasCredit = false;
    for (const provider of details.providers) for (const account of provider.accounts) {
      if (account.currency !== 'USD' || account.currentCents == null) continue;
      try { const value = BigInt(account.currentCents);
        if (account.type === 'depository') { depository += value; hasDepository = true; }
        if (account.type === 'credit') { credit += value; hasCredit = true; }
      } catch { /* unparseable balance unavailable */ }
    }
    $('cash-total').textContent = hasDepository ? cents(depository.toString()) : '—';
    $('credit-total').textContent = hasCredit ? cents(credit.toString()) : '—';
    $('connected-count').textContent = details.providers.filter(p => p.connected).length + ' of 7';
    $('transaction-count').textContent = integer.format(details.totalTransactions);
    $('provider-mode').textContent = details.plaidEnabled ? (details.paidBalance ? 'On-demand balance enabled' : 'Cached balance mode') : 'Live linking not configured · local imports available';
  }
  function renderProviders() {
    const target = $('institutions'); target.replaceChildren();
    for (const provider of details.providers) {
      const card = action('article', '', 'glass provider'); card.textContent = '';
      const top = action('div', '', 'provider-top');
      top.append(action('div', provider.name, 'provider-name'));
      const connected = provider.connected, broken = provider.links.some(l => l.error);
      top.append(action('span', broken ? 'Needs attention' : connected ? 'Linked' : 'Not connected', 'state ' + (broken ? 'error' : connected ? 'connected' : '')));
      card.append(top);
      const content = action('div', '', 'provider-detail');
      if (provider.accounts.length) {
        for (const a of provider.accounts) {
          const line = action('p', a.name + (a.mask ? ' · ••••' + a.mask : '') + ' · ' + cents(a.currentCents) + ' (' + (a.balanceSource === 'on-demand' ? 'on-demand' : 'cached') + ')');
          content.append(line);
        }
      } else content.append(action('p', connected ? 'Linked; waiting for account data.' : 'Use authorized linking when available, or import a statement.'));
      if (provider.importedRows) content.append(action('p', integer.format(provider.importedRows) + ' imported local rows'));
      for (const link of provider.links) {
        if (link.checkedAt) content.append(action('p', 'Checked: ' + dateLabel(link.checkedAt) + ' · Provider data: ' + dateLabel(link.providerUpdatedAt)));
        if (link.error) content.append(action('p', link.error));
      }
      card.append(content);
      const actions = action('div', '', 'provider-actions');
      const connect = action('button', connected ? 'Add another' : 'Connect account', 'smallbtn');
      connect.type = 'button'; connect.disabled = !details.plaidEnabled || linkBusy; connect.title = details.plaidEnabled ? 'Authorize a read-only connection through Plaid Link' : 'Plaid credentials are not configured on this device';
      connect.addEventListener('click', () => beginLink(provider.name)); actions.append(connect);
      for (const link of provider.links) {
        const renew = action('button', link.error ? 'Reconnect' : 'Renew access', 'smallbtn');
        renew.type = 'button'; renew.disabled = !details.plaidEnabled || linkBusy;
        renew.title = details.plaidEnabled ? 'Use Plaid Link update mode to repair or renew existing consent' : 'Plaid credentials are not configured';
        renew.addEventListener('click', () => beginLink(provider.name, link.id)); actions.append(renew);
        const remove = action('button', 'Disconnect', 'smallbtn'); remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!confirm('Disconnect this institution and delete its connected data from the local vault?')) return;
          remove.disabled = true;
          try { await api('disconnect', { itemId: link.id }); await loadDashboard(); alertStatus('Connection revoked and its cached entries removed.'); }
          catch (err) { alertStatus(err.message, true); remove.disabled = false; }
        }); actions.append(remove);
      }
      card.append(actions); target.append(card);
    }
  }
  function renderTransactions() {
    const needle = $('query').value.trim().toLowerCase();
    const target = $('entries'); target.replaceChildren();
    const rows = details.transactions.filter(t => (t.description + ' ' + t.institution + ' ' + t.account).toLowerCase().includes(needle)).slice(0, 200);
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const text of [r.date, r.description, r.institution + ' · ' + r.account, cents(r.cents), r.source === 'csv' ? 'Imported' : (r.pending ? 'Provider · pending' : 'Provider')]) tr.append(action('td', text));
      target.append(tr);
    }
    $('no-entries').hidden = rows.length > 0;
    if (!rows.length && needle) $('no-entries').textContent = 'No matching transactions.';
    else if (!rows.length) $('no-entries').textContent = 'No transactions yet. Link an institution or import a statement.';
  }
  function render() { if (!details) return; accountTotals(); renderProviders(); renderTransactions(); }
  async function loadDashboard() { details = await api('dashboard'); render(); }
  async function refresh(trigger = 'manual') {
    if (refreshing) return;
    refreshing = true; $('refresh').disabled = true; $('spinner').hidden = false;
    showStatus('Checking connected sources. Previously saved data stays visible during the check…', 'busy');
    try {
      const result = await api('refresh'); await loadDashboard();
      const base = result.checked === 0 ? 'No live accounts linked. Import a statement or configure Plaid linking.' :
        'Checked ' + result.checked + ' linked connections: ' + result.successes + ' succeeded, ' + result.failures + ' need attention.';
      showStatus(base + ' Last check: ' + dateLabel(result.checkedAt) + '. Bank transaction feeds may still be cached.', result.failures ? 'error' : '');
      if (trigger === 'manual') alertStatus(base);
    } catch (error) { showStatus('Refresh could not finish. Earlier encrypted records remain available.', 'error'); alertStatus(error.message, true); }
    finally { refreshing = false; $('refresh').disabled = false; $('spinner').hidden = true; }
  }
  function loadPlaidScript() {
    if (window.Plaid) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; script.async = true;
      script.onload = () => window.Plaid ? resolve() : reject(new Error('Plaid Link unavailable'));
      script.onerror = () => reject(new Error('Cannot reach Plaid Link. Check your network.'));
      document.head.append(script);
    });
  }
  async function beginLink(institution, itemId = null) {
    if (linkBusy) return;
    linkBusy = true; renderProviders();
    try {
      const isUpdate = Boolean(itemId);
      alertStatus((isUpdate ? 'Renewing existing authorization' : 'Opening secure provider authorization') + ' for ' + institution + '…');
      const [token] = await Promise.all([
        isUpdate ? api('relink-token', { itemId }) : api('link-token', { institution }),
        loadPlaidScript()
      ]);
      let finished = false;
      const release = link => {
        if (finished) return;
        finished = true;
        link.destroy();
        linkBusy = false;
        if (details) renderProviders();
      };
      const link = window.Plaid.create({ token: token.linkToken,
        onSuccess: async publicToken => {
          try {
            if (isUpdate) {
              // Plaid update mode retains the existing access token. Do not exchange the callback token.
              const result = await api('relink-complete', { itemId });
              await loadDashboard();
              alertStatus(result.success
                ? institution + ' connection checked after consent renewal. Upstream data may still be cached.'
                : institution + ' consent flow completed, but the provider check failed. Existing data was retained.', !result.success);
            } else {
              await api('connect', { publicToken, institution });
              await loadDashboard(); await refresh('open');
              alertStatus(institution + ' authorization saved.');
            }
          } catch (error) {
            alertStatus('Could not ' + (isUpdate ? 'renew' : 'connect') + ': ' + error.message, true);
          } finally { release(link); }
        },
        onExit: () => release(link)
      });
      link.open();
      // Controls remain disabled until the provider window closes or completes.
    } catch (error) {
      linkBusy = false;
      alertStatus(error.message, true);
      if (details) renderProviders();
    }
  }
  async function start() {
    try {
      const status = await (await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' })).json();
      csrf = status.csrf;
      if (status.authenticated) { screen('dashboard'); await loadDashboard(); await refresh('open'); }
      else authScreen(status.setupRequired);
    } catch { showStatus('Could not contact the local service.', 'error'); alertStatus('This app requires the local GoreeCloud Finances server. Start it with npm start.', true); authScreen(false); }
  }
  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('auth-submit'); button.disabled = true;
    try {
      const setup = $('auth-form').dataset.setup === 'yes';
      const result = await api(setup ? 'setup' : 'login', { username: $('username').value, password: $('password').value });
      $('password').value = ''; csrf = result.csrf;
      screen('dashboard'); await loadDashboard(); await refresh('open');
      alertStatus(setup ? 'Local account created; vault encrypted.' : 'Welcome back.');
    } catch (error) { alertStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  $('password-change-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = $('password-change-form'), button = form.querySelector('button');
    const currentPassword = $('current-password').value;
    const newPassword = $('new-password').value;
    const confirmation = $('confirm-password').value;
    if (newPassword !== confirmation) {
      $('password-change-status').textContent = 'New passwords do not match.';
      return;
    }
    button.disabled = true;
    try {
      const response = await api('password/change', { currentPassword, newPassword });
      csrf = response.csrf;
      form.reset();
      $('password-change-status').textContent = 'Vault re-encrypted. Other sign-in sessions were revoked.';
      alertStatus('Your GoreeCloud Finances password has been changed.');
    } catch (error) {
      $('password-change-status').textContent = 'Password not changed: ' + error.message;
      alertStatus('Could not change password: ' + error.message, true);
    } finally { button.disabled = false; }
  });
  $('refresh').addEventListener('click', () => refresh('manual'));
  $('query').addEventListener('input', renderTransactions);
  $('mask').addEventListener('click', () => { mask = !mask; $('mask').textContent = mask ? 'Show amounts' : 'Hide amounts'; render(); });
  $('logout').addEventListener('click', async () => {
    try { await api('logout'); } catch { /* local state still cleared */ }
    csrf = null; details = null; $('entries').replaceChildren(); $('institutions').replaceChildren();
    $('auth-form').reset(); authScreen(false); alertStatus('Signed out.');
  });
  const select = $('institution'); for (const p of PROVIDERS) select.append(new Option(p, p));
  $('import-form').addEventListener('submit', async event => {
    event.preventDefault(); const file = $('csv').files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { alertStatus('File exceeds 2 MB', true); return; }
    const button = $('import-form').querySelector('button'); button.disabled = true;
    try {
      const result = await api('import', { institution: $('institution').value, label: $('label').value, csv: await file.text() });
      await loadDashboard(); alertStatus('Imported ' + result.added + ' rows (' + result.duplicates + ' duplicates skipped).');
      $('csv').value = '';
    } catch (error) { alertStatus(error.message, true); } finally { button.disabled = false; }
  });
  start();
})();
