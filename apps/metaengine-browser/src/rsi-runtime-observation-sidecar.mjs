export const RSI_RUNTIME_OBSERVATION_SIDECAR_SCHEMA = 'metaengine.rsi.runtime-observation-sidecar.v1';

function assertRuntime(runtime) {
  if (
    !runtime
    || typeof runtime.observeBrainSnapshot !== 'function'
    || typeof runtime.flushObservations !== 'function'
  ) {
    throw new Error('rsi_observation_sidecar_runtime_invalid');
  }
  return runtime;
}

export class RsiRuntimeObservationSidecar {
  #runtimeProvider;
  #running = false;
  #drainPromise = null;
  #pendingLatest = null;
  #submitted = 0;
  #processed = 0;
  #replaced = 0;
  #failed = 0;
  #lastError = null;
  #lastObservedAt = null;

  constructor({ runtimeProvider } = {}) {
    if (typeof runtimeProvider !== 'function') throw new Error('rsi_observation_sidecar_runtime_provider_required');
    this.#runtimeProvider = runtimeProvider;
  }

  submit(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('rsi_observation_sidecar_snapshot_required');
    }
    this.#submitted += 1;
    if (this.#pendingLatest) this.#replaced += 1;
    this.#pendingLatest = snapshot;
    if (!this.#drainPromise) {
      this.#running = true;
      queueMicrotask(() => {
        if (!this.#drainPromise) this.#drainPromise = this.#drain();
      });
    }
    return this.snapshot();
  }

  async #drain() {
    try {
      while (this.#pendingLatest) {
        const snapshot = this.#pendingLatest;
        this.#pendingLatest = null;
        try {
          const runtime = assertRuntime(this.#runtimeProvider());
          const observation = await runtime.observeBrainSnapshot(snapshot);
          this.#processed += 1;
          this.#lastObservedAt = observation?.observed_at || null;
          this.#lastError = null;
        } catch (error) {
          this.#failed += 1;
          this.#lastError = String(error?.message || error).slice(0, 240);
        }
      }
    } finally {
      this.#drainPromise = null;
      this.#running = false;
      if (this.#pendingLatest) {
        this.#running = true;
        this.#drainPromise = this.#drain();
      }
    }
  }

  async flush() {
    if (this.#pendingLatest && !this.#drainPromise) {
      this.#running = true;
      this.#drainPromise = this.#drain();
    }
    if (this.#drainPromise) await this.#drainPromise;
    const runtime = this.#runtimeProvider();
    if (!runtime) return false;
    assertRuntime(runtime);
    return runtime.flushObservations();
  }

  snapshot() {
    return Object.freeze({
      schema: RSI_RUNTIME_OBSERVATION_SIDECAR_SCHEMA,
      submitted_count: this.#submitted,
      processed_count: this.#processed,
      replaced_pending_count: this.#replaced,
      failed_count: this.#failed,
      pending: this.#pendingLatest != null,
      drain_in_flight: this.#drainPromise != null || this.#running,
      max_pending_snapshots: 1,
      delivery: 'LATEST_ONLY_SINGLE_INFLIGHT',
      last_observed_at: this.#lastObservedAt,
      last_error: this.#lastError,
      piggybacks_existing_browser_brain_cadence: true,
      independent_timer: false,
      second_scheduler: false,
      execution_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}
