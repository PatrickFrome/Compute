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

function sameFileIdentity(observed, expected) {
  return observed?.isFile() === true && expected?.isFile() === true
    && observed.dev === expected.dev && observed.ino === expected.ino;
}

async function tempPayloadSurvived(temp, payload, identity) {
  try {
    if (!sameFileIdentity(await fsp.lstat(temp, { bigint: true }), identity)) return false;
    const handle = await fsp.open(temp, 'r');
    try {
      if (!sameFileIdentity(await handle.stat({ bigint: true }), identity)) return false;
      if (await handle.readFile('utf8') !== payload) return false;
      return sameFileIdentity(await fsp.lstat(temp, { bigint: true }), identity);
    } finally { await handle.close(); }
  } catch { return false; }
}

function tempPayloadSurvivedSync(temp, payload, identity) {
  try {
    if (!sameFileIdentity(fs.lstatSync(temp, { bigint: true }), identity)) return false;
    const fd = fs.openSync(temp, 'r');
    try {
      if (!sameFileIdentity(fs.fstatSync(fd, { bigint: true }), identity)) return false;
      if (fs.readFileSync(fd, 'utf8') !== payload) return false;
      return sameFileIdentity(fs.lstatSync(temp, { bigint: true }), identity);
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

async function targetPayloadReadback(temp, file, payload, identity) {
  try { if (await fsp.readFile(file, 'utf8') === payload) return 'MATCH'; }
  catch (error) { if (error?.code !== 'ENOENT') return 'UNKNOWN'; }
  // A committed rename can be followed by another writer replacing/deleting
  // the target. Only the unchanged original temp proves a retry is safe.
  return await tempPayloadSurvived(temp, payload, identity) ? 'KNOWN_NOT_COMMITTED' : 'UNKNOWN';
}

function targetPayloadReadbackSync(temp, file, payload, identity) {
  try { if (fs.readFileSync(file, 'utf8') === payload) return 'MATCH'; }
  catch (error) { if (error?.code !== 'ENOENT') return 'UNKNOWN'; }
  return tempPayloadSurvivedSync(temp, payload, identity) ? 'KNOWN_NOT_COMMITTED' : 'UNKNOWN';
}

async function renameWithReadback(temp, file, payload, renameState, identity) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      await fsp.rename(temp, file);
      return Object.freeze({ attempts: attempt + 1, recovered_via_readback: false });
    } catch (error) {
      lastError = error;
      const readback = await targetPayloadReadback(temp, file, payload, identity);
      if (readback === 'MATCH') {
        return Object.freeze({ attempts: attempt + 1, recovered_via_readback: true });
      }
      if (readback === 'UNKNOWN') {
        renameState.outcome_unknown = true;
        throw error;
      }
      if (!transientRenameError(error) || attempt === RENAME_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('durable_json_rename_failed');
}

function renameWithReadbackSync(temp, file, payload, renameState, identity) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      fs.renameSync(temp, file);
      return Object.freeze({ attempts: attempt + 1, recovered_via_readback: false });
    } catch (error) {
      lastError = error;
      const readback = targetPayloadReadbackSync(temp, file, payload, identity);
      if (readback === 'MATCH') {
        return Object.freeze({ attempts: attempt + 1, recovered_via_readback: true });
      }
      if (readback === 'UNKNOWN') {
        renameState.outcome_unknown = true;
        throw error;
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

async function readPreimage(file) {
  try {
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('durable_json_preimage_type_unknown');
    return await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function publishWithPreimage(temp, file, payload, expected, renameState, identity) {
  // Callers must own the durable file lock. Never overwrite a final path:
  // claiming its old name and absent-only publication also preserve a writer
  // which does not participate in that lock between these operations.
  renameState.outcome_unknown = true;
  if (await readPreimage(file) !== expected) throw new Error('durable_json_preimage_mismatch');
  const previous = expected === null ? null : `${temp}.previous`;
  if (previous) {
    await fsp.rename(file, previous);
    if (await readPreimage(previous) !== expected) {
      // Restore only to an absent name. An existing concurrent final wins;
      // retain the claimed preimage as evidence in either case.
      try { await fsp.link(previous, file); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
      throw new Error('durable_json_preimage_mismatch');
    }
  }
  if (!await tempPayloadSurvived(temp, payload, identity)) throw new Error('durable_json_temp_identity_unknown');
  await fsp.link(temp, file);
  if (await readPreimage(file) !== payload || (previous && await readPreimage(previous) !== expected)) {
    throw new Error('durable_json_publication_unknown');
  }
  return Object.freeze({ attempts: 1, recovered_via_readback: false, previous });
}

async function durableWriteJson(target, value, { mode = 0o600, sequence = 0, expectedPreimage = undefined } = {}) {
  const file = String(target || '');
  if (!file) throw new Error('durable_json_target_required');
  if (expectedPreimage !== undefined && expectedPreimage !== null && typeof expectedPreimage !== 'string') {
    throw new Error('durable_json_preimage_invalid');
  }
  const directory = path.dirname(file);
  const temp = tempPath(file, sequence);
  const payload = jsonPayload(value);
  let renamed = false;
  let renameOutcome = null;
  let tempIdentity = null;
  const renameState = { outcome_unknown: false };
  await fsp.mkdir(directory, { recursive: true });
  try {
    const handle = await fsp.open(temp, 'wx', mode);
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      tempIdentity = await handle.stat({ bigint: true });
    } finally {
      await handle.close();
    }
    renameOutcome = expectedPreimage === undefined
      ? await renameWithReadback(temp, file, payload, renameState, tempIdentity)
      : await publishWithPreimage(temp, file, payload, expectedPreimage, renameState, tempIdentity);
    renamed = true;
    if (renameOutcome.recovered_via_readback) await fsp.unlink(temp).catch(() => {});
    const committed = await fsp.open(file, 'r+');
    try { await committed.sync(); } finally { await committed.close(); }
    const directorySynced = await syncDirectory(directory);
    if (expectedPreimage !== undefined) {
      // Cleanup only follows confirmed publication, committed-file flush and
      // directory flush. Any earlier failure leaves all surviving evidence.
      if (renameOutcome.previous) await fsp.unlink(renameOutcome.previous);
      await fsp.unlink(temp);
      await syncDirectory(directory);
    }
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
    // An unreadable target may already contain the committed rename. Preserve
    // the temp, if it remains, for readback instead of erasing unknown evidence.
    if (!renamed && !renameState.outcome_unknown) await fsp.unlink(temp).catch(() => {});
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
  let tempIdentity = null;
  const renameState = { outcome_unknown: false };
  fs.mkdirSync(directory, { recursive: true });
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
      tempIdentity = fs.fstatSync(fd, { bigint: true });
    } finally {
      fs.closeSync(fd);
    }
    renameOutcome = renameWithReadbackSync(temp, file, payload, renameState, tempIdentity);
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
    if (!renamed && !renameState.outcome_unknown) {
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
