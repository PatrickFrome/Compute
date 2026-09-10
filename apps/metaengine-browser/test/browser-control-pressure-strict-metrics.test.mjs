import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserControlPressureGovernor,
  evaluateControlPressure,
} from '../src/browser-control-pressure-governor.mjs';

const healthy = (extra = {}) => ({
  event_loop_utilization: 0.2,
  event_loop_delay_p95_ms: 4,
  max_renderer_cpu_percent: 20,
  main_working_set_mb: 256,
  network_inflight: 8,
  result_ack_rtt_p95_ms: 80,
  command_lease_rtt_p95_ms: 90,
  recent_crashes: 0,
  unresponsive_cells: 0,
  live_cells: 32,
  ...extra,
});

const metricKeys = [
  'event_loop_utilization',
  'event_loop_delay_p95_ms',
  'max_renderer_cpu_percent',
  'main_working_set_mb',
  'network_inflight',
  'result_ack_rtt_p95_ms',
  'command_lease_rtt_p95_ms',
];

test('explicit malformed numeric pressure metrics fail closed to RED', () => {
  const malformed = [-1, Number.NaN, Number.POSITIVE_INFINITY, '0'];

  for (const key of metricKeys) {
    for (const value of malformed) {
      const out = evaluateControlPressure(healthy({ [key]: value }));
      assert.equal(out.pressure_band, 'RED', `${key}=${String(value)}`);
      assert.equal(out.mutation_concurrency, 2, `${key}=${String(value)}`);
      assert.deepEqual(out.invalid_signals, [key], `${key}=${String(value)}`);
    }
  }
});

test('missing required event-loop metrics remain missing rather than invalid', () => {
  const sample = healthy();
  delete sample.event_loop_utilization;
  delete sample.event_loop_delay_p95_ms;

  const out = evaluateControlPressure(sample);
  assert.equal(out.pressure_band, 'ORANGE');
  assert.deepEqual([...out.missing_signals].sort(), [
    'event_loop_delay_p95_ms',
    'event_loop_utilization',
  ]);
  assert.deepEqual(out.invalid_signals, []);
});

test('missing optional pressure metrics remain optional while numeric zero stays valid', () => {
  const sample = healthy();
  for (const key of metricKeys.slice(2)) delete sample[key];

  const omitted = evaluateControlPressure(sample);
  const zero = evaluateControlPressure(healthy({
    max_renderer_cpu_percent: 0,
    main_working_set_mb: 0,
    network_inflight: 0,
    result_ack_rtt_p95_ms: 0,
    command_lease_rtt_p95_ms: 0,
  }));

  assert.equal(omitted.pressure_band, 'GREEN');
  assert.deepEqual(omitted.invalid_signals, []);
  assert.equal(zero.pressure_band, 'GREEN');
  assert.deepEqual(zero.invalid_signals, []);
});

test('event-loop utilization above one is conservatively clamped and remains RED pressure', () => {
  const out = evaluateControlPressure(healthy({ event_loop_utilization: 1.5 }));
  assert.equal(out.pressure_band, 'RED');
  assert.deepEqual(out.invalid_signals, []);
});

test('zero live BrowserCells close mutation fanout without changing read pressure', () => {
  const evaluated = evaluateControlPressure(healthy({ live_cells: 0 }));
  assert.equal(evaluated.pressure_band, 'GREEN');
  assert.equal(evaluated.read_concurrency, 128);
  assert.equal(evaluated.mutation_concurrency, 0);

  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const observed = governor.observe(healthy({ live_cells: 0 }));
  assert.equal(observed.live_cells, 0);
  assert.equal(observed.mutation_concurrency, 0);
  assert.equal(observed.scheduler_authority, false);
  assert.equal(observed.execution_authority, false);
  assert.equal(observed.authority_effect, false);
});

test('explicit malformed live cell evidence fails closed with zero mutation capacity', () => {
  const malformed = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '32', null, undefined];

  for (const liveCells of malformed) {
    const out = evaluateControlPressure(healthy({ live_cells: liveCells }));
    assert.equal(out.pressure_band, 'RED', `live_cells=${String(liveCells)}`);
    assert.equal(out.live_cells, 0, `live_cells=${String(liveCells)}`);
    assert.equal(out.mutation_concurrency, 0, `live_cells=${String(liveCells)}`);
    assert.deepEqual(out.invalid_signals, ['live_cells'], `live_cells=${String(liveCells)}`);
  }
});

test('stateful governor carries malformed live cell evidence without manufacturing a mutation lane', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const observed = governor.observe(healthy({ live_cells: '32' }));

  assert.equal(observed.pressure_band, 'RED');
  assert.equal(observed.live_cells, 0);
  assert.equal(observed.mutation_concurrency, 0);
  assert.deepEqual(observed.invalid_signals, ['live_cells']);
  assert.equal(observed.scheduler_authority, false);
  assert.equal(observed.execution_authority, false);
  assert.equal(observed.authority_effect, false);

  const directSnapshot = governor.snapshot({ liveCells: '32' });
  assert.equal(directSnapshot.pressure_band, 'RED');
  assert.equal(directSnapshot.live_cells, 0);
  assert.equal(directSnapshot.mutation_concurrency, 0);
  assert.deepEqual(directSnapshot.invalid_signals, ['live_cells']);
});

test('governor carries invalid metric evidence without gaining effect authority', () => {
  const governor = new BrowserControlPressureGovernor();
  const out = governor.observe(healthy({ result_ack_rtt_p95_ms: '80' }));

  assert.equal(out.pressure_band, 'RED');
  assert.deepEqual(out.invalid_signals, ['result_ack_rtt_p95_ms']);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.execution_authority, false);
  assert.equal(out.authority_effect, false);
});

test('malformed recovery hysteresis configuration fails closed at construction', () => {
  const malformed = [0, -1, 1.5, 21, Number.NaN, Number.POSITIVE_INFINITY, '3', null];

  for (const recoverySamples of malformed) {
    assert.throws(
      () => new BrowserControlPressureGovernor({ recoverySamples }),
      (error) => error instanceof TypeError && error.code === 'invalid_recovery_samples',
      `recoverySamples=${String(recoverySamples)}`,
    );
  }
});

test('valid recovery hysteresis bounds and default remain exact', () => {
  const minimum = new BrowserControlPressureGovernor({ recoverySamples: 1 }).snapshot();
  const maximum = new BrowserControlPressureGovernor({ recoverySamples: 20 }).snapshot();
  const fallback = new BrowserControlPressureGovernor().snapshot();

  assert.equal(minimum.recovery_samples_required, 1);
  assert.equal(maximum.recovery_samples_required, 20);
  assert.equal(fallback.recovery_samples_required, 3);
  assert.equal(minimum.scheduler_authority, false);
  assert.equal(minimum.execution_authority, false);
  assert.equal(minimum.authority_effect, false);
});

test('validated live-cell normalization feeds budget projection without widening capacity', () => {
  const oversized = evaluateControlPressure(healthy({ live_cells: 999 }));
  assert.equal(oversized.live_cells, 512);
  assert.equal(oversized.pressure_band, 'GREEN');
  assert.equal(oversized.read_concurrency, 128);
  assert.equal(oversized.mutation_concurrency, 32);

  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const observed = governor.observe(healthy({ live_cells: 999 }));
  assert.equal(observed.live_cells, 512);
  assert.equal(observed.mutation_concurrency, 32);
  assert.equal(observed.scheduler_authority, false);
  assert.equal(observed.execution_authority, false);
  assert.equal(observed.authority_effect, false);
});
