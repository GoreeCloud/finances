/* In-memory only; no outbound request, browser storage, or service worker APIs. */
'use strict';
(function () {
  const api = window.GoreeFinances;
  let records = [];
  let maskAmounts = false;
  let currentPage = 0;
  let importBusy = false;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('en-US');
  const allNames = api.INSTITUTIONS;

  function setText(id, value) { $(id).textContent = value; }
  function money(value) { return maskAmounts ? '••••••' : api.formatCents(value); }
  function clearChildren(element) { element.replaceChildren(); }
  function node(tag, className, content) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  }
  function updateStatus(message, error = false) {
    const status = $('result'); status.textContent = message;
    status.dataset.error = error ? 'true' : 'false';
  }

  function render() {
    let visible;
    try {
      visible = api.filterTransactions(records, {
        institution: $('filter-institution').value, query: $('search').value,
        start: $('start-date').value, end: $('end-date').value
      });
      $('filter-error').textContent = '';
    } catch (error) {
      $('filter-error').textContent = error.message;
      visible = [];
    }
    const totals = api.summarize(visible);
    setText('metric-net', money(totals.net));
    setText('metric-in', money(totals.inflow));
    setText('metric-out', money(totals.outflow));
    setText('metric-count', number.format(totals.count));
    setText('record-count', `${number.format(visible.length)} transactions shown`);
    const counts = new Map(allNames.map(name => [name, 0]));
    for (const row of records) counts.set(row.institution, counts.get(row.institution) + 1);
    for (const element of document.querySelectorAll('[data-institution-status]')) {
      const name = element.getAttribute('data-institution-status');
      const count = counts.get(name);
      element.textContent = count ? `${number.format(count)} local rows` : 'No local data';
    }
    const body = $('transactions'); clearChildren(body);
    const page = api.paginateTransactions(visible, currentPage);
    currentPage = page.page;
    for (const record of page.rows) {
      const tr = document.createElement('tr');
      tr.append(node('td', '', record.date), node('td', 'tx-detail', record.description),
        node('td', 'tx-institution', `${record.institution} · ${record.accountLabel}`),
        node('td', `tx-amount ${record.cents < 0n ? 'negative' : 'positive'}`, money(record.cents)));
      body.append(tr);
    }
    $('table-empty').hidden = page.total > 0;
    setText('table-note', page.total ? `Page ${page.page + 1} of ${page.pages} · ${number.format(page.total)} matching rows` : '');
    $('page-prev').disabled = page.page === 0;
    $('page-next').disabled = page.page >= page.pages - 1;
    const spend = api.summarizeSpendingByInstitution(visible);
    const chart = $('spend-chart'); clearChildren(chart);
    const maximum = [...spend.values()].reduce((max, v) => v > max ? v : max, 0n);
    for (const name of allNames) {
      const amount = spend.get(name);
      const item = node('div', 'chart-row');
      const head = node('div', 'chart-head');
      head.append(node('span', '', name), node('span', '', money(amount)));
      const track = node('div', 'chart-track');
      const fill = node('div', 'chart-fill');
      const percentage = maximum === 0n ? 0 : Number(amount * 100n / maximum);
      fill.style.width = `${percentage}%`;
      track.append(fill); item.append(head, track); chart.append(item);
    }
    const accountBody = $('account-rows'); clearChildren(accountBody);
    const accounts = api.summarizeByAccount(visible);
    for (const item of accounts) {
      const tr = document.createElement('tr');
      tr.append(node('th', '', `${item.institution} · ${item.accountLabel}`),
        node('td', '', item.firstDate), node('td', '', item.lastDate),
        node('td', '', number.format(item.count)), node('td', '', money(item.net)));
      accountBody.append(tr);
    }
    $('account-empty').hidden = accounts.length > 0;
    const monthly = api.summarizeByMonth(visible);
    const monthBody = $('monthly-rows'); clearChildren(monthBody);
    for (const item of monthly.slice(0, 24)) {
      const tr = document.createElement('tr');
      tr.append(node('th', '', item.month), node('td', '', number.format(item.count)),
        node('td', '', money(item.inflow)), node('td', '', money(item.outflow)),
        node('td', '', money(item.net)));
      monthBody.append(tr);
    }
    $('monthly-empty').hidden = monthly.length > 0;
    setText('monthly-note', monthly.length > 24 ? `Showing latest 24 of ${monthly.length} months.` : 'Monthly flows are not account balances.');
    $('clear').disabled = records.length === 0 || importBusy;
  }

  for (const name of allNames) {
    $('institution').append(new Option(name, name));
    $('filter-institution').append(new Option(name, name));
    const item = node('div', 'institution');
    const detail = node('div', 'institution-info');
    detail.append(node('strong', '', name), node('span', 'small', 'Live connection disabled'));
    const count = node('span', 'institution-state', 'No local data');
    count.setAttribute('data-institution-status', name);
    item.append(detail, count); $('institutions').append(item);
  }

  $('import-form').addEventListener('submit', async event => {
    event.preventDefault();
    const files = Array.from($('statement').files || []);
    if (!files.length) { updateStatus('Choose one or more CSV statements first.', true); return; }
    if (files.length > api.MAX_FILES) { updateStatus('Choose at most 20 files per import.', true); return; }
    if (importBusy) return;
    const button = $('analyze'); importBusy = true; button.disabled = true; $('clear').disabled = true;
    try {
      const batches = [];
      for (const file of files) {
        if (file.size > api.MAX_IMPORT_BYTES) throw new Error(`${file.name}: file exceeds 2 MB`);
        const raw = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        batches.push(api.parseStatement(text, $('institution').value, $('account-label').value));
      }
      const merged = api.mergeStatements(records, batches);
      records = merged.records;
      $('statement').value = '';
      updateStatus(`${merged.added} new rows imported; ${merged.duplicates} exact-match rows skipped. Stored only in browser memory. No upload.`);
      render();
    } catch (error) {
      updateStatus(`Import rejected; existing data unchanged. ${error.message}`, true);
    } finally { importBusy = false; button.disabled = false; render(); }
  });
  function resetPageAndRender() { currentPage = 0; render(); }
  $('filter-institution').addEventListener('change', resetPageAndRender);
  $('search').addEventListener('input', resetPageAndRender);
  $('start-date').addEventListener('change', resetPageAndRender);
  $('end-date').addEventListener('change', resetPageAndRender);
  $('page-prev').addEventListener('click', () => { currentPage = Math.max(0, currentPage - 1); render(); });
  $('page-next').addEventListener('click', () => { currentPage++; render(); });
  $('mask').addEventListener('change', event => { maskAmounts = event.target.checked; render(); });
  $('clear').addEventListener('click', () => {
    if (importBusy) return;
    records = []; currentPage = 0; $('statement').value = ''; $('search').value = ''; $('filter-institution').value = 'all';
    $('start-date').value = ''; $('end-date').value = '';
    updateStatus('Session cleared. No records are retained by this app.'); render();
  });
  render();
})();
