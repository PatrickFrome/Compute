import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserBrainRealtimePressureBridge,
  projectRealtimeProcessPressure,
} from '../src/browser-brain-realtime-pressure-bridge.mjs';

const baseSnapshot = (overrides = {}) => ({
  schema: 'metaengine.browser.realtime-process-plane.v1',
  running: true,
  sequence: 7,
  observed_at: '2026-09-06T07:00:00.000Z',
  processes: [
    { type: 'Browser', cpu_percent: 8, memory_working_set_kb: 1_048_576 },
    { type: 'Tab', cpu_percent: 42, memory_working_set_kb: 200_000 },
    { type: 'Renderer', cpu_percent: 73, memory_working_set_kb: 220_000 },
  ],
  web_contents: [
    { web_contents_id: 10, tab_id: 'tab-a', destroyed: false },
    { web_contents_id: 11, tab_id: 'tab-b', destroyed: false },
  ],
  semantic_plane: { target_count: 2 },
  events: [],
  ...overrides,
});

test('projects process metrics into governor pressure signals without authority', () => {
  const sample = projectRealtimeProcessPressure(baseSnapshot(), {
    event_loop_utilization: 0.31,
    event_loop_delay_p95_ms: 4,
  });
  assert.equal(sample.live_cells, 2);
  assert.equal(sample.max_renderer_cpu_percent, 73);
  assert.equal(sample.main_working_set_mb, 1024);
  assert.equal(sample.event_loop_utilization, 0.31);
  assert.equal(sample.authority_effect, false);
});

test('falls back to live webContents count when semantic targets are unavailable', () => {
  const sample = projectRealtimeProcessPressure(baseSnapshot({ semantic_plane: { target_count: 0 } }));
  assert.equal(sample.live_cells, 2);
});

test('feeds one projected sample into adaptive runtime and reuses existing sampler', () => {
  const observed = [];
  const bridge = new BrowserBrainRealtimePressureBridge({
    adaptiveRuntime: { observePressure(sample) { observed.push(sample); return { pressure_band: 'GREEN' }; } },
    getExtraSample: () => ({ event_loop_utilization: 0.2, event_loop_delay_p95_ms: 2 }),
  });
  const result = bridge.observe(baseSnapshot());
  assert.equal(observed.length, 1);
  assert.equal(observed[0].max_renderer_cpu_percent, 73);
  assert.equal(result.budget.pressure_band, 'GREEN');
  assert.equal(result.reuses_process_plane_sampler, true);
  assert.equal(result.dedicated_timer, false);
  assert.equal(result.second_scheduler, false);
  assert.equal(result.execution_authority, false);
});

test('tracks unresponsive BrowserCells incrementally and clears them on responsive event', () => {
  let now = Date.parse('2026-09-06T07:00:01.000Z');
  const samples = [];
  const bridge = new BrowserBrainRealtimePressureBridge({
    adaptiveRuntime: { observePressure(sample) { samples.push(sample); return {}; } },
    clock: () => now,
  });
  bridge.observe(baseSnapshot({
    sequence: 8,
    events: [{ seq: 8, type: 'WEB_CONTENTS_UNRESPONSIVE', tab_id: 'tab-a', observed_at: '2026-09-06T07:00:01.000Z' }],
  }));
  assert.equal(samples.at(-1).unresponsive_cells, 1);
  now += 100;
  bridge.observe(baseSnapshot({
    sequence: 9,
    events: [{ seq: 9, type: 'WEB_CONTENTS_RESPONSIVE', tab_id: 'tab-a', observed_at: '2026-09-06T07:00:01.100Z' }],
  }));
  assert.equal(samples.at(-1).unresponsive_cells, 0);
});

test('counts renderer crashes in a bounded recent window without replaying old events', () => {
  let now = Date.parse('2026-09-06T07:00:10.000Z');
  const samples = [];
  const bridge = new BrowserBrainRealtimePressureBridge({
    adaptiveRuntime: { observePressure(sample) { samples.push(sample); return {}; } },
    clock: () => now,
  });
  const crash = { seq: 10, type: 'RENDER_PROCESS_GONE', tab_id: 'tab-a', observed_at: '2026-09-06T07:00:10.000Z' };
  bridge.observe(baseSnapshot({ sequence: 10, events: [crash] }));
  assert.equal(samples.at(-1).recent_crashes, 1);
  bridge.observe(baseSnapshot({ sequence: 10, events: [crash] }));
  assert.equal(samples.at(-1).recent_crashes, 1);
  now += 30_001;
  bridge.observe(baseSnapshot({ sequence: 11, events: [] }));
  assert.equal(samples.at(-1).recent_crashes, 0);
});

test('rejects snapshots outside the realtime process-plane contract before governor effects', () => {
  let calls = 0;
  const bridge = new BrowserBrainRealtimePressureBridge({
    adaptiveRuntime: { observePressure() { calls += 1; return {}; } },
  });
  assert.throws(() => bridge.observe({ schema: 'wrong' }), /snapshot_invalid/);
  assert.equal(calls, 0);
});
