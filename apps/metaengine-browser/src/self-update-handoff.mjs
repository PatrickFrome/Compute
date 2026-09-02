import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  beginSelfUpdateTransaction,
  qualifySelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from './self-update-transaction-journal.mjs';

const require = createRequire(import.meta.url);
const { durableWriteJson } = require('./durable-json-file.cjs');

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

function successorBinding({ version, appId, successorStartup, preInstallSha256, preInstallRecordedAt }) {
  return {
    schema: SUCCESSOR_SCHEMA,
    version: String(version || ''),
    pid: process.pid,
    primary_instance: true,
    app_id: appId ? String(appId) : null,
    successor_startup: successorStartup,
    qualification_state: 'BOOT_VERIFIED',
    pre_install_receipt_sha256: String(preInstallSha256 || ''),
    pre_install_recorded_at: String(preInstallRecordedAt || ''),
    authority_effect: false,
  };
}

function validateSuccessorReceiptBinding(row, binding) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('self_update_successor_receipt_invalid');
  if (row.schema !== SUCCESSOR_SCHEMA) throw new Error('self_update_successor_receipt_schema_invalid');
  const exactFields = [
    'version',
    'pid',
    'primary_instance',
    'app_id',
    'successor_startup',
    'qualification_state',
    'pre_install_receipt_sha256',
    'pre_install_recorded_at',
    'authority_effect',
  ];
  for (const field of exactFields) {
    if (row[field] !== binding[field]) throw new Error(`self_update_successor_receipt_binding_mismatch:${field}`);
  }
  const recordedMs = Date.parse(String(row.recorded_at || ''));
  if (!Number.isFinite(recordedMs)) throw new Error('self_update_successor_receipt_time_invalid');
  return row;
}

async function readBoundSuccessorReceipt(app, binding) {
  const { successor } = selfUpdateHandoffPaths(app);
  let raw;
  try { raw = await fs.readFile(successor, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let row;
  try { row = JSON.parse(raw); }
  catch { throw new Error('self_update_successor_receipt_json_invalid'); }
  validateSuccessorReceiptBinding(row, binding);
  return { row, path: successor, successor_startup: binding.successor_startup };
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
  // Admit against the existing durable ledger before touching prior receipt evidence.
  // If receipt persistence fails after admission, the attempt becomes ambiguous rather
  // than silently rolling back to a retryable state.
  await beginSelfUpdateTransaction(app, receipt);
  try {
    await clearSuccessorReceipt(app);
    await durableWriteJson(pre_install, receipt);
  } catch (error) {
    await transitionIfPresent(app, 'AMBIGUOUS_INSTALL', {
      evidence: { reason: `pre_install_receipt_persist_failed:${String(error?.message || error).slice(0, 140)}` },
    }).catch(() => {});
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
  writeJson = durableWriteJson,
} = {}) {
  assertApp(app);
  if (!Array.isArray(argv) || !argv.includes('--updated')) return null;
  if (app.isPackaged !== true) throw new Error('self_update_successor_packaged_required');
  if (primaryInstance !== true) throw new Error('self_update_successor_primary_required');
  if (typeof app.hasSingleInstanceLock === 'function' && app.hasSingleInstanceLock() !== true) {
    throw new Error('self_update_successor_primary_lock_required');
  }
  if (typeof writeJson !== 'function') throw new Error('self_update_successor_writer_invalid');
  const expected = await readExpectedPreInstallReceipt(app, { maxAgeMs, clock });
  if (!expected) return null;
  const version = String(app.getVersion() || '');
  if (!version || expected.receipt.version !== version) throw new Error('self_update_successor_version_binding_invalid');

  const binding = successorBinding({
    version,
    appId,
    successorStartup: expected.successor_startup,
    preInstallSha256: expected.sha256,
    preInstallRecordedAt: expected.receipt.recorded_at,
  });

  // The write-ahead transaction remains authoritative for the installer effect.
  // Re-entering an already-booted successor must not rewrite its journal merely
  // to reconcile receipt durability, but any other admissible state is advanced
  // to SUCCESSOR_BOOTED before the receipt is created.
  const journal = await readSelfUpdateTransaction(app);
  if (journal?.state === 'SUCCESSOR_BOOTED') {
    if (journal.target_version !== version) throw new Error('self_update_transaction_target_binding_mismatch');
  } else {
    await transitionIfPresent(app, 'SUCCESSOR_BOOTED', {
      requireTargetVersion: version,
      evidence: { updated_argv: true, primary_instance: true, boot_version_match: true },
    });
  }

  // A prior exact receipt is positive evidence that this same successor process
  // already committed the effect. Preserve its recorded_at and never overwrite it.
  // Malformed or mismatched evidence fails closed rather than being replaced.
  const existing = await readBoundSuccessorReceipt(app, binding);
  if (existing) return existing;

  const row = {
    ...binding,
    recorded_at: new Date(Number(clock())).toISOString(),
  };
  const { successor } = selfUpdateHandoffPaths(app);
  try {
    await writeJson(successor, row);
  } catch (error) {
    // durableWriteJson can fail after rename (for example during committed-file or
    // directory fsync). Re-read the final path before declaring ambiguity. Exact
    // bytes/binding are success; absence remains a hold and is never retried here;
    // malformed/mismatched content is an explicit fail-closed conflict.
    const recovered = await readBoundSuccessorReceipt(app, binding);
    if (recovered) return recovered;
    throw error;
  }

  // Positive final-path readback is required even after the writer returned success.
  const committed = await readBoundSuccessorReceipt(app, binding);
  if (!committed) throw new Error('self_update_successor_receipt_readback_missing');
  return committed;
}

export async function qualifyUpdatedSuccessor(app, evidence = {}) {
  const row = await readSelfUpdateTransaction(app);
  if (!row || row.state !== 'SUCCESSOR_BOOTED') return row;
  return qualifySelfUpdateTransaction(app, evidence);
}
