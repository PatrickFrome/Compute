import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustTaintGraphV1 } from '../coordination/browser-shared/trust-taint-graph-v1.mjs';

const D = (c) => `sha256:${c.repeat(64)}`;

test('page/model/tool data can never grant authority by source declaration', () => {
  const graph = new TrustTaintGraphV1();
  for (const source_class of ['PAGE_DATA', 'MODEL_OUTPUT', 'TOOL_OUTPUT']) {
    const node = graph.addSource({ node_id: `node.${source_class.toLowerCase()}`, source_class, content_digest: D('1'), authority_capabilities: [] });
    assert.equal(node.integrity, 'UNTRUSTED');
    assert.equal(node.authority_eligible, false);
    assert.deepEqual(node.taint_source_ids, [node.node_id]);
  }
  assert.throws(() => graph.addSource({ node_id: 'node.page.bad', source_class: 'PAGE_DATA', content_digest: D('2'), authority_capabilities: ['BROWSER_ACTUATION'] }), /taint_non_authority_source_capabilities_forbidden/);
});

test('derivation conservatively propagates taint and loses authority when data is mixed into authority lane', () => {
  const graph = new TrustTaintGraphV1();
  graph.addSource({ node_id: 'node.policy', source_class: 'LOCAL_POLICY', content_digest: D('1'), authority_capabilities: ['BROWSER_ACTUATION', 'NETWORK_WRITE'] });
  graph.addSource({ node_id: 'node.page', source_class: 'PAGE_DATA', content_digest: D('2'), authority_capabilities: [] });
  const derived = graph.derive({ node_id: 'node.mixed', parent_ids: ['node.policy', 'node.page'], transform_kind: 'PLAN', content_digest: D('3') });
  assert.equal(derived.integrity, 'UNTRUSTED');
  assert.equal(derived.authority_eligible, false);
  assert.deepEqual(derived.authority_capabilities, []);
  assert.deepEqual(derived.taint_source_ids, ['node.page']);
  assert.throws(() => graph.assessPrivilegedSink({ authority_node_id: 'node.mixed', data_node_ids: [], sink_kind: 'BROWSER_ACTUATION' }), /taint_authority_node_not_eligible/);
});

test('trusted authority lane may authorize tainted browser data but data grants no authority and requires live revalidation', () => {
  const graph = new TrustTaintGraphV1();
  graph.addSource({ node_id: 'node.policy', source_class: 'SIGNED_SUPERVISOR_DIRECTIVE', content_digest: D('1'), authority_capabilities: ['BROWSER_ACTUATION'] });
  graph.addSource({ node_id: 'node.page', source_class: 'PAGE_DATA', content_digest: D('2'), authority_capabilities: [] });
  graph.addSource({ node_id: 'node.model', source_class: 'MODEL_OUTPUT', content_digest: D('3'), authority_capabilities: [] });
  const receipt = graph.assessPrivilegedSink({
    authority_node_id: 'node.policy', data_node_ids: ['node.page', 'node.model'], sink_kind: 'BROWSER_ACTUATION', requested_capabilities: ['BROWSER_ACTUATION'],
  });
  assert.equal(receipt.allowed, true);
  assert.equal(receipt.data_granted_authority, false);
  assert.equal(receipt.live_revalidation_required, true);
  assert.deepEqual(receipt.tainted_data_node_ids, ['node.model', 'node.page']);
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.actuation_eligible, false);
});

test('least privilege denies ungranted requested capability and authority/data lane alias', () => {
  const graph = new TrustTaintGraphV1();
  graph.addSource({ node_id: 'node.policy', source_class: 'LOCAL_POLICY', content_digest: D('1'), authority_capabilities: ['BROWSER_ACTUATION'] });
  assert.throws(() => graph.assessPrivilegedSink({
    authority_node_id: 'node.policy', data_node_ids: [], sink_kind: 'BROWSER_ACTUATION', requested_capabilities: ['SECRET_READ'],
  }), /taint_requested_capability_not_granted/);
  assert.throws(() => graph.assessPrivilegedSink({
    authority_node_id: 'node.policy', data_node_ids: ['node.policy'], sink_kind: 'BROWSER_ACTUATION', requested_capabilities: [],
  }), /taint_authority_data_lane_alias_forbidden/);
});

test('evidence nodes can support reasoning but cannot act as authority', () => {
  const graph = new TrustTaintGraphV1();
  const evidence = graph.addSource({ node_id: 'node.test', source_class: 'VERIFIED_TEST_EVIDENCE', content_digest: D('4'), authority_capabilities: [] });
  assert.equal(evidence.integrity, 'EVIDENCE');
  assert.equal(evidence.authority_eligible, false);
  assert.throws(() => graph.assessPrivilegedSink({ authority_node_id: 'node.test', sink_kind: 'LOCAL_EXEC' }), /taint_authority_node_not_eligible/);
});

test('explicit verified endorsement is scoped and retains taint provenance', () => {
  const seen = [];
  const graph = new TrustTaintGraphV1({ endorsementVerifier: (endorsement, parent) => {
    seen.push({ endorsement, parent });
    return endorsement.principal_id === 'supervisor.root' && endorsement.evidence_digest === D('9');
  }});
  graph.addSource({ node_id: 'node.model', source_class: 'MODEL_OUTPUT', content_digest: D('1'), authority_capabilities: [] });
  const endorsed = graph.endorse({
    node_id: 'node.endorsed', parent_id: 'node.model', content_digest: D('2'),
    endorsement: { endorsement_id: 'endorsement.001', principal_id: 'supervisor.root', scopes: ['NETWORK_WRITE'], evidence_digest: D('9') },
  });
  assert.equal(endorsed.integrity, 'ENDORSED');
  assert.equal(endorsed.authority_eligible, true);
  assert.deepEqual(endorsed.taint_source_ids, ['node.model']);
  assert.deepEqual(endorsed.authority_capabilities, ['NETWORK_WRITE']);
  assert.equal(seen.length, 1);
  const ok = graph.assessPrivilegedSink({ authority_node_id: 'node.endorsed', data_node_ids: [], sink_kind: 'NETWORK_WRITE' });
  assert.equal(ok.allowed, true);
  assert.throws(() => graph.assessPrivilegedSink({ authority_node_id: 'node.endorsed', data_node_ids: [], sink_kind: 'SECRET_READ' }), /taint_authority_sink_capability_missing/);
});

test('failed endorsement verification does not create a node', () => {
  const graph = new TrustTaintGraphV1({ endorsementVerifier: () => false });
  graph.addSource({ node_id: 'node.page', source_class: 'PAGE_DATA', content_digest: D('1'), authority_capabilities: [] });
  assert.throws(() => graph.endorse({
    node_id: 'node.bad', parent_id: 'node.page', content_digest: D('2'),
    endorsement: { endorsement_id: 'endorsement.bad', principal_id: 'supervisor.root', scopes: ['BROWSER_ACTUATION'], evidence_digest: D('9') },
  }), /taint_endorsement_not_verified/);
  assert.equal(graph.getNode('node.bad'), null);
});
