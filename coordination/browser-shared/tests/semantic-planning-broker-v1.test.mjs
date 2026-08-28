import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticPlanningBroker } from '../semantic-planning-broker-v1.mjs';

function node({ ref='n1', sem='sem_submit', loc='loc_submit', visibility='VISIBLE', clickable=true, editable=false, focusable=true, role='button' } = {}) {
  return {
    ref, parent_ref: null, role, name: 'Submit', description: null, value_summary: null,
    states: {}, editable, clickable, focusable, bounds: [10, 20, 100, 30], visibility,
    confidence: 0.99, continuity: null, binding_epoch: null,
    semantic_fingerprint: sem, geometry_bucket: '0:0:96:32', locator_fingerprint: loc
  };
}

function envelope({ target='target_1', context='default', conversation=4, document='doc_1', source='src_1', nodes=[node()] } = {}) {
  return {
    schema: 'metaengine.a2-browser-operator.perception-envelope.v1', source_surface: 'COMPUTE_BROWSER',
    target_id: target, context_id: context, conversation_epoch: conversation, document_epoch: document,
    captured_at: '2026-08-28T06:30:00.000Z', source_token: source, source_scope: 'SEMANTIC_WORKING_SET',
    tainted_page_data: true, authority_effect: false, actuation_eligible: false,
    evidence: { accessibility: 'COMPLETE', geometry: 'PARTIAL', visibility: 'POSITIVE_ONLY', oopif: 'UNKNOWN' },
    truncation: { applied: false, source_node_count: nodes.length, emitted_node_count: nodes.length }, nodes
  };
}

function deterministicBroker(options = {}) {
  let id = 0;
  return new SemanticPlanningBroker({
    flightIdFactory: () => `flight_${++id}`,
    leaseTokenFactory: () => `lease_${id}_${'x'.repeat(24)}`,
    ...options
  });
}

test('one cold semantic key elects exactly one external planner leader', () => {
  const broker = deterministicBroker();
  const leader = broker.lookup({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(leader.status, 'MISS_LEADER');
  assert.equal(leader.model_call_required, true);
  assert.equal(leader.wait_required, false);
  assert.ok(leader.lease_token);
  const waiter = broker.lookup({ envelope: envelope({ source: 'src_2' }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(waiter.status, 'WAIT_FOR_PROMOTION');
  assert.equal(waiter.model_call_required, false);
  assert.equal(waiter.wait_required, true);
  assert.equal(waiter.flight_id, leader.flight_id);
  assert.equal(waiter.lease_token, null);
  assert.equal(broker.snapshot().metrics.leader_misses, 1);
  assert.equal(broker.snapshot().metrics.waiters, 1);
});

test('leader promotion revalidates its selected semantics against a fresh envelope and warms cache', () => {
  const broker = deterministicBroker();
  const first = envelope({ nodes: [node({ ref: 'old_ref', loc: 'loc_old' })] });
  const leader = broker.lookup({ envelope: first, intentId: 'submit', actionKind: 'CLICK' });
  const fresh = envelope({ source: 'src_fresh', nodes: [node({ ref: 'fresh_ref', loc: 'loc_changed' })] });
  const promoted = broker.promote({
    flightId: leader.flight_id,
    leaseToken: leader.lease_token,
    candidateRef: 'old_ref',
    freshEnvelope: fresh
  });
  assert.equal(promoted.status, 'PROMOTED_REVALIDATED');
  assert.equal(promoted.candidate_ref, 'fresh_ref');
  assert.equal(promoted.actuation_eligible, false);
  assert.equal(promoted.must_run_actionability_checks, true);
  const hit = broker.lookup({ envelope: envelope({ source: 'src_after', nodes: [node({ ref: 'newest_ref', loc: 'loc_newest' })] }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(hit.status, 'HIT_REVALIDATED');
  assert.equal(hit.candidate_ref, 'newest_ref');
  assert.equal(hit.model_call_required, false);
  assert.equal(broker.snapshot().in_flight_count, 0);
});

test('promotion refuses cross-document drift and releases the lease for replanning', () => {
  const broker = deterministicBroker();
  const leader = broker.lookup({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  assert.throws(() => broker.promote({
    flightId: leader.flight_id,
    leaseToken: leader.lease_token,
    candidateRef: 'n1',
    freshEnvelope: envelope({ document: 'doc_2', source: 'src_doc2' })
  }), /semantic_planning_broker_namespace_changed/);
  assert.equal(broker.snapshot().in_flight_count, 0);
  const next = broker.lookup({ envelope: envelope({ document: 'doc_2', source: 'src_doc2b' }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(next.status, 'MISS_LEADER');
});

test('promotion refuses semantic target replacement rather than trusting old node refs', () => {
  const broker = deterministicBroker();
  const leader = broker.lookup({ envelope: envelope({ nodes: [node({ ref: 'old', sem: 'sem_old' })] }), intentId: 'submit', actionKind: 'CLICK' });
  assert.throws(() => broker.promote({
    flightId: leader.flight_id,
    leaseToken: leader.lease_token,
    candidateRef: 'old',
    freshEnvelope: envelope({ source: 'src_new', nodes: [node({ ref: 'new', sem: 'sem_new' })] })
  }), /semantic_planning_broker_target_not_revalidated:TARGET_NOT_REVALIDATED/);
  assert.equal(broker.snapshot().cache.entry_count, 0);
  assert.equal(broker.snapshot().metrics.promotion_revalidation_failures, 1);
});

test('only the elected leader lease can promote or abort', () => {
  const broker = deterministicBroker();
  const leader = broker.lookup({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  assert.throws(() => broker.promote({
    flightId: leader.flight_id,
    leaseToken: 'lease_wrong_XXXXXXXXXXXXXXXXXXXXXXXX',
    candidateRef: 'n1',
    freshEnvelope: envelope({ source: 'src_fresh' })
  }), /semantic_planning_broker_lease_invalid/);
  assert.equal(broker.snapshot().in_flight_count, 1);
  assert.throws(() => broker.abort({
    flightId: leader.flight_id,
    leaseToken: 'lease_wrong_XXXXXXXXXXXXXXXXXXXXXXXX',
    reasonCode: 'MODEL_ERROR'
  }), /semantic_planning_broker_lease_invalid/);
  const aborted = broker.abort({ flightId: leader.flight_id, leaseToken: leader.lease_token, reasonCode: 'MODEL_ERROR' });
  assert.equal(aborted.status, 'ABORTED');
  assert.equal(broker.snapshot().in_flight_count, 0);
});

test('expired planner leases elect a new leader', () => {
  let now = 1000;
  let id = 0;
  const broker = new SemanticPlanningBroker({
    clock: () => now,
    leaseTtlMs: 50,
    flightIdFactory: () => `flight_${++id}`,
    leaseTokenFactory: () => `lease_${id}_${'x'.repeat(24)}`
  });
  const first = broker.lookup({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  now = 1100;
  const second = broker.lookup({ envelope: envelope({ source: 'src_later' }), intentId: 'submit', actionKind: 'CLICK' });
  assert.equal(second.status, 'MISS_LEADER');
  assert.notEqual(second.flight_id, first.flight_id);
  assert.equal(broker.snapshot().metrics.expirations, 1);
});

test('flight cardinality is bounded and overload fails closed', () => {
  const broker = deterministicBroker({ maxFlights: 2 });
  broker.lookup({ envelope: envelope({ target: 'target_a' }), intentId: 'a', actionKind: 'CLICK' });
  broker.lookup({ envelope: envelope({ target: 'target_b' }), intentId: 'b', actionKind: 'CLICK' });
  assert.throws(() => broker.lookup({ envelope: envelope({ target: 'target_c' }), intentId: 'c', actionKind: 'CLICK' }), /semantic_planning_broker_capacity_exceeded/);
  assert.equal(broker.snapshot().metrics.capacity_rejections, 1);
});

test('different causal namespaces never share a planning flight', () => {
  const broker = deterministicBroker();
  const variants = [
    envelope({ target: 'target_a' }),
    envelope({ target: 'target_b' }),
    envelope({ context: 'ctx_b' }),
    envelope({ conversation: 5 }),
    envelope({ document: 'doc_b' })
  ];
  const rows = variants.map((value) => broker.lookup({ envelope: value, intentId: 'submit', actionKind: 'CLICK' }));
  assert.ok(rows.every((row) => row.status === 'MISS_LEADER'));
  assert.equal(new Set(rows.map((row) => row.flight_id)).size, rows.length);
});

test('broker snapshots never expose perception, lease tokens, node refs, or execution payloads', () => {
  const broker = deterministicBroker();
  const leader = broker.lookup({ envelope: envelope(), intentId: 'submit', actionKind: 'CLICK' });
  const serialized = JSON.stringify(broker.snapshot());
  assert.equal(serialized.includes(leader.lease_token), false);
  assert.equal(serialized.includes('src_1'), false);
  assert.equal(serialized.includes('n1'), false);
  assert.equal(broker.snapshot().stores_execution_payload, false);
  assert.equal(broker.snapshot().stores_perception_persistently, false);
  assert.equal(broker.snapshot().authority_effect, false);
});
