// Command batch fastlane — wake-aware pickup accelerator for the native supervisor.
//
// Purpose: when the deployed edge serves /v1/commands/wait-batch as a bounded
// DB poll (no LISTEN/NOTIFY wake), the held wait-batch is also the worst-case
// command pickup delay (observed live as DB_POLL_TIMEOUT_FALLBACK with a 4s
// budget and 2.7–6.9s issue→COMPLETED). This module polls the SAME signed
// /v1/commands/next single-lease endpoint on a short cadence so a PENDING
// command is picked up within ~interval + one round trip while the supervisor
// cycle is parked inside its held wait-batch request.
//
// Wake awareness (the amendment that keeps the steady state single-loop):
// - POLL_EDGE evidence (wake_reason ending in DB_POLL_FALLBACK) keeps the
//   accelerator polling;
// - NOTIFY_EDGE evidence (POSTGRES_NOTIFY / POSTGRES_RELISTEN /
//   POSTGRES_SUBSCRIBED_RECHECK / REALTIME_*) suspends it permanently until
//   poll-fallback evidence returns, so a wake-capable edge never sees extra
//   lease traffic in steady state;
// - NEUTRAL evidence (IMMEDIATE / TIMEOUT / UNKNOWN) keeps the current mode.
//
// Invariants (nothing is widened):
// - command_pickup_transport_only: the batch fastlane has no scheduler
//   authority. The supervisor cycle remains the only scheduler for lifecycle,
//   mesh, self-update, heartbeat and maintenance.
// - command_execution_exclusive: execution stays mutually exclusive via the
//   client's in-flight command slot plus the transactional DB lease
//   (a PENDING command flips to LEASED exactly once, no matter which pickup
//   path observes it first).
// - No new authority path: commands flow through the exact same lease, gate
//   (mode/armed), execute and result-posting code as cycle-driven pickup.
// - Failures degrade to backoff (bounded, resets on success) and never spawn a
//   second scheduler; enrollment is still driven by the supervisor cycle.

const clip = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);

const NOTIFY_EDGE_RE = /^(POSTGRES_NOTIFY|POSTGRES_RELISTEN|POSTGRES_SUBSCRIBED_RECHECK|REALTIME_)/;
// Poll-fallback evidence: the legacy edge's literal DB_POLL_TIMEOUT_FALLBACK
// wake reason, or the current edge's POSTGRES_*_DB_POLL_FALLBACK family that
// only appears when LISTEN/NOTIFY wake is unavailable.
const POLL_EDGE_RE = /^DB_POLL_|_DB_POLL_FALLBACK$/;

export function classifyBatchFastlaneWakeReason(reason) {
  const normalized = String(reason || '').trim().toUpperCase();
  if (!normalized) return 'NEUTRAL';
  if (NOTIFY_EDGE_RE.test(normalized)) return 'NOTIFY_EDGE';
  if (POLL_EDGE_RE.test(normalized)) return 'POLL_EDGE';
  return 'NEUTRAL';
}

export class NativeSupervisorCommandBatchFastlane {
  #intervalMs;
  #maxBackoffMs;
  #isRunning;
  #isSlotBusy;
  #identitySnapshot;
  #pickupAndRun;
  #timer = null;
  #started = false;
  #backoffMs = 0;
  #lastPollAt = null;
  #pollCount = 0;
  #executed = 0;
  #lastError = null;
  #mode = 'POLLING';
  #lastWakeReason = null;
  #lastWakeReasonClass = 'UNPROVEN';
  #suspendCount = 0;
  #reactivateCount = 0;
  #observedWakeReasons = 0;

  constructor({
    intervalMs = 600,
    maxBackoffMs = 8000,
    isRunning,
    isSlotBusy,
    identitySnapshot,
    pickupAndRun,
    initialMode = 'POLLING',
  } = {}) {
    if (typeof isRunning !== 'function') throw new Error('native_supervisor_batch_fastlane_running_probe_required');
    if (typeof isSlotBusy !== 'function') throw new Error('native_supervisor_batch_fastlane_slot_probe_required');
    if (typeof identitySnapshot !== 'function') throw new Error('native_supervisor_batch_fastlane_identity_probe_required');
    if (typeof pickupAndRun !== 'function') throw new Error('native_supervisor_batch_fastlane_pickup_required');
    this.#intervalMs = Math.max(250, Number(intervalMs) || 600);
    this.#maxBackoffMs = Math.max(this.#intervalMs * 2, Number(maxBackoffMs) || 8000);
    this.#isRunning = isRunning;
    this.#isSlotBusy = isSlotBusy;
    this.#identitySnapshot = identitySnapshot;
    this.#pickupAndRun = pickupAndRun;
    const mode = String(initialMode || 'POLLING').toUpperCase();
    if (!['POLLING', 'SUSPENDED'].includes(mode)) throw new Error('native_supervisor_batch_fastlane_initial_mode_invalid');
    this.#mode = mode;
  }

  get intervalMs() { return this.#intervalMs; }
  get active() { return this.#timer != null; }
  get mode() { return this.#mode; }

  start() {
    this.#started = true;
    if (this.#timer) return;
    if (this.#mode !== 'POLLING') return;
    this.#schedule();
  }

  stop() {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // Backoff state is intentionally preserved across stop/start so a restart
    // during a degraded network does not immediately resume hot polling.
  }

  // Wake-evidence ingestion. Called by the client for every observed
  // wait-batch response so the accelerator follows the edge's actual
  // transport capability instead of a startup guess.
  observeWake(reason) {
    const normalized = String(reason || '').trim().slice(0, 120);
    const wakeClass = classifyBatchFastlaneWakeReason(normalized);
    this.#lastWakeReason = normalized || null;
    this.#lastWakeReasonClass = wakeClass;
    this.#observedWakeReasons += 1;
    if (wakeClass === 'NOTIFY_EDGE' && this.#mode !== 'SUSPENDED') {
      this.#mode = 'SUSPENDED';
      this.#suspendCount += 1;
      // Internal suspension clears the timer but keeps the started intent so
      // a later poll-fallback reactivation resumes the cadence on its own.
      if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
      return this.#mode;
    }
    if (wakeClass === 'POLL_EDGE' && this.#mode !== 'POLLING') {
      this.#mode = 'POLLING';
      this.#reactivateCount += 1;
      if (this.#started) this.#schedule();
      return this.#mode;
    }
    return this.#mode;
  }

  #schedule() {
    if (this.#timer) return;
    if (this.#mode !== 'POLLING') return;
    const delay = this.#backoffMs || this.#intervalMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#tick().catch(() => {}).finally(() => this.#schedule());
    }, delay);
    this.#timer.unref?.();
  }

  async #tick() {
    if (this.#mode !== 'POLLING') return;
    if (!this.#isRunning()) return;
    if (this.#isSlotBusy()) return; // in-flight commands own the slot; defer to them
    const identity = this.#identitySnapshot();
    if (!identity?.device_id) return; // enrollment is driven by the supervisor cycle
    this.#lastPollAt = new Date().toISOString();
    this.#pollCount += 1;
    try {
      const command = await this.#pickupAndRun();
      if (command) this.#executed += 1;
      this.#backoffMs = 0;
      this.#lastError = null;
    } catch (error) {
      const next = this.#backoffMs
        ? Math.min(this.#maxBackoffMs, this.#backoffMs * 2)
        : Math.min(this.#maxBackoffMs, this.#intervalMs * 2);
      this.#backoffMs = next;
      this.#lastError = clip(error);
    }
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.native-supervisor.command-batch-fastlane.v1',
      enabled: true,
      mode: this.#mode,
      active: this.active,
      interval_ms: this.#intervalMs,
      current_backoff_ms: this.#backoffMs,
      last_wake_reason: this.#lastWakeReason,
      last_wake_reason_class: this.#lastWakeReasonClass,
      observed_wake_reasons: this.#observedWakeReasons,
      suspend_count: this.#suspendCount,
      reactivate_count: this.#reactivateCount,
      last_poll_at: this.#lastPollAt,
      poll_count: this.#pollCount,
      commands_executed: this.#executed,
      last_error: this.#lastError,
      command_pickup_transport_only: true,
      command_execution_exclusive: 'local_slot_plus_db_lease_transactional',
      auto_suspend_on_notify_wake: true,
      steady_state_single_lease_loop: this.#mode !== 'POLLING',
      scheduler_authority: false,
      browser_authority: false,
      authority_effect: false,
    });
  }
}
