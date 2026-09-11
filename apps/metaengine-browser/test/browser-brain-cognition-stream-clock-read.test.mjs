import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainCognitionFabric } from '../src/browser-brain-cognition-fabric.mjs';

const TAB_ID = 'tab_00000000-0000-4000-8000-000000000001';

test('observeEdge reads one immutable stream-clock snapshot after producer observation', () => {
  let snapshotReads = 0;
  const observations = [];
  const streamClock = {
    observe(source, sequence) {
      observations.push([source, sequence]);
      return Object.freeze({ source, sequence, disposition: 'APPLIED' });
    },
    snapshot() {
      snapshotReads += 1;
      return Object.freeze({
        schema: 'metaengine.browser-brain.stream-clock.v1',
        epoch: 7,
        gap_requires_resync: false,
        sources: Object.freeze([]),
      });
    },
  };
  const fabric = new BrowserBrainCognitionFabric({ streamClock });

  const result = fabric.observeEdge({
    type: 'RENDER_PROCESS_CREATED',
    seq: 1,
    tab_id: TAB_ID,
    observed_at: '2026-09-11T05:00:00.000Z',
  });

  assert.deepEqual(observations, [['process-plane', 1]]);
  assert.equal(snapshotReads, 1);
  assert.equal(result.causal_epoch, 7);
  assert.equal(result.resync_required, false);
  assert.equal(result.authority_effect, false);
});

test('single post-observation snapshot preserves gap state from the same causal view', () => {
  let snapshotReads = 0;
  const streamClock = {
    observe(source, sequence) {
      return Object.freeze({ source, sequence, disposition: 'GAP' });
    },
    snapshot() {
      snapshotReads += 1;
      return Object.freeze({
        schema: 'metaengine.browser-brain.stream-clock.v1',
        epoch: 11,
        gap_requires_resync: true,
        sources: Object.freeze([]),
      });
    },
  };
  const fabric = new BrowserBrainCognitionFabric({ streamClock });

  const result = fabric.observeEdge({ type: 'RENDER_PROCESS_CREATED', seq: 3 });

  assert.equal(snapshotReads, 1);
  assert.equal(result.clock[0].disposition, 'GAP');
  assert.equal(result.causal_epoch, 11);
  assert.equal(result.resync_required, true);
  assert.equal(result.authority_effect, false);
});
