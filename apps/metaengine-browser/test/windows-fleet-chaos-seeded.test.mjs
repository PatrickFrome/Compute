import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteBrowserPoolV1, RemoteBrowserPoolError } from '../../../coordination/browser-shared/remote-browser-pool-v1.mjs';
import { assertLiveLeaseBinding } from '../src/devos-native-task-cycle.mjs';

const SEED = Number(process.env.METAENGINE_CHAOS_SEED || 20260831) >>> 0;
const STEPS = Math.max(1000, Number(process.env.METAENGINE_CHAOS_STEPS || 6000));
const NODE_COUNT = 32;
const NODE_CAPACITY = 12;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function node(index, epoch) {
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

function active(snapshot) {
  return snapshot.leases.filter((row) => row.state === 'RESERVED' || row.state === 'IN_FLIGHT');
}

function activeByNode(snapshot) {
  const counts = new Map(snapshot.nodes.map((row) => [row.node_id, 0]));
  for (const lease of active(snapshot)) counts.set(lease.node_id, (counts.get(lease.node_id) || 0) + 1);
  return counts;
}

function assertPoolInvariants(pool) {
  const snapshot = pool.activeSnapshot();
  const seenResources = new Set();
  for (const lease of active(snapshot)) {
    assert.equal(seenResources.has(lease.resource_id), false, `duplicate active resource ${lease.resource_id}`);
    seenResources.add(lease.resource_id);
    assert.equal(lease.automatic_retry_allowed, false);
    assert.equal(lease.authority_effect, false);
    assert.equal(lease.actuation_eligible, false);
  }
  for (const [nodeId, count] of activeByNode(snapshot)) {
    const row = snapshot.nodes.find((item) => item.node_id === nodeId);
    assert.ok(count <= row.max_leases, `${nodeId} exceeded capacity`);
    assert.equal(row.context_isolation, true);
    assert.equal(row.raw_engine_exposed, false);
  }
  assert.equal(snapshot.terminal_history_retained, true);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.raw_engine_transport_exposed, false);
}

test(`seeded Windows fleet chaos preserves placement/effect invariants (seed=${SEED}, steps=${STEPS})`, () => {
  const random = rng(SEED);
  const pool = createRemoteBrowserPoolV1();
  const epochs = Array.from({ length: NODE_COUNT }, () => 1);
  for (let i = 0; i < NODE_COUNT; i += 1) pool.registerNode(node(i, epochs[i]));

  let leaseSeq = 0;
  let resourceSeq = 0;
  let staleDispatchChecks = 0;
  let duplicateChecks = 0;
  let crashChecks = 0;
  let ambiguousObserved = 0;

  for (let step = 0; step < STEPS; step += 1) {
    const op = random();
    const snapshot = pool.activeSnapshot();
    const live = active(snapshot);

    if (op < 0.42) {
      const resource = `task.seed.${resourceSeq++}`;
      try {
        pool.acquireLease({
          lease_id: `lease.seed.${leaseSeq++}`,
          action_id: `action.seed.${leaseSeq}`,
          resource_id: resource,
          required_capabilities: random() < 0.35 ? ['CLICK', 'PERCEPTION'] : ['CLICK'],
          now_ms: 100_000 + step,
          ttl_ms: 300_000,
        });
      } catch (error) {
        assert.ok(error instanceof RemoteBrowserPoolError);
        assert.equal(error.code, 'pool_no_eligible_node');
      }
    } else if (op < 0.58 && live.length) {
      const lease = live[Math.floor(random() * live.length)];
      if (lease.state === 'RESERVED') {
        pool.markActuationStarted({
          lease_id: lease.lease_id,
          node_id: lease.node_id,
          node_epoch: lease.node_epoch,
          process_incarnation_id: lease.process_incarnation_id,
          now_ms: 100_000 + step,
        });
      }
    } else if (op < 0.72 && live.length) {
      const lease = live[Math.floor(random() * live.length)];
      pool.completeLease({
        lease_id: lease.lease_id,
        outcome: lease.state === 'IN_FLIGHT' ? 'COMMITTED' : 'NO_EFFECT',
        reason_code: lease.state === 'IN_FLIGHT' ? 'EXECUTOR_RECEIPT' : 'CANCELLED_BEFORE_EFFECT',
      });
    } else if (op < 0.82) {
      const index = Math.floor(random() * NODE_COUNT);
      const n = node(index, epochs[index]);
      const before = pool.activeSnapshot().leases.filter((row) => row.node_id === n.node_id);
      pool.setNodeHealth({ node_id:n.node_id, node_epoch:n.node_epoch, process_incarnation_id:n.process_incarnation_id, health:'UNHEALTHY' });
      for (const old of before) {
        const terminal = pool.getLease(old.lease_id);
        assert.equal(terminal.state, 'TERMINAL');
        assert.equal(terminal.automatic_retry_allowed, false);
        if (old.state === 'IN_FLIGHT') {
          assert.equal(terminal.terminal_outcome, 'AMBIGUOUS');
          ambiguousObserved += 1;
        } else {
          assert.equal(terminal.terminal_outcome, 'NO_EFFECT');
        }
      }
      epochs[index] += 1;
      pool.registerNode(node(index, epochs[index]));
      crashChecks += 1;
    } else if (op < 0.90) {
      const reserved = live.filter((row) => row.state === 'RESERVED');
      if (reserved.length) {
        const lease = reserved[Math.floor(random() * reserved.length)];
        assert.throws(() => pool.validateDispatch({
          lease_id: lease.lease_id,
          node_id: lease.node_id,
          node_epoch: lease.node_epoch + 1,
          process_incarnation_id: `${lease.process_incarnation_id}.stale`,
          now_ms: 100_000 + step,
        }), (error) => error instanceof RemoteBrowserPoolError && error.code === 'pool_dispatch_incarnation_mismatch');
        staleDispatchChecks += 1;
      }
    } else if (live.length) {
      const lease = live[Math.floor(random() * live.length)];
      assert.throws(() => pool.acquireLease({
        lease_id: `lease.duplicate.${leaseSeq++}`,
        action_id: `action.duplicate.${leaseSeq}`,
        resource_id: lease.resource_id,
        required_capabilities: ['CLICK'],
        now_ms: 100_000 + step,
        ttl_ms: 300_000,
      }), (error) => error instanceof RemoteBrowserPoolError && error.code === 'pool_resource_already_leased');
      duplicateChecks += 1;
    }

    if (step % 97 === 0) assertPoolInvariants(pool);
  }

  assertPoolInvariants(pool);
  assert.ok(staleDispatchChecks > 0, 'stale incarnation path was not exercised');
  assert.ok(duplicateChecks > 0, 'duplicate resource path was not exercised');
  assert.ok(crashChecks > 0, 'node crash path was not exercised');
  assert.ok(ambiguousObserved > 0, 'post-effect crash ambiguity was not exercised');
});

test('operational snapshot excludes terminal history without deleting evidence', () => {
  const pool=createRemoteBrowserPoolV1();
  pool.registerNode(node(0,1));
  const lease=pool.acquireLease({lease_id:'lease.snapshot.1',action_id:'action.snapshot.1',resource_id:'resource.snapshot.1',required_capabilities:['CLICK'],now_ms:1000,ttl_ms:10000});
  pool.completeLease({lease_id:lease.lease_id,outcome:'NO_EFFECT',reason_code:'CANCELLED_BEFORE_EFFECT'});
  assert.equal(pool.activeSnapshot().leases.length,0);
  assert.equal(pool.snapshot().leases.length,1);
  assert.equal(pool.getLease(lease.lease_id).terminal_outcome,'NO_EFFECT');
});

test('cross-layer placement and DevOS exact binding fail closed independently', () => {
  const pool = createRemoteBrowserPoolV1();
  pool.registerNode(node(0, 1));
  const placement = pool.acquireLease({
    lease_id: 'lease.cross.001', action_id: 'action.cross.001', resource_id: 'task.cross.001',
    required_capabilities: ['CLICK'], now_ms: 1000, ttl_ms: 120000,
  });
  const routing = pool.validateDispatch({
    lease_id: placement.lease_id, node_id: placement.node_id, node_epoch: placement.node_epoch,
    process_incarnation_id: placement.process_incarnation_id, now_ms: 2000,
  });
  assert.equal(routing.routing_eligible, true);
  assert.equal(routing.actuation_eligible, false);

  const lease = {
    task_id: '11111111-1111-4111-8111-111111111111', agent_id: 'agent_12345678', role: 'IMPLEMENTER',
    base_sha: 'a'.repeat(40), lease_generation: 7, tab_id: 'tab_001', target_id: 'webcontents:101',
    agent_generation_epoch: 3, automatic_retry_allowed: false, task_spec: { objective: 'test' },
  };
  const fleet = {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
    agents: [{
      agent_id: lease.agent_id,
      role: lease.role,
      lifecycle_state: 'ACTIVE',
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      automatic_retry_allowed: false,
      authority_effect: false,
      transport_proof: {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: lease.tab_id,
        target_id: lease.target_id,
        generation_epoch: lease.agent_generation_epoch,
        conversation_url_sha256: 'b'.repeat(64),
        proven_at: '2026-08-31T19:00:00.000Z',
        authority_effect: false,
      },
    }],
  };
  assert.equal(assertLiveLeaseBinding(lease, fleet).target_id, lease.target_id);

  const driftedFleet = structuredClone(fleet);
  driftedFleet.agents[0].target_id = 'webcontents:102';
  driftedFleet.agents[0].generation_epoch = 4;
  driftedFleet.agents[0].transport_proof.target_id = 'webcontents:102';
  driftedFleet.agents[0].transport_proof.generation_epoch = 4;
  assert.throws(
    () => assertLiveLeaseBinding(lease, driftedFleet),
    /devos_target_binding_mismatch|devos_generation_binding_mismatch/,
  );

  pool.registerNode(node(0, 2));
  const old = pool.getLease(placement.lease_id);
  assert.equal(old.state, 'TERMINAL');
  assert.equal(old.terminal_outcome, 'NO_EFFECT');
  assert.equal(old.automatic_retry_allowed, false);
});
