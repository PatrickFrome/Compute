import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHybridNode, proposeHybridPlacement } from './placement.mjs';

const now = 1_700_000_000_000;
const sha = 'a'.repeat(40);
function task(overrides = {}) {
  return { schema: 'metaengine.hybrid.task-placement-intent.v1',
    task_id: 'task_alpha', workspace_id: 'workspace_alpha',
    source_sha: sha, effect_class: 'READ_ONLY', data_zone: 'PORTABLE',
    required_capabilities: ['GIT_READ'], allow_cloud: true,
    max_cost_units: 100, max_latency_ms: 1000, ...overrides };
}
function node(node_id, domain, overrides = {}) {
  return { node_id, domain, incarnation_id: 'boot_0001', generation: 7,
    registry_generation: 7, heartbeat_seq: 18, registry_min_seq: 17,
    observed_at_ms: now - 1000, state: 'READY', source_sha: sha,
    capabilities: ['GIT_READ', 'TEST_RUN'], total_slots: 2, in_use_slots: 0,
    latency_ms: 25, cost_units: 10, ...overrides };
}
function enrollment(n) {
  return {node_id:n.node_id, incarnation_id:n.incarnation_id, generation:n.generation,
    domain:n.domain, source_sha:n.source_sha};
}
function snapshot(nodes = []) {
  return { schema: 'metaengine.hybrid.registry-snapshot.v1',
    workspace_id: 'workspace_alpha', source_sha: sha,
    readback_source: 'EXISTING_CONTROL_PLANE', nodes,
    enrollments: nodes.filter(Boolean).map(enrollment) };
}
function place(nodes, intent = task(), time = now) {
  return proposeHybridPlacement({ task: intent, snapshot: snapshot(nodes), now_ms: time });
}

test('basic local placement is a non-executable suggestion only', () => {
  const result = place([node('local01', 'LOCAL')]);
  assert.equal(result.state, 'PROPOSAL_ONLY');
  assert.equal(result.node_id, 'local01');
  assert.equal(result.authority_effect, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.automatic_retry_allowed, false);
});
test('cloud node can be proposed when task is portable and cloud is allowed', () => {
  assert.equal(place([node('cloud01', 'CLOUD')]).node_id, 'cloud01');
});
test('LOCAL_PRIVATE data never leaves the local domain', () => {
  const result = place([node('cloud01', 'CLOUD')], task({ data_zone: 'LOCAL_PRIVATE' }));
  assert.equal(result.state, 'HOLD');
  assert.equal(result.excluded.PRIVATE_DATA_LOCAL_ONLY, 1);
});
test('CLOUD_ONLY data excludes local candidates', () => {
  const result = place([node('local01', 'LOCAL'), node('cloud01', 'CLOUD')],
    task({ data_zone: 'CLOUD_ONLY' }));
  assert.equal(result.node_id, 'cloud01');
  assert.equal(result.excluded.CLOUD_ONLY_TASK, 1);
});
test('cloud default deny is not bypassed by a healthy node', () => {
  const result = place([node('cloud01', 'CLOUD')], task({allow_cloud: false}));
  assert.equal(result.state, 'HOLD');
  assert.equal(result.excluded.CLOUD_NOT_AUTHORIZED, 1);
});
test('stale and future heartbeat timestamps never permit placement', () => {
  for (const offset of [-(30_001), 1]) {
    const result = place([node('local01', 'LOCAL', {observed_at_ms: now + offset})]);
    assert.equal(result.state, 'HOLD');
    assert.equal(result.excluded.NODE_STALE, 1);
  }
});
test('incarnation/generation fencing excludes mismatched revision', () => {
  const result = place([node('local01', 'LOCAL', { registry_generation: 6 })]);
  assert.equal(result.excluded.NODE_GENERATION_OR_SEQUENCE_FENCED, 1);
});
test('heartbeat sequence regression is fenced', () => {
  assert.equal(place([node('local01', 'LOCAL', {heartbeat_seq: 16})]).state, 'HOLD');
});
test('exact source SHA mismatch is fenced', () => {
  const result = place([node('local01', 'LOCAL', {source_sha: 'b'.repeat(40)})]);
  assert.equal(result.excluded.SOURCE_SHA_MISMATCH, 1);
});
test('no slots, missing capability, and budgets fail closed', () => {
  assert.equal(place([node('local01', 'LOCAL', {in_use_slots: 2})]).excluded.NO_FREE_SLOTS, 1);
  assert.equal(place([node('local01', 'LOCAL')], task({required_capabilities: ['GPU_COMPUTE']}))
    .excluded.CAPABILITY_MISSING, 1);
  assert.equal(place([node('local01', 'LOCAL', {cost_units: 101})]).excluded.COST_BUDGET_EXCEEDED, 1);
  assert.equal(place([node('local01', 'LOCAL', {latency_ms: 1001})]).excluded.LATENCY_BUDGET_EXCEEDED, 1);
});
test('unapproved mutating effects are never converted to read-only placement authority', () => {
  const result = place([node('local01', 'LOCAL')], task({effect_class: 'MUTATING'}));
  assert.equal(result.reason, 'MUTATION_REQUIRES_EXISTING_LEASE_AND_VEF');
  assert.equal(result.dispatch_allowed, false);
});
test('invalid task and untrusted registry shape cannot bypass admission', () => {
  assert.equal(proposeHybridPlacement({task:task({effect_class:'RAW_SHELL'}),snapshot:snapshot([]),now_ms:now}).reason,
    'INVALID_TASK_INTENT');
  assert.equal(proposeHybridPlacement({task:task(),snapshot:{...snapshot([]),readback_source:'PAGE_TEXT'},now_ms:now}).reason,
    'REGISTRY_SNAPSHOT_NOT_ADMITTED');
});
test('duplicate node IDs cannot game deterministic selection', () => {
  assert.equal(place([node('duplicate', 'LOCAL'),node('duplicate', 'CLOUD')]).reason,'DUPLICATE_NODE_ID');
});
test('node tie-breaking is deterministic regardless of input order', () => {
  const nodes = [node('z_node', 'CLOUD'),node('a_node', 'LOCAL'),
    node('b_node', 'LOCAL')];
  assert.equal(place(nodes).node_id, 'a_node');
  assert.equal(place([...nodes].reverse()).node_id, 'a_node');
});
test('cheaper node wins before latency, without side effects', () => {
  const a = node('fast_local', 'LOCAL', {cost_units: 20,latency_ms: 1});
  const b = node('cheap_cloud', 'CLOUD', {cost_units: 3,latency_ms: 300});
  assert.equal(place([a,b]).node_id,'cheap_cloud');
});
test('empty fleet is a HOLD rather than fabricated cloud fallback', () => {
  const result = place([]);
  assert.equal(result.reason, 'NO_ELIGIBLE_NODE');
  assert.equal(result.dispatch_allowed, false);
});
test('malformed node is rejected with bounded diagnostics', () => {
  assert.deepEqual(classifyHybridNode({...node('local01','LOCAL'),capabilities:['RAW_CDP']},task(),now,enrollment(node('local01','LOCAL'))),
    {eligible:false,reason:'NODE_INVALID'});
});

test('unenrolled worker is not eligible', () => {
  const registered=snapshot([node('local01','LOCAL')]);
  const result=proposeHybridPlacement({task:task(),snapshot:{...registered,enrollments:[]},now_ms:now});
  assert.equal(result.state,'HOLD');
  assert.equal(result.excluded.NODE_NOT_ENROLLED,1);
});
test('reincarnated worker cannot reuse old enrollment', () => {
  const registered=snapshot([node('local01','LOCAL')]);
  const changed={...registered,nodes:[node('local01','LOCAL',{incarnation_id:'boot_0002'})]};
  const result=proposeHybridPlacement({task:task(),snapshot:changed,now_ms:now});
  assert.equal(result.excluded.NODE_GENERATION_OR_SEQUENCE_FENCED,1);
});
test('duplicate registrations are rejected, not first-write-wins', () => {
  const registered=snapshot([node('local01','LOCAL')]);
  const result=proposeHybridPlacement({task:task(),
    snapshot:{...registered,enrollments:[...registered.enrollments,...registered.enrollments]},now_ms:now});
  assert.equal(result.reason,'DUPLICATE_REGISTRY_ENROLLMENT');
});
test('registration domain mismatch cannot promote local node to cloud', () => {
  const registered=snapshot([node('local01','LOCAL')]);
  const modified={...registered,enrollments:[{...registered.enrollments[0],domain:'CLOUD'}]};
  const result=proposeHybridPlacement({task:task(),snapshot:modified,now_ms:now});
  assert.equal(result.excluded.NODE_GENERATION_OR_SEQUENCE_FENCED,1);
});
test('registry must exactly match task source and workspace', () => {
  const s=snapshot([node('local01','LOCAL')]);
  assert.equal(proposeHybridPlacement({task:task(),snapshot:{...s,workspace_id:'other_ws'},now_ms:now}).reason,
    'REGISTRY_SNAPSHOT_NOT_ADMITTED');
  assert.equal(proposeHybridPlacement({task:task(),snapshot:{...s,source_sha:'b'.repeat(40)},now_ms:now}).reason,
    'REGISTRY_SNAPSHOT_NOT_ADMITTED');
});
test('bounded fleet size prevents unbounded planner work', () => {
  const result=proposeHybridPlacement({task:task(),snapshot:snapshot(Array(4097).fill(null)),now_ms:now});
  assert.equal(result.reason,'REGISTRY_SNAPSHOT_NOT_ADMITTED');
});
