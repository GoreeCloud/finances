/* GoreeCloud Finances: pure, dependency-free, offline statement parsing and reconciliation.
 * Financial amounts are integer cents (BigInt), never floating-point.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoreeFinances = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const INSTITUTIONS = Object.freeze([
    'Navy Federal Credit Union', 'Cash App', 'Varo', 'Capital One',
    'Marcus by Goldman Sachs', 'Discover', 'PayPal'
  ]);
  const MAX_IMPORT_BYTES = 2_000_000;
  const MAX_ROWS = 10_000;
  const MAX_SESSION_ROWS = 100_000;
  const MAX_FILES = 20;
  const MAX_ACCOUNT_LABEL = 64;
  const MONEY_RE = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isValidDate(text) {
    const found = DATE_RE.exec(text);
    if (!found) return false;
    const y = Number(found[1]), m = Number(found[2]), d = Number(found[3]);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
    const days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
  }

  function amountToCents(value) {
    if (typeof value !== 'string') throw new Error('Invalid amount');
    const match = MONEY_RE.exec(value);
    if (!match) throw new Error('Invalid amount: use dollars and up to two decimal places');
    const dollars = BigInt(match[2]);
    const cents = dollars * 100n + BigInt((match[3] || '').padEnd(2, '0') || '0');
    if (cents > 100_000_000_000n) throw new Error('Amount is outside the supported range');
    return match[1] === '-' ? -cents : cents;
  }

  function formatCents(cents) {
    if (typeof cents !== 'bigint') throw new TypeError('Expected integer cents');
    const sign = cents < 0n ? '-' : '';
    const absolute = cents < 0n ? -cents : cents;
    const dollars = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}$${dollars}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  // Strict RFC4180-style scanner: supports quoted commas, double quotes,
  // embedded CRLFs, and rejects unescaped quotation marks.
  function readCsv(text) {
    if (typeof text !== 'string') throw new TypeError('Statement must be UTF-8 text');
    const rows = [];
    const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    let row = [], field = '', quoted = false, closedQuote = false, started = false;
    function pushField() { row.push(field); field = ''; closedQuote = false; started = false; }
    function pushRow() {
      pushField();
      // Skip wholly empty physical lines like Python csv.DictReader.
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error('Too many rows (maximum 10,000)');
    }
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quoted) {
        if (c === '"') {
          if (input[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closedQuote = true; }
        } else { field += c; }
      } else if (closedQuote) {
        if (c === ',') pushField();
        else if (c === '\r' || c === '\n') { if (c === '\r' && input[i + 1] === '\n') i++; pushRow(); }
        else throw new Error('Unexpected text after quoted field');
      } else if (c === '"') {
        if (field.length || started) throw new Error('Unescaped quote in CSV field');
        quoted = true; started = true;
      } else if (c === ',') pushField();
      else if (c === '\r' || c === '\n') { if (c === '\r' && input[i + 1] === '\n') i++; pushRow(); }
      else { field += c; started = true; }
    }
    if (quoted) throw new Error('Unclosed quoted field');
    if (field.length || row.length || started || closedQuote) pushRow();
    return rows;
  }

  function parseStatement(text, institution, accountLabel = 'Primary') {
    if (!INSTITUTIONS.includes(institution)) throw new Error('Unknown institution');
    if (typeof accountLabel !== 'string' || accountLabel.length > MAX_ACCOUNT_LABEL ||
        !accountLabel.trim() || /[\x00-\x1f\x7f]/.test(accountLabel)) {
      throw new Error('Account label must be 1–64 characters without control characters');
    }
    if (typeof text !== 'string') throw new Error('Statement must be UTF-8 text');
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('File exceeds 2 MB');
    if (text.includes('\0')) throw new Error('NUL bytes are not allowed');
    const rows = readCsv(text);
    if (!rows.length || JSON.stringify(rows[0]) !== '["date","description","amount"]') {
      throw new Error('Expected columns exactly: date,description,amount');
    }
    if (rows.length - 1 > MAX_ROWS) throw new Error('Too many rows');
    const normalizedAccount = accountLabel.trim();
    const seen = new Map();
    return rows.slice(1).map((cells, index) => {
      if (cells.length !== 3) throw new Error(`Row ${index + 2}: expected three fields`);
      const [date, rawDescription, rawAmount] = cells;
      const description = rawDescription.trim();
      if (!isValidDate(date)) throw new Error(`Row ${index + 2}: invalid ISO calendar date`);
      if (!description || description.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) {
        throw new Error(`Row ${index + 2}: invalid description`);
      }
      let cents;
      try { cents = amountToCents(rawAmount); }
      catch (error) { throw new Error(`Row ${index + 2}: ${error.message}`); }
      const signature = JSON.stringify([institution, normalizedAccount, date, description, cents.toString()]);
      const occurrence = (seen.get(signature) || 0) + 1;
      seen.set(signature, occurrence);
      return Object.freeze({ institution, accountLabel: normalizedAccount, date, description, cents,
        // Occurrence ordinal protects distinct equal-value rows in the same statement.
        key: `${signature}#${occurrence}` });
    });
  }

  function mergeStatements(existing, batches) {
    if (!Array.isArray(existing) || !Array.isArray(batches)) throw new TypeError('Expected transaction arrays');
    if (existing.length > MAX_SESSION_ROWS) throw new Error('Session limit exceeded');
    const combined = [...existing];
    const keys = new Set(existing.map(row => row.key));
    let duplicates = 0, added = 0;
    for (const batch of batches) {
      if (!Array.isArray(batch)) throw new TypeError('Invalid statement batch');
      for (const tx of batch) {
        if (keys.has(tx.key)) { duplicates++; continue; }
        if (combined.length >= MAX_SESSION_ROWS) throw new Error('Session transaction limit reached');
        combined.push(tx); keys.add(tx.key); added++;
      }
    }
    return { records: combined, added, duplicates };
  }

  const PAGE_SIZE = 100;
  function filterTransactions(records, { institution = 'all', query = '', start = '', end = '' } = {}) {
    if (!Array.isArray(records)) throw new TypeError('Expected transaction array');
    if (institution !== 'all' && !INSTITUTIONS.includes(institution)) throw new Error('Invalid institution filter');
    if (typeof query !== 'string' || query.length > 300) throw new Error('Invalid search query');
    if ((start && !isValidDate(start)) || (end && !isValidDate(end))) throw new Error('Invalid date filter');
    if (start && end && start > end) throw new Error('Start date is after end date');
    const search = query.trim().toLocaleLowerCase();
    return records.filter(r => (institution === 'all' || r.institution === institution) &&
      (!start || r.date >= start) && (!end || r.date <= end) &&
      (!search || r.description.toLocaleLowerCase().includes(search) ||
        r.accountLabel.toLocaleLowerCase().includes(search)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  }

  function paginateTransactions(records, page = 0, pageSize = PAGE_SIZE) {
    if (!Array.isArray(records) || !Number.isSafeInteger(page) || page < 0 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error('Invalid pagination request');
    }
    const pages = Math.max(1, Math.ceil(records.length / pageSize));
    const currentPage = Math.min(page, pages - 1);
    return Object.freeze({ rows: records.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
      page: currentPage, pages, total: records.length });
  }

  // Pure monthly activity summary; excludes balances and makes no transfer claims.
  function summarizeByMonth(records) {
    if (!Array.isArray(records)) throw new TypeError('Expected transaction array');
    const months = new Map();
    for (const record of records) {
      if (!record || !isValidDate(record.date) || typeof record.cents !== 'bigint') {
        throw new Error('Invalid transaction in monthly summary');
      }
      const month = record.date.slice(0, 7);
      if (!months.has(month)) months.set(month, { month, count: 0, inflow: 0n, outflow: 0n });
      const value = months.get(month);
      value.count++;
      if (record.cents >= 0n) value.inflow += record.cents;
      else value.outflow -= record.cents;
    }
    return [...months.values()].sort((a, b) => b.month.localeCompare(a.month))
      .map(value => Object.freeze({ ...value, net: value.inflow - value.outflow }));
  }

  // Reconciliation preparation: aggregate statement movement by institution and
  // user-provided account label. These are NOT bank balances or proof of completeness.
  function summarizeByAccount(records) {
    if (!Array.isArray(records)) throw new TypeError('Expected transaction array');
    const accounts = new Map();
    for (const r of records) {
      if (!r || !INSTITUTIONS.includes(r.institution) ||
          typeof r.accountLabel !== 'string' || !r.accountLabel.trim() ||
          r.accountLabel.length > MAX_ACCOUNT_LABEL || !isValidDate(r.date) ||
          typeof r.cents !== 'bigint') throw new Error('Invalid transaction in account summary');
      const key = JSON.stringify([r.institution, r.accountLabel]);
      if (!accounts.has(key)) accounts.set(key, {
        institution: r.institution, accountLabel: r.accountLabel,
        count: 0, inflow: 0n, outflow: 0n, firstDate: r.date, lastDate: r.date
      });
      const entry = accounts.get(key);
      entry.count++;
      if (r.cents >= 0n) entry.inflow += r.cents;
      else entry.outflow -= r.cents;
      if (r.date < entry.firstDate) entry.firstDate = r.date;
      if (r.date > entry.lastDate) entry.lastDate = r.date;
    }
    return [...accounts.values()].sort((a, b) => a.institution.localeCompare(b.institution) ||
      a.accountLabel.localeCompare(b.accountLabel)).map(r =>
      Object.freeze({ ...r, net: r.inflow - r.outflow }));
  }

  function summarizeSpendingByInstitution(records) {
    if (!Array.isArray(records)) throw new TypeError('Expected transaction array');
    const totals = new Map(INSTITUTIONS.map(name => [name, 0n]));
    for (const record of records) {
      if (!totals.has(record.institution) || typeof record.cents !== 'bigint') {
        throw new Error('Invalid transaction in institution summary');
      }
      if (record.cents < 0n) totals.set(record.institution, totals.get(record.institution) - record.cents);
    }
    return totals;
  }

  function summarize(records) {
    let inflow = 0n, outflow = 0n;
    for (const record of records) {
      if (record.cents > 0n) inflow += record.cents;
      else outflow -= record.cents;
    }
    return { count: records.length, inflow, outflow, net: inflow - outflow };
  }

  return Object.freeze({ INSTITUTIONS, MAX_IMPORT_BYTES, MAX_ROWS, MAX_FILES,
    MAX_SESSION_ROWS, isValidDate, amountToCents, formatCents, readCsv,
    parseStatement, mergeStatements, summarize, summarizeByMonth, summarizeByAccount, summarizeSpendingByInstitution, filterTransactions, paginateTransactions, PAGE_SIZE });
});
