import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNativeSemanticRefCurrent,
  buildNativeSemanticRef,
  NATIVE_SEMANTIC_REF_SCHEMA,
} from '../src/native-semantic-ref.mjs';

const REVISION = `rev_${'a'.repeat(64)}`;
const BASE = Object.freeze({
  stateRevisionId: REVISION,
  targetId: 'webcontents:77',
  runtimeTargetId: 'target-77',
  frameId: 'frame-main-77',
  backendNodeId: 901,
  executionContextUniqueId: 'ctx-unique-77',
});

function current(overrides = {}) {
  return { ...BASE, ...overrides };
}

test('SemanticRef is deterministic over causal node identity while role/name remain evidence only', () => {
  const first = buildNativeSemanticRef({ ...BASE, role: 'button', name: 'Submit' });
  const second = buildNativeSemanticRef({ ...BASE, role: 'link', name: 'Continue' });

  assert.equal(first.schema, NATIVE_SEMANTIC_REF_SCHEMA);
  assert.match(first.semantic_ref_id, /^semref_[a-f0-9]{64}$/);
  assert.equal(first.semantic_ref_id, second.semantic_ref_id);
  assert.notDeepEqual(first.evidence, second.evidence);
  assert.equal(first.evidence.identity_authority, false);
  assert.equal(first.stale_by_default, true);
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal(first.authority_effect, false);
});

test('same-looking replacement node is stale when BackendNodeId changes', () => {
  const ref = buildNativeSemanticRef({ ...BASE, role: 'button', name: 'Submit' });
  assert.throws(
    () => assertNativeSemanticRefCurrent({ ref, ...current({ backendNodeId: 902 }) }),
    /native_semantic_ref_stale/,
  );
});

test('StateRevision, target, runtime target, frame, and execution context are stale fences', () => {
  const ref = buildNativeSemanticRef(BASE);
  const mutations = [
    { stateRevisionId: `rev_${'b'.repeat(64)}` },
    { targetId: 'webcontents:78' },
    { runtimeTargetId: 'target-78' },
    { frameId: 'frame-child-77' },
    { executionContextUniqueId: 'ctx-unique-78' },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertNativeSemanticRefCurrent({ ref, ...current(mutation) }),
      /native_semantic_ref_stale/,
    );
  }
});

test('exact current causal identity validates without granting authority', () => {
  const ref = buildNativeSemanticRef({ ...BASE, role: 'textbox', name: 'Prompt' });
  const validated = assertNativeSemanticRefCurrent({ ref, ...BASE });
  assert.equal(validated.semantic_ref_id, ref.semantic_ref_id);
  assert.equal(validated.authority_effect, false);
  assert.equal(validated.automatic_retry_allowed, false);
});

test('missing or malformed identity fails closed', () => {
  assert.throws(
    () => buildNativeSemanticRef({ ...BASE, backendNodeId: 0 }),
    /native_semantic_ref_backend_node_id_invalid/,
  );
  assert.throws(
    () => buildNativeSemanticRef({ ...BASE, stateRevisionId: 'rev_bad' }),
    /native_semantic_ref_state_revision_id_invalid/,
  );
  assert.throws(
    () => buildNativeSemanticRef({ ...BASE, executionContextUniqueId: null }),
    /native_semantic_ref_execution_context_unique_id_required/,
  );

  const ref = buildNativeSemanticRef(BASE);
  assert.throws(
    () => assertNativeSemanticRefCurrent({ ref, ...current({ frameId: '' }) }),
    /native_semantic_ref_stale/,
  );
  assert.throws(
    () => assertNativeSemanticRefCurrent({ ref: { ...ref, semantic_ref_id: `semref_${'0'.repeat(64)}` }, ...BASE }),
    /native_semantic_ref_integrity_mismatch/,
  );
});
