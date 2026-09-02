'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DURABLE_JSON_FILE_CONTRACT = 'METAENGINE_DURABLE_JSON_V1';
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = Object.freeze([0, 25, 50, 100, 200, 400]);

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tempPath(target, sequence = 0) {
  return `${target}.${process.pid}.${Number(sequence) || 0}.${crypto.randomUUID()}.tmp`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sleepSync(ms) {
  if (!(Number(ms) > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
}

function transientRenameError(error) {
  return TRANSIENT_RENAME_CODES.has(String(error?.code || '').toUpperCase());
}

async function targetMatchesPayload(file, payload) {
  try { return await fsp.readFile(file, 'utf8') === payload; }
  catch { return false; }
}

function targetMatchesPayloadSync(file, payload) {
  try { return fs.readFileSync(file, 'utf8') === payload; }
  catch { return false; }
}

async function renameWithReadback(temp, file, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      await fsp.rename(temp, file);
      return Object.freeze({ attempts: attempt + 1, recovered_via_readback: false });
    } catch (error) {
      lastError = error;
      // A rename result can be ambiguous under Windows file-system filters. Read back
      // the exact payload before any retry so an already-committed replace is never replayed.
      if (await targetMatchesPayload(file, payload)) {
        return Object.freeze({ attempts: attempt + 1, recovered_via_readback: true });
      }
      if (!transientRenameError(error) || attempt === RENAME_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('durable_json_rename_failed');
}

function renameWithReadbackSync(temp, file, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      fs.renameSync(temp, file);
      return Object.freeze({ attempts: attempt + 1, recovered_via_readback: false });
    } catch (error) {
      lastError = error;
      if (targetMatchesPayloadSync(file, payload)) {
        return Object.freeze({ attempts: attempt + 1, recovered_via_readback: true });
      }
      if (!transientRenameError(error) || attempt === RENAME_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('durable_json_rename_failed');
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
  let renamed = false;
  let renameOutcome = null;
  await fsp.mkdir(directory, { recursive: true });
  try {
    const handle = await fsp.open(temp, 'wx', mode);
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    renameOutcome = await renameWithReadback(temp, file, payload);
    renamed = true;
    if (renameOutcome.recovered_via_readback) await fsp.unlink(temp).catch(() => {});
    // On Windows fsync/FlushFileBuffers requires a write-capable handle. r+ does not
    // alter existing bytes; it only opens the committed file for the durability flush.
    const committed = await fsp.open(file, 'r+');
    try { await committed.sync(); } finally { await committed.close(); }
    const directorySynced = await syncDirectory(directory);
    return Object.freeze({
      contract: DURABLE_JSON_FILE_CONTRACT,
      target: file,
      file_synced: true,
      directory_synced: directorySynced,
      rename_committed: true,
      rename_attempts: renameOutcome.attempts,
      rename_recovered_via_readback: renameOutcome.recovered_via_readback,
      platform: process.platform,
      authority_effect: false,
    });
  } catch (error) {
    if (!renamed) await fsp.unlink(temp).catch(() => {});
    throw error;
  }
}

function durableWriteJsonSync(target, value, { mode = 0o600, sequence = 0 } = {}) {
  const file = String(target || '');
  if (!file) throw new Error('durable_json_target_required');
  const directory = path.dirname(file);
  const temp = tempPath(file, sequence);
  const payload = jsonPayload(value);
  let renamed = false;
  let renameOutcome = null;
  fs.mkdirSync(directory, { recursive: true });
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameOutcome = renameWithReadbackSync(temp, file, payload);
    renamed = true;
    if (renameOutcome.recovered_via_readback) {
      try { fs.unlinkSync(temp); } catch {}
    }
    const committedFd = fs.openSync(file, 'r+');
    try { fs.fsyncSync(committedFd); } finally { fs.closeSync(committedFd); }
    const directorySynced = syncDirectorySync(directory);
    return Object.freeze({
      contract: DURABLE_JSON_FILE_CONTRACT,
      target: file,
      file_synced: true,
      directory_synced: directorySynced,
      rename_committed: true,
      rename_attempts: renameOutcome.attempts,
      rename_recovered_via_readback: renameOutcome.recovered_via_readback,
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
  durableWriteJson,
  durableWriteJsonSync,
});
