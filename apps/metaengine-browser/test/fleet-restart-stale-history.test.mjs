import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FleetProvisioner,
  FLEET_RESTART_STALE_HISTORY_LIMIT,
  compactTerminalFleetHistory,
  pruneRestartStaleLostHistory,
} from '../src/fleet-provisioner.mjs';

const RESTART_STALE_REASON = 'PHYSICAL_TAB_MISSING_ON_RESTART';

function row({ id, lifecycle = 'LOST', lostReason = RESTART_STALE_REASON, updatedAt, tabId = null, targetId = null, ambiguousReason = null, authorityEffect = false } = {}) {
  return {
    agent_id: id,
    role: 'RESEARCHER',
    ownership: 'FLEET_OWNED',
    lifecycle_state: lifecycle,
    tab_id: tabId,
    target_id: targetId,
    conversation_epoch: 1,
    generation_epoch: 1,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: updatedAt,
    lost_reason: lostReason,
    ambiguous_reason: ambiguousReason,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: authorityEffect,
  };
}

function persistedState(agents, policy = { warm_agents: 0, desired_agents: 0, profile: 'BALANCED' }) {
  return {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.5.0',
    policy,
    agents,
    updated_at: '2026-09-09T00:00:00.000Z',
  };
}

function hasCanonicalTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

test('restart-stale history bound keeps newest forensic rows and never prunes ambiguous or malformed evidence', () => {
  const stale = Array.from({ length: 70 }, (_, i) => row({
    id: `agent_stale${String(i).padStart(3, '0')}`,
    updatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
  }));
  const nonRestartLost = row({
    id: 'agent_manual000',
    lostReason: 'PHYSICAL_TAB_CLOSED',
    updatedAt: '2026-09-08T00:00:00.000Z',
  });
  const ambiguous = row({
    id: 'agent_ambig0000',
    lifecycle: 'PROVISIONING_AMBIGUOUS',
    lostReason: null,
    ambiguousReason: 'CREATE_TAB_AMBIGUOUS:network_unknown',
    updatedAt: '2026-09-08T01:00:00.000Z',
  });
  const authorityBearing = row({
    id: 'agent_authority0',
    authorityEffect: true,
    updatedAt: '2026-09-08T02:00:00.000Z',
  });
  const malformedTimestamp = row({
    id: 'agent_badtime00',
    updatedAt: 'not-a-canonical-timestamp',
  });
  const input = persistedState([...stale, nonRestartLost, ambiguous, authorityBearing, malformedTimestamp]);
  const original = structuredClone(input);

  const bounded = pruneRestartStaleLostHistory(input);
  const boundedEligible = bounded.agents.filter((agent) => (
    agent.lifecycle_state === 'LOST'
    && agent.lost_reason === RESTART_STALE_REASON
    && agent.authority_effect !== true
    && hasCanonicalTimestamp(agent.updated_at)
  ));

  assert.equal(boundedEligible.length, FLEET_RESTART_STALE_HISTORY_LIMIT);
  assert.ok(boundedEligible.every((agent) => Number(agent.agent_id.slice(-3)) >= 6));
  assert.ok(bounded.agents.some((agent) => agent.agent_id === nonRestartLost.agent_id));
  assert.ok(bounded.agents.some((agent) => agent.agent_id === ambiguous.agent_id));
  assert.ok(bounded.agents.some((agent) => agent.agent_id === authorityBearing.agent_id));
  assert.ok(bounded.agents.some((agent) => agent.agent_id === malformedTimestamp.agent_id));
  assert.deepEqual(input, original);
});

test('zero-target terminal compaction removes LOST and RETIRED only and is pure bookkeeping', () => {
  const lost = row({ id: 'agent_lost0000', updatedAt: '2026-09-08T00:00:00.000Z' });
  const retired = row({ id: 'agent_retired0', lifecycle: 'RETIRED', lostReason: 'MANUAL_RETIRE', updatedAt: '2026-09-08T00:01:00.000Z' });
  const active = row({ id: 'agent_active00', lifecycle: 'ACTIVE', lostReason: null, tabId: 'tab-active', targetId: 'target-active', updatedAt: '2026-09-08T00:02:00.000Z' });
  const ambiguous = row({ id: 'agent_ambig2000', lifecycle: 'PROVISIONING_AMBIGUOUS', lostReason: null, ambiguousReason: 'NETWORK_UNKNOWN', updatedAt: '2026-09-08T00:03:00.000Z' });
  const input = persistedState([lost, retired, active, ambiguous]);
  const original = structuredClone(input);

  const compacted = compactTerminalFleetHistory(input);

  assert.deepEqual(compacted.agents.map((agent) => agent.agent_id), [active.agent_id, ambiguous.agent_id]);
  assert.equal(compacted.policy.desired_agents, 0);
  assert.deepEqual(input, original);

  const nonzero = persistedState([lost, retired], { warm_agents: 1, desired_agents: 1, profile: 'BALANCED' });
  assert.strictEqual(compactTerminalFleetHistory(nonzero), nonzero);
});

test('Fleet persistence removes terminal history after init at zero target without browser effects or resurrection', async () => {
  const historical = Array.from({ length: 61 }, (_, i) => row({
    id: `agent_hist${String(i).padStart(4, '0')}`,
    updatedAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(),
  }));
  const retired = Array.from({ length: 4 }, (_, i) => row({
    id: `agent_ret${String(i).padStart(5, '0')}`,
    lifecycle: 'RETIRED',
    lostReason: 'MANUAL_RETIRE',
    updatedAt: new Date(Date.UTC(2026, 7, 2, 0, i)).toISOString(),
  }));
  const liveBeforeRestart = Array.from({ length: 8 }, (_, i) => row({
    id: `agent_live${String(i).padStart(4, '0')}`,
    lifecycle: 'BOUND_UNVERIFIED',
    lostReason: null,
    tabId: `tab_${i}`,
    targetId: `target_${i}`,
    updatedAt: '2026-09-08T00:00:00.000Z',
  }));
  const ambiguous = [
    row({ id: 'agent_ambig1000', lifecycle: 'PROVISIONING_AMBIGUOUS', lostReason: null, ambiguousReason: 'NETWORK_UNKNOWN', updatedAt: '2026-09-08T02:00:00.000Z' }),
    row({ id: 'agent_ambig1001', lifecycle: 'PROVISIONING_AMBIGUOUS', lostReason: null, ambiguousReason: 'TARGET_UNKNOWN', updatedAt: '2026-09-08T02:01:00.000Z' }),
  ];
  let state = persistedState([...historical, ...retired, ...liveBeforeRestart, ...ambiguous]);
  let now = Date.UTC(2026, 8, 9, 12, 0, 0);
  let createCalls = 0;
  let loadCalls = 0;
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 0, desired_agents: 0, profile: 'BALANCED' },
    clock: () => ++now,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    loadState: async () => structuredClone(state),
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => false,
    createTab: async () => { createCalls += 1; throw new Error('unexpected_create'); },
    loadTab: async () => { loadCalls += 1; throw new Error('unexpected_load'); },
  });

  const initialized = await provisioner.init();

  assert.equal(initialized.counts.LOST, 0);
  assert.equal(initialized.counts.RETIRED, 0);
  assert.equal(initialized.counts.ACTIVE, 0);
  assert.equal(initialized.policy.desired_agents, 0);
  assert.equal(initialized.authority_effect, false);
  assert.ok(ambiguous.every((agent) => state.agents.some((kept) => kept.agent_id === agent.agent_id)));
  assert.equal(createCalls, 0);
  assert.equal(loadCalls, 0);

  const reconciled = await provisioner.reconcile({ active: false });
  assert.equal(reconciled.counts.LOST, 0);
  assert.equal(reconciled.counts.RETIRED, 0);
  assert.equal(reconciled.policy.desired_agents, 0);
  assert.equal(reconciled.authority_effect, false);
  assert.equal(createCalls, 0);
  assert.equal(loadCalls, 0);

  const restarted = new FleetProvisioner({
    policy: { warm_agents: 0, desired_agents: 0, profile: 'BALANCED' },
    clock: () => ++now,
    uuid: () => '00000000-0000-4000-8000-000000000002',
    loadState: async () => structuredClone(state),
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => false,
    createTab: async () => { createCalls += 1; throw new Error('unexpected_create'); },
    loadTab: async () => { loadCalls += 1; throw new Error('unexpected_load'); },
  });
  const afterRestart = await restarted.init();
  assert.equal(afterRestart.counts.LOST, 0);
  assert.equal(afterRestart.counts.RETIRED, 0);
  assert.equal(afterRestart.policy.desired_agents, 0);
  assert.equal(afterRestart.authority_effect, false);
  assert.equal(createCalls, 0);
  assert.equal(loadCalls, 0);
});
