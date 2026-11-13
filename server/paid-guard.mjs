// Local-only reservation journal for optional Plaid calls that can incur charges.
// One reservation is durably recorded BEFORE the outgoing API call. The journal
// contains no account/token identifiers, balances, transaction contents or secrets.
import { mkdir, lstat, open, unlink, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHmac } from 'node:crypto';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PAID_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_LEDGER_BYTES = 150_000;
const MAX_ENTRIES = 1000;
const CODE = 'PAID_GUARD_UNAVAILABLE';
const operations = new Set(['balance', 'transactions']);
export const defaultLedgerFile = () => join(homedir(), '.local', 'share', 'goreecloud-finances', 'paid-requests.json');

export function validCap(value) {
  return typeof value === 'string' && /^(?:[1-9]|[1-9][0-9]|100)$/.test(value);
}

function unsafe() {
  const error = new Error('Paid request ledger unavailable; only cached data may be checked');
  error.code = CODE;
  return error;
}
async function privateDirectory(file) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw unsafe();
  return dir;
}
function validLedger(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.highWater) ||
      value.highWater < 0 || typeof value.salt !== 'string' || !Array.isArray(value.entries) ||
      value.entries.length > MAX_ENTRIES) return false;
  const raw = Buffer.from(value.salt, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== value.salt) return false;
  return value.entries.every(entry => entry && operations.has(entry.op) &&
    typeof entry.key === 'string' && /^[0-9a-f]{64}$/.test(entry.key) &&
    Number.isSafeInteger(entry.at) && entry.at >= 0 && entry.at <= value.highWater);
}
async function readLedger(file) {
  let fd;
  try { fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, highWater: 0, salt: randomBytes(32).toString('base64'), entries: [] };
    throw unsafe();
  }
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        stat.size < 1 || stat.size > MAX_LEDGER_BYTES) throw unsafe();
    let data;
    try { data = JSON.parse(await fd.readFile('utf8')); } catch { throw unsafe(); }
    if (!validLedger(data)) throw unsafe();
    return data;
  } finally { await fd.close(); }
}
async function atomicLedger(file, ledger) {
  const encoded = Buffer.from(JSON.stringify(ledger));
  if (encoded.length > MAX_LEDGER_BYTES) throw unsafe();
  const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  const fd = await open(tmp, 'wx', 0o600);
  try {
    await fd.writeFile(encoded);
    await fd.sync();
    await fd.close();
    await rename(tmp, file);
    // Persist the replacement directory entry; failure is fail-closed for billing.
    const dirFd = await open(dirname(file), 'r');
    try { await dirFd.sync(); } finally { await dirFd.close(); }
  } catch (error) {
    await fd.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

// This is a conservative request COUNT gate, not a currency spending cap.
// Reservations are consumed even when Plaid times out or rejects the request.
export function makePaidGuard({ file = defaultLedgerFile(), dailyLimit, itemDailyLimit,
  clock = Date.now } = {}) {
  const ledgerFile = resolve(file);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100 ||
      !Number.isInteger(itemDailyLimit) || itemDailyLimit < 1 || itemDailyLimit > dailyLimit) {
    throw new Error('Explicit paid request caps must be positive integers with a total cap of at most 100');
  }
  async function reserve(itemId, operation) {
    if (typeof itemId !== 'string' || !itemId || !operations.has(operation)) throw unsafe();
    // Exclusive file creation is cross-process. Stale locks are never auto-broken:
    // a crashed writer can only reduce billing, never silently reset allowance.
    await privateDirectory(ledgerFile);
    const lock = ledgerFile + '.lock';
    let fd;
    try { fd = await open(lock, 'wx', 0o600); } catch { throw unsafe(); }
    try {
      const ledger = await readLedger(ledgerFile);
      const now = clock();
      if (!Number.isSafeInteger(now) || now < ledger.highWater) throw unsafe();
      const key = createHmac('sha256', Buffer.from(ledger.salt, 'base64')).update(itemId).digest('hex');
      const entries = ledger.entries.filter(entry => now - entry.at < DAY_MS);
      const itemEntries = entries.filter(entry => entry.key === key);
      const opEntries = itemEntries.filter(entry => entry.op === operation);
      if (entries.length >= dailyLimit) return { allowed: false, reason: 'daily-cap' };
      if (itemEntries.length >= itemDailyLimit) return { allowed: false, reason: 'item-cap' };
      if (opEntries.some(entry => now - entry.at < PAID_COOLDOWN_MS)) return { allowed: false, reason: 'cooldown' };
      entries.push({ key, op: operation, at: now });
      await atomicLedger(ledgerFile, { version: 1, salt: ledger.salt, highWater: now, entries });
      return { allowed: true, at: now };
    } catch { throw unsafe(); }
    finally {
      await fd.close().catch(() => {});
      await unlink(lock).catch(() => {}); // private owner directory; stale locks block new reservations
    }
  }
  return { reserve, file: ledgerFile, dailyLimit, itemDailyLimit };
}
