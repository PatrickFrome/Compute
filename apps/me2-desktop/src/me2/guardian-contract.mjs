/**
 * ME2 desktop — Guardian-parity light (R81, GAP #2; TOP-8 must-carry item 2).
 *
 * Legacy parity carried over: an EXTERNAL watchdog can resurrect a fallen
 * client, with the same evidence discipline (durable JSONL journal) and the
 * same honest caps (no restart storms, never fight a clean operator quit).
 *
 * Mechanics:
 *   · The client writes an atomic BEACON file { pid, boot_id, ts, clean_exit? }
 *     into userData every BEACON_INTERVAL_MS (thin electron wiring in main.mjs).
 *   · The external guardian (scripts/guardian.mjs) evaluates the beacon with
 *     pure decisions below: shape → clock sanity → pid liveness → freshness.
 *   · Restarts use exponential backoff 15s→120s (mirrors epoch-fence family),
 *     reset after a stability window; a journal-window restart cap (8/h)
 *     turns restart into an honest give_up instead of a storm.
 *   · A clean operator quit is journaled in the beacon (clean_exit) and is
 *     NEVER fought — the guardian monitors, it does not resurrect a decision.
 *
 * Everything here is pure and testable (node --test); electron/spawn wiring
 * lives in main.mjs / scripts/guardian.mjs.
 */
import { GUARDIAN } from '../shared/me2-constants.mjs';

/** Build the beacon record the client persists atomically (pure). */
export function makeBeacon({ pid, bootId, now = Date.now(), cleanExit = false } = {}) {
  return { pid, boot_id: bootId, ts: now, clean_exit: Boolean(cleanExit) };
}

/**
 * Pure decision: is the beacon well-formed? Missing/corrupt readJson both
 * arrive as null → the same honest "absent" (no phantom shape guessing).
 */
export function validateBeacon(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'beacon_absent' };
  }
  const { pid, boot_id: bootId, ts } = raw;
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'beacon_pid_malformed' };
  if (typeof bootId !== 'string' || bootId.length === 0) return { ok: false, reason: 'beacon_boot_id_malformed' };
  if (!Number.isFinite(ts) || typeof ts !== 'number') return { ok: false, reason: 'beacon_ts_absent' };
  return { ok: true, beacon: raw };
}

/**
 * Pure decision: liveness verdict from a beacon record.
 * Order matters and is honest: shape → clock sanity → pid death → staleness.
 * alive=false never throws; the caller journals the reason.
 */
export function evaluateBeacon({ beacon, now = Date.now(), staleMs = GUARDIAN.STALE_MS, aliveImpl = () => true } = {}) {
  const shape = validateBeacon(beacon);
  if (!shape.ok) return { alive: false, reason: shape.reason };
  const b = shape.beacon;
  if (b.clean_exit === true) return { alive: false, reason: 'clean_exit' };
  if (b.ts > now) return { alive: false, reason: 'ts_in_future' };
  if (!aliveImpl(b.pid)) return { alive: false, reason: 'pid_dead' };
  if (now - b.ts > staleMs) return { alive: false, reason: 'beacon_stale' };
  return { alive: true, reason: 'alive', ageMs: now - b.ts };
}

/** Exponential backoff progression (null/0 → start; capped at max). */
export function nextBackoffMs({ currentMs, startMs = GUARDIAN.BACKOFF_START_MS, maxMs = GUARDIAN.BACKOFF_MAX_MS } = {}) {
  if (!Number.isFinite(currentMs) || currentMs <= 0) return startMs;
  return Math.min(currentMs * 2, maxMs);
}

/**
 * Pure decision: what should the guardian do on this observation?
 * Returns { action: 'monitor'|'wait'|'restart'|'give_up', ... } — the caller
 * journals and executes; nothing here spawns anything.
 */
export function decideRestart({
  alive,
  restartsInWindow,
  maxRestarts = GUARDIAN.MAX_RESTARTS_PER_WINDOW,
  now = Date.now(),
  lastRestartAt = null,
  currentBackoffMs = GUARDIAN.BACKOFF_START_MS,
  lastAliveAt = null,
  stableResetMs = GUARDIAN.STABLE_RESET_MS,
  reason = 'client_down',
} = {}) {
  if (alive) {
    const stable = lastAliveAt != null && now - lastAliveAt >= stableResetMs;
    return { action: 'monitor', reason: stable ? 'stable' : 'alive', resetBackoff: stable };
  }
  if (reason === 'clean_exit') return { action: 'monitor', reason, resetBackoff: true };
  if (restartsInWindow >= maxRestarts) return { action: 'give_up', reason: 'restart_cap' };
  if (lastRestartAt != null && now - lastRestartAt < currentBackoffMs) {
    return { action: 'wait', reason: 'backoff', retryInMs: currentBackoffMs - (now - lastRestartAt) };
  }
  return { action: 'restart', reason };
}

/**
 * Pure count: guardian_restart events inside the sliding window, from journal
 * records (the window survives watchdog restarts — evidence over memory).
 * Journal records carry `at` (ISO string, appendJournal contract); a raw `ts`
 * number is accepted as the honest fallback for in-memory records.
 */
export function computeRestartsInWindow(records, { now = Date.now(), windowMs = GUARDIAN.MAX_RESTARTS_WINDOW_MS } = {}) {
  if (!Array.isArray(records)) return 0;
  const floor = now - windowMs;
  let count = 0;
  for (const r of records) {
    if (!r || r.event !== 'guardian_restart') continue;
    const t = typeof r.at === 'string' ? new Date(r.at).getTime() : Number.isFinite(r.ts) ? r.ts : NaN;
    if (Number.isFinite(t) && t >= floor) count += 1;
  }
  return count;
}
