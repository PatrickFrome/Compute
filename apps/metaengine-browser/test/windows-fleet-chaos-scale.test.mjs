import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createRemoteBrowserPoolV1, RemoteBrowserPoolError } from '../../../coordination/browser-shared/remote-browser-pool-v1.mjs';
import { buildSupervisorMeshWireProjectionV1 } from '../src/supervisor-mesh-wire-projection.mjs';

const NODE_COUNT = 48;
const NODE_CAPACITY = 24;
const TASKS = 1000;
const MESH_GROUPS = 64;
const PEERS_PER_MESH = 16;

function node(index, epoch = 1) {
  return {
    node_id: `node.${String(index).padStart(3, '0')}`,
    node_epoch: epoch,
    process_incarnation_id: `proc.node.${String(index).padStart(3, '0')}.epoch.${epoch}`,
    surface: 'REMOTE_BROWSER_NODE',
    health: 'HEALTHY',
    capabilities: ['CLICK', 'PERCEPTION', 'TYPE'],
    context_isolation: true,
    raw_engine_exposed: false,
    region: 'us-east-2',
    max_leases: NODE_CAPACITY,
  };
}

function peer(group, index) {
  const url = `https://chatgpt.com/c/${String(group).padStart(8, '0')}-${String(index).padStart(4, '0')}-4000-8000-000000000001`;
  const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex');
  return {
    supervisor_id: `sup_${hash.slice(0, 24)}`,
    conversation_url_sha256: hash,
    status: 'ACTIVE',
    tab_id: `tab_mesh_${group}_${index}`,
    selected: index === 0,
    authority_effect: false,
  };
}

function meshRuntime(group) {
  const supervisors = Array.from({ length: PEERS_PER_MESH }, (_, i) => peer(group, i));
  return {
    schema: 'metaengine.supervisor-mesh-runtime.v2',
    running: true,
    last_reconcile_at: '2026-08-31T12:00:00.000Z',
    last_error: null,
    authority_effect: false,
    mesh: {
      schema: 'metaengine.supervisor-mesh.state.v2',
      version: '1.1.0-devos',
      mesh_epoch: group + 1,
      coordinator_supervisor_id: supervisors[0].supervisor_id,
      supervisors,
      authority_effect: false,
    },
  };
}

function activeByNode(snapshot) {
  const counts = new Map(snapshot.nodes.map((n) => [n.node_id, 0]));
  for (const lease of snapshot.leases) {
    if (lease.state === 'RESERVED' || lease.state === 'IN_FLIGHT') counts.set(lease.node_id, (counts.get(lease.node_id) || 0) + 1);
  }
  return counts;
}

test('Windows-scale chaos: 1000 task placements stay balanced across bounded Browser node incarnations', () => {
  const pool = createRemoteBrowserPoolV1();
  for (let i = 0; i < NODE_COUNT; i += 1) pool.registerNode(node(i));

  const leases = [];
  for (let i = 0; i < TASKS; i += 1) {
    leases.push(pool.acquireLease({
      lease_id: `lease.${String(i).padStart(5, '0')}`,
      action_id: `action.${String(i).padStart(5, '0')}`,
      resource_id: `task.${String(i).padStart(5, '0')}`,
      required_capabilities: i % 3 === 0 ? ['CLICK', 'PERCEPTION'] : ['CLICK'],
      now_ms: 1_000 + i,
      ttl_ms: 120_000,
    }));
  }

  const counts = [...activeByNode(pool.snapshot()).values()];
  assert.equal(leases.length, TASKS);
  assert.ok(Math.max(...counts) <= NODE_CAPACITY);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(pool.snapshot().automatic_retry_allowed, false);
  assert.equal(pool.snapshot().authority_effect, false);
});

test('Windows-scale chaos: node crashes preserve pre/post-effect uncertainty and never blind-retry', () => {
  const pool = createRemoteBrowserPoolV1();
  for (let i = 0; i < 12; i += 1) pool.registerNode(node(i));
  const leases = [];
  for (let i = 0; i < 180; i += 1) {
    const lease = pool.acquireLease({
      lease_id: `lease.crash.${i}`,
      action_id: `action.crash.${i}`,
      resource_id: `task.crash.${i}`,
      required_capabilities: ['CLICK'],
      now_ms: 10_000 + i,
      ttl_ms: 120_000,
    });
    leases.push(lease);
    if (i % 7 === 0) pool.markActuationStarted({
      lease_id: lease.lease_id,
      node_id: lease.node_id,
      node_epoch: lease.node_epoch,
      process_incarnation_id: lease.process_incarnation_id,
      now_ms: 20_000 + i,
    });
  }

  for (const index of [2, 5, 9]) {
    pool.setNodeHealth({
      node_id: node(index).node_id,
      node_epoch: 1,
      process_incarnation_id: node(index).process_incarnation_id,
      health: 'UNHEALTHY',
    });
  }

  const crashed = new Set([node(2).node_id, node(5).node_id, node(9).node_id]);
  const affected = pool.snapshot().leases.filter((l) => crashed.has(l.node_id));
  assert.ok(affected.length > 0);
  assert.ok(affected.every((l) => l.state === 'TERMINAL'));
  assert.ok(affected.every((l) => ['NO_EFFECT', 'AMBIGUOUS'].includes(l.terminal_outcome)));
  assert.ok(affected.every((l) => l.automatic_retry_allowed === false));
  assert.ok(affected.some((l) => l.terminal_outcome === 'AMBIGUOUS'));
  assert.ok(affected.some((l) => l.terminal_outcome === 'NO_EFFECT'));
});

test('Windows-scale chaos: stale process incarnation cannot dispatch after node replacement', () => {
  const pool = createRemoteBrowserPoolV1();
  pool.registerNode(node(1));
  const lease = pool.acquireLease({ lease_id:'lease.stale.001', action_id:'action.stale.001', resource_id:'task.stale.001', required_capabilities:['CLICK'], now_ms:1000, ttl_ms:120000 });
  pool.registerNode(node(1, 2));
  const old = pool.getLease(lease.lease_id);
  assert.equal(old.state, 'TERMINAL');
  assert.equal(old.terminal_outcome, 'NO_EFFECT');
  assert.equal(old.automatic_retry_allowed, false);
  assert.throws(() => pool.validateDispatch({ lease_id:lease.lease_id, node_id:lease.node_id, node_epoch:lease.node_epoch, process_incarnation_id:lease.process_incarnation_id, now_ms:2000 }), (e) => e instanceof RemoteBrowserPoolError);
});

test('Windows-scale chaos: 1024 supervisor peers remain sharded into DB-compatible bounded meshes', () => {
  let total = 0;
  const preferred = new Set();
  for (let group = 0; group < MESH_GROUPS; group += 1) {
    const wire = buildSupervisorMeshWireProjectionV1(meshRuntime(group));
    assert.equal(wire.mesh.supervisors.length, PEERS_PER_MESH);
    assert.equal(wire.mesh.mesh_epoch, group + 1);
    assert.ok(wire.mesh.preferred_supervisor_id);
    assert.equal(wire.authority_effect, false);
    total += wire.mesh.supervisors.length;
    preferred.add(wire.mesh.preferred_supervisor_id);
  }
  assert.equal(total, MESH_GROUPS * PEERS_PER_MESH);
  assert.equal(total, 1024);
  assert.equal(preferred.size, MESH_GROUPS);
});

test('Windows-scale chaos: resource duplication is rejected under high contention', () => {
  const pool = createRemoteBrowserPoolV1();
  for (let i = 0; i < 8; i += 1) pool.registerNode(node(i));
  pool.acquireLease({ lease_id:'lease.first.001', action_id:'action.first.001', resource_id:'task.shared.001', required_capabilities:['CLICK'], now_ms:1000, ttl_ms:120000 });
  for (let i = 0; i < 100; i += 1) {
    assert.throws(() => pool.acquireLease({ lease_id:`lease.dup.${i}`, action_id:`action.dup.${i}`, resource_id:'task.shared.001', required_capabilities:['CLICK'], now_ms:1001+i, ttl_ms:120000 }), (e) => e instanceof RemoteBrowserPoolError && e.code === 'pool_resource_already_leased');
  }
});
