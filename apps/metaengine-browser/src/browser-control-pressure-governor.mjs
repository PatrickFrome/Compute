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

function numericSignal(sample, key, { max = null } = {}) {
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
  const invalid = [];

  const applyMetric = (key, thresholds, { required = false, max = null } = {}) => {
    const value = numericSignal(sample, key, { max });
    if (value === MISSING_SIGNAL) {
      if (required) missing.push(key);
      return;
    }
    if (value === INVALID_SIGNAL) {
      invalid.push(key);
      band = 'RED';
      return;
    }
    band = higherBand(band, metricBand({ value, ...thresholds }));
  };

  applyMetric('event_loop_utilization', { yellow: 0.60, orange: 0.75, red: 0.88 }, { required: true, max: 1 });
  applyMetric('event_loop_delay_p95_ms', { yellow: 20, orange: 50, red: 120 }, { required: true });
  applyMetric('max_renderer_cpu_percent', { yellow: 65, orange: 85, red: 97 });
  applyMetric('main_working_set_mb', { yellow: 768, orange: 1536, red: 3072 });
  applyMetric('network_inflight', { yellow: 128, orange: 384, red: 768 });
  applyMetric('result_ack_rtt_p95_ms', { yellow: 300, orange: 1000, red: 3000 });
  applyMetric('command_lease_rtt_p95_ms', { yellow: 300, orange: 1000, red: 3000 });

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
