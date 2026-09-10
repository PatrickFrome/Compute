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

test('governor carries invalid metric evidence without gaining effect authority', () => {
  const governor = new BrowserControlPressureGovernor();
  const out = governor.observe(healthy({ result_ack_rtt_p95_ms: '80' }));

  assert.equal(out.pressure_band, 'RED');
  assert.deepEqual(out.invalid_signals, ['result_ack_rtt_p95_ms']);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.execution_authority, false);
  assert.equal(out.authority_effect, false);
});
