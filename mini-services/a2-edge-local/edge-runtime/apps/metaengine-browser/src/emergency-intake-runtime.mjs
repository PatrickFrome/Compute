export const EMERGENCY_INTAKE_RUNTIME_SCHEMA = 'metaengine.browser.emergency-intake-runtime.v1';

function boundedDelay(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export class EmergencyIntakeRuntime {
  #pump;
  #running = false;
  #timer = null;
  #inFlight = null;
  #lastAt = null;
  #lastState = 'STOPPED';
  #lastError = null;
  #cycles = 0;
  #resultReplays = 0;
  #setTimer;
  #clearTimer;
  #idleDelayMs;
  #errorDelayMs;

  constructor({
    pump,
    idleDelayMs = 250,
    errorDelayMs = 1000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (!pump || typeof pump.cycle !== 'function' || typeof pump.retryCompletion !== 'function' || typeof pump.snapshot !== 'function') {
      throw new Error('emergency_intake_runtime_pump_required');
    }
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('emergency_intake_runtime_timer_required');
    this.#pump = pump;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#idleDelayMs = boundedDelay(idleDelayMs, 250, 50, 5000);
    this.#errorDelayMs = boundedDelay(errorDelayMs, 1000, 250, 15000);
  }

  snapshot() {
    return Object.freeze({
      schema: EMERGENCY_INTAKE_RUNTIME_SCHEMA,
      running: this.#running,
      in_flight: this.#inFlight != null,
      last_at: this.#lastAt,
      last_state: this.#lastState,
      last_error: this.#lastError,
      cycles: this.#cycles,
      result_replays: this.#resultReplays,
      idle_delay_ms: this.#idleDelayMs,
      error_delay_ms: this.#errorDelayMs,
      general_scheduler_dependency: false,
      second_general_scheduler: false,
      leases_normal_commands: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }

  start() {
    if (this.#running) return this.snapshot();
    this.#running = true;
    this.#lastState = 'STARTING';
    this.#schedule(0);
    return this.snapshot();
  }

  stop() {
    const wasRunning = this.#running;
    this.#running = false;
    if (this.#timer) this.#clearTimer(this.#timer);
    this.#timer = null;
    if (!this.#inFlight) this.#lastState = 'STOPPED';
    return wasRunning;
  }

  async stopAndWait() {
    this.stop();
    if (this.#inFlight) await this.#inFlight.catch(() => {});
    this.#lastState = 'STOPPED';
    return this.snapshot();
  }

  #schedule(delayMs) {
    if (!this.#running || this.#timer || this.#inFlight) return;
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      void this.#runOne();
    }, Math.max(0, Number(delayMs) || 0));
    this.#timer?.unref?.();
  }

  async #runOne() {
    if (!this.#running || this.#inFlight) return;
    this.#inFlight = (async () => {
      const pending = this.#pump.snapshot()?.state === 'RESULT_PENDING';
      const result = pending ? await this.#pump.retryCompletion() : await this.#pump.cycle();
      this.#cycles += 1;
      if (pending) this.#resultReplays += 1;
      this.#lastAt = new Date().toISOString();
      this.#lastState = String(result?.state || 'UNKNOWN').slice(0, 80);
      this.#lastError = null;
      return result;
    })().catch((error) => {
      this.#lastAt = new Date().toISOString();
      this.#lastState = 'ERROR';
      this.#lastError = String(error?.message || error || 'UNKNOWN').slice(0, 240);
      return null;
    }).finally(() => {
      this.#inFlight = null;
      if (!this.#running) {
        this.#lastState = 'STOPPED';
        return;
      }
      const pending = this.#pump.snapshot()?.state === 'RESULT_PENDING';
      const delay = this.#lastError ? this.#errorDelayMs : (pending ? this.#errorDelayMs : this.#idleDelayMs);
      this.#schedule(delay);
    });
    return this.#inFlight;
  }
}
