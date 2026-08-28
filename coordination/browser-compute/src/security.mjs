import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const CONTEXT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
const TARGET_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;

export function validateProfileId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!PROFILE_ID_RE.test(id)) throw new Error('profile_id_invalid');
  return id;
}

export function validateTargetId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!TARGET_ID_RE.test(id)) throw new Error('target_id_invalid');
  return id;
}

export function validateContextId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!CONTEXT_ID_RE.test(id)) throw new Error('context_id_invalid');
  return id;
}

export function validateNavigationUrl(value) {
  const raw = String(value || 'about:blank').trim();
  if (raw === 'about:blank') return raw;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('target_url_scheme_forbidden');
  url.username = '';
  url.password = '';
  return url.toString();
}

export function defaultStateRoot() {
  if (process.env.A2_COMPUTE_STATE_ROOT) return path.resolve(process.env.A2_COMPUTE_STATE_ROOT);
  return path.join(os.homedir(), '.metaengine', 'a2-compute-browser');
}

export async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700).catch(() => {});
}

export async function atomicJsonWrite(file, value) {
  const dir = path.dirname(file);
  await ensurePrivateDir(dir);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
  if (process.platform !== 'win32') await fs.chmod(file, 0o600).catch(() => {});
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return structuredClone(fallback); throw error; }
}

export async function rotateControlToken(root) {
  await ensurePrivateDir(root);
  const file = path.join(root, 'control-token');
  const token = crypto.randomBytes(32).toString('hex');
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, `${token}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
  if (process.platform !== 'win32') await fs.chmod(file, 0o600).catch(() => {});
  return { token, file };
}

export function rpcEndpoint(root) {
  if (process.platform === 'win32') {
    const user = String(os.userInfo().username || 'user').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    return `\\\\.\\pipe\\metaengine-a2-compute-browser-${user}`;
  }
  return path.join(root, 'control.sock');
}
