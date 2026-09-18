import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserControlPressureGovernor,
  evaluateControlPressure,
} from '../src/browser-control-pressure-governor.mjs';

const healthySample = (liveCells) => ({
  event_loop_utilization: 0.2,
  event_loop_delay_p95_ms: 4,
  max_renderer_cpu_percent: 20,
  main_working_set_mb: 256,
  network_inflight: 8,
  result_ack_rtt_p95_ms: 80,
  command_lease_rtt_p95_ms: 90,
  recent_crashes: 0,
  unresponsive_cells: 0,
  ...(liveCells === undefined ? {} : { live_cells: liveCells }),
});

test('pressure hot path preserves omitted, zero, capped and malformed live-cell semantics', () => {
  const omitted = evaluateControlPressure(healthySample(undefined));
  assert.equal(omitted.live_cells, 1);
  assert.equal(omitted.pressure_band, 'GREEN');
  assert.equal(omitted.mutation_concurrency, 1);

  const zero = evaluateControlPressure(healthySample(0));
  assert.equal(zero.live_cells, 0);
  assert.equal(zero.pressure_band, 'GREEN');
  assert.equal(zero.mutation_concurrency, 0);

  const capped = evaluateControlPressure(healthySample(999));
  assert.equal(capped.live_cells, 512);
  assert.equal(capped.pressure_band, 'GREEN');
  assert.equal(capped.mutation_concurrency, 32);

  const malformed = evaluateControlPressure(healthySample('64'));
  assert.equal(malformed.live_cells, 0);
  assert.equal(malformed.pressure_band, 'RED');
  assert.equal(malformed.mutation_concurrency, 0);
  assert.deepEqual(malformed.invalid_signals, ['live_cells']);
});

test('rank-based governor control flow preserves immediate degradation and one-band recovery', () => {
  const governor = new BrowserControlPressureGovernor({ recoverySamples: 1 });

  const degraded = governor.observe({
    ...healthySample(64),
    network_inflight: 768,
    observed_at: '2026-09-10T14:00:00.000Z',
  });
  assert.equal(degraded.pressure_band, 'RED');
  assert.equal(degraded.mutation_concurrency, 2);

  const orange = governor.observe({
    ...healthySample(64),
    observed_at: '2026-09-10T14:00:01.000Z',
  });
  assert.equal(orange.pressure_band, 'ORANGE');
  assert.equal(orange.mutation_concurrency, 8);

  const yellow = governor.observe({
    ...healthySample(64),
    observed_at: '2026-09-10T14:00:02.000Z',
  });
  assert.equal(yellow.pressure_band, 'YELLOW');
  assert.equal(yellow.mutation_concurrency, 16);

  const green = governor.observe({
    ...healthySample(64),
    observed_at: '2026-09-10T14:00:03.000Z',
  });
  assert.equal(green.pressure_band, 'GREEN');
  assert.equal(green.mutation_concurrency, 32);

  for (const snapshot of [degraded, orange, yellow, green]) {
    assert.equal(snapshot.scheduler_authority, false);
    assert.equal(snapshot.execution_authority, false);
    assert.equal(snapshot.authority_effect, false);
  }
});
