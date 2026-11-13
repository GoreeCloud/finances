'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../app/finance.js');
const header = 'date,description,amount\n';
const parse = (rows, institution = 'PayPal', account = 'Primary') => f.parseStatement(header + rows, institution, account);

test('all seven institutions', () => assert.equal(f.INSTITUTIONS.length, 7));
test('strict cents without float errors', () => {
 assert.equal(f.amountToCents('0.10') + f.amountToCents('0.20'), 30n);
 assert.equal(f.formatCents(-1_234_567_890_123n), '-$12,345,678,901.23');
});
test('supports quoted commas and escaped quotes', () => {
 const rows = parse('2026-11-01,"Store, Inc. ""East""",-12.50\r\n');
 assert.equal(rows[0].description, 'Store, Inc. "East"');
 assert.equal(rows[0].cents, -1250n);
});
test('quoted embedded CRLF is a single row', () => {
 const rows = parse('2026-11-01,"Line one\r\nLine two",2.00\n');
 assert.equal(rows.length, 1); assert.equal(rows[0].description, 'Line one\r\nLine two');
});
test('UTF-8 BOM and blank records are accepted', () => {
 const rows = f.parseStatement('\uFEFF' + header + '\n2026-11-01,Deposit,1.00\n\n', 'PayPal');
 assert.equal(rows.length, 1);
});
test('rejects malformed quotes and trailing columns', () => {
 for (const bad of ['2026-11-01,"bad,1.00\n', '2026-11-01,"ok"bad,1.00\n', '2026-11-01,wrong,1,extra\n']) {
   assert.throws(() => parse(bad));
 }
});
test('rejects NaN, exponent, overprecise, negative zero padding, and bounds', () => {
 for (const bad of ['NaN', 'Infinity', '1e5', '1.123', '01.00', '1000000000.01']) {
  assert.throws(() => parse(`2026-11-01,A,${bad}\n`), bad);
 }
});
test('invalid calendar dates rejected including leap-year edge', () => {
 for (const bad of ['2026-02-29', '2026-11-31', '1899-01-01', '20261101']) {
  assert.throws(() => parse(`${bad},A,1\n`));
 }
 assert.equal(parse('2024-02-29,A,1\n').length, 1);
});
test('exact-match reimport is idempotent but repeat occurrences are retained', () => {
 const batch = parse('2026-11-01,Store,-1.20\n2026-11-01,Store,-1.20\n');
 assert.equal(batch[0].key === batch[1].key, false);
 const first = f.mergeStatements([], [batch]);
 assert.deepEqual([first.added, first.duplicates], [2, 0]);
 const second = f.mergeStatements(first.records, [batch]);
 assert.deepEqual([second.added, second.duplicates], [0, 2]);
});
test('same transaction from a different institution and account is not deduped', () => {
 const one = parse('2026-11-01,Store,-1.20\n', 'PayPal', 'Personal');
 const two = parse('2026-11-01,Store,-1.20\n', 'Capital One', 'Personal');
 const three = parse('2026-11-01,Store,-1.20\n', 'PayPal', 'Savings');
 const result = f.mergeStatements([], [one, two, three]);
 assert.equal(result.added, 3);
});
test('summary calculates net movement not a balance', () => {
 const rows = parse('2026-11-01,Pay,13.24\n2026-11-02,Food,-5.19\n');
 assert.deepEqual(f.summarize(rows), {count:2,inflow:1324n,outflow:519n,net:805n});
});
test('batch merge atomic on session-limit error', () => {
 const previous = parse('2026-11-01,Food,-1.00\n');
 const unsafe = new Array(f.MAX_SESSION_ROWS).fill(null).map((_, i) => ({ key:`new${i}`,cents:1n }));
 assert.throws(() => f.mergeStatements(previous, [unsafe]));
 assert.equal(previous.length, 1);
});
test('account label and invalid UTF-8 payload rules', () => {
 assert.throws(() => parse('2026-11-01,A,1\n', 'PayPal', 'bad\nlabel'));
 assert.throws(() => parse('2026-11-01,A,1\n', 'PayPal', 'x'.repeat(65)));
 assert.throws(() => parse('2026-11-01,Null\u0000,1\n'));
});

test('date filters are inclusive and preserve exact cents', () => {
 const rows = parse('2026-11-01,Alpha,-1.01\n2026-11-02,Beta,-2.02\n2026-11-03,Gamma,3.03\n');
 const filtered = f.filterTransactions(rows, { start: '2026-11-02', end: '2026-11-03' });
 assert.equal(filtered.length, 2);
 assert.equal(f.summarize(filtered).net, 101n);
});
test('date filters reject impossible and reversed dates', () => {
 assert.throws(() => f.filterTransactions([], {start: '2026-02-29'}));
 assert.throws(() => f.filterTransactions([], {start: '2026-11-02', end: '2026-11-01'}));
});
test('search and institution filters compose without mutating source', () => {
 const rows = [ ...parse('2026-11-01,Store,-1.00\n', 'PayPal'),
   ...parse('2026-11-02,Store,-2.00\n', 'Discover') ];
 const out = f.filterTransactions(rows, { institution: 'PayPal', query: 'store' });
 assert.equal(out.length, 1);
 assert.equal(rows[0].institution, 'PayPal');
 assert.equal(rows.length, 2);
});
test('pagination reaches beyond the first hundred and clamps safely', () => {
 const rows = Array.from({length: 205}, (_, i) => ({key: String(i), date:'2026-11-01'}));
 assert.deepEqual([f.paginateTransactions(rows, 0).rows.length,
  f.paginateTransactions(rows, 1).rows.length,
  f.paginateTransactions(rows, 2).rows.length], [100,100,5]);
 assert.equal(f.paginateTransactions(rows, 999).page, 2);
 assert.throws(() => f.paginateTransactions(rows, -1));
});

test('monthly aggregation is sorted newest first and exact to the cent', () => {
 const rows = parse('2026-10-01,Food,-0.20\n2026-11-01,Pay,10.10\n2026-11-02,Food,-0.30\n');
 const months = f.summarizeByMonth(rows);
 assert.deepEqual(months.map(x => x.month), ['2026-11', '2026-10']);
 assert.deepEqual([months[0].count, months[0].inflow, months[0].outflow, months[0].net], [2, 1010n, 30n, 980n]);
 assert.equal(months[1].net, -20n);
});
test('monthly summary rejects invalid dates and amounts', () => {
 assert.throws(() => f.summarizeByMonth([{date:'2026-02-30', cents:1n}]));
 assert.throws(() => f.summarizeByMonth([{date:'2026-11-01', cents:0.01}]));
});
test('institution spending uses filtered records and does not count deposits', () => {
 const records = [...parse('2026-11-01,Store,-1.20\n2026-11-02,Deposit,5.00\n','PayPal'),
 ...parse('2026-11-02,Store,-2.30\n','Discover')];
 const filtered = f.filterTransactions(records, {institution:'PayPal'});
 const spending = f.summarizeSpendingByInstitution(filtered);
 assert.equal(spending.get('PayPal'), 120n);
 assert.equal(spending.get('Discover'), 0n);
});
test('institution spending fails closed on malformed records', () => {
 assert.throws(() => f.summarizeSpendingByInstitution([{institution:'Unknown', cents:-1n}]));
});

test('account audit preserves exact cents and date coverage across labels', () => {
 const rows = [ ...parse('2026-11-03,Shop,-0.20\n2026-11-01,Pay,10.10\n', 'PayPal', 'A'),
   ...parse('2026-11-02,Shop,-1.50\n', 'PayPal', 'B') ];
 const groups = f.summarizeByAccount(rows);
 assert.equal(groups.length, 2);
 assert.deepEqual([groups[0].count, groups[0].firstDate, groups[0].lastDate, groups[0].net],
  [2, '2026-11-01', '2026-11-03', 990n]);
 assert.equal(groups[1].net, -150n);
});
test('account audit rejects malformed records rather than inventing totals', () => {
 assert.throws(() => f.summarizeByAccount([{institution:'PayPal', accountLabel:'A', date:'2026-02-30', cents:1n}]));
 assert.throws(() => f.summarizeByAccount([{institution:'Other', accountLabel:'A', date:'2026-11-01', cents:1n}]));
});
test('account audit honors composed filters without changing originals', () => {
 const rows = [ ...parse('2026-11-01,Food,-1.00\n', 'PayPal', 'A'),
   ...parse('2026-10-01,Food,-2.00\n', 'PayPal', 'A') ];
 const filtered = f.filterTransactions(rows, {start:'2026-11-01'});
 assert.equal(f.summarizeByAccount(filtered)[0].net, -100n);
 assert.equal(rows.length, 2);
});
