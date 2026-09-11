import { performance } from 'node:perf_hooks';

export const BROWSER_MAIN_EVENT_LOOP_PRESSURE_SCHEMA = 'metaengine.browser.main-event-loop-pressure.v1';

function boundedPositive(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))];
}

/**
 * Main-thread pressure sampler that owns no clock/timer.
 *
 * The existing BrowserRealtimeProcessPlane resource interval calls sample(). ELU
 * is read from perf_hooks and delay is the positive scheduling drift of that same
 * interval. A bounded ring turns drift into a p95 signal without introducing a
 * second event-loop delay monitor or polling cadence.
 */
export class BrowserMainEventLoopPressure {
  #clock;
  #eventLoopUtilization;
  #expectedIntervalMs;
  #maxDelaySamples;
  #lastSampleAtMs = null;
  #lastElu = null;
  #delays = [];
  #last = null;

  constructor({
    clock = () => performance.now(),
    eventLoopUtilization = (...args) => performance.eventLoopUtilization(...args),
    expectedIntervalMs = 250,
    maxDelaySamples = 64,
  } = {}) {
    if (typeof clock !== 'function' || typeof eventLoopUtilization !== 'function') {
      throw new Error('browser_main_event_loop_pressure_source_invalid');
    }
    this.#clock = clock;
    this.#eventLoopUtilization = eventLoopUtilization;
    this.#expectedIntervalMs = boundedPositive(expectedIntervalMs, 250, 25, 5000);
    this.#maxDelaySamples = Math.max(8, Math.min(512, Math.trunc(Number(maxDelaySamples) || 64)));
    try { this.#lastElu = this.#eventLoopUtilization(); } catch { this.#lastElu = null; }
  }

  sample({ expectedIntervalMs = this.#expectedIntervalMs } = {}) {
    const expected = boundedPositive(expectedIntervalMs, this.#expectedIntervalMs, 25, 5000);
    const now = Number(this.#clock());
    if (Number.isFinite(now) && this.#lastSampleAtMs != null) {
      const drift = Math.max(0, now - this.#lastSampleAtMs - expected);
      this.#delays.push(drift);
      if (this.#delays.length > this.#maxDelaySamples) {
        this.#delays.splice(0, this.#delays.length - this.#maxDelaySamples);
      }
    }
    if (Number.isFinite(now)) this.#lastSampleAtMs = now;

    let utilization = null;
    try {
      const current = this.#eventLoopUtilization();
      if (this.#lastElu) {
        const delta = this.#eventLoopUtilization(current, this.#lastElu);
        const value = Number(delta?.utilization);
        utilization = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
      }
      this.#lastElu = current;
    } catch {
      utilization = null;
    }

    this.#last = Object.freeze({
      schema: BROWSER_MAIN_EVENT_LOOP_PRESSURE_SCHEMA,
      observed_at: new Date().toISOString(),
      event_loop_utilization: utilization,
      event_loop_delay_p95_ms: percentile95(this.#delays),
      event_loop_delay_sample_count: this.#delays.length,
      expected_sample_interval_ms: expected,
      delay_source: 'EXISTING_PROCESS_SAMPLER_DRIFT',
      elu_source: 'NODE_PERF_HOOKS_EVENT_LOOP_UTILIZATION_DELTA',
      bounded_delay_samples: this.#maxDelaySamples,
      dedicated_timer: false,
      second_scheduler: false,
      authority_effect: false,
    });
    return this.#last;
  }

  snapshot() {
    return this.#last || Object.freeze({
      schema: BROWSER_MAIN_EVENT_LOOP_PRESSURE_SCHEMA,
      observed_at: null,
      event_loop_utilization: null,
      event_loop_delay_p95_ms: null,
      event_loop_delay_sample_count: 0,
      expected_sample_interval_ms: this.#expectedIntervalMs,
      delay_source: 'EXISTING_PROCESS_SAMPLER_DRIFT',
      elu_source: 'NODE_PERF_HOOKS_EVENT_LOOP_UTILIZATION_DELTA',
      bounded_delay_samples: this.#maxDelaySamples,
      dedicated_timer: false,
      second_scheduler: false,
      authority_effect: false,
    });
  }
}
