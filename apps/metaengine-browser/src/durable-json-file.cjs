'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DURABLE_JSON_FILE_CONTRACT = 'METAENGINE_DURABLE_JSON_V1';

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tempPath(target, sequence = 0) {
  return `${target}.${process.pid}.${Number(sequence) || 0}.${crypto.randomUUID()}.tmp`;
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
  let renamed = false;
  await fsp.mkdir(directory, { recursive: true });
  try {
    const handle = await fsp.open(temp, 'wx', mode);
    try {
      await handle.writeFile(jsonPayload(value), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temp, file);
    renamed = true;
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
