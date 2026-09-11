import path from 'node:path';
import { createRequire } from 'node:module';
import { isNewerCompatibleDevVersion } from './dev-update-hint.mjs';
import { readSelfUpdateTransaction } from './self-update-transaction-journal.mjs';

const require = createRequire(import.meta.url);
const { durableWriteJson } = require('./durable-json-file.cjs');

export const SELF_UPDATE_OLD_PARENT_HANDOFF_FILE = 'metaengine-self-update-old-parent-handoff-v1.json';
export const SELF_UPDATE_OLD_PARENT_HANDOFF_SCHEMA = 'metaengine.self-update.old-parent-handoff.v1';
export const DEFAULT_OLD_PARENT_HANDOFF_INITIAL_DELAY_MS = 10_000;
export const DEFAULT_OLD_PARENT_HANDOFF_INTERVAL_MS = 5_000;
export const DEFAULT_OLD_PARENT_HANDOFF_MAX_CHECKS = 120;

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('self_update_old_parent_handoff_app_invalid');
  }
}

function handoffPath(app) {
  assertApp(app);
  return path.join(app.getPath('userData'), SELF_UPDATE_OLD_PARENT_HANDOFF_FILE);
}

function validateIntent(row) {
  if (!row || row.schema !== SELF_UPDATE_OLD_PARENT_HANDOFF_SCHEMA) throw new Error('self_update_old_parent_handoff_schema_invalid');
  if (!row.transaction_id || !row.source_version || !row.target_version) throw new Error('self_update_old_parent_handoff_binding_invalid');
  if (row.automatic_retry_allowed !== false || row.authority_effect !== false) throw new Error('self_update_old_parent_handoff_invariant_invalid');
  return row;
}

export async function readSelfUpdateOldParentHandoff(app) {
  const target = handoffPath(app);
  let raw;
  try {
    raw = await import('node:fs/promises').then(({ readFile }) => readFile(target, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let row;
  try { row = JSON.parse(raw); }
  catch { throw new Error('self_update_old_parent_handoff_json_invalid'); }
  return structuredClone(validateIntent(row));
}

function classifyJournal(journal, currentVersion) {
  if (!journal) return { state: 'NO_TRANSACTION', continue_watch: false };
  if (journal.authority_effect !== false || journal.automatic_retry_allowed !== false) {
    return { state: 'JOURNAL_INVARIANT_MISMATCH', continue_watch: false };
  }
  if (journal.state === 'PREPARED' || journal.state === 'INSTALLING') {
    return { state: 'WAITING_SUCCESSOR_BOOT', continue_watch: true, target_version: journal.target_version || null };
  }
  if (journal.state !== 'SUCCESSOR_BOOTED') {
    return { state: `TRANSACTION_${String(journal.state || 'UNKNOWN')}`, continue_watch: false, target_version: journal.target_version || null };
  }
  const current = String(currentVersion || '');
  const source = String(journal.source_version || '');
  const target = String(journal.target_version || '');
  if (!current || source !== current) {
    return { state: 'SOURCE_VERSION_MISMATCH', continue_watch: false, target_version: target || null };
  }
  if (!isNewerCompatibleDevVersion(target, current)) {
    return { state: 'TARGET_NOT_NEWER_COMPATIBLE', continue_watch: false, target_version: target || null };
  }
  return { state: 'HANDOFF_REQUIRED', continue_watch: false, target_version: target };
}

export async function attemptSelfUpdateOldParentHandoff({
  app,
  relaunch,
  exit,
  clock = () => Date.now(),
} = {}) {
  assertApp(app);
  if (typeof relaunch !== 'function' || typeof exit !== 'function') throw new Error('self_update_old_parent_handoff_process_hooks_required');

  const journal = await readSelfUpdateTransaction(app);
  const currentVersion = String(app.getVersion() || '');
  const classification = classifyJournal(journal, currentVersion);
  if (classification.state !== 'HANDOFF_REQUIRED') {
    return Object.freeze({
      ...classification,
      recovered: false,
      current_version: currentVersion,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  const prior = await readSelfUpdateOldParentHandoff(app);
  if (prior?.transaction_id === journal.transaction_id) {
    return Object.freeze({
      state: 'HANDOFF_ALREADY_DISPATCHED',
      recovered: false,
      transaction_id: journal.transaction_id,
      current_version: currentVersion,
      target_version: journal.target_version,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  const now = Number(clock());
  const intent = {
    schema: SELF_UPDATE_OLD_PARENT_HANDOFF_SCHEMA,
    transaction_id: journal.transaction_id,
    source_version: currentVersion,
    target_version: journal.target_version,
    source_pid: process.pid,
    intent_at: new Date(now).toISOString(),
    dispatch_kind: 'ELECTRON_APP_RELAUNCH_THEN_EXIT',
    reason: 'SUCCESSOR_BOOTED_OLD_PARENT_STILL_ALIVE',
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  await durableWriteJson(handoffPath(app), intent);

  try {
    relaunch();
  } catch (error) {
    return Object.freeze({
      state: 'HANDOFF_RELAUNCH_THROWN',
      recovered: false,
      transaction_id: journal.transaction_id,
      current_version: currentVersion,
      target_version: journal.target_version,
      error: String(error?.message || error).slice(0, 240),
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
  exit(19);
  return Object.freeze({
    state: 'HANDOFF_DISPATCHED',
    recovered: true,
    transaction_id: journal.transaction_id,
    current_version: currentVersion,
    target_version: journal.target_version,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function startSelfUpdateOldParentHandoffWatchdog({
  app,
  relaunch,
  exit,
  onObservation = () => {},
  onError = () => {},
  initialDelayMs = DEFAULT_OLD_PARENT_HANDOFF_INITIAL_DELAY_MS,
  intervalMs = DEFAULT_OLD_PARENT_HANDOFF_INTERVAL_MS,
  maxChecks = DEFAULT_OLD_PARENT_HANDOFF_MAX_CHECKS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  assertApp(app);
  if (typeof relaunch !== 'function' || typeof exit !== 'function') throw new Error('self_update_old_parent_handoff_process_hooks_required');
  const initial = Math.max(1_000, Number(initialDelayMs) || DEFAULT_OLD_PARENT_HANDOFF_INITIAL_DELAY_MS);
  const interval = Math.max(1_000, Number(intervalMs) || DEFAULT_OLD_PARENT_HANDOFF_INTERVAL_MS);
  const limit = Math.max(1, Math.min(600, Number(maxChecks) || DEFAULT_OLD_PARENT_HANDOFF_MAX_CHECKS));
  let timer = null;
  let checks = 0;
  let cancelled = false;

  const schedule = (delay) => {
    if (cancelled || checks >= limit) return;
    timer = setTimer(() => {
      timer = null;
      checks += 1;
      attemptSelfUpdateOldParentHandoff({ app, relaunch, exit })
        .then((result) => {
          onObservation(result);
          if (result?.continue_watch === true && !cancelled && checks < limit) schedule(interval);
        })
        .catch((error) => {
          onError(String(error?.message || error).slice(0, 240));
          if (!cancelled && checks < limit) schedule(interval);
        });
    }, delay);
    timer?.unref?.();
  };

  schedule(initial);
  return Object.freeze({
    schema: 'metaengine.self-update.old-parent-handoff-watchdog.v1',
    initial_delay_ms: initial,
    interval_ms: interval,
    max_checks: limit,
    automatic_retry_after_dispatch: false,
    cancel: () => {
      cancelled = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    authority_effect: false,
  });
}
