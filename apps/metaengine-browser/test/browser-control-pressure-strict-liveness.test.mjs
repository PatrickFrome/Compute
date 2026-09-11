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

test('explicit malformed liveness counts fail closed to RED pressure', () => {
  const cases = [
    ['unresponsive_cells', -1],
    ['unresponsive_cells', 0.5],
    ['unresponsive_cells', Number.NaN],
    ['unresponsive_cells', Number.POSITIVE_INFINITY],
    ['unresponsive_cells', '0'],
    ['recent_crashes', -1],
    ['recent_crashes', 0.5],
    ['recent_crashes', Number.NaN],
    ['recent_crashes', Number.POSITIVE_INFINITY],
    ['recent_crashes', '0'],
  ];

  for (const [field, value] of cases) {
    const out = evaluateControlPressure(healthy({ [field]: value }));
    assert.equal(out.pressure_band, 'RED', `${field}=${String(value)}`);
    assert.equal(out.mutation_concurrency, 2, `${field}=${String(value)}`);
    assert.deepEqual(out.invalid_signals, [field], `${field}=${String(value)}`);
  }
});

test('omitted liveness counters remain optional while explicit zero is valid', () => {
  const omitted = healthy();
  delete omitted.unresponsive_cells;
  delete omitted.recent_crashes;

  const withoutCounters = evaluateControlPressure(omitted);
  const explicitZero = evaluateControlPressure(healthy());

  assert.equal(withoutCounters.pressure_band, 'GREEN');
  assert.deepEqual(withoutCounters.invalid_signals, []);
  assert.equal(explicitZero.pressure_band, 'GREEN');
  assert.deepEqual(explicitZero.invalid_signals, []);
});

test('governor persists invalid liveness evidence in its durable snapshot surface', () => {
  const governor = new BrowserControlPressureGovernor();
  const bad = governor.observe(healthy({ unresponsive_cells: Number.NaN }));

  assert.equal(bad.pressure_band, 'RED');
  assert.deepEqual(bad.invalid_signals, ['unresponsive_cells']);
  assert.equal(bad.scheduler_authority, false);
  assert.equal(bad.execution_authority, false);
  assert.equal(bad.authority_effect, false);

  const recovering = governor.observe(healthy());
  assert.deepEqual(recovering.invalid_signals, []);
  assert.equal(recovering.pressure_band, 'RED');
});
