import test from 'node:test';
import assert from 'node:assert/strict';
import { runA2BrowserBenchV1, A2BrowserBenchError } from '../coordination/browser-shared/a2-browser-bench-v1.mjs';

const SOURCE = '6e113ec7eaa85c1c689d40874b7c52c2c5f4305e';
function clockFrom(values) { let i = 0; return () => values[i++]; }

test('correct case reports deterministic nearest-rank p50/p95/p99', async () => {
  const durations = [1,2,3,4,5,6,7,8,9,10];
  const ticks = durations.flatMap((d, i) => [i * 100, i * 100 + d]);
  let runs = 0;
  const result = await runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.001', iterations: 10, warmupIterations: 0,
    clock: clockFrom(ticks), environment: { runner: 'synthetic' },
    cases: [{ case_id: 'case.latency', correctness: async () => true, run: async () => { runs += 1; } }],
  });
  assert.equal(runs, 10);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.results[0].latency_ms, { min:1, p50:5, p95:10, p99:10, max:10 });
  assert.equal(result.aggregate_score, null);
});

test('failed correctness is never timed or eligible even if run would be fast', async () => {
  let runs = 0;
  const result = await runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.002', iterations: 5, warmupIterations: 3,
    cases: [{ case_id: 'case.unsafe', correctness: async () => false, run: async () => { runs += 1; } }],
  });
  assert.equal(runs, 0);
  assert.equal(result.eligible, false);
  assert.equal(result.results[0].eligible, false);
  assert.equal(result.results[0].latency_ms, null);
});

test('correctness exception is captured as ineligible rather than benchmark crash', async () => {
  const result = await runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.003', iterations: 5, warmupIterations: 0,
    cases: [{ case_id: 'case.throw', correctness: async () => { const e = new Error('unsafe'); e.code='SAFETY_FAIL'; throw e; }, run: async () => {} }],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.results[0].correctness_error, 'SAFETY_FAIL');
});

test('mixed suite cannot hide a failed case behind fast successful cases', async () => {
  const ticks = Array.from({ length: 10 }, (_, i) => i).flatMap((x) => [x * 2, x * 2 + 1]);
  const result = await runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.004', iterations: 5, warmupIterations: 0,
    clock: clockFrom(ticks),
    cases: [
      { case_id: 'case.safe', correctness: async () => true, run: async () => {} },
      { case_id: 'case.bad', correctness: async () => false, run: async () => {} },
    ],
  });
  assert.equal(result.results[0].eligible, true);
  assert.equal(result.results[1].eligible, false);
  assert.equal(result.eligible, false);
});

test('non-monotonic clock fails closed', async () => {
  await assert.rejects(() => runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.005', iterations: 5, warmupIterations: 0,
    clock: clockFrom([2,1, 4,3, 6,5, 8,7, 10,9]),
    cases: [{ case_id: 'case.clock', correctness: async () => true, run: async () => {} }],
  }), (e) => e instanceof A2BrowserBenchError && e.code === 'bench_clock_non_monotonic');
});

test('benchmark envelope explicitly has zero authority/effect replay', async () => {
  const ticks = [0,1,2,3,4,5,6,7,8,9];
  const result = await runA2BrowserBenchV1({
    sourceCommit: SOURCE, fixtureVersion: 'fixture.r14.006', iterations: 5, warmupIterations: 0,
    clock: clockFrom(ticks),
    cases: [{ case_id: 'case.zeroauth', correctness: async () => true, run: async () => {} }],
  });
  assert.equal(result.authority_effect, false);
  assert.equal(result.actuation_eligible, false);
  assert.equal(result.replay_executes_effects, false);
  assert.equal(result.correctness_precedes_performance, true);
});
