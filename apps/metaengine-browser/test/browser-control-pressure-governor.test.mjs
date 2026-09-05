import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserControlPressureGovernor,
  evaluateControlPressure,
} from '../src/browser-control-pressure-governor.mjs';

const green = (extra = {}) => ({
  event_loop_utilization: 0.20,
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

test('GREEN pressure can use all 32 independent mutation cells and 128 read slots', () => {
  const out = evaluateControlPressure(green());
  assert.equal(out.pressure_band, 'GREEN');
  assert.equal(out.read_concurrency, 128);
  assert.equal(out.mutation_concurrency, 32);
  assert.equal(out.resource_sample_ms, 250);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.execution_authority, false);
  assert.equal(out.authority_effect, false);
});

test('mutation budget never exceeds exact live BrowserCell count', () => {
  assert.equal(evaluateControlPressure(green({ live_cells: 7 })).mutation_concurrency, 7);
  assert.equal(evaluateControlPressure(green({ live_cells: 1 })).mutation_concurrency, 1);
});

test('event-loop and network pressure reduce concurrency before overload becomes a global stall', () => {
  const yellow = evaluateControlPressure(green({ event_loop_utilization: 0.64 }));
  const orange = evaluateControlPressure(green({ event_loop_delay_p95_ms: 60 }));
  const red = evaluateControlPressure(green({ network_inflight: 900 }));
  assert.equal(yellow.pressure_band, 'YELLOW');
  assert.equal(yellow.read_concurrency, 64);
  assert.equal(orange.pressure_band, 'ORANGE');
  assert.equal(orange.mutation_concurrency, 8);
  assert.equal(red.pressure_band, 'RED');
  assert.equal(red.read_concurrency, 8);
  assert.equal(red.mutation_concurrency, 2);
});

test('renderer crash or unresponsive cell degrades immediately', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 3 });
  governor.observe(green());
  const crash = governor.observe(green({ recent_crashes: 2 }));
  assert.equal(crash.pressure_band, 'RED');
  assert.equal(crash.mutation_concurrency, 2);
  const hang = governor.observe(green({ unresponsive_cells: 1 }));
  assert.equal(hang.pressure_band, 'RED');
});

test('recovery is hysteretic and moves at most one band after consecutive healthy samples', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 3 });
  assert.equal(governor.observe(green({ unresponsive_cells: 1 })).pressure_band, 'RED');
  assert.equal(governor.observe(green()).pressure_band, 'RED');
  assert.equal(governor.observe(green()).pressure_band, 'RED');
  assert.equal(governor.observe(green()).pressure_band, 'ORANGE');
  assert.equal(governor.observe(green()).pressure_band, 'ORANGE');
  assert.equal(governor.observe(green()).pressure_band, 'ORANGE');
  assert.equal(governor.observe(green()).pressure_band, 'YELLOW');
  assert.equal(governor.observe(green()).pressure_band, 'YELLOW');
  assert.equal(governor.observe(green()).pressure_band, 'YELLOW');
  assert.equal(governor.observe(green()).pressure_band, 'GREEN');
});

test('missing event-loop truth fails toward ORANGE rather than optimistic maximum fan-out', () => {
  const out = evaluateControlPressure({ live_cells: 32 });
  assert.equal(out.pressure_band, 'ORANGE');
  assert.equal(out.read_concurrency, 32);
  assert.equal(out.mutation_concurrency, 8);
  assert.deepEqual([...out.missing_signals].sort(), ['event_loop_delay_p95_ms', 'event_loop_utilization']);
});

test('governor is sample-driven and creates no timer, command lease or retry authority', () => {
  const governor = new BrowserControlPressureGovernor();
  const out = governor.observe(green());
  assert.equal(out.sample_driven, true);
  assert.equal(out.dedicated_timer, false);
  assert.equal(out.command_leasing, false);
  assert.equal(out.capacity_changes_authority, false);
  assert.equal(out.automatic_effect_retry_allowed, false);
  assert.equal(out.authority_effect, false);
});
