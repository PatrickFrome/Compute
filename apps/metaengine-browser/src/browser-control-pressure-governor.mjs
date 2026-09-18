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
const EMPTY_SIGNALS = Object.freeze([]);
const METRIC_MISSING = -1;
const METRIC_INVALID = 4;
const SIGNAL_KEYS = Object.freeze([
  'event_loop_utilization',
  'event_loop_delay_p95_ms',
  'max_renderer_cpu_percent',
  'main_working_set_mb',
  'network_inflight',
  'result_ack_rtt_p95_ms',
  'command_lease_rtt_p95_ms',
  'unresponsive_cells',
  'recent_crashes',
  'live_cells',
]);

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

function liveCellCount(value, present = true) {
  if (!present) return 1;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return INVALID_SIGNAL;
  return Math.min(512, value);
}

function higherBand(a, b) {
  return BAND_ORDER[Math.max(BAND_RANK[a], BAND_RANK[b])];
}

function metricRank(value, yellow, orange, red) {
  if (value >= red) return BAND_RANK.RED;
  if (value >= orange) return BAND_RANK.ORANGE;
  if (value >= yellow) return BAND_RANK.YELLOW;
  return BAND_RANK.GREEN;
}

function pressureMetricRank(sample, key, yellow, orange, red, required, max) {
  const value = numericSignal(sample, key, max);
  if (value === MISSING_SIGNAL) return required ? METRIC_MISSING : BAND_RANK.GREEN;
  if (value === INVALID_SIGNAL) return METRIC_INVALID;
  return metricRank(value, yellow, orange, red);
}

function signalsFromMask(mask) {
  if (mask === 0) return EMPTY_SIGNALS;
  const signals = [];
  for (let index = 0; index < SIGNAL_KEYS.length; index += 1) {
    if ((mask & (1 << index)) !== 0) signals.push(SIGNAL_KEYS[index]);
  }
  return Object.freeze(signals);
}

function pressureBand(sample = {}) {
  let bandRank = BAND_RANK.GREEN;
  let missingMask = 0;
  let invalidMask = 0;
  let metric;

  metric = pressureMetricRank(sample, 'event_loop_utilization', 0.60, 0.75, 0.88, true, 1);
  if (metric === METRIC_MISSING) missingMask |= 1 << 0;
  else if (metric === METRIC_INVALID) invalidMask |= 1 << 0;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'event_loop_delay_p95_ms', 20, 50, 120, true, null);
  if (metric === METRIC_MISSING) missingMask |= 1 << 1;
  else if (metric === METRIC_INVALID) invalidMask |= 1 << 1;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'max_renderer_cpu_percent', 65, 85, 97, false, null);
  if (metric === METRIC_INVALID) invalidMask |= 1 << 2;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'main_working_set_mb', 768, 1536, 3072, false, null);
  if (metric === METRIC_INVALID) invalidMask |= 1 << 3;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'network_inflight', 128, 384, 768, false, null);
  if (metric === METRIC_INVALID) invalidMask |= 1 << 4;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'result_ack_rtt_p95_ms', 300, 1000, 3000, false, null);
  if (metric === METRIC_INVALID) invalidMask |= 1 << 5;
  else bandRank = Math.max(bandRank, metric);

  metric = pressureMetricRank(sample, 'command_lease_rtt_p95_ms', 300, 1000, 3000, false, null);
  if (metric === METRIC_INVALID) invalidMask |= 1 << 6;
  else bandRank = Math.max(bandRank, metric);

  const unresponsive = livenessCount(sample, 'unresponsive_cells');
  const recentCrashes = livenessCount(sample, 'recent_crashes');
  const liveCells = liveCellCount(
    sample.live_cells,
    Object.prototype.hasOwnProperty.call(sample, 'live_cells'),
  );
  if (unresponsive === INVALID_SIGNAL) invalidMask |= 1 << 7;
  if (recentCrashes === INVALID_SIGNAL) invalidMask |= 1 << 8;
  if (liveCells === INVALID_SIGNAL) invalidMask |= 1 << 9;
  if (invalidMask !== 0 || unresponsive > 0 || recentCrashes >= 2) bandRank = BAND_RANK.RED;
  else if (recentCrashes === 1) bandRank = Math.max(bandRank, BAND_RANK.ORANGE);

  // Missing both event-loop signals means we cannot prove a GREEN hot path.
  if (missingMask === ((1 << 0) | (1 << 1))) bandRank = Math.max(bandRank, BAND_RANK.ORANGE);
  else if (missingMask !== 0) bandRank = Math.max(bandRank, BAND_RANK.YELLOW);

  return Object.freeze({
    band: BAND_ORDER[bandRank],
    missing: signalsFromMask(missingMask),
    invalid: signalsFromMask(invalidMask),
    liveCells: liveCells === INVALID_SIGNAL ? 0 : liveCells,
  });
}

function budgetBaseFor(band) {
  return BAND_BUDGETS[band] || BAND_BUDGETS.ORANGE;
}

function mutationConcurrencyFor(base, liveCells) {
  return liveCells === 0 ? 0 : Math.max(1, Math.min(base.mutation_concurrency, liveCells));
}

export class BrowserControlPressureGovernor {
  #band = 'ORANGE';
  #betterSamples = 0;
  #recoverySamples;
  #lastSampleAt = null;
  #lastReasons = EMPTY_SIGNALS;
  #lastInvalid = EMPTY_SIGNALS;

  constructor({ recoverySamples = 3 } = {}) {
    this.#recoverySamples = recoverySampleCount(recoverySamples);
  }

  observe(sample = {}) {
    const evaluated = pressureBand(sample);
    const currentIndex = BAND_RANK[this.#band];
    const evaluatedIndex = BAND_RANK[evaluated.band];

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
      : this.#lastInvalid;
    const pressureBandValue = liveSignalInvalid ? 'RED' : this.#band;
    const budgetBase = budgetBaseFor(pressureBandValue);
    return Object.freeze({
      schema: BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA,
      pressure_band: pressureBandValue,
      better_samples_toward_recovery: this.#betterSamples,
      recovery_samples_required: this.#recoverySamples,
      last_sample_at: this.#lastSampleAt,
      missing_signals: this.#lastReasons,
      invalid_signals: invalidSignals,
      read_concurrency: budgetBase.read_concurrency,
      mutation_concurrency: mutationConcurrencyFor(budgetBase, normalizedLiveCells),
      resource_sample_ms: budgetBase.resource_sample_ms,
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
  const budgetBase = budgetBaseFor(evaluated.band);
  return Object.freeze({
    schema: BROWSER_CONTROL_PRESSURE_GOVERNOR_SCHEMA,
    pressure_band: evaluated.band,
    missing_signals: evaluated.missing,
    invalid_signals: evaluated.invalid,
    read_concurrency: budgetBase.read_concurrency,
    mutation_concurrency: mutationConcurrencyFor(budgetBase, evaluated.liveCells),
    resource_sample_ms: budgetBase.resource_sample_ms,
    live_cells: evaluated.liveCells,
    sample_driven: true,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}
