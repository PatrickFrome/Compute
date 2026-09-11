import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserControlPressureGovernor } from '../src/browser-control-pressure-governor.mjs';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const healthy = (liveCells = 32) => ({
  event_loop_utilization: 0.10,
  event_loop_delay_p95_ms: 2,
  max_renderer_cpu_percent: 10,
  main_working_set_mb: 256,
  network_inflight: 4,
  command_lease_rtt_p95_ms: 80,
  result_ack_rtt_p95_ms: 90,
  unresponsive_cells: 0,
  recent_crashes: 0,
  live_cells: liveCells,
});

test('existing scheduler accepts bounded pressure budget without recreating command authority', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 32, mutationConcurrency: 8 });

  // Governor begins conservative ORANGE and recovers one band per healthy sample.
  const yellow = governor.observe(healthy());
  let scheduled = scheduler.setConcurrencyBudget(yellow);
  assert.equal(scheduled.read_concurrency, 64);
  assert.equal(scheduled.mutation_concurrency, 16);

  const green = governor.observe(healthy());
  scheduled = scheduler.setConcurrencyBudget(green);
  assert.equal(green.pressure_band, 'GREEN');
  assert.equal(scheduled.read_concurrency, 128);
  assert.equal(scheduled.mutation_concurrency, 32);
  assert.equal(scheduled.live_concurrency_tuning_changes_authority, false);
});

test('pressure collapse shrinks the same scheduler immediately and remains bounded', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32 });
  governor.observe(healthy());
  governor.observe(healthy());

  const red = governor.observe(healthy(32));
  assert.equal(red.pressure_band, 'GREEN');

  const degraded = governor.observe({ ...healthy(32), unresponsive_cells: 1 });
  const scheduled = scheduler.setConcurrencyBudget(degraded);
  assert.equal(degraded.pressure_band, 'RED');
  assert.equal(scheduled.read_concurrency, 8);
  assert.equal(scheduled.mutation_concurrency, 2);
});

test('scheduler independently clamps malformed tuning input and never widens hard ceilings', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  const tuned = scheduler.setConcurrencyBudget({ read_concurrency: 100000, mutation_concurrency: 100000 });
  assert.equal(tuned.read_concurrency, 128);
  assert.equal(tuned.mutation_concurrency, 32);
  const unchanged = scheduler.setConcurrencyBudget({ read_concurrency: 'not-an-int' });
  assert.equal(unchanged.read_concurrency, 128);
  assert.equal(unchanged.mutation_concurrency, 32);
});
