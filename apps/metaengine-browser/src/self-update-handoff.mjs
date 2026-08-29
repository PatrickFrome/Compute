import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PRE_INSTALL_RECEIPT_FILE = 'metaengine-self-update-pre-install-receipt-v1.json';
export const SUCCESSOR_RECEIPT_FILE = 'metaengine-self-update-successor-receipt-v1.json';
const PRE_INSTALL_SCHEMA = 'metaengine.self-update.pre-install-receipt.v1';
const SUCCESSOR_SCHEMA = 'metaengine.self-update.successor-receipt.v1';
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') throw new Error('self_update_handoff_app_invalid');
}

function validatePreInstallReceipt(receipt) {
  if (receipt?.schema !== PRE_INSTALL_SCHEMA) throw new Error('self_update_handoff_receipt_schema_invalid');
  if (!receipt?.version || receipt.version !== receipt?.available_version) throw new Error('self_update_handoff_receipt_version_invalid');
  if (receipt?.metadata_verified !== true || receipt?.restart_gate_safe !== true || receipt?.authority_effect !== false) {
    throw new Error('self_update_handoff_receipt_invariant_invalid');
  }
  const recordedMs = Date.parse(String(receipt?.recorded_at || ''));
  if (!Number.isFinite(recordedMs)) throw new Error('self_update_handoff_receipt_time_invalid');
  return recordedMs;
}

async function atomicWriteJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
}

export function selfUpdateHandoffPaths(app) {
  assertApp(app);
  const userData = app.getPath('userData');
  return {
    pre_install: path.join(userData, PRE_INSTALL_RECEIPT_FILE),
    successor: path.join(userData, SUCCESSOR_RECEIPT_FILE),
  };
}

export async function persistPreInstallReceipt(app, receipt) {
  assertApp(app);
  if (app.isPackaged !== true) throw new Error('self_update_handoff_packaged_required');
  if (typeof app.hasSingleInstanceLock !== 'function' || app.hasSingleInstanceLock() !== true) {
    throw new Error('self_update_handoff_primary_lock_required');
  }
  validatePreInstallReceipt(receipt);
  const { pre_install } = selfUpdateHandoffPaths(app);
  await atomicWriteJson(pre_install, receipt);
  return { path: pre_install };
}

export async function clearSuccessorReceipt(app) {
  const { successor } = selfUpdateHandoffPaths(app);
  try { await fs.unlink(successor); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return successor;
}

export async function readExpectedPreInstallReceipt(app, { maxAgeMs = DEFAULT_MAX_AGE_MS, clock = () => Date.now() } = {}) {
  assertApp(app);
  const { pre_install } = selfUpdateHandoffPaths(app);
  let raw;
  try { raw = await fs.readFile(pre_install, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let receipt;
  try { receipt = JSON.parse(raw); } catch { throw new Error('self_update_handoff_receipt_json_invalid'); }
  const recordedMs = validatePreInstallReceipt(receipt);
  const ageMs = Number(clock()) - recordedMs;
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > maxAgeMs) throw new Error('self_update_handoff_receipt_stale');
  return {
    receipt,
    raw,
    sha256: createHash('sha256').update(raw).digest('hex'),
    path: pre_install,
  };
}

export async function persistUpdatedSuccessorReceipt(app, {
  argv = process.argv,
  primaryInstance = true,
  appId = null,
  clock = () => Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  assertApp(app);
  if (!Array.isArray(argv) || !argv.includes('--updated')) return null;
  if (app.isPackaged !== true) throw new Error('self_update_successor_packaged_required');
  if (primaryInstance !== true) throw new Error('self_update_successor_primary_required');
  if (typeof app.hasSingleInstanceLock === 'function' && app.hasSingleInstanceLock() !== true) {
    throw new Error('self_update_successor_primary_lock_required');
  }
  const expected = await readExpectedPreInstallReceipt(app, { maxAgeMs, clock });
  if (!expected) return null;
  const version = String(app.getVersion() || '');
  if (!version || expected.receipt.version !== version) throw new Error('self_update_successor_version_binding_invalid');
  const row = {
    schema: SUCCESSOR_SCHEMA,
    version,
    pid: process.pid,
    primary_instance: true,
    app_id: appId ? String(appId) : null,
    pre_install_receipt_sha256: expected.sha256,
    pre_install_recorded_at: expected.receipt.recorded_at,
    recorded_at: new Date(Number(clock())).toISOString(),
    authority_effect: false,
  };
  const { successor } = selfUpdateHandoffPaths(app);
  await atomicWriteJson(successor, row);
  return { row, path: successor };
}
