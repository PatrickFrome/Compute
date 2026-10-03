import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BROWSER_STARTUP_ACTIVATION_ACK_MAX,
  BROWSER_STARTUP_JOURNAL_FILE,
  BROWSER_STARTUP_JOURNAL_SCHEMA,
  PRIMARY_ACTIVATION_ACK_POLL_MS,
  PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
  normalizeActivationAcks,
  readStartupJournalFile,
  startupJournalPath,
  validActivationAck,
  validActivationLaunchId,
  waitForPrimaryActivationAck,
} from './browser-startup-activation-readback.mjs';
import {
  PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS,
  PRIMARY_WINDOW_STABLE_MS,
  activateExistingPrimaryWindow,
  waitForStablePrimaryWindow,
} from './browser-primary-window-activation.mjs';

export {
  BROWSER_STARTUP_ACTIVATION_ACK_MAX,
  BROWSER_STARTUP_JOURNAL_FILE,
  BROWSER_STARTUP_JOURNAL_SCHEMA,
  PRIMARY_ACTIVATION_ACK_POLL_MS,
  PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
  PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS,
  PRIMARY_WINDOW_STABLE_MS,
  activateExistingPrimaryWindow,
  waitForPrimaryActivationAck,
  waitForStablePrimaryWindow,
};

const require = createRequire(import.meta.url);
const { durableWriteJson } = require('./durable-json-file.cjs');

export const BROWSER_STARTUP_JOURNAL_MAX_EVENTS = 128;

const SAFE_STATE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_REASON = /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/;
const SAFE_DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const ADVISORY_ONLY_STATES = new Set(['SECOND_INSTANCE_RECEIVED']);
let journalTail = Promise.resolve();

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('browser_startup_journal_app_invalid');
  }
}


function primitiveDetail(value) {
  if (value == null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 240);
  return undefined;
}

function safeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_DETAIL_KEY.test(key)) continue;
    const normalized = primitiveDetail(raw);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function errorEvidence(error) {
  if (!error) return null;
  const stack = typeof error?.stack === 'string' ? error.stack : null;
  return Object.freeze({
    name: String(error?.name || 'Error').slice(0, 80),
    code: error?.code == null ? null : String(error.code).slice(0, 80),
    message: String(error?.message || error).slice(0, 500),
    stack_sha256: stack == null
      ? null
      : crypto.createHash('sha256').update(stack, 'utf8').digest('hex'),
  });
}


function activationAckFromEvent(event) {
  if (event?.state !== 'PRIMARY_WINDOW_ACTIVATED'
    || event?.details?.visible !== true
    || typeof event?.details?.launch_id !== 'string'
    || !validActivationLaunchId(event.details.launch_id)) return null;
  const row = {
    boot_id: event.boot_id,
    launch_id: event.details.launch_id,
    sequence: event.sequence,
    version: event.version,
    pid: event.pid,
    at: event.at,
    authority_effect: false,
  };
  return validActivationAck(row) ? row : null;
}


async function preserveCorruptJournal(app, error, clock) {
  const target = startupJournalPath(app);
  const stamp = Number(clock());
  const suffix = Number.isFinite(stamp) ? stamp : Date.now();
  const quarantine = `${target}.corrupt-${suffix}-${crypto.randomUUID()}`;
  try {
    await fs.rename(target, quarantine);
    return Object.freeze({
      quarantined: true,
      quarantine_file: path.basename(quarantine),
      read_error: String(error?.message || error).slice(0, 160),
    });
  } catch {
    return Object.freeze({
      quarantined: false,
      quarantine_file: null,
      read_error: String(error?.message || error).slice(0, 160),
    });
  }
}

function freshJournal(bootId, app, at) {
  return {
    schema: BROWSER_STARTUP_JOURNAL_SCHEMA,
    version: 1,
    current_boot_id: bootId,
    current_version: String(app.getVersion() || ''),
    current_pid: process.pid,
    last_sequence: 0,
    updated_at: at,
    events: [],
    activation_acks: [],
    authority_effect: false,
  };
}

async function appendEventUnlocked(app, {
  boot_id,
  state,
  reason = null,
  details = {},
  error = null,
  begin = false,
  clock = () => Date.now(),
} = {}) {
  assertApp(app);
  if (typeof boot_id !== 'string' || boot_id.length < 16) throw new Error('browser_startup_boot_id_invalid');
  if (!SAFE_STATE.test(String(state || ''))) throw new Error('browser_startup_state_invalid');
  if (reason != null && !SAFE_REASON.test(String(reason))) throw new Error('browser_startup_reason_invalid');

  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs)) throw new Error('browser_startup_clock_invalid');
  const at = new Date(nowMs).toISOString();
  let row = null;
  let recovery = null;
  try {
    row = await readStartupJournalFile(app);
  } catch (readError) {
    recovery = await preserveCorruptJournal(app, readError, clock);
  }
  if (!row) row = freshJournal(boot_id, app, at);

  if (begin) {
    row.current_boot_id = boot_id;
    row.current_version = String(app.getVersion() || '');
    row.current_pid = process.pid;
  } else if (row.current_boot_id !== boot_id) {
    throw new Error('browser_startup_journal_boot_mismatch');
  }

  const sequence = row.last_sequence + 1;
  const event = {
    sequence,
    boot_id,
    state: String(state),
    reason: reason == null ? null : String(reason),
    at,
    version: String(app.getVersion() || ''),
    pid: process.pid,
    details: {
      ...safeDetails(details),
      ...(recovery ? {
        journal_recovered: true,
        journal_quarantined: recovery.quarantined,
        journal_quarantine_file: recovery.quarantine_file,
        journal_read_error: recovery.read_error,
      } : {}),
    },
    error: errorEvidence(error),
    authority_effect: false,
  };
  const priorActivationAcks = normalizeActivationAcks(row.activation_acks);
  const activationAck = activationAckFromEvent(event);

  const next = {
    ...row,
    current_boot_id: boot_id,
    current_version: String(app.getVersion() || ''),
    current_pid: process.pid,
    last_sequence: sequence,
    updated_at: at,
    events: [...row.events, event].slice(-BROWSER_STARTUP_JOURNAL_MAX_EVENTS),
    activation_acks: activationAck
      ? [...priorActivationAcks, activationAck].slice(-BROWSER_STARTUP_ACTIVATION_ACK_MAX)
      : priorActivationAcks,
    authority_effect: false,
  };
  await durableWriteJson(startupJournalPath(app), next, { sequence });
  return structuredClone(next);
}

function serializeJournal(operation) {
  const run = journalTail.then(operation, operation);
  journalTail = run.then(() => undefined, () => undefined);
  return run;
}

export async function beginBrowserStartupJournal(app, {
  launch_kind = 'NORMAL',
  clock = () => Date.now(),
} = {}) {
  const bootId = crypto.randomUUID();
  const journal = await serializeJournal(() => appendEventUnlocked(app, {
    boot_id: bootId,
    state: 'BOOT_STARTED',
    reason: 'PRIMARY_INSTANCE_LOCK_ACQUIRED',
    details: { launch_kind: String(launch_kind).slice(0, 80) },
    begin: true,
    clock,
  }));
  return Object.freeze({
    boot_id: bootId,
    journal_path: startupJournalPath(app),
    last_sequence: journal.last_sequence,
    authority_effect: false,
  });
}

export async function recordBrowserStartupEvent(app, input = {}) {
  const state = String(input?.state || '');
  if (ADVISORY_ONLY_STATES.has(state)) {
    return Object.freeze({
      schema: 'metaengine.browser.startup-advisory-event.v1',
      state,
      durable: false,
      represented_by_exact_activation_ack: state === 'SECOND_INSTANCE_RECEIVED',
      authority_effect: false,
    });
  }
  return serializeJournal(() => appendEventUnlocked(app, input));
}

export async function readBrowserStartupJournal(app) {
  const row = await readStartupJournalFile(app);
  return row == null ? null : structuredClone(row);
}


export function browserStartupObservabilityContract() {
  return Object.freeze({
    schema: BROWSER_STARTUP_JOURNAL_SCHEMA,
    durable_startup_journal_required: true,
    runtime_import_failure_must_be_durable: true,
    gui_stderr_is_diagnostic_authority: false,
    second_instance_must_activate_primary_window: true,
    second_instance_receive_marker_is_advisory_only: true,
    second_instance_activation_ack_is_single_durable_write: true,
    second_instance_activation_ack_must_match_launch_id: true,
    second_instance_activation_ack_has_bounded_independent_ledger: true,
    mixed_version_primary_without_ack_must_surface_error: true,
    secondary_must_not_mutate_primary_journal: true,
    hidden_window_must_be_shown: true,
    minimized_window_must_be_restored: true,
    normal_ui_boot_requires_stable_window_readback: true,
    primary_activation_ack_timeout_ms: PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
    primary_activation_ack_poll_ms: PRIMARY_ACTIVATION_ACK_POLL_MS,
    startup_journal_max_events: BROWSER_STARTUP_JOURNAL_MAX_EVENTS,
    startup_activation_ack_max: BROWSER_STARTUP_ACTIVATION_ACK_MAX,
    authority_effect: false,
  });
}
