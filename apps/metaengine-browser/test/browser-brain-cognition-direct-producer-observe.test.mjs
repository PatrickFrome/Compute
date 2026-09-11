import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainCognitionFabric } from '../src/browser-brain-cognition-fabric.mjs';

const TAB_ID = 'tab_00000000-0000-4000-8000-000000000001';

function clockHarness(dispositions = []) {
  const observations = [];
  let cursor = 0;
  return {
    observations,
    streamClock: {
      observe(source, sequence) {
        observations.push([source, sequence]);
        return Object.freeze({
          source,
          sequence,
          disposition: dispositions[cursor++] || 'APPLIED',
        });
      },
      snapshot() {
        return Object.freeze({
          schema: 'metaengine.browser-brain.stream-clock.v1',
          epoch: 9,
          gap_requires_resync: dispositions.includes('GAP'),
          sources: Object.freeze([]),
        });
      },
    },
  };
}

test('semantic edge observes process and semantic producers directly in stable order', () => {
  const harness = clockHarness();
  const fabric = new BrowserBrainCognitionFabric({ streamClock: harness.streamClock });

  const result = fabric.observeEdge({
    type: 'SEMANTIC_EVENT',
    seq: 41,
    semantic_sequence: 73,
    tab_id: TAB_ID,
    semantic_method: 'DOM.documentUpdated',
    observed_at: '2026-09-11T06:00:00.000Z',
  });

  assert.deepEqual(harness.observations, [
    ['process-plane', 41],
    ['semantic', 73],
  ]);
  assert.deepEqual(result.clock.map(({ source, sequence }) => [source, sequence]), harness.observations);
  assert.equal(result.authority_effect, false);
});

test('invalid or absent producer sequences do not create stream-clock observations', () => {
  const harness = clockHarness();
  const fabric = new BrowserBrainCognitionFabric({ streamClock: harness.streamClock });

  const result = fabric.observeEdge({
    type: 'SEMANTIC_EVENT',
    seq: 0,
    semantic_sequence: -1,
    tab_id: TAB_ID,
  });

  assert.deepEqual(harness.observations, []);
  assert.deepEqual(result.clock, []);
  assert.equal(result.causal_epoch, 9);
  assert.equal(result.authority_effect, false);
});

test('direct producer observation preserves gap and regression accounting inputs', () => {
  const harness = clockHarness(['GAP', 'REGRESSION']);
  const fabric = new BrowserBrainCognitionFabric({ streamClock: harness.streamClock });

  const result = fabric.observeEdge({
    type: 'SEMANTIC_EVENT',
    seq: 8,
    semantic_sequence: 13,
  });

  assert.deepEqual(result.clock.map((row) => row.disposition), ['GAP', 'REGRESSION']);
  assert.equal(result.resync_required, true);

  const snapshot = fabric.snapshot();
  assert.equal(snapshot.clock_gap_count, 1);
  assert.equal(snapshot.clock_regression_count, 1);
});
