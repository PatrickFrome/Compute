import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  beginSelfUpdateTransaction,
  qualifySelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from './self-update-transaction-journal.mjs';

export const PRE_INSTALL_RECEIPT_FILE = 'metaengine-self-update-pre-install-receipt-v1.json';
export const SUCCESSOR_RECEIPT_FILE = 'metaengine-self-update-successor-receipt-v1.json';
export const SUCCESSOR_STARTUP_NORMAL = 'NORMAL';
export const SUCCESSOR_STARTUP_PROBE_ONLY = 'PROBE_ONLY';
const PRE_INSTALL_SCHEMA = 'metaengine.self-update.pre-install-receipt.v1';
const SUCCESSOR_SCHEMA = 'metaengine.self-update.successor-receipt.v1';
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;
const STARTUP_HOLD_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const UNRESOLVED_STARTUP_STATES = new Set(['PREPARED','INSTALLING','SUCCESSOR_BOOTED']);

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') throw new Error('self_update_handoff_app_invalid');
}

function successorStartupMode(receipt) {
  const mode = String(receipt?.successor_startup || SUCCESSOR_STARTUP_NORMAL).toUpperCase();
  if (![SUCCESSOR_STARTUP_NORMAL, SUCCESSOR_STARTUP_PROBE_ONLY].includes(mode)) {
    throw new Error('self_update_handoff_successor_startup_invalid');
  }
  return mode;
}

function validatePreInstallReceipt(receipt) {
  if (receipt?.schema !== PRE_INSTALL_SCHEMA) throw new Error('self_update_handoff_receipt_schema_invalid');
  if (!receipt?.version || receipt.version !== receipt?.available_version) throw new Error('self_update_handoff_receipt_version_invalid');
  if (receipt?.metadata_verified !== true || receipt?.restart_gate_safe !== true || receipt?.authority_effect !== false) {
    throw new Error('self_update_handoff_receipt_invariant_invalid');
  }
  successorStartupMode(receipt);
  const recordedMs = Date.parse(String(receipt?.recorded_at || ''));
  if (!Number.isFinite(recordedMs)) throw new Error('self_update_handoff_receipt_time_invalid');
  return recordedMs;
}

function versionTuple(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map((part) => BigInt(part)) : null;
}

function compareVersions(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  if (!a || !b) return null;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
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

async function transitionIfPresent(app, state, options = {}) {
  const row = await readSelfUpdateTransaction(app).catch(() => null);
  if (!row) return null;
  try { return await transitionSelfUpdateTransaction(app, state, options); }
  catch (error) {
    if (String(error?.message || error).includes('transition_invalid') && row.state === state) return row;
    throw error;
  }
}

function startupHold({ app, journal = null, reason, transactionState = null } = {}) {
  return {
    schema: 'metaengine.self-update.startup-inspection.v1',
    state: 'AMBIGUOUS_INSTALL',
    transaction_state: transactionState || journal?.state || null,
    current_version: String(app.getVersion() || ''),
    target_version: journal?.target_version || null,
    reason: String(reason || 'durable_transaction_hold').slice(0, 240),
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function selfUpdateHandoffPaths(app) {
  assertApp(app);
  const userData = app.getPath('userData');
  return {
    pre_install: path.join(userData, PRE_INSTALL_RECEIPT_FILE),
    successor: path.join(userData, SUCCESSOR_RECEIPT_FILE),
  };
}

export async function clearSuccessorReceipt(app) {
  const { successor } = selfUpdateHandoffPaths(app);
  try { await fs.unlink(successor); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return successor;
}

export async function persistPreInstallReceipt(app, receipt) {
  assertApp(app);
  if (app.isPackaged !== true) throw new Error('self_update_handoff_packaged_required');
  if (typeof app.hasSingleInstanceLock !== 'function' || app.hasSingleInstanceLock() !== true) {
    throw new Error('self_update_handoff_primary_lock_required');
  }
  validatePreInstallReceipt(receipt);
  const { pre_install } = selfUpdateHandoffPaths(app);
  await clearSuccessorReceipt(app);
  await atomicWriteJson(pre_install, receipt);
  try {
    await beginSelfUpdateTransaction(app, receipt);
  } catch (error) {
    // Do not leave a fresh receipt that could be mistaken for a newly admitted attempt
    // when the durable transaction ledger rejected the begin operation.
    try { await fs.unlink(pre_install); } catch (unlinkError) { if (unlinkError?.code !== 'ENOENT') throw unlinkError; }
    throw error;
  }
  return { path: pre_install, successor_startup: successorStartupMode(receipt) };
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
    successor_startup: successorStartupMode(receipt),
    path: pre_install,
  };
}

export async function inspectSelfUpdateStartup(app, { clock = () => Date.now() } = {}) {
  assertApp(app);
  let journal = null;
  try {
    journal = await readSelfUpdateTransaction(app);
  } catch (error) {
    return startupHold({
      app,
      reason: `transaction_journal_unreadable:${String(error?.message || error).slice(0, 180)}`,
      transactionState: 'UNREADABLE',
    });
  }
  if (journal?.state === 'AMBIGUOUS_INSTALL' || journal?.state === 'QUARANTINED') {
    return startupHold({
      app,
      journal,
      reason: journal.evidence?.reason || journal.evidence?.quarantine_reason || 'durable_transaction_hold',
    });
  }

  let expected;
  try {
    expected = await readExpectedPreInstallReceipt(app, { maxAgeMs: STARTUP_HOLD_MAX_AGE_MS, clock });
  } catch (error) {
    await transitionIfPresent(app, 'AMBIGUOUS_INSTALL', { evidence: { reason: String(error?.message || error).slice(0, 180) } }).catch(() => {});
    return startupHold({ app, journal, reason: error?.message || error });
  }
  if (!expected) {
    if (journal && UNRESOLVED_STARTUP_STATES.has(journal.state)) {
      const reason = 'durable_transaction_present_but_pre_install_receipt_missing';
      await transitionIfPresent(app, 'AMBIGUOUS_INSTALL', { evidence: { reason } }).catch(() => {});
      return startupHold({ app, journal, reason, transactionState: journal.state });
    }
    return {
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'NONE', current_version: String(app.getVersion() || ''), target_version: null,
      automatic_retry_allowed: true, authority_effect: false,
    };
  }
  const current = String(app.getVersion() || '');
  const target = String(expected.receipt.version || '');
  const cmp = compareVersions(current, target);
  if (current === target || cmp === 0) {
    await transitionIfPresent(app, 'SUCCESSOR_BOOTED', {
      requireTargetVersion: target,
      evidence: { boot_version_match: true },
    }).catch(() => {});
    return {
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'TARGET_INSTALLED', current_version: current, target_version: target,
      automatic_retry_allowed: false, authority_effect: false,
    };
  }
  if (cmp != null && cmp > 0) {
    await transitionIfPresent(app, 'SUPERSEDED', { evidence: { superseding_version: current } }).catch(() => {});
    return {
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'SUPERSEDED', current_version: current, target_version: target,
      automatic_retry_allowed: false, authority_effect: false,
    };
  }
  await transitionIfPresent(app, 'AMBIGUOUS_INSTALL', {
    evidence: { reason: 'pre_install_receipt_present_but_target_not_installed' },
  }).catch(() => {});
  return startupHold({
    app,
    journal,
    reason: 'pre_install_receipt_present_but_target_not_installed',
  });
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
  await transitionIfPresent(app, 'SUCCESSOR_BOOTED', {
    requireTargetVersion: version,
    evidence: { updated_argv: true, primary_instance: true, boot_version_match: true },
  });
  const row = {
    schema: SUCCESSOR_SCHEMA,
    version,
    pid: process.pid,
    primary_instance: true,
    app_id: appId ? String(appId) : null,
    successor_startup: expected.successor_startup,
    qualification_state: 'BOOT_VERIFIED',
    pre_install_receipt_sha256: expected.sha256,
    pre_install_recorded_at: expected.receipt.recorded_at,
    recorded_at: new Date(Number(clock())).toISOString(),
    authority_effect: false,
  };
  const { successor } = selfUpdateHandoffPaths(app);
  await atomicWriteJson(successor, row);
  return { row, path: successor, successor_startup: expected.successor_startup };
}

export async function qualifyUpdatedSuccessor(app, evidence = {}) {
  const row = await readSelfUpdateTransaction(app);
  if (!row || row.state !== 'SUCCESSOR_BOOTED') return row;
  return qualifySelfUpdateTransaction(app, evidence);
}
