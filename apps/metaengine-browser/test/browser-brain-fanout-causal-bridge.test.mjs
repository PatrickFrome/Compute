import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutCausalBridge,
  browserBrainFanoutCausalBridgeContract,
} from '../src/browser-brain-fanout-causal-bridge.mjs';

function progress(sequence, overrides = {}) {
  return {
    schema: 'metaengine.browser.provider-neutral-fanout-progress.v1',
    sequence,
    action_id: 'act_1',
    action_digest: 'a'.repeat(64),
    fanout_index: sequence - 1,
    target_binding_digest: 'b'.repeat(64),
    outcome: 'APPLIED',
    effect_proof_digest: 'c'.repeat(64),
    received_count: sequence,
    pending_count: 3 - sequence,
    complete: sequence === 3,
    payload_persisted: false,
    retry_candidates: [],
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

test('projects monotonic fanout progress into one causal Brain epoch', () => {
  const bridge = new BrowserBrainFanoutCausalBridge();
  const first = bridge.observe(progress(1));
  const second = bridge.observe(progress(2));

  assert.equal(first.disposition, 'APPLIED');
  assert.equal(first.brain_epoch, 1);
  assert.equal(second.brain_epoch, 2);
  assert.equal(second.progress.received_count, 2);
  assert.equal(second.progress.action_digest, 'a'.repeat(64));
  assert.equal(second.authority_effect, false);
});

test('duplicate delivery is idempotent and does not advance Brain epoch', () => {
  const bridge = new BrowserBrainFanoutCausalBridge();
  bridge.observe(progress(1));
  const duplicate = bridge.observe(progress(1));

  assert.equal(duplicate.disposition, 'DUPLICATE');
  assert.equal(duplicate.brain_epoch, 1);
  assert.equal(duplicate.progress, null);
  assert.equal(bridge.snapshot().epoch, 1);
});

test('gap fails closed and requires canonical resync', () => {
  const bridge = new BrowserBrainFanoutCausalBridge();
  bridge.observe(progress(1));
  const gap = bridge.observe(progress(3));

  assert.equal(gap.accepted, false);
  assert.equal(gap.disposition, 'GAP');
  assert.equal(gap.resync_required, true);
  assert.equal(gap.progress, null);
  assert.equal(bridge.snapshot().gap_requires_resync, true);
});

test('independent action digests keep independent causal sequences', () => {
  const bridge = new BrowserBrainFanoutCausalBridge();
  const first = bridge.observe(progress(1));
  const other = bridge.observe(progress(1, { action_id: 'act_2', action_digest: 'd'.repeat(64) }));

  assert.notEqual(first.source, other.source);
  assert.equal(other.disposition, 'APPLIED');
  assert.equal(other.brain_epoch, 2);
  assert.equal(bridge.snapshot().source_count, 2);
});

test('rejects malformed progress before causal state mutation', () => {
  const bridge = new BrowserBrainFanoutCausalBridge();
  assert.throws(() => bridge.observe(progress(1, { action_digest: 'provider-selector' })), /action_digest_invalid/);
  assert.equal(bridge.snapshot().epoch, 0);
  assert.equal(bridge.snapshot().source_count, 0);
});

test('contract is bounded, payload-free and zero-authority', () => {
  const contract = browserBrainFanoutCausalBridgeContract();
  assert.equal(contract.max_fanout_sources, 128);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.gap_requires_canonical_resync, true);
  for (const key of [
    'scheduler_authority',
    'dispatch_authority',
    'lease_authority',
    'effect_execution_authority',
    'automatic_retry_allowed',
    'ambiguous_retry_allowed',
    'dedicated_timer',
    'authority_effect',
  ]) assert.equal(contract[key], false);
});
