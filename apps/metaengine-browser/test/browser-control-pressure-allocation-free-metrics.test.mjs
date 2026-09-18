import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateControlPressure } from '../src/browser-control-pressure-governor.mjs';

const base = () => ({
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
});

const cases = [
  ['event_loop_utilization', 0.60, 'YELLOW'],
  ['event_loop_utilization', 0.75, 'ORANGE'],
  ['event_loop_utilization', 0.88, 'RED'],
  ['event_loop_delay_p95_ms', 20, 'YELLOW'],
  ['event_loop_delay_p95_ms', 50, 'ORANGE'],
  ['event_loop_delay_p95_ms', 120, 'RED'],
  ['max_renderer_cpu_percent', 65, 'YELLOW'],
  ['max_renderer_cpu_percent', 85, 'ORANGE'],
  ['max_renderer_cpu_percent', 97, 'RED'],
  ['main_working_set_mb', 768, 'YELLOW'],
  ['main_working_set_mb', 1536, 'ORANGE'],
  ['main_working_set_mb', 3072, 'RED'],
  ['network_inflight', 128, 'YELLOW'],
  ['network_inflight', 384, 'ORANGE'],
  ['network_inflight', 768, 'RED'],
  ['result_ack_rtt_p95_ms', 300, 'YELLOW'],
  ['result_ack_rtt_p95_ms', 1000, 'ORANGE'],
  ['result_ack_rtt_p95_ms', 3000, 'RED'],
  ['command_lease_rtt_p95_ms', 300, 'YELLOW'],
  ['command_lease_rtt_p95_ms', 1000, 'ORANGE'],
  ['command_lease_rtt_p95_ms', 3000, 'RED'],
];

test('allocation-free metric evaluation preserves every exact pressure threshold', () => {
  for (const [key, value, expectedBand] of cases) {
    const sample = base();
    sample[key] = value;
    const out = evaluateControlPressure(sample);
    assert.equal(out.pressure_band, expectedBand, `${key}=${value}`);
    assert.equal(out.scheduler_authority, false);
    assert.equal(out.execution_authority, false);
    assert.equal(out.authority_effect, false);
  }
});

test('allocation-free metric evaluation preserves missing and invalid evidence order', () => {
  const sample = base();
  delete sample.event_loop_utilization;
  delete sample.event_loop_delay_p95_ms;
  sample.max_renderer_cpu_percent = '65';
  sample.result_ack_rtt_p95_ms = -1;

  const out = evaluateControlPressure(sample);
  assert.equal(out.pressure_band, 'RED');
  assert.deepEqual(out.missing_signals, [
    'event_loop_utilization',
    'event_loop_delay_p95_ms',
  ]);
  assert.deepEqual(out.invalid_signals, [
    'max_renderer_cpu_percent',
    'result_ack_rtt_p95_ms',
  ]);
  assert.equal(out.live_cells, 64);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.execution_authority, false);
  assert.equal(out.authority_effect, false);
});
