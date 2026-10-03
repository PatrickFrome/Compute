import fs from 'node:fs/promises';
import path from 'node:path';

export const BROWSER_STARTUP_JOURNAL_SCHEMA = 'metaengine.browser.startup-journal.v1';
export const BROWSER_STARTUP_JOURNAL_FILE = 'metaengine-browser-startup-journal-v1.json';
export const BROWSER_STARTUP_ACTIVATION_ACK_MAX = 256;
export const PRIMARY_ACTIVATION_ACK_TIMEOUT_MS = 15_000;
export const PRIMARY_ACTIVATION_ACK_POLL_MS = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('browser_startup_journal_app_invalid');
  }
}

export function validActivationLaunchId(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function startupJournalPath(app) {
  assertApp(app);
  return path.join(app.getPath('userData'), BROWSER_STARTUP_JOURNAL_FILE);
}

export function validActivationAck(row) {
  const pid = Number(row?.pid);
  return row
    && typeof row === 'object'
    && !Array.isArray(row)
    && typeof row.boot_id === 'string'
    && row.boot_id.length >= 16
    && validActivationLaunchId(row.launch_id)
    && Number.isSafeInteger(row.sequence)
    && row.sequence > 0
    && Number.isSafeInteger(pid)
    && pid > 0
    && typeof row.version === 'string'
    && typeof row.at === 'string'
    && row.authority_effect === false;
}

export function normalizeActivationAcks(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => validActivationAck(row)).slice(-BROWSER_STARTUP_ACTIVATION_ACK_MAX);
}

function validJournal(row) {
  return row
    && row.schema === BROWSER_STARTUP_JOURNAL_SCHEMA
    && row.version === 1
    && typeof row.current_boot_id === 'string'
    && Number.isSafeInteger(row.last_sequence)
    && row.last_sequence >= 0
    && Array.isArray(row.events)
    && (row.activation_acks == null || Array.isArray(row.activation_acks))
    && row.authority_effect === false;
}

export async function readStartupJournalFile(app) {
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

/**
 * A losing secondary never writes or quarantines the primary journal. It only
 * reads the bounded ACK ledger until the current primary durably proves that it
 * handled this exact launch nonce and surfaced its existing window.
 */
export async function waitForPrimaryActivationAck(app, {
  launch_id,
  timeout_ms = PRIMARY_ACTIVATION_ACK_TIMEOUT_MS,
  poll_ms = PRIMARY_ACTIVATION_ACK_POLL_MS,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!validActivationLaunchId(launch_id)) {
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
      const row = await readStartupJournalFile(app);
      const ledgerAck = normalizeActivationAcks(row?.activation_acks).findLast((candidate) => candidate
        && candidate.boot_id === row.current_boot_id
        && candidate.launch_id === launch_id);
      const eventAck = row?.events?.findLast?.((event) => event
        && event.boot_id === row.current_boot_id
        && event.state === 'PRIMARY_WINDOW_ACTIVATED'
        && event.details?.launch_id === launch_id
        && event.details?.visible === true);
      const ack = ledgerAck || eventAck;
      if (ack) {
        return Object.freeze({
          ok: true,
          reason: 'PRIMARY_ACTIVATION_ACK_EXACT',
          ack_source: ledgerAck ? 'ACTIVATION_ACK_LEDGER' : 'STARTUP_EVENT_RING',
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
