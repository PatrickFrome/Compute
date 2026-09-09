import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';

function processSnapshot(sequence) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: `2026-09-09T19:00:0${sequence}.000Z`,
    event_driven_lifecycle: true,
    processes: [],
    web_contents: [],
    semantic_plane: { target_count: 0, targets: [] },
    events: [],
  };
}

test('fresh process snapshots refresh pressure even on semantic-only edges', () => {
  const pressureSequences = [];
  const pressureBridge = {
    observe(snapshot) {
      pressureSequences.push(snapshot.sequence);
      return Object.freeze({
        budget: Object.freeze({
          pressure_band: 'NORMAL',
          read_concurrency: 8,
          mutation_concurrency: 4,
          resource_sample_ms: snapshot.sequence,
          live_cells: 0,
        }),
      });
    },
    snapshot() {
      return Object.freeze({ authority_effect: false });
    },
  };
  const observationBridge = {
    reconcile() {},
    observe() {
      return Object.freeze({ authority_effect: false });
    },
    snapshot() {
      return Object.freeze({ authority_effect: false });
    },
  };
  const coordinator = new BrowserBrainContinuousCoordinator({
    observationBridge,
    pressureBridge,
  });

  coordinator.reconcile(processSnapshot(1));
  const reused = coordinator.observeEdge({ type: 'SEMANTIC_EVENT', seq: 2 });
  assert.equal(reused.pressure_evaluated, false);
  assert.deepEqual(pressureSequences, [1]);

  const refreshed = coordinator.observeEdge({ type: 'SEMANTIC_EVENT', seq: 3 }, {
    process_snapshot: processSnapshot(2),
  });

  assert.equal(refreshed.pressure_evaluated, true);
  assert.equal(refreshed.pressure.budget.resource_sample_ms, 2);
  assert.deepEqual(pressureSequences, [1, 2]);
  assert.equal(refreshed.scheduler_authority, false);
  assert.equal(refreshed.command_leasing, false);
  assert.equal(refreshed.authority_effect, false);
});
