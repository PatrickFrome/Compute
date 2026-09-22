// Command pickup fastlane — transport-layer accelerator for the native supervisor.
//
// Purpose: the supervisor cycle carries mesh/lifecycle/self-update/heartbeat work
// and historically leased at most one command per full cycle, which measured
// 8-336 seconds from issuance to pickup on the live host. This module polls the
// SAME signed /v1/commands/next lease endpoint on a short cadence so a PENDING
// command is picked up within ~interval + one round trip.
//
// Invariants (amendment is explicit, nothing is widened):
// - command_pickup_transport_only: the fastlane has no scheduler authority. The
//   single supervisor cycle remains the only scheduler for lifecycle, mesh,
//   self-update and heartbeat.
// - command_execution_exclusive: execution stays mutually exclusive via the
//   client's local command slot plus the transactional DB lease
//   (h205f22_a2_browser_supervisor_lease_v3 flips PENDING -> LEASED once).
// - No new authority path: commands flow through the exact same lease, gate
//   (mode/armed), execute and result-posting code as cycle-driven pickup.
// - Failures degrade to backoff (bounded, resets on success) and never spawn a
//   second scheduler; enrollment is still driven by the supervisor cycle.

const clip = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);

export class NativeSupervisorCommandFastlane {
  #intervalMs;
  #maxBackoffMs;
  #isRunning;
  #isSlotBusy;
  #identitySnapshot;
  #pickupAndRun;
  #timer = null;
  #backoffMs = 0;
  #lastPollAt = null;
  #pollCount = 0;
  #executed = 0;
  #lastError = null;

  constructor({ intervalMs = 750, maxBackoffMs = 8000, isRunning, isSlotBusy, identitySnapshot, pickupAndRun } = {}) {
    if (typeof isRunning !== 'function') throw new Error('native_supervisor_fastlane_running_probe_required');
    if (typeof isSlotBusy !== 'function') throw new Error('native_supervisor_fastlane_slot_probe_required');
    if (typeof identitySnapshot !== 'function') throw new Error('native_supervisor_fastlane_identity_probe_required');
    if (typeof pickupAndRun !== 'function') throw new Error('native_supervisor_fastlane_pickup_required');
    this.#intervalMs = Math.max(250, Number(intervalMs) || 750);
    this.#maxBackoffMs = Math.max(this.#intervalMs * 2, Number(maxBackoffMs) || 8000);
    this.#isRunning = isRunning;
    this.#isSlotBusy = isSlotBusy;
    this.#identitySnapshot = identitySnapshot;
    this.#pickupAndRun = pickupAndRun;
  }

  get intervalMs() { return this.#intervalMs; }
  get active() { return this.#timer != null; }

  start() {
    if (this.#timer) return;
    this.#schedule();
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // Backoff state is intentionally preserved across stop/start so a restart
    // during a degraded network does not immediately resume hot polling.
  }

  #schedule() {
    if (this.#timer) return;
    const delay = this.#backoffMs || this.#intervalMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#tick().catch(() => {}).finally(() => this.#schedule());
    }, delay);
    this.#timer.unref?.();
  }

  async #tick() {
    if (!this.#isRunning()) return;
    if (this.#isSlotBusy()) return; // an active command owns the slot; defer to it
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
      schema: 'metaengine.native-supervisor.command-fastlane.v1',
      enabled: true,
      running: this.#isRunning(),
      active: this.active,
      interval_ms: this.#intervalMs,
      current_backoff_ms: this.#backoffMs,
      last_poll_at: this.#lastPollAt,
      poll_count: this.#pollCount,
      commands_executed: this.#executed,
      last_error: this.#lastError,
      command_pickup_transport_only: true,
      command_execution_exclusive: 'local_slot_plus_db_lease_transactional',
      scheduler_authority: false,
      browser_authority: false,
      authority_effect: false,
    });
  }
}
