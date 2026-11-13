// Local single-owner encrypted vault. No password, transaction or access token is logged.
import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, open, rename, unlink, stat, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const scrypt = promisify(scryptCallback);
const COST = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const utf8 = x => Buffer.from(JSON.stringify(x), 'utf8');
const empty = () => ({ version: 1, items: [], imports: [] });
export const validUsername = v => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/.test(v);
export const validPassword = v => typeof v === 'string' && v.length >= 12 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);

async function derive(password, salt) { return scrypt(password, salt, 32, COST); }
function encrypt(key, value, salt, username) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // The public account identifier and KDF parameters are authenticated too.
  cipher.setAAD(Buffer.from(username + '|1|' + salt.toString('base64'), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(utf8(value)), cipher.final()]);
  return { version: 1, username, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decrypt(key, envelope) {
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  dec.setAAD(Buffer.from(envelope.username + '|1|' + envelope.salt, 'utf8'));
  dec.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const raw = Buffer.concat([dec.update(Buffer.from(envelope.ciphertext, 'base64')), dec.final()]);
  const result = JSON.parse(raw.toString('utf8'));
  if (result?.version !== 1 || !Array.isArray(result.items) || !Array.isArray(result.imports)) throw new Error('Unsupported vault data');
  return result;
}
async function rejectSymlink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Vault symlinks are not supported'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function makeVault(path) {
  const file = resolve(path);
  async function ensureParent() {
    const parent = dirname(file);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await rejectSymlink(parent);
    const info = await stat(parent);
    if ((info.mode & 0o077) !== 0) throw new Error('Private vault directory must not be accessible to group or others');
  }
  async function getEnvelope() {
    await rejectSymlink(file);
    const fd = await open(file, 'r');
    try { const info = await fd.stat(); if ((info.mode & 0o077) !== 0) throw new Error('Vault file permissions are too broad');
      if (info.size > 12_000_000) throw new Error('Vault exceeds 12MB limit');
      const data = await fd.readFile('utf8');
      const parsed = JSON.parse(data);
      if (parsed?.version !== 1 || !validUsername(parsed.username)) throw new Error('Unsupported vault version');
      return parsed;
    } finally { await fd.close(); }
  }
  async function exists() { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  async function setup(username, password) {
    if (!validUsername(username) || !validPassword(password)) throw new Error('Invalid username or password policy');
    await ensureParent();
    const salt = randomBytes(24);
    const key = await derive(password, salt);
    const fd = await open(file, 'wx', 0o600);
    try { await fd.writeFile(JSON.stringify(encrypt(key, empty(), salt, username))); await fd.sync(); }
    catch (error) { await fd.close(); await unlink(file).catch(() => {}); key.fill(0); throw error; }
    await fd.close();
    return { key, state: empty(), username };
  }
  async function unlock(username, password) {
    const envelope = await getEnvelope();
    // A wrong name takes the same expensive KDF path as a wrong password.
    const key = await derive(password, Buffer.from(envelope.salt, 'base64'));
    try {
      const match = Buffer.from(username || '', 'utf8');
      const expected = Buffer.from(envelope.username, 'utf8');
      const same = match.length === expected.length && timingSafeEqual(match, expected);
      const state = decrypt(key, envelope);
      if (!same) throw new Error('Invalid username or password');
      return { key, state, username: envelope.username };
    } catch { key.fill(0); throw new Error('Invalid username or password'); }
  }
  async function readWithKey(key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid unlock key');
    return decrypt(key, await getEnvelope());
  }
  async function atomicSave(envelope) {
    const encoded = Buffer.from(JSON.stringify(envelope));
    if (encoded.length > 12_000_000) throw new Error('Vault capacity exceeded');
    const temp = file + '.' + randomBytes(12).toString('hex') + '.tmp';
    const fd = await open(temp, 'wx', 0o600);
    try {
      await fd.writeFile(encoded);
      await fd.sync();
      await fd.close();
      await rename(temp, file);
    } catch (error) {
      await fd.close().catch(() => {});
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
  async function save(key, value) {
    const existing = await getEnvelope();
    // A stale key must never overwrite the vault after credential rotation.
    decrypt(key, existing);
    await atomicSave(encrypt(key, value, Buffer.from(existing.salt, 'base64'), existing.username));
  }
  async function rotate(key, currentPassword, nextPassword) {
    if (!validPassword(nextPassword) || nextPassword === currentPassword) {
      throw Object.assign(new Error('Choose a different password of 12–256 characters'), { status: 400 });
    }
    if (!validPassword(currentPassword)) throw Object.assign(new Error('Invalid current password'), { status: 401 });
    const existing = await getEnvelope();
    const oldKey = await derive(currentPassword, Buffer.from(existing.salt, 'base64'));
    const verified = Buffer.isBuffer(key) && key.length === 32 && timingSafeEqual(oldKey, key);
    oldKey.fill(0);
    if (!verified) throw Object.assign(new Error('Invalid current password'), { status: 401 });
    // Decrypt before writing to guarantee state preservation or fail unchanged.
    const state = decrypt(key, existing);
    const nextSalt = randomBytes(24);
    const nextKey = await derive(nextPassword, nextSalt);
    try {
      await atomicSave(encrypt(nextKey, state, nextSalt, existing.username));
      return { key: nextKey, username: existing.username };
    } catch (error) { nextKey.fill(0); throw error; }
  }
  return { file, exists, setup, unlock, readWithKey, save, rotate };
}
