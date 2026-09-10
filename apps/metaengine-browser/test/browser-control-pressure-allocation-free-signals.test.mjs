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

test('primitive pressure signal path preserves exact mixed-signal fail-closed semantics', () => {
  const healthyOut = evaluateControlPressure(healthy());
  assert.equal(healthyOut.pressure_band, 'GREEN');
  assert.equal(healthyOut.live_cells, 32);
  assert.equal(healthyOut.mutation_concurrency, 32);
  assert.deepEqual(healthyOut.missing_signals, []);
  assert.deepEqual(healthyOut.invalid_signals, []);

  const missing = healthy();
  delete missing.event_loop_delay_p95_ms;
  const missingOut = evaluateControlPressure(missing);
  assert.equal(missingOut.pressure_band, 'YELLOW');
  assert.deepEqual(missingOut.missing_signals, ['event_loop_delay_p95_ms']);
  assert.deepEqual(missingOut.invalid_signals, []);

  const invalidOut = evaluateControlPressure(healthy({
    result_ack_rtt_p95_ms: '80',
    unresponsive_cells: -1,
    live_cells: '32',
  }));
  assert.equal(invalidOut.pressure_band, 'RED');
  assert.equal(invalidOut.live_cells, 0);
  assert.equal(invalidOut.mutation_concurrency, 0);
  assert.deepEqual(invalidOut.invalid_signals, [
    'result_ack_rtt_p95_ms',
    'unresponsive_cells',
    'live_cells',
  ]);
  assert.equal(invalidOut.scheduler_authority, false);
  assert.equal(invalidOut.execution_authority, false);
  assert.equal(invalidOut.authority_effect, false);
});

test('stateful governor preserves liveness hysteresis after primitive signal decoding', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });

  const degraded = governor.observe(healthy({ recent_crashes: 1 }));
  assert.equal(degraded.pressure_band, 'ORANGE');
  assert.equal(degraded.mutation_concurrency, 8);

  const firstRecovery = governor.observe(healthy());
  assert.equal(firstRecovery.pressure_band, 'YELLOW');
  assert.equal(firstRecovery.mutation_concurrency, 16);

  const recovered = governor.observe(healthy());
  assert.equal(recovered.pressure_band, 'GREEN');
  assert.equal(recovered.mutation_concurrency, 32);
  assert.equal(recovered.scheduler_authority, false);
  assert.equal(recovered.execution_authority, false);
  assert.equal(recovered.authority_effect, false);
});
