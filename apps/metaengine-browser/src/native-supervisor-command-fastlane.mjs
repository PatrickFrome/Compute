// Command pickup fastlane — transport-layer accelerator for the native supervisor.
//
// Purpose: the supervisor cycle carries mesh/lifecycle/self-update/heartbeat work
// and historically leased at most one command per full cycle, which measured
// 8-336 seconds from issuance to pickup on the live host. This module polls the
// SAME signed /v1/commands/next lease endpoint on a short fallback cadence and
// also supports coalesced trusted wake-ups so a push transport can trigger the
// same lease path immediately. After one successful pickup it drains a bounded
// burst without sleeping between commands.
//
// Invariants (amendment is explicit, nothing is widened):
// - command_pickup_transport_only: the fastlane has no scheduler authority. The
//   single supervisor cycle remains the only scheduler for lifecycle, mesh,
//   self-update and heartbeat.
// - command_execution_exclusive: execution stays mutually exclusive via the
//   client's local command slot plus the transactional DB lease.
// - No new authority path: wake is only a transport hint. Commands still flow
//   through the exact same lease, mode/armed gate, executor and result posting.
// - Burst drain is bounded and serial at the effect slot. It removes avoidable
//   inter-command sleep but does not create parallel mutating effects.
// - Failures degrade to bounded backoff and never spawn a second scheduler.

const clip = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);

export class NativeSupervisorCommandFastlane {
  #intervalMs;
  #maxBackoffMs;
  #maxDrain;
  #isRunning;
  #isSlotBusy;
  #identitySnapshot;
  #pickupAndRun;
  #timer = null;
  #tickPromise = null;
  #wakeQueued = false;
  #backoffMs = 0;
  #lastPollAt = null;
  #lastWakeAt = null;
  #lastWakeReason = null;
  #pollCount = 0;
  #wakeCount = 0;
  #executed = 0;
  #drainBursts = 0;
  #maxObservedDrain = 0;
  #lastError = null;

  constructor({
    intervalMs = 750,
    maxBackoffMs = 8000,
    maxDrain = 32,
    isRunning,
    isSlotBusy,
    identitySnapshot,
    pickupAndRun,
  } = {}) {
    if (typeof isRunning !== 'function') throw new Error('native_supervisor_fastlane_running_probe_required');
    if (typeof isSlotBusy !== 'function') throw new Error('native_supervisor_fastlane_slot_probe_required');
    if (typeof identitySnapshot !== 'function') throw new Error('native_supervisor_fastlane_identity_probe_required');
    if (typeof pickupAndRun !== 'function') throw new Error('native_supervisor_fastlane_pickup_required');
    this.#intervalMs = Math.max(100, Number(intervalMs) || 750);
    this.#maxBackoffMs = Math.max(this.#intervalMs * 2, Number(maxBackoffMs) || 8000);
    this.#maxDrain = Math.max(1, Math.min(256, Number(maxDrain) || 32));
    this.#isRunning = isRunning;
    this.#isSlotBusy = isSlotBusy;
    this.#identitySnapshot = identitySnapshot;
    this.#pickupAndRun = pickupAndRun;
  }

  get intervalMs() { return this.#intervalMs; }
  get active() { return this.#timer != null || this.#tickPromise != null || this.#wakeQueued; }

  start() {
    if (!this.#isRunning()) return false;
    this.#schedule();
    return true;
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#wakeQueued = false;
    // Backoff state is intentionally preserved across stop/start so a restart
    // during a degraded network does not immediately resume hot polling.
  }

  wake(reason = 'TRUSTED_PUSH') {
    if (!this.#isRunning()) return false;
    this.#wakeCount += 1;
    this.#lastWakeAt = new Date().toISOString();
    this.#lastWakeReason = String(reason || 'TRUSTED_PUSH').slice(0, 120);
    if (this.#wakeQueued || this.#tickPromise) return true;
    this.#wakeQueued = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    queueMicrotask(() => {
      this.#wakeQueued = false;
      void this.#runTick().finally(() => this.#schedule());
    });
    return true;
  }

  #schedule() {
    if (!this.#isRunning() || this.#timer || this.#tickPromise || this.#wakeQueued) return;
    const delay = this.#backoffMs || this.#intervalMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#runTick().finally(() => this.#schedule());
    }, delay);
    this.#timer.unref?.();
  }

  async #runTick() {
    if (this.#tickPromise) return this.#tickPromise;
    this.#tickPromise = this.#tick().finally(() => { this.#tickPromise = null; });
    return this.#tickPromise;
  }

  async #tick() {
    if (!this.#isRunning()) return 0;
    if (this.#isSlotBusy()) return 0;
    const identity = this.#identitySnapshot();
    if (!identity?.device_id) return 0;
    this.#lastPollAt = new Date().toISOString();
    this.#pollCount += 1;
    let drained = 0;
    try {
      while (drained < this.#maxDrain && this.#isRunning() && !this.#isSlotBusy()) {
        const command = await this.#pickupAndRun();
        if (!command) break;
        drained += 1;
        this.#executed += 1;
      }
      if (drained > 0) {
        this.#drainBursts += 1;
        this.#maxObservedDrain = Math.max(this.#maxObservedDrain, drained);
      }
      this.#backoffMs = 0;
      this.#lastError = null;
      return drained;
    } catch (error) {
      const next = this.#backoffMs
        ? Math.min(this.#maxBackoffMs, this.#backoffMs * 2)
        : Math.min(this.#maxBackoffMs, this.#intervalMs * 2);
      this.#backoffMs = next;
      this.#lastError = clip(error);
      return drained;
    }
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.native-supervisor.command-fastlane.v1',
      enabled: true,
      running: this.#isRunning(),
      active: this.active,
      interval_ms: this.#intervalMs,
      fallback_interval_ms: this.#intervalMs,
      current_backoff_ms: this.#backoffMs,
      max_drain: this.#maxDrain,
      last_poll_at: this.#lastPollAt,
      last_wake_at: this.#lastWakeAt,
      last_wake_reason: this.#lastWakeReason,
      poll_count: this.#pollCount,
      wake_count: this.#wakeCount,
      commands_executed: this.#executed,
      drain_bursts: this.#drainBursts,
      max_observed_drain: this.#maxObservedDrain,
      last_error: this.#lastError,
      trusted_wake_transport_hint_only: true,
      command_pickup_transport_only: true,
      command_execution_exclusive: 'local_slot_plus_db_lease_transactional',
      mutating_parallelism: 1,
      scheduler_authority: false,
      browser_authority: false,
      authority_effect: false,
    });
  }
}
