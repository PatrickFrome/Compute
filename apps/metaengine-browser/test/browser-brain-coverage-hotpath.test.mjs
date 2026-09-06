import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const CELL_COUNT = 128;
const EDGE_COUNT = 5_000;
const tabs = Array.from({ length: CELL_COUNT }, (_, i) => `tab_00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

function snapshot({ sequence = 1, destroyedIndex = -1 } = {}) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: new Date(1_800_000_000_000 + sequence).toISOString(),
    event_driven_lifecycle: true,
    processes: [
      { pid: 1, process_key: '1:1000', creation_time_ms: 1000, type: 'Browser' },
      ...tabs.map((_, i) => ({
        pid: 1000 + i,
        process_key: `${1000 + i}:${2000 + i}`,
        creation_time_ms: 2000 + i,
        type: 'Tab',
      })),
    ],
    web_contents: tabs.map((tabId, i) => ({
      web_contents_id: 1000 + i,
      os_pid: 1000 + i,
      process_key: `${1000 + i}:${2000 + i}`,
      tab_id: tabId,
      destroyed: i === destroyedIndex,
    })),
    semantic_plane: {
      sequence,
      target_count: CELL_COUNT,
      targets: tabs.map((tabId, i) => ({
        tab_id: tabId,
        target_id: `target-${i + 1}`,
        document_generation: 1,
        semantic_revision: 0,
      })),
    },
  };
}

test('128-cell semantic burst reuses diagnostic coverage while lifecycle topology refresh remains immediate', () => {
  const coordinator = new BrowserBrainContinuousCoordinator({
    scheduler: new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32 }),
    executeRuntimeFenced: async () => ({ ok: true }),
  });

  const initial = snapshot();
  coordinator.reconcile(initial, {
    cell_by_tab: new Map(tabs.map((tabId, i) => [tabId, {
      cell_id: `cell:${i + 1}`,
      cell_generation: 1,
      provider: i % 2 === 0 ? 'openai' : 'provider-b',
      role: 'WORKER',
    }])),
  });
  const before = coordinator.snapshot();
  assert.equal(before.coverage.live_web_contents_count, CELL_COUNT);
  assert.equal(before.coverage_evaluation_count, 1);

  for (let i = 0; i < EDGE_COUNT; i += 1) {
    const index = i % CELL_COUNT;
    const result = coordinator.observeEdge({
      seq: i + 2,
      type: 'SEMANTIC_EVENT',
      tab_id: tabs[index],
      web_contents_id: 1000 + index,
      target_id: `target-${index + 1}`,
      semantic_method: 'Accessibility.nodesUpdated',
      semantic_sequence: i + 1,
      observed_at: new Date(1_800_000_000_100 + i).toISOString(),
    }, { process_snapshot: initial });
    assert.equal(result.coverage_evaluated, false);
  }

  const afterBurst = coordinator.snapshot();
  assert.equal(afterBurst.coverage_evaluation_count, before.coverage_evaluation_count);
  assert.equal(afterBurst.coverage_reuse_count - before.coverage_reuse_count, EDGE_COUNT);
  assert.equal(afterBurst.coverage.live_web_contents_count, CELL_COUNT);
  assert.equal(afterBurst.semantic_edges_reuse_coverage, true);

  const goneIndex = 17;
  const gone = {
    seq: EDGE_COUNT + 2,
    type: 'WEB_CONTENTS_DESTROYED',
    tab_id: tabs[goneIndex],
    web_contents_id: 1000 + goneIndex,
    observed_at: new Date(1_800_000_100_000).toISOString(),
  };
  const topology = snapshot({ sequence: EDGE_COUNT + 2, destroyedIndex: goneIndex });
  const result = coordinator.observeEdge(gone, { process_snapshot: topology });
  const final = coordinator.snapshot();

  assert.equal(result.coverage_evaluated, true);
  assert.equal(final.coverage_evaluation_count, before.coverage_evaluation_count + 1);
  assert.equal(final.coverage.live_web_contents_count, CELL_COUNT - 1);
  assert.equal(final.coverage.exact_tab_bound_web_contents_count, CELL_COUNT - 1);
  assert.equal(coordinator.binding(tabs[goneIndex]), null);
  assert.equal(final.second_scheduler, false);
  assert.equal(final.command_leasing, false);
  assert.equal(final.authority_effect, false);
});
