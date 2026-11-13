// Copies only encrypted vault bytes. Never writes plaintext financial data.
import { open, lstat, mkdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validUsername } from '../server/vault.mjs';

const MAX_BYTES = 12_000_000;
const defaultVault = () => join(homedir(), '.local', 'share', 'goreecloud-finances', 'vault.json');
const defaultBackupDir = () => join(homedir(), '.local', 'share', 'goreecloud-finances', 'backups');

async function privateFolder(folder) {
  const path = resolve(folder);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('Backup folder must be a private, non-symlink directory (mode 0700)');
  }
  return path;
}
function base64Size(value, size) {
  return typeof value === 'string' && value.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value &&
    (size == null || Buffer.from(value, 'base64').length === size);
}
function verifyEnvelope(data) {
  if (data.length === 0 || data.length > MAX_BYTES) throw new Error('Encrypted backup size is invalid');
  let envelope;
  try { envelope = JSON.parse(data.toString('utf8')); }
  catch { throw new Error('Invalid encrypted vault backup format'); }
  if (envelope?.version !== 1 || !validUsername(envelope.username) ||
    !base64Size(envelope.salt, 24) || !base64Size(envelope.iv, 12) ||
    !base64Size(envelope.tag, 16) || !base64Size(envelope.ciphertext)) {
    throw new Error('Invalid encrypted vault backup metadata');
  }
  // Format check only. Password and AES-GCM integrity are verified at login.
  return data;
}
async function readSealed(source) {
  const fd = await open(resolve(source), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 ||
        info.size === 0 || info.size > MAX_BYTES) {
      throw new Error('Encrypted source must be a private regular file (mode 0600)');
    }
    return verifyEnvelope(await fd.readFile());
  } finally { await fd.close(); }
}
async function writeExclusive(destination, bytes) {
  const fd = await open(destination, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); await fd.close(); return destination; }
  catch (error) { await fd.close().catch(() => {}); await unlink(destination).catch(() => {}); throw error; }
}
export async function backupVault(dataFile, backupFolder = defaultBackupDir()) {
  const source = resolve(dataFile);
  const bytes = await readSealed(source);
  const folder = await privateFolder(backupFolder);
  const output = join(folder, 'vault-' + new Date().toISOString().replace(/[:.]/g, '-') +
    '-' + randomBytes(5).toString('hex') + '.encrypted.json');
  if (output === source) throw new Error('Backup destination cannot be the vault');
  return writeExclusive(output, bytes);
}
export async function restoreVault(backupFile, targetFile) {
  const source = resolve(backupFile), target = resolve(targetFile);
  if (source === target) throw new Error('Backup source cannot equal destination');
  const bytes = await readSealed(source);
  await privateFolder(dirname(target));
  return writeExclusive(target, bytes); // O_EXCL, never overwrites an existing vault
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  const dataFile = process.env.GOREE_FINANCES_DATA_FILE || defaultVault();
  if (action === 'backup' && args.length === 0) {
    const output = await backupVault(dataFile, process.env.GOREE_FINANCES_BACKUP_DIR || defaultBackupDir());
    console.log('Encrypted vault backup written to:', output);
  } else if (action === 'restore' && args.length === 1) {
    const output = await restoreVault(args[0], dataFile);
    console.log('Encrypted vault restored to:', output);
    console.log('Unlock it with the password used when the backup was created.');
  } else {
    throw new Error('Usage: npm run vault:backup OR npm run vault:restore -- /path/to/private/encrypted-backup.json');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Encrypted vault operation failed:', error.message); process.exitCode = 1; });
}
