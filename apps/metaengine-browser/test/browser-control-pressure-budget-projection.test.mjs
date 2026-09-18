import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserControlPressureGovernor,
  evaluateControlPressure,
} from '../src/browser-control-pressure-governor.mjs';

const baseSample = {
  event_loop_utilization: 0.2,
  event_loop_delay_p95_ms: 4,
  max_renderer_cpu_percent: 20,
  main_working_set_mb: 256,
  network_inflight: 8,
  result_ack_rtt_p95_ms: 80,
  command_lease_rtt_p95_ms: 90,
  recent_crashes: 0,
  unresponsive_cells: 0,
};

const cases = [
  { name: 'GREEN', sample: {}, read: 128, mutation: 32, sampleMs: 250 },
  { name: 'YELLOW', sample: { event_loop_utilization: 0.60 }, read: 64, mutation: 16, sampleMs: 350 },
  { name: 'ORANGE', sample: { event_loop_utilization: 0.75 }, read: 32, mutation: 8, sampleMs: 500 },
  { name: 'RED', sample: { event_loop_utilization: 0.88 }, read: 8, mutation: 2, sampleMs: 1000 },
];

test('budget projection preserves exact band budgets without intermediate authority', () => {
  for (const entry of cases) {
    const result = evaluateControlPressure({
      ...baseSample,
      ...entry.sample,
      live_cells: 512,
    });

    assert.equal(result.pressure_band, entry.name);
    assert.equal(result.read_concurrency, entry.read);
    assert.equal(result.mutation_concurrency, entry.mutation);
    assert.equal(result.resource_sample_ms, entry.sampleMs);
    assert.equal(result.scheduler_authority, false);
    assert.equal(result.execution_authority, false);
    assert.equal(result.authority_effect, false);
  }
});

test('budget projection clamps mutation lanes to live cells and preserves zero-cell fence', () => {
  const oneCell = evaluateControlPressure({ ...baseSample, live_cells: 1 });
  const zeroCells = evaluateControlPressure({ ...baseSample, live_cells: 0 });

  assert.equal(oneCell.read_concurrency, 128);
  assert.equal(oneCell.mutation_concurrency, 1);
  assert.equal(zeroCells.read_concurrency, 128);
  assert.equal(zeroCells.mutation_concurrency, 0);
});

test('stateful snapshots use the same projected budgets through hysteresis', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const yellow = governor.observe({ ...baseSample, live_cells: 64 });
  const green = governor.observe({ ...baseSample, live_cells: 64 });

  assert.equal(yellow.pressure_band, 'YELLOW');
  assert.equal(yellow.read_concurrency, 64);
  assert.equal(yellow.mutation_concurrency, 16);
  assert.equal(yellow.resource_sample_ms, 350);

  assert.equal(green.pressure_band, 'GREEN');
  assert.equal(green.read_concurrency, 128);
  assert.equal(green.mutation_concurrency, 32);
  assert.equal(green.resource_sample_ms, 250);
  assert.equal(green.scheduler_authority, false);
  assert.equal(green.execution_authority, false);
  assert.equal(green.authority_effect, false);
});
