import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateControlPressure } from '../src/browser-control-pressure-governor.mjs';

const healthySample = {
  event_loop_utilization: 0.2,
  event_loop_delay_p95_ms: 4,
  max_renderer_cpu_percent: 20,
  main_working_set_mb: 256,
  network_inflight: 8,
  result_ack_rtt_p95_ms: 80,
  command_lease_rtt_p95_ms: 90,
  recent_crashes: 0,
  unresponsive_cells: 0,
  live_cells: 64,
};

test('healthy pressure observations reuse immutable empty evidence', () => {
  const first = evaluateControlPressure(healthySample);
  const second = evaluateControlPressure(healthySample);

  assert.equal(first.pressure_band, 'GREEN');
  assert.equal(first.missing_signals, second.missing_signals);
  assert.equal(first.invalid_signals, second.invalid_signals);
  assert.deepEqual(first.missing_signals, []);
  assert.deepEqual(first.invalid_signals, []);
  assert.equal(Object.isFrozen(first.missing_signals), true);
  assert.equal(Object.isFrozen(first.invalid_signals), true);
  assert.equal(first.scheduler_authority, false);
  assert.equal(first.execution_authority, false);
  assert.equal(first.authority_effect, false);
});

test('missing pressure evidence preserves canonical order and fail-closed banding', () => {
  const missingBoth = { ...healthySample };
  delete missingBoth.event_loop_utilization;
  delete missingBoth.event_loop_delay_p95_ms;

  const result = evaluateControlPressure(missingBoth);
  assert.equal(result.pressure_band, 'ORANGE');
  assert.deepEqual(result.missing_signals, [
    'event_loop_utilization',
    'event_loop_delay_p95_ms',
  ]);
  assert.equal(Object.isFrozen(result.missing_signals), true);
  assert.equal(result.invalid_signals.length, 0);
});

test('invalid pressure evidence is materialized only when present and stays ordered', () => {
  const result = evaluateControlPressure({
    ...healthySample,
    event_loop_utilization: Number.NaN,
    max_renderer_cpu_percent: -1,
    command_lease_rtt_p95_ms: Infinity,
    unresponsive_cells: 1.5,
    recent_crashes: -1,
    live_cells: '64',
  });

  assert.equal(result.pressure_band, 'RED');
  assert.equal(result.live_cells, 0);
  assert.equal(result.mutation_concurrency, 0);
  assert.deepEqual(result.invalid_signals, [
    'event_loop_utilization',
    'max_renderer_cpu_percent',
    'command_lease_rtt_p95_ms',
    'unresponsive_cells',
    'recent_crashes',
    'live_cells',
  ]);
  assert.equal(Object.isFrozen(result.invalid_signals), true);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.execution_authority, false);
  assert.equal(result.authority_effect, false);
});
