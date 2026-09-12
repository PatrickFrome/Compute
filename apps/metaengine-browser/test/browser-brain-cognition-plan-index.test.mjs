import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainCognitionFabric } from '../src/browser-brain-cognition-fabric.mjs';

const tab = (n) => `tab_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function remember(fabric, tabId, suffix) {
  return fabric.rememberPlan({
    tab_id: tabId,
    intent_id: `intent.${suffix}`,
    action: 'TYPED_CLICK',
    candidate_ref: `node.${suffix}`,
    semantic_fingerprint: `semantic.${suffix}`,
    locator_fingerprint: `locator.${suffix}`,
    binding_generation: 1,
    document_generation: 1,
    semantic_revision: 1,
  });
}

test('navigation invalidates only the indexed BrowserCell plan set at large cache width', () => {
  const fabric = new BrowserBrainCognitionFabric({ maxPlans: 2048, clock: () => 10_000 });
  fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1 });

  for (let i = 0; i < 1000; i += 1) remember(fabric, tab(2), `other.${i}`);
  for (let i = 0; i < 32; i += 1) remember(fabric, tab(1), `target.${i}`);

  assert.equal(fabric.snapshot().advisory_plan_count, 1032);
  fabric.observeEdge({
    type: 'SEMANTIC_EVENT',
    seq: 2,
    semantic_sequence: 1,
    semantic_method: 'DOM.documentUpdated',
    tab_id: tab(1),
  });

  const snapshot = fabric.snapshot();
  assert.equal(snapshot.advisory_plan_count, 1000);
  assert.equal(snapshot.advisory_plan_invalidations, 32);

  const survivor = fabric.resolvePlan({
    tab_id: tab(2),
    intent_id: 'intent.other.999',
    action: 'TYPED_CLICK',
    binding_generation: 1,
    document_generation: 1,
    semantic_revision: 1,
    revalidate: () => true,
  });
  assert.equal(survivor.hit, true);
});

test('bounded eviction removes stale tab-index membership before later invalidation', () => {
  const fabric = new BrowserBrainCognitionFabric({ maxPlans: 2, clock: () => 10_000 });
  remember(fabric, tab(1), 'evicted');
  remember(fabric, tab(2), 'kept.two');
  remember(fabric, tab(3), 'kept.three');

  assert.equal(fabric.snapshot().advisory_plan_count, 2);
  fabric.observeEdge({ type: 'WEB_CONTENTS_DESTROYED', tab_id: tab(1) });
  assert.equal(fabric.snapshot().advisory_plan_invalidations, 0);

  fabric.observeEdge({ type: 'WEB_CONTENTS_DESTROYED', tab_id: tab(2) });
  const snapshot = fabric.snapshot();
  assert.equal(snapshot.advisory_plan_count, 1);
  assert.equal(snapshot.advisory_plan_invalidations, 1);
});

test('realtime edge and plan lookup use O(1) causal summary without materializing full snapshots', () => {
  let epoch = 0;
  let snapshotCalls = 0;
  const streamClock = {
    observe(source, sequence) {
      epoch += 1;
      return Object.freeze({
        accepted: true,
        disposition: 'APPLIED',
        epoch,
        source: Object.freeze({ source, sequence, resync_required: false }),
        authority_effect: false,
      });
    },
    currentEpoch() {
      return epoch;
    },
    requiresResync() {
      return false;
    },
    snapshot() {
      snapshotCalls += 1;
      return Object.freeze({
        epoch,
        sources: Object.freeze([]),
        gap_requires_resync: false,
      });
    },
  };
  const fabric = new BrowserBrainCognitionFabric({ streamClock, clock: () => 10_000 });

  const edge = fabric.observeEdge({ type: 'PROCESS_CENSUS_REFRESHED', seq: 1, tab_id: tab(1) });
  assert.equal(edge.causal_epoch, 1);
  assert.equal(edge.resync_required, false);
  assert.equal(snapshotCalls, 0);

  remember(fabric, tab(1), 'summary.fastpath');
  const resolved = fabric.resolvePlan({
    tab_id: tab(1),
    intent_id: 'intent.summary.fastpath',
    action: 'TYPED_CLICK',
    binding_generation: 1,
    document_generation: 1,
    semantic_revision: 1,
    revalidate: () => true,
  });
  assert.equal(resolved.hit, true);
  assert.equal(snapshotCalls, 0);

  assert.equal(fabric.snapshot().causal_epoch, 1);
  assert.equal(snapshotCalls, 1);
});
