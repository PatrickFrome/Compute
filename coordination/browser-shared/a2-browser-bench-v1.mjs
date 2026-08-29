import { performance } from 'node:perf_hooks';

export const A2_BROWSER_BENCH_VERSION = '1.0.0';
const ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

export class A2BrowserBenchError extends Error {
  constructor(code) {
    super(code);
    this.name = 'A2BrowserBenchError';
    this.code = code;
  }
}

function text(value, re, code) {
  if (typeof value !== 'string' || !re.test(value)) throw new A2BrowserBenchError(code);
  return value;
}
function integer(value, min, max, code) {
  if (!Number.isInteger(value) || value < min || value > max) throw new A2BrowserBenchError(code);
  return value;
}
function percentile(sorted, p) {
  if (!sorted.length) throw new A2BrowserBenchError('bench_samples_empty');
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export async function runA2BrowserBenchV1({
  sourceCommit,
  fixtureVersion,
  cases,
  iterations = 100,
  warmupIterations = 10,
  clock = () => performance.now(),
  environment = {},
} = {}) {
  const source_commit = text(sourceCommit, COMMIT_RE, 'bench_source_commit_invalid');
  const fixture_version = text(fixtureVersion, ID_RE, 'bench_fixture_version_invalid');
  integer(iterations, 5, 100000, 'bench_iterations_invalid');
  integer(warmupIterations, 0, 10000, 'bench_warmup_iterations_invalid');
  if (!Array.isArray(cases) || !cases.length || cases.length > 64) throw new A2BrowserBenchError('bench_cases_invalid');
  if (typeof clock !== 'function') throw new A2BrowserBenchError('bench_clock_invalid');
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new A2BrowserBenchError('bench_environment_invalid');

  const seen = new Set();
  const results = [];
  for (const entry of cases) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new A2BrowserBenchError('bench_case_invalid');
    const case_id = text(entry.case_id, ID_RE, 'bench_case_id_invalid');
    if (seen.has(case_id)) throw new A2BrowserBenchError('bench_case_id_duplicate');
    seen.add(case_id);
    if (typeof entry.correctness !== 'function' || typeof entry.run !== 'function') throw new A2BrowserBenchError('bench_case_callbacks_invalid');

    let correctness;
    try { correctness = await entry.correctness(); }
    catch (error) {
      results.push(freeze({
        case_id,
        correctness_passed: false,
        correctness_error: String(error?.code || error?.message || 'correctness_exception').slice(0, 160),
        eligible: false,
        samples: 0,
        latency_ms: null,
      }));
      continue;
    }
    if (correctness !== true) {
      results.push(freeze({ case_id, correctness_passed: false, correctness_error: 'correctness_false', eligible: false, samples: 0, latency_ms: null }));
      continue;
    }

    for (let i = 0; i < warmupIterations; i += 1) await entry.run();
    const samples = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = Number(clock());
      await entry.run();
      const end = Number(clock());
      const duration = end - start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || duration < 0) {
        throw new A2BrowserBenchError('bench_clock_non_monotonic');
      }
      samples.push(duration);
    }
    samples.sort((a, b) => a - b);
    results.push(freeze({
      case_id,
      correctness_passed: true,
      correctness_error: null,
      eligible: true,
      samples: samples.length,
      latency_ms: {
        min: samples[0],
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        p99: percentile(samples, 99),
        max: samples.at(-1),
      },
    }));
  }

  const eligible = results.every((row) => row.correctness_passed === true && row.eligible === true);
  return freeze({
    version: A2_BROWSER_BENCH_VERSION,
    source_commit,
    fixture_version,
    iterations,
    warmup_iterations: warmupIterations,
    environment: structuredClone(environment),
    results,
    eligible,
    aggregate_score: null,
    correctness_precedes_performance: true,
    authority_effect: false,
    actuation_eligible: false,
    replay_executes_effects: false,
  });
}
