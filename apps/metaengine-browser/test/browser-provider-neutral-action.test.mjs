import assert from 'node:assert/strict';
import test from 'node:test';
import {
  durableProviderNeutralActionRef,
  fanoutProviderNeutralAction,
  normalizeProviderNeutralAction,
  providerNeutralActionSnapshot,
} from '../src/browser-provider-neutral-action.mjs';

const action = () => ({
  action_id: 'action-1',
  action: 'SEMANTIC_TYPE',
  payload: {
    role: 'textbox',
    accessible_name: 'Message',
    text: 'hello fleet',
    replace_existing: true,
  },
});

const binding = (index) => ({
  agent_id: `agent-${index}`,
  tab_id: `tab-${index}`,
  target_id: `target-${index}`,
  agent_generation: 2,
  lease_generation: 3,
  binding_generation: 4,
});

test('normalization is provider-neutral and deterministic', () => {
  const first = normalizeProviderNeutralAction(action());
  const second = normalizeProviderNeutralAction(action());
  assert.equal(first.provider, null);
  assert.equal(first.provider_specific_selector, null);
  assert.equal(first.action_digest, second.action_digest);
  assert.equal(first.authority_effect, false);
  assert.equal(first.automatic_retry_allowed, false);
});

test('bounded fanout preserves one action digest and exact generation fences per target', () => {
  const rows = fanoutProviderNeutralAction(action(), [binding(1), binding(2), binding(3)]);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.action_digest)).size, 1);
  assert.deepEqual(rows.map((row) => row.fanout_index), [0, 1, 2]);
  assert.deepEqual(rows[1].target_binding, binding(2));
  assert.equal(rows.every((row) => row.authority_effect === false), true);
});

test('duplicate target generations and oversized fanout fail closed', () => {
  assert.throws(
    () => fanoutProviderNeutralAction(action(), [binding(1), binding(1)]),
    /provider_neutral_duplicate_target_binding/,
  );
  assert.throws(
    () => fanoutProviderNeutralAction(action(), [binding(1), binding(2)], { maxTargets: 1 }),
    /provider_neutral_fanout_limit:1/,
  );
});

test('provider-specific or unsupported action forms cannot enter the neutral contract', () => {
  assert.throws(
    () => normalizeProviderNeutralAction({ action_id: 'x', action: 'STOP_GENERATION', payload: {} }),
    /provider_neutral_action_unsupported/,
  );
  assert.throws(
    () => normalizeProviderNeutralAction({ action_id: 'x', action: 'TYPED_CLICK', payload: { role: 'document', accessible_name: 'x' } }),
    /provider_neutral_role_unsupported/,
  );
});

test('durable memory stores action identity and digest without payload content', () => {
  const ref = durableProviderNeutralActionRef(action());
  assert.equal(ref.action_id, 'action-1');
  assert.equal(ref.action, 'SEMANTIC_TYPE');
  assert.match(ref.action_digest, /^[a-f0-9]{64}$/);
  assert.equal(ref.payload_persisted, false);
  assert.equal('payload' in ref, false);
  assert.equal(JSON.stringify(ref).includes('hello fleet'), false);
});

test('contract exposes zero authority and no blind retry', () => {
  const snapshot = providerNeutralActionSnapshot();
  assert.equal(snapshot.provider_neutral, true);
  assert.equal(snapshot.exact_target_generation_fencing, true);
  assert.equal(snapshot.provider_specific_selectors_allowed, false);
  assert.equal(snapshot.durable_payload_persistence, false);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.lease_authority, false);
  assert.equal(snapshot.effect_execution_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
});
