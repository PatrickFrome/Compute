import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { durableWriteJson } = require('./durable-json-file.cjs');

export const BROWSER_STARTUP_JOURNAL_SCHEMA = 'metaengine.browser.startup-journal.v1';
export const BROWSER_STARTUP_JOURNAL_FILE = 'metaengine-browser-startup-journal-v1.json';
export const BROWSER_STARTUP_JOURNAL_MAX_EVENTS = 128;
export const PRIMARY_WINDOW_STABLE_MS = 1_500;
export const PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS = 30_000;
export const PRIMARY_ACTIVATION_ACK_TIMEOUT_MS = 15_000;

const SAFE_STATE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_REASON = /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/;
const SAFE_DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let journalTail = Promise.resolve();

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('browser_startup_journal_app_invalid');
  }
}

function startupJournalPath(app) {
  assertApp(app);
  return path.join(app.getPath('userData'), BROWSER_STARTUP_JOURNAL_FILE);
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

function validJournal(row) {
  return row
    && row.schema === BROWSER_STARTUP_JOURNAL_SCHEMA
    && row.version === 1
    && typeof row.current_boot_id === 'string'
    && Number.isSafeInteger(row.last_sequence)
    && row.last_sequence >= 0
    && Array.isArray(row.events)
    && row.authority_effect === false;
}

async function readJournalFile(app) {
  const target = startupJournalPath(app);
  let raw;
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let row;
  try {
    row = JSON.parse(raw);
  } catch {
    throw new Error('browser_startup_journal_json_invalid');
  }
  if (!validJournal(row)) throw new Error('browser_startup_journal_schema_invalid');
  return row;
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
    row = await readJournalFile(app);
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

  const next = {
    ...row,
    current_boot_id: boot_id,
    current_version: String(app.getVersion() || ''),
    current_pid: process.pid,
    last_sequence: sequence,
    updated_at: at,
    events: [...row.events, event].slice(-BROWSER_STARTUP_JOURNAL_MAX_EVENTS),
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
  return serializeJournal(() => appendEventUnlocked(app, input));
}

export async function readBrowserStartupJournal(app) {
  const row = await readJournalFile(app);
  return row == null ? null : structuredClone(row);
}

/**
 * A losing secondary never writes the primary journal. It only waits for the
 * current primary to durably prove that it handled this exact launch nonce and
 * made an existing window visible. Old versions cannot manufacture that ACK, so
 * the caller can distinguish a compatible primary from a stale/hidden one.
 */
export async function waitForPrimaryActivationAck(app, {
  launch_id,
  timeout_ms = PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
  poll_ms = 100,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof launch_id !== 'string' || !UUID.test(launch_id)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_ACTIVATION_ACK_LAUNCH_ID_INVALID', authority_effect: false });
  }
  if (![timeout_ms, poll_ms].every((value) => Number.isFinite(value) && value > 0)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_ACTIVATION_ACK_CONFIG_INVALID', authority_effect: false });
  }
  const startedAt = Number(clock());
  if (!Number.isFinite(startedAt)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_ACTIVATION_ACK_CLOCK_INVALID', authority_effect: false });
  }
  let lastReadError = null;

  while (Number(clock()) - startedAt <= timeout_ms) {
    try {
      const row = await readJournalFile(app);
      const ack = row?.events?.findLast?.((event) => event
        && event.boot_id === row.current_boot_id
        && event.state === 'PRIMARY_WINDOW_ACTIVATED'
        && event.details?.launch_id === launch_id
        && event.details?.visible === true);
      if (ack) {
        return Object.freeze({
          ok: true,
          reason: 'PRIMARY_ACTIVATION_ACK_EXACT',
          launch_id,
          primary_boot_id: row.current_boot_id,
          event_sequence: ack.sequence,
          primary_version: ack.version,
          primary_pid: ack.pid,
          authority_effect: false,
        });
      }
      lastReadError = null;
    } catch (error) {
      // Read ambiguity is not permission to mutate or quarantine the primary's
      // journal from the secondary process. Keep waiting within the same bound.
      lastReadError = String(error?.message || error).slice(0, 160);
    }
    await sleep(poll_ms);
  }

  return Object.freeze({
    ok: false,
    reason: lastReadError == null
      ? 'PRIMARY_ACTIVATION_ACK_TIMEOUT'
      : 'PRIMARY_ACTIVATION_ACK_READ_AMBIGUOUS',
    launch_id,
    last_read_error: lastReadError,
    authority_effect: false,
  });
}

function liveWindows(BaseWindow) {
  if (!BaseWindow || typeof BaseWindow.getAllWindows !== 'function') return [];
  const rows = BaseWindow.getAllWindows();
  if (!Array.isArray(rows)) return [];
  return rows.filter((win) => win && typeof win.isDestroyed === 'function' && win.isDestroyed() !== true);
}

export function activateExistingPrimaryWindow(BaseWindow) {
  try {
    const windows = liveWindows(BaseWindow);
    if (windows.length === 0) {
      return Object.freeze({
        ok: false,
        reason: 'PRIMARY_WINDOW_NOT_READY',
        window_count: 0,
        authority_effect: false,
      });
    }
    const focused = typeof BaseWindow.getFocusedWindow === 'function' ? BaseWindow.getFocusedWindow() : null;
    const target = focused && windows.includes(focused) ? focused : windows[0];
    const wasMinimized = typeof target.isMinimized === 'function' && target.isMinimized() === true;
    if (wasMinimized && typeof target.restore === 'function') target.restore();
    if (typeof target.show === 'function') target.show();
    if (typeof target.focus === 'function') target.focus();
    return Object.freeze({
      ok: true,
      reason: 'PRIMARY_WINDOW_ACTIVATED',
      window_count: windows.length,
      restored: wasMinimized,
      visible: typeof target.isVisible === 'function' ? target.isVisible() === true : null,
      focused: typeof target.isFocused === 'function' ? target.isFocused() === true : null,
      authority_effect: false,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: 'PRIMARY_WINDOW_ACTIVATION_ERROR',
      error: String(error?.message || error).slice(0, 200),
      authority_effect: false,
    });
  }
}

export async function waitForStablePrimaryWindow(BaseWindow, {
  timeout_ms = PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS,
  stable_ms = PRIMARY_WINDOW_STABLE_MS,
  poll_ms = 100,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (![timeout_ms, stable_ms, poll_ms].every((value) => Number.isFinite(value) && value > 0)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_WINDOW_OBSERVER_CONFIG_INVALID', authority_effect: false });
  }
  const startedAt = Number(clock());
  if (!Number.isFinite(startedAt)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_WINDOW_OBSERVER_CLOCK_INVALID', authority_effect: false });
  }
  let target = null;
  let stableSince = null;

  while (Number(clock()) - startedAt <= timeout_ms) {
    let windows;
    try {
      windows = liveWindows(BaseWindow);
    } catch {
      windows = [];
    }
    const visible = windows.find((win) => typeof win.isVisible !== 'function' || win.isVisible() === true) || null;
    const now = Number(clock());
    if (visible && visible === target) {
      if (stableSince != null && now - stableSince >= stable_ms) {
        return Object.freeze({
          ok: true,
          reason: 'PRIMARY_WINDOW_STABLE',
          window_count: windows.length,
          stable_ms: now - stableSince,
          visible: typeof visible.isVisible === 'function' ? visible.isVisible() === true : null,
          focused: typeof visible.isFocused === 'function' ? visible.isFocused() === true : null,
          authority_effect: false,
        });
      }
    } else if (visible) {
      target = visible;
      stableSince = now;
    } else {
      target = null;
      stableSince = null;
    }
    await sleep(poll_ms);
  }

  return Object.freeze({
    ok: false,
    reason: 'PRIMARY_WINDOW_STABLE_TIMEOUT',
    window_count: liveWindows(BaseWindow).length,
    authority_effect: false,
  });
}

export function browserStartupObservabilityContract() {
  return Object.freeze({
    schema: BROWSER_STARTUP_JOURNAL_SCHEMA,
    durable_startup_journal_required: true,
    runtime_import_failure_must_be_durable: true,
    gui_stderr_is_diagnostic_authority: false,
    second_instance_must_activate_primary_window: true,
    second_instance_activation_ack_must_match_launch_id: true,
    mixed_version_primary_without_ack_must_surface_error: true,
    secondary_must_not_mutate_primary_journal: true,
    hidden_window_must_be_shown: true,
    minimized_window_must_be_restored: true,
    normal_ui_boot_requires_stable_window_readback: true,
    primary_activation_ack_timeout_ms: PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
    startup_journal_max_events: BROWSER_STARTUP_JOURNAL_MAX_EVENTS,
    authority_effect: false,
  });
}
