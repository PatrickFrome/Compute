import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';

const TAB_ID = 'tab_00000000-0000-4000-8000-000000000201';

function trackedProcessSnapshot() {
  let reads = 0;
  const webContents = [
    {
      web_contents_id: 201,
      os_pid: 201,
      process_key: '201:3001',
      tab_id: TAB_ID,
      destroyed: false,
    },
  ];
  const snapshot = {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence: 20,
    observed_at: '2026-09-09T16:00:00.000Z',
    event_driven_lifecycle: true,
    processes: [
      { pid: 201, process_key: '201:3001', creation_time_ms: 3001, type: 'Tab' },
    ],
    semantic_plane: {
      target_count: 1,
      targets: [
        { tab_id: TAB_ID, target_id: 'target-201', document_generation: 1, semantic_revision: 4 },
      ],
    },
    events: [],
  };
  Object.defineProperty(snapshot, 'web_contents', {
    enumerable: true,
    get() {
      reads += 1;
      return webContents;
    },
  });
  return { snapshot, reads: () => reads };
}

test('semantic edges reuse coverage when the process snapshot is reused', () => {
  const tracked = trackedProcessSnapshot();
  const coordinator = new BrowserBrainContinuousCoordinator();

  const initial = coordinator.reconcile(tracked.snapshot);
  const readsAfterReconcile = tracked.reads();
  assert.equal(initial.coverage.live_web_contents_count, 1);
  assert.ok(readsAfterReconcile > 0);

  const result = coordinator.observeEdge({
    seq: 21,
    type: 'SEMANTIC_EVENT',
    tab_id: TAB_ID,
    web_contents_id: 201,
    target_id: 'target-201',
    semantic_method: 'Accessibility.nodesUpdated',
    semantic_sequence: 5,
    observed_at: '2026-09-09T16:00:00.010Z',
  });

  assert.equal(tracked.reads(), readsAfterReconcile);
  assert.equal(result.coverage.live_web_contents_count, 1);
  assert.equal(result.pressure_evaluated, false);
  assert.equal(result.authority_effect, false);
});

test('caller-supplied process snapshots still refresh coverage before publishing an edge', () => {
  const first = trackedProcessSnapshot();
  const second = trackedProcessSnapshot();
  const coordinator = new BrowserBrainContinuousCoordinator();
  coordinator.reconcile(first.snapshot);
  const before = second.reads();

  coordinator.observeEdge({ type: 'SEMANTIC_EVENT', tab_id: TAB_ID }, {
    process_snapshot: second.snapshot,
  });

  assert.ok(second.reads() > before);
});
