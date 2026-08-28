import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticActionCache } from '../semantic-action-cache-v1.mjs';

function node({ ref='n1', sem='semfp_submit', loc='loc_submit_a', visible=true, clickable=true, editable=false, focusable=true, role='button' } = {}) {
  return {
    ref,
    parent_ref: null,
    role,
    name: 'Submit',
    description: null,
    value_summary: null,
    states: {},
    editable,
    clickable,
    focusable,
    bounds: [10, 20, 100, 30],
    visibility: visible ? 'VISIBLE' : 'UNKNOWN',
    confidence: 0.99,
    continuity: null,
    binding_epoch: null,
    semantic_fingerprint: sem,
    geometry_bucket: '0:0:96:32',
    locator_fingerprint: loc
  };
}

function envelope({ surface='EXTENSION', target='browser_1', context='default', conversation=7, document='doc_1', nodes=[node()] } = {}) {
  return {
    schema: 'metaengine.a2-browser-operator.perception-envelope.v1',
    source_surface: surface,
    target_id: target,
    context_id: context,
    conversation_epoch: conversation,
    document_epoch: document,
    captured_at: '2026-08-28T06:20:00.000Z',
    source_token: 'src_test',
    source_scope: 'SEMANTIC_WORKING_SET',
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    evidence: { accessibility: 'COMPLETE', geometry: 'PARTIAL', visibility: 'POSITIVE_ONLY', oopif: 'UNKNOWN' },
    truncation: { applied: false, source_node_count: nodes.length, emitted_node_count: nodes.length },
    nodes
  };
}

test('cross-surface hit bypasses planning but still requires fresh actionability', () => {
  let now = 1000;
  const cache = new SemanticActionCache({ clock: () => now });
  cache.put({ envelope: envelope({ surface: 'EXTENSION' }), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  now += 10;
  const computeFresh = envelope({
    surface: 'COMPUTE_BROWSER',
    nodes: [node({ ref: 'compute_ref_88', loc: 'loc_submit_b' })]
  });
  const hit = cache.resolve({ envelope: computeFresh, intentId: 'intent_submit', actionKind: 'CLICK' });
  assert.equal(hit.cache_status, 'HIT_REVALIDATED');
  assert.equal(hit.reason, 'UNIQUE_SEMANTIC_REVALIDATED');
  assert.equal(hit.candidate_ref, 'compute_ref_88');
  assert.equal(hit.authority_effect, false);
  assert.equal(hit.actuation_eligible, false);
  assert.equal(hit.revalidation_required, true);
  assert.equal(hit.must_run_actionability_checks, true);
});

test('full namespace fences target context conversation and document epochs', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  const base = envelope();
  cache.put({ envelope: base, intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  for (const changed of [
    envelope({ target: 'browser_2' }),
    envelope({ context: 'context_2' }),
    envelope({ conversation: 8 }),
    envelope({ document: 'doc_2' })
  ]) {
    const miss = cache.resolve({ envelope: changed, intentId: 'intent_submit', actionKind: 'CLICK' });
    assert.equal(miss.cache_status, 'MISS');
    assert.equal(miss.reason, 'NO_RECORD');
  }
});

test('semantic uniqueness tolerates geometry drift', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  cache.put({ envelope: envelope(), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  const fresh = envelope({ nodes: [node({ ref: 'fresh', loc: 'loc_geometry_changed' })] });
  const hit = cache.resolve({ envelope: fresh, intentId: 'intent_submit', actionKind: 'CLICK' });
  assert.equal(hit.cache_status, 'HIT_REVALIDATED');
  assert.equal(hit.reason, 'UNIQUE_SEMANTIC_REVALIDATED');
  assert.equal(hit.candidate_ref, 'fresh');
});

test('duplicate semantics require unique geometry fingerprint or fail closed', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  cache.put({ envelope: envelope(), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  const disambiguated = envelope({ nodes: [
    node({ ref: 'a', loc: 'loc_other' }),
    node({ ref: 'b', loc: 'loc_submit_a' })
  ] });
  const hit = cache.resolve({ envelope: disambiguated, intentId: 'intent_submit', actionKind: 'CLICK' });
  assert.equal(hit.cache_status, 'HIT_REVALIDATED');
  assert.equal(hit.reason, 'SEMANTIC_AND_GEOMETRY_REVALIDATED');
  assert.equal(hit.candidate_ref, 'b');

  const ambiguous = envelope({ nodes: [
    node({ ref: 'a', loc: 'loc_other_a' }),
    node({ ref: 'b', loc: 'loc_other_b' })
  ] });
  const miss = cache.resolve({ envelope: ambiguous, intentId: 'intent_submit', actionKind: 'CLICK' });
  assert.equal(miss.cache_status, 'MISS');
  assert.equal(miss.reason, 'AMBIGUOUS_TARGET');
});

test('fresh visibility and capability are mandatory at put and resolve', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  assert.throws(() => cache.put({
    envelope: envelope({ nodes: [node({ visible: false })] }),
    intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1'
  }), /semantic_action_cache_node_not_eligible/);

  cache.put({ envelope: envelope(), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  const miss = cache.resolve({
    envelope: envelope({ nodes: [node({ ref: 'fresh', visible: false })] }),
    intentId: 'intent_submit', actionKind: 'CLICK'
  });
  assert.equal(miss.reason, 'TARGET_NOT_REVALIDATED');
});

test('cache never accepts action payload or stores ephemeral node refs', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  assert.throws(() => cache.put({
    envelope: envelope(), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1', value: 'secret'
  }), /semantic_action_cache_payload_forbidden:value/);
  const record = cache.put({ envelope: envelope(), intentId: 'intent_submit', actionKind: 'CLICK', nodeRef: 'n1' });
  assert.equal(record.stores_action_payload, false);
  assert.equal(record.stores_node_ref, false);
  assert.equal(JSON.stringify(record).includes('"ref":"n1"'), false);
  const snapshot = cache.snapshot();
  assert.equal(snapshot.stores_action_payload, false);
  assert.equal(snapshot.stores_node_ref, false);
  assert.equal(snapshot.negative_cache_enabled, false);
});

test('TTL expiry and LRU capacity bound stale work', () => {
  let now = 1000;
  const cache = new SemanticActionCache({ maxEntries: 2, maxAgeMs: 50, clock: () => now });
  cache.put({ envelope: envelope(), intentId: 'intent_a', actionKind: 'CLICK', nodeRef: 'n1' });
  cache.put({ envelope: envelope(), intentId: 'intent_b', actionKind: 'CLICK', nodeRef: 'n1' });
  cache.put({ envelope: envelope(), intentId: 'intent_c', actionKind: 'CLICK', nodeRef: 'n1' });
  assert.equal(cache.snapshot().entry_count, 2);
  assert.equal(cache.snapshot().metrics.evictions, 1);
  assert.equal(cache.resolve({ envelope: envelope(), intentId: 'intent_a', actionKind: 'CLICK' }).reason, 'NO_RECORD');
  now = 1100;
  assert.equal(cache.resolve({ envelope: envelope(), intentId: 'intent_b', actionKind: 'CLICK' }).reason, 'EXPIRED');
});

test('misses do not create negative cache entries and namespace invalidation is exact', () => {
  const cache = new SemanticActionCache({ clock: () => 1000 });
  const base = envelope();
  const otherDoc = envelope({ document: 'doc_other' });
  assert.equal(cache.resolve({ envelope: base, intentId: 'intent_missing', actionKind: 'CLICK' }).cache_status, 'MISS');
  assert.equal(cache.snapshot().entry_count, 0);
  cache.put({ envelope: base, intentId: 'intent_a', actionKind: 'CLICK', nodeRef: 'n1' });
  cache.put({ envelope: otherDoc, intentId: 'intent_b', actionKind: 'CLICK', nodeRef: 'n1' });
  assert.equal(cache.invalidateNamespace(base), 1);
  assert.equal(cache.snapshot().entry_count, 1);
  assert.equal(cache.resolve({ envelope: otherDoc, intentId: 'intent_b', actionKind: 'CLICK' }).cache_status, 'HIT_REVALIDATED');
});
