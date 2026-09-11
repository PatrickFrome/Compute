import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserControlPressureGovernor } from '../src/browser-control-pressure-governor.mjs';

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
  observed_at: '2026-09-10T16:00:00.000Z',
};

test('stateful snapshots reuse immutable pressure evidence without widening authority', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const observed = governor.observe(healthySample);
  const repeated = governor.snapshot({ liveCells: 64 });

  assert.strictEqual(repeated.missing_signals, observed.missing_signals);
  assert.strictEqual(repeated.invalid_signals, observed.invalid_signals);
  assert.equal(Object.isFrozen(repeated.missing_signals), true);
  assert.equal(Object.isFrozen(repeated.invalid_signals), true);
  assert.deepEqual(repeated.missing_signals, []);
  assert.deepEqual(repeated.invalid_signals, []);
  assert.equal(repeated.scheduler_authority, false);
  assert.equal(repeated.execution_authority, false);
  assert.equal(repeated.authority_effect, false);
});

test('snapshot appends malformed live-cell evidence without mutating retained evidence', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const observed = governor.observe({
    ...healthySample,
    result_ack_rtt_p95_ms: Number.NaN,
  });
  const retainedInvalid = observed.invalid_signals;

  const malformedLiveCell = governor.snapshot({ liveCells: '64' });

  assert.deepEqual(retainedInvalid, ['result_ack_rtt_p95_ms']);
  assert.deepEqual(malformedLiveCell.invalid_signals, ['result_ack_rtt_p95_ms', 'live_cells']);
  assert.notStrictEqual(malformedLiveCell.invalid_signals, retainedInvalid);
  assert.equal(Object.isFrozen(malformedLiveCell.invalid_signals), true);
  assert.equal(malformedLiveCell.pressure_band, 'RED');
  assert.equal(malformedLiveCell.mutation_concurrency, 0);
  assert.equal(malformedLiveCell.scheduler_authority, false);
  assert.equal(malformedLiveCell.execution_authority, false);
  assert.equal(malformedLiveCell.authority_effect, false);
});
