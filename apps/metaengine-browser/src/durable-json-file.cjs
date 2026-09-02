'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DURABLE_JSON_FILE_CONTRACT = 'METAENGINE_DURABLE_JSON_V1';
const WINDOWS_TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WINDOWS_RENAME_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100, 200, 400]);

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tempPath(target, sequence = 0) {
  return `${target}.${process.pid}.${Number(sequence) || 0}.${crypto.randomUUID()}.tmp`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transientWindowsRenameError(error, platform = process.platform) {
  return platform === 'win32' && WINDOWS_TRANSIENT_RENAME_CODES.has(String(error?.code || ''));
}

async function commitRenameWithReadback({
  temp,
  file,
  payload,
  platform = process.platform,
  renameImpl = fsp.rename,
  readFileImpl = fsp.readFile,
  unlinkImpl = fsp.unlink,
  sleepImpl = sleep,
  retryDelaysMs = WINDOWS_RENAME_RETRY_DELAYS_MS,
} = {}) {
  if (!temp || !file || typeof payload !== 'string') throw new Error('durable_json_rename_dependencies_required');
  const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : [];

  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameImpl(temp, file);
      return Object.freeze({ confirmation: 'RENAME', attempts: attempt + 1, authority_effect: false });
    } catch (error) {
      if (!transientWindowsRenameError(error, platform)) throw error;

      // A Windows sharing violation is retriable only after exact readback. If the
      // destination already contains this unique payload, the commit is proven and
      // replay is unnecessary. Otherwise the same temp file may be retried boundedly.
      let exactReadback = false;
      try {
        exactReadback = (await readFileImpl(file, 'utf8')) === payload;
      } catch (readError) {
        if (readError?.code !== 'ENOENT' && !transientWindowsRenameError(readError, platform)) throw readError;
      }
      if (exactReadback) {
        await unlinkImpl(temp).catch(() => {});
        return Object.freeze({ confirmation: 'EXACT_READBACK', attempts: attempt + 1, authority_effect: false });
      }

      if (attempt >= delays.length) throw error;
      const delayMs = Math.max(0, Number(delays[attempt]) || 0);
      if (delayMs > 0) await sleepImpl(delayMs);
    }
  }
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return false;
  const handle = await fsp.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  return true;
}

function syncDirectorySync(directory) {
  if (process.platform === 'win32') return false;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return true;
}

async function durableWriteJson(target, value, { mode = 0o600, sequence = 0 } = {}) {
  const file = String(target || '');
  if (!file) throw new Error('durable_json_target_required');
  const directory = path.dirname(file);
  const temp = tempPath(file, sequence);
  const payload = jsonPayload(value);
  let committed = false;
  let renameConfirmation = null;
  await fsp.mkdir(directory, { recursive: true });
  try {
    const handle = await fsp.open(temp, 'wx', mode);
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const rename = await commitRenameWithReadback({ temp, file, payload });
    committed = true;
    renameConfirmation = rename.confirmation;
    // On Windows fsync/FlushFileBuffers requires a write-capable handle. r+ does not
    // alter existing bytes; it only opens the committed file for the durability flush.
    const committedHandle = await fsp.open(file, 'r+');
    try { await committedHandle.sync(); } finally { await committedHandle.close(); }
    const directorySynced = await syncDirectory(directory);
    return Object.freeze({
      contract: DURABLE_JSON_FILE_CONTRACT,
      target: file,
      file_synced: true,
      directory_synced: directorySynced,
      rename_committed: true,
      rename_confirmation: renameConfirmation,
      platform: process.platform,
      authority_effect: false,
    });
  } catch (error) {
    if (!committed) await fsp.unlink(temp).catch(() => {});
    throw error;
  }
}

function durableWriteJsonSync(target, value, { mode = 0o600, sequence = 0 } = {}) {
  const file = String(target || '');
  if (!file) throw new Error('durable_json_target_required');
  const directory = path.dirname(file);
  const temp = tempPath(file, sequence);
  let renamed = false;
  fs.mkdirSync(directory, { recursive: true });
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try {
      fs.writeFileSync(fd, jsonPayload(value), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    renamed = true;
    const committedFd = fs.openSync(file, 'r+');
    try { fs.fsyncSync(committedFd); } finally { fs.closeSync(committedFd); }
    const directorySynced = syncDirectorySync(directory);
    return Object.freeze({
      contract: DURABLE_JSON_FILE_CONTRACT,
      target: file,
      file_synced: true,
      directory_synced: directorySynced,
      rename_committed: true,
      rename_confirmation: 'RENAME',
      platform: process.platform,
      authority_effect: false,
    });
  } catch (error) {
    if (!renamed) {
      try { fs.unlinkSync(temp); } catch {}
    }
    throw error;
  }
}

module.exports = Object.freeze({
  DURABLE_JSON_FILE_CONTRACT,
  WINDOWS_RENAME_RETRY_DELAYS_MS,
  transientWindowsRenameError,
  commitRenameWithReadback,
  durableWriteJson,
  durableWriteJsonSync,
});
