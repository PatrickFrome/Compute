import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionGraphState, digestActionGraphEvidence } from '../durable-action-graph-core-v1.mjs';

const digest = (label) => digestActionGraphEvidence({ label });
const namespace = {
  target_id: 'tgt.one',
  context_id: 'ctx.one',
  conversation_epoch: 'conv:1',
  document_epoch: 'doc:1',
};

test('forged prepared event hash is rejected before state mutation', () => {
  const state = new ActionGraphState('graph.forge');
  const valid = state.prepareDeclared({
    actionId: 'act.forge', actionKind: 'CLICK', intentDigest: digest('intent'), namespace,
  });
  const forged = { ...valid, event_hash: digest('attacker-replaced-hash') };
  assert.throws(() => state.acceptPrepared(forged), /action_graph_event_hash_mismatch/);
  assert.equal(state.snapshot().action_count, 0);
  assert.equal(state.snapshot().event_count, 0);
});

test('extra fields cannot smuggle action payload into accepted journal events', () => {
  const state = new ActionGraphState('graph.fields');
  const valid = state.prepareDeclared({
    actionId: 'act.fields', actionKind: 'CLICK', intentDigest: digest('intent'), namespace,
  });
  const forged = { ...valid, action_payload: 'sensitive typed text' };
  forged.event_hash = digestActionGraphEvidence(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== 'event_hash')));
  assert.throws(() => state.acceptPrepared(forged), /action_graph_event_fields_invalid/);
  assert.equal(state.snapshot().action_count, 0);
});
