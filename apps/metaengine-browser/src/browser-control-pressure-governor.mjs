export const BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA = 'metaengine.browser.control-pressure-governor.v1';

export const CONTROL_PRESSURE_BANDS = Object.freeze({
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  ORANGE: 'ORANGE',
  RED: 'RED',
});

const BAND_ORDER = Object.freeze(['GREEN', 'YELLOW', 'ORANGE', 'RED']);
const BAND_RANK = Object.freeze({ GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 });
const BAND_BUDGETS = Object.freeze({
  GREEN: Object.freeze({ read_concurrency: 128, mutation_concurrency: 32, resource_sample_ms: 250 }),
  YELLOW: Object.freeze({ read_concurrency: 64, mutation_concurrency: 16, resource_sample_ms: 350 }),
  ORANGE: Object.freeze({ read_concurrency: 32, mutation_concurrency: 8, resource_sample_ms: 500 }),
  RED: Object.freeze({ read_concurrency: 8, mutation_concurrency: 2, resource_sample_ms: 1000 }),
});

const MISSING_SIGNAL = Symbol('missing_pressure_signal');
const INVALID_SIGNAL = Symbol('invalid_pressure_signal');

function recoverySampleCount(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 20) {
    const error = new TypeError('invalid_recovery_samples');
    error.code = 'invalid_recovery_samples';
    throw error;
  }
  return value;
}

function numericSignal(sample, key, max = null) {
  if (!Object.prototype.hasOwnProperty.call(sample, key)) return MISSING_SIGNAL;
  const raw = sample[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return INVALID_SIGNAL;
  return max == null ? raw : Math.min(max, raw);
}

function livenessCount(sample, key) {
  if (!Object.prototype.hasOwnProperty.call(sample, key)) return 0;
  const raw = sample[key];
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) return INVALID_SIGNAL;
  return raw;
}

function liveCellCount(value, { present = true } = {}) {
  if (!present) return 1;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return INVALID_SIGNAL;
  return Math.min(512, value);
}

function higherBand(a, b) {
  return BAND_ORDER[Math.max(BAND_RANK[a], BAND_RANK[b])];
}

function metricBand(value, yellow, orange, red) {
  if (value >= red) return 'RED';
  if (value >= orange) return 'ORANGE';
  if (value >= yellow) return 'YELLOW';
  return 'GREEN';
}

function pressureMetricBand(sample, key, yellow, orange, red, required, max, missing, invalid) {
  const value = numericSignal(sample, key, max);
  if (value === MISSING_SIGNAL) {
    if (required) missing.push(key);
    return 'GREEN';
  }
  if (value === INVALID_SIGNAL) {
    invalid.push(key);
    return 'RED';
  }
  return metricBand(value, yellow, orange, red);
}

function pressureBand(sample = {}) {
  let band = 'GREEN';
  const missing = [];
  const invalid = [];

  band = higherBand(band, pressureMetricBand(sample, 'event_loop_utilization', 0.60, 0.75, 0.88, true, 1, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'event_loop_delay_p95_ms', 20, 50, 120, true, null, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'max_renderer_cpu_percent', 65, 85, 97, false, null, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'main_working_set_mb', 768, 1536, 3072, false, null, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'network_inflight', 128, 384, 768, false, null, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'result_ack_rtt_p95_ms', 300, 1000, 3000, false, null, missing, invalid));
  band = higherBand(band, pressureMetricBand(sample, 'command_lease_rtt_p95_ms', 300, 1000, 3000, false, null, missing, invalid));

  const unresponsive = livenessCount(sample, 'unresponsive_cells');
  const recentCrashes = livenessCount(sample, 'recent_crashes');
  const liveCells = liveCellCount(sample.live_cells, {
    present: Object.prototype.hasOwnProperty.call(sample, 'live_cells'),
  });
  if (unresponsive === INVALID_SIGNAL) invalid.push('unresponsive_cells');
  if (recentCrashes === INVALID_SIGNAL) invalid.push('recent_crashes');
  if (liveCells === INVALID_SIGNAL) invalid.push('live_cells');
  if (invalid.length > 0) band = 'RED';
  else if (unresponsive > 0 || recentCrashes >= 2) band = 'RED';
  else if (recentCrashes === 1) band = higherBand(band, 'ORANGE');

  // Missing both event-loop signals means we cannot prove a GREEN hot path.
  if (missing.length === 2) band = higherBand(band, 'ORANGE');
  else if (missing.length > 0) band = higherBand(band, 'YELLOW');

  return Object.freeze({
    band,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    liveCells: liveCells === INVALID_SIGNAL ? 0 : liveCells,
  });
}

function budgetForValidatedLiveCells(band, liveCells) {
  const base = BAND_BUDGETS[band] || BAND_BUDGETS.ORANGE;
  return Object.freeze({
    read_concurrency: base.read_concurrency,
    mutation_concurrency: liveCells === 0 ? 0 : Math.max(1, Math.min(base.mutation_concurrency, liveCells)),
    resource_sample_ms: base.resource_sample_ms,
  });
}

export class BrowserControlPressureGovernor {
  #band = 'ORANGE';
  #betterSamples = 0;
  #recoverySamples;
  #lastSampleAt = null;
  #lastReasons = [];
  #lastInvalid = [];

  constructor({ recoverySamples = 3 } = {}) {
    this.#recoverySamples = recoverySampleCount(recoverySamples);
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
    this.#lastInvalid = evaluated.invalid;
    return this.snapshot({ liveCells: evaluated.liveCells });
  }

  snapshot({ liveCells = 1 } = {}) {
    const liveSignal = liveCellCount(liveCells);
    const liveSignalInvalid = liveSignal === INVALID_SIGNAL;
    const normalizedLiveCells = liveSignalInvalid ? 0 : liveSignal;
    const invalidSignals = liveSignalInvalid && !this.#lastInvalid.includes('live_cells')
      ? Object.freeze([...this.#lastInvalid, 'live_cells'])
      : Object.freeze([...this.#lastInvalid]);
    return Object.freeze({
      schema: BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA,
      pressure_band: liveSignalInvalid ? 'RED' : this.#band,
      better_samples_toward_recovery: this.#betterSamples,
      recovery_samples_required: this.#recoverySamples,
      last_sample_at: this.#lastSampleAt,
      missing_signals: Object.freeze([...this.#lastReasons]),
      invalid_signals: invalidSignals,
      ...budgetForValidatedLiveCells(liveSignalInvalid ? 'RED' : this.#band, normalizedLiveCells),
      live_cells: normalizedLiveCells,
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
    invalid_signals: evaluated.invalid,
    ...budgetForValidatedLiveCells(evaluated.band, evaluated.liveCells),
    live_cells: evaluated.liveCells,
    sample_driven: true,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}
