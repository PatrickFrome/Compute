import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000101';
const TAB_B = 'tab_00000000-0000-4000-8000-000000000102';

function processSnapshot({ events = [], sequence = 10 } = {}) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: '2026-09-06T10:30:00.000Z',
    event_driven_lifecycle: true,
    processes: [
      { pid: 1, process_key: '1:1000', creation_time_ms: 1000, type: 'Browser', cpu_percent: 2, memory_working_set_kb: 256000 },
      { pid: 101, process_key: '101:2001', creation_time_ms: 2001, type: 'Tab', cpu_percent: 4, memory_working_set_kb: 128000 },
      { pid: 102, process_key: '102:2002', creation_time_ms: 2002, type: 'Tab', cpu_percent: 5, memory_working_set_kb: 128000 },
    ],
    web_contents: [
      { web_contents_id: 101, os_pid: 101, process_key: '101:2001', tab_id: TAB_A, destroyed: false },
      { web_contents_id: 102, os_pid: 102, process_key: '102:2002', tab_id: TAB_B, destroyed: false },
    ],
    semantic_plane: {
      target_count: 2,
      targets: [
        { tab_id: TAB_A, target_id: 'target-a', document_generation: 1, semantic_revision: 7 },
        { tab_id: TAB_B, target_id: 'target-b', document_generation: 1, semantic_revision: 9 },
      ],
    },
    events,
  };
}

function command(id, tabId) {
  return {
    command_id: id,
    action: 'TYPED_CLICK',
    platform: 'TEST',
    payload: { tab_id: tabId, role: 'button', accessible_name: `button-${id}` },
  };
}

test('one process snapshot feeds exact memory and adaptive pressure without another scheduler', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 1, mutationConcurrency: 1 });
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    executeRuntimeFenced: async () => ({ ok: true }),
  });

  const snapshot = coordinator.reconcile(processSnapshot(), {
    cell_by_tab: new Map([
      [TAB_A, { cell_id: 'cell:a', cell_generation: 3, provider: 'openai', role: 'AGENT' }],
      [TAB_B, { cell_id: 'cell:b', cell_generation: 4, provider: 'openai', role: 'AGENT' }],
    ]),
  });

  assert.equal(coordinator.binding(TAB_A, { require_complete_process_identity: true }).renderer_process_key, '101:2001');
  assert.equal(coordinator.context(TAB_B).binding.target_id, 'target-b');
  assert.equal(snapshot.coverage.process_count, 3);
  assert.equal(snapshot.coverage.live_web_contents_count, 2);
  assert.equal(snapshot.coverage.unbound_live_web_contents_count, 0);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.dedicated_timer, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.bounded_memory, true);
});

test('independent BrowserCells enter the already runtime-fenced executor concurrently', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 8, mutationConcurrency: 8 });
  const started = [];
  const release = new Map();
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    executeRuntimeFenced: async (cmd, context) => {
      started.push({ id: cmd.command_id, cell: context.browserCell });
      await new Promise((resolve) => release.set(cmd.command_id, resolve));
      return { id: cmd.command_id };
    },
  });
  coordinator.reconcile(processSnapshot());

  const pending = coordinator.dispatchMutations([
    command('c1', TAB_A),
    command('c2', TAB_B),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  assert.notEqual(started[0].cell, started[1].cell);
  release.get('c1')();
  release.get('c2')();
  const rows = await pending;
  assert.deepEqual(rows.map((row) => row.status), ['fulfilled', 'fulfilled']);
});

test('lifecycle edge immediately invalidates exact memory while pressure consumes the same snapshot', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    executeRuntimeFenced: async () => ({ ok: true }),
    clock: () => Date.parse('2026-09-06T10:30:00.020Z'),
  });
  coordinator.reconcile(processSnapshot());

  const gone = {
    seq: 11,
    type: 'RENDER_PROCESS_GONE',
    tab_id: TAB_A,
    web_contents_id: 101,
    os_pid: 101,
    reason: 'crashed',
    observed_at: '2026-09-06T10:30:00.010Z',
  };
  const result = coordinator.observeEdge(gone, {
    process_snapshot: processSnapshot({ sequence: 11, events: [gone] }),
  });

  assert.equal(coordinator.binding(TAB_A), null);
  assert.equal(coordinator.context(TAB_A).status, 'GONE');
  assert.equal(result.pressure.projection.recent_crashes, 1);
  assert.equal(result.command_leasing, false);
  assert.equal(result.authority_effect, false);
});

test('ambiguous physical failure is surfaced exactly once with no coordinator retry', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  let calls = 0;
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    executeRuntimeFenced: async () => {
      calls += 1;
      throw new Error('ambiguous_after_dispatch');
    },
  });
  coordinator.reconcile(processSnapshot());

  const rows = await coordinator.dispatchMutations([command('c1', TAB_A)]);
  assert.equal(calls, 1);
  assert.equal(rows[0].status, 'rejected');
  assert.match(String(rows[0].reason?.message || rows[0].reason), /ambiguous_after_dispatch/);
  assert.equal(coordinator.snapshot().automatic_effect_retry_allowed, false);
});

test('coverage states the exact visibility boundary instead of claiming OS-global omniscience', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler,
    executeRuntimeFenced: async () => ({ ok: true }),
  });
  const snapshot = coordinator.reconcile(processSnapshot());
  assert.equal(snapshot.full_electron_process_visibility, true);
  assert.equal(snapshot.os_global_process_visibility, false);
  assert.equal(snapshot.exact_tab_binding_required_for_mutation, true);
  assert.equal(snapshot.hidden_queue, false);
});
