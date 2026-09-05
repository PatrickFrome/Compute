export const BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA = 'metaengine.browser.control-pressure-governor.v1';

export const CONTROL_PRESSURE_BANDS = Object.freeze({
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  ORANGE: 'ORANGE',
  RED: 'RED',
});

const BAND_ORDER = Object.freeze(['GREEN', 'YELLOW', 'ORANGE', 'RED']);
const BAND_BUDGETS = Object.freeze({
  GREEN: Object.freeze({ read_concurrency: 128, mutation_concurrency: 32, resource_sample_ms: 250 }),
  YELLOW: Object.freeze({ read_concurrency: 64, mutation_concurrency: 16, resource_sample_ms: 350 }),
  ORANGE: Object.freeze({ read_concurrency: 32, mutation_concurrency: 8, resource_sample_ms: 500 }),
  RED: Object.freeze({ read_concurrency: 8, mutation_concurrency: 2, resource_sample_ms: 1000 }),
});

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value, fallback = 0) {
  const parsed = finite(value, fallback);
  return parsed == null ? fallback : Math.max(0, parsed);
}

function ratio(value) {
  const parsed = finite(value, null);
  if (parsed == null) return null;
  return Math.max(0, Math.min(1, parsed));
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function higherBand(a, b) {
  return BAND_ORDER[Math.max(BAND_ORDER.indexOf(a), BAND_ORDER.indexOf(b))];
}

function metricBand({ value, yellow, orange, red }) {
  if (value == null) return null;
  if (value >= red) return 'RED';
  if (value >= orange) return 'ORANGE';
  if (value >= yellow) return 'YELLOW';
  return 'GREEN';
}

function pressureBand(sample = {}) {
  let band = 'GREEN';
  const missing = [];

  const elu = ratio(sample.event_loop_utilization);
  const delay = finite(sample.event_loop_delay_p95_ms, null);
  if (elu == null) missing.push('event_loop_utilization');
  else band = higherBand(band, metricBand({ value: elu, yellow: 0.60, orange: 0.75, red: 0.88 }));
  if (delay == null) missing.push('event_loop_delay_p95_ms');
  else band = higherBand(band, metricBand({ value: delay, yellow: 20, orange: 50, red: 120 }));

  const maxRendererCpu = finite(sample.max_renderer_cpu_percent, null);
  if (maxRendererCpu != null) band = higherBand(band, metricBand({ value: maxRendererCpu, yellow: 65, orange: 85, red: 97 }));

  const mainWorkingSetMb = finite(sample.main_working_set_mb, null);
  if (mainWorkingSetMb != null) band = higherBand(band, metricBand({ value: mainWorkingSetMb, yellow: 768, orange: 1536, red: 3072 }));

  const networkInflight = finite(sample.network_inflight, null);
  if (networkInflight != null) band = higherBand(band, metricBand({ value: networkInflight, yellow: 128, orange: 384, red: 768 }));

  const resultAckRtt = finite(sample.result_ack_rtt_p95_ms, null);
  if (resultAckRtt != null) band = higherBand(band, metricBand({ value: resultAckRtt, yellow: 300, orange: 1000, red: 3000 }));

  const leaseRtt = finite(sample.command_lease_rtt_p95_ms, null);
  if (leaseRtt != null) band = higherBand(band, metricBand({ value: leaseRtt, yellow: 300, orange: 1000, red: 3000 }));

  const unresponsive = nonNegative(sample.unresponsive_cells, 0);
  const recentCrashes = nonNegative(sample.recent_crashes, 0);
  if (unresponsive > 0 || recentCrashes >= 2) band = 'RED';
  else if (recentCrashes === 1) band = higherBand(band, 'ORANGE');

  // Missing both event-loop signals means we cannot prove a GREEN hot path.
  if (missing.length === 2) band = higherBand(band, 'ORANGE');
  else if (missing.length > 0) band = higherBand(band, 'YELLOW');

  return Object.freeze({ band, missing: Object.freeze(missing) });
}

function budgetFor(band, liveCells) {
  const base = BAND_BUDGETS[band] || BAND_BUDGETS.ORANGE;
  const live = integer(liveCells, 1, 1, 512);
  return Object.freeze({
    read_concurrency: base.read_concurrency,
    mutation_concurrency: Math.max(1, Math.min(base.mutation_concurrency, live)),
    resource_sample_ms: base.resource_sample_ms,
  });
}

export class BrowserControlPressureGovernor {
  #band = 'ORANGE';
  #betterSamples = 0;
  #recoverySamples;
  #lastSampleAt = null;
  #lastReasons = [];

  constructor({ recoverySamples = 3 } = {}) {
    this.#recoverySamples = integer(recoverySamples, 3, 1, 20);
  }

  observe(sample = {}) {
    const evaluated = pressureBand(sample);
    const currentIndex = BAND_ORDER.indexOf(this.#band);
    const evaluatedIndex = BAND_ORDER.indexOf(evaluated.band);

    if (evaluatedIndex > currentIndex) {
      // Degrade immediately. Protect liveness before chasing throughput.
      this.#band = evaluated.band;
      this.#betterSamples = 0;
    } else if (evaluatedIndex < currentIndex) {
      // Recover only one band at a time after several consecutive better samples.
      this.#betterSamples += 1;
      if (this.#betterSamples >= this.#recoverySamples) {
        this.#band = BAND_ORDER[Math.max(0, currentIndex - 1)];
        this.#betterSamples = 0;
      }
    } else {
      this.#betterSamples = 0;
    }

    this.#lastSampleAt = sample.observed_at ? String(sample.observed_at) : new Date().toISOString();
    this.#lastReasons = evaluated.missing;
    return this.snapshot({ liveCells: sample.live_cells });
  }

  snapshot({ liveCells = 1 } = {}) {
    const budget = budgetFor(this.#band, liveCells);
    return Object.freeze({
      schema: BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA,
      pressure_band: this.#band,
      better_samples_toward_recovery: this.#betterSamples,
      recovery_samples_required: this.#recoverySamples,
      last_sample_at: this.#lastSampleAt,
      missing_signals: Object.freeze([...this.#lastReasons]),
      ...budget,
      live_cells: integer(liveCells, 1, 1, 512),
      sample_driven: true,
      dedicated_timer: false,
      scheduler_authority: false,
      execution_authority: false,
      command_leasing: false,
      capacity_changes_authority: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}

export function evaluateControlPressure(sample = {}) {
  const evaluated = pressureBand(sample);
  return Object.freeze({
    schema: BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA,
    pressure_band: evaluated.band,
    missing_signals: evaluated.missing,
    ...budgetFor(evaluated.band, sample.live_cells),
    sample_driven: true,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}
