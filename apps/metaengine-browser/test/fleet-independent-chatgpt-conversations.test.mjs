import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FleetProvisioner } from '../src/fleet-provisioner-core.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function harness({ persisted = null, desired = 2 } = {}) {
  let state = structuredClone(persisted);
  let sequence = persisted?.agents?.length || 0;
  let tabSequence = 0;
  const tabs = new Set((persisted?.agents || []).map((row) => row.tab_id).filter(Boolean));
  const creates = [];
  const make = () => new FleetProvisioner({
    policy: { warm_agents: 0, desired_agents: desired, profile: 'BALANCED' },
    clock: () => Date.parse('2026-10-04T08:00:00.000Z'),
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    loadState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next); },
    tabExists: (id) => tabs.has(id),
    createTab: async (args) => {
      creates.push(args);
      const tab = { tab_id: `tab_new_${++tabSequence}`, webcontents_id: 100 + tabSequence };
      tabs.add(tab.tab_id);
      return tab;
    },
    loadTab: async () => {},
  });
  return { make, creates, state: () => structuredClone(state) };
}

function proof(agent, conversation_url = CONVERSATION) {
  return {
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    conversation_url,
    agent_surface_sha256: 'f'.repeat(64),
  };
}

async function provision(h) {
  const fleet = h.make();
  await fleet.init();
  await fleet.reconcile({ active: true });
  return fleet;
}

test('six independent roles admit distinct ChatGPT conversations and persist provider-neutral identities', async () => {
  const h = harness({ desired: 6 });
  const fleet = await provision(h);
  const initial = fleet.snapshot().agents;
  assert.ok(initial.some((agent) => agent.role === 'IMPLEMENTER'));
  assert.ok(initial.some((agent) => agent.role === 'CRITIC'));
  for (const [index, agent] of initial.entries()) {
    await fleet.markTransportProven(proof(agent, `https://chatgpt.com/c/conversation-${index}`));
  }
  assert.equal(fleet.snapshot().counts.ACTIVE, 6);
  assert.equal(new Set(fleet.snapshot().agents.map((agent) => agent.transport_proof.conversation_url_sha256)).size, 6);
  assert.ok(h.creates.every((request) => request.url === 'https://chatgpt.com/'));
  for (const agent of h.state().agents) {
    assert.equal(agent.provider, 'OPENAI');
    assert.equal(agent.platform, 'CHATGPT');
    assert.equal(agent.legacy_read_only, false);
    assert.equal(agent.transport_proof.provider, 'OPENAI');
    assert.equal(agent.transport_proof.platform, 'CHATGPT');
    assert.equal(agent.conversation_url_sha256, agent.transport_proof.conversation_url_sha256);
  }
});

test('URL aliases cannot give a second role ownership of the same conversation', async () => {
  const h = harness();
  const fleet = await provision(h);
  const [first, second] = fleet.snapshot().agents;
  await fleet.markTransportProven(proof(first));
  const before = h.state();
  await assert.rejects(fleet.markTransportProven(proof(second,
    'https://www.chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/?utm_source=test#end')),
  /fleet_transport_conversation_identity_conflict/);
  assert.deepEqual(h.state(), before);
  assert.equal(fleet.snapshot().counts.ACTIVE, 1);
  assert.equal(fleet.snapshot().agents[1].lifecycle_state, 'BOUND_UNVERIFIED');
  // Re-reading the same agent's proven incarnation is idempotently admissible.
  await fleet.markTransportProven(proof(first));
  assert.equal(fleet.snapshot().counts.ACTIVE, 1);
});

test('concurrent role promotions serialize conversation ownership before persistence', async () => {
  const h = harness();
  const fleet = await provision(h);
  const results = await Promise.allSettled(fleet.snapshot().agents.map((agent) => fleet.markTransportProven(proof(agent))));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /conversation_identity_conflict/);
  assert.equal(h.state().agents.filter((agent) => agent.lifecycle_state === 'ACTIVE').length, 1);
});

test('restart invalidates transport authority while retaining independent conversation ownership', async () => {
  const h = harness();
  const fleet = await provision(h);
  await fleet.markTransportProven(proof(fleet.snapshot().agents[0]));
  const restarted = h.make();
  await restarted.init();
  const [first, second] = restarted.snapshot().agents;
  assert.equal(first.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(first.transport_proof, null);
  assert.equal(first.conversation_url_sha256, hash(CONVERSATION));
  await assert.rejects(restarted.markTransportProven(proof(second)), /conversation_identity_conflict/);
  await restarted.markTransportProven(proof(first));
  assert.equal(restarted.snapshot().counts.ACTIVE, 1);
});

test('generation-floor invalidation cannot free a peer conversation for another incarnation', async () => {
  const h = harness();
  const fleet = await provision(h);
  await fleet.markTransportProven(proof(fleet.snapshot().agents[0]));
  await fleet.adoptGenerationFloor(28);
  const [first, second] = fleet.snapshot().agents;
  assert.equal(first.transport_proof, null);
  assert.equal(first.generation_epoch, 28);
  await assert.rejects(fleet.markTransportProven(proof(second)), /conversation_identity_conflict/);
  await fleet.markTransportProven(proof(first));
});

test('explicit retirement releases conversation ownership without changing historical identity', async () => {
  const h = harness();
  const fleet = await provision(h);
  const [first, second] = fleet.snapshot().agents;
  await fleet.markTransportProven(proof(first));
  await fleet.retire(first.agent_id);
  await fleet.markTransportProven(proof(second));
  assert.equal(fleet.snapshot().counts.ACTIVE, 1);
  assert.equal(fleet.snapshot().agents[0].conversation_url_sha256, hash(CONVERSATION));
  assert.equal(fleet.snapshot().agents[0].lifecycle_state, 'RETIRED');
});

test('historical duplicate conversation proofs fence both roles and survive a second restart', async () => {
  const h = harness();
  const fleet = await provision(h);
  await fleet.markTransportProven(proof(fleet.snapshot().agents[0]));
  const persisted = h.state();
  const [first, second] = persisted.agents;
  // Simulate the old implementation admitting a second role, with no separate
  // durable claim. Alias normalization must still identify the collision.
  delete first.conversation_url_sha256;
  delete second.conversation_url_sha256;
  second.lifecycle_state = 'ACTIVE';
  second.transport_proof = {
    ...first.transport_proof,
    tab_id: second.tab_id,
    target_id: second.target_id,
    generation_epoch: second.generation_epoch,
    conversation_url: 'https://www.chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/',
  };
  const restoredHarness = harness({ persisted });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const restored = restoredHarness.make();
    await restored.init();
    assert.equal(restored.snapshot().counts.ACTIVE, 0);
    assert.equal(restored.snapshot().counts.PROVISIONING_AMBIGUOUS, 2);
    for (const agent of restored.snapshot().agents) {
      assert.equal(agent.ambiguous_reason, 'TRANSPORT_CONVERSATION_IDENTITY_CONFLICT');
      assert.equal(agent.transport_proof, null);
      assert.equal(agent.automatic_retry_allowed, false);
      await assert.rejects(restored.markTransportProven(proof(agent)), /fleet_transport_state_invalid/);
    }
    await restored.reconcile({ active: true });
    assert.equal(restoredHarness.creates.length, 0);
  }
});

test('hash-only historical proofs cannot restore two owners of one conversation', async () => {
  const h = harness();
  const fleet = await provision(h);
  await fleet.markTransportProven(proof(fleet.snapshot().agents[0]));
  const persisted = h.state();
  const [first, second] = persisted.agents;
  delete first.conversation_url_sha256;
  delete first.transport_proof.conversation_url;
  second.lifecycle_state = 'ACTIVE';
  second.transport_proof = { ...first.transport_proof, tab_id: second.tab_id, target_id: second.target_id };
  const restored = harness({ persisted }).make();
  await restored.init();
  assert.equal(restored.snapshot().counts.PROVISIONING_AMBIGUOUS, 2);
  assert.ok(restored.snapshot().agents.every((agent) => agent.conversation_url_sha256 === hash(CONVERSATION)));
});

test('shared root reachability evidence is not mistaken for conversation ownership', async () => {
  const h = harness();
  const fleet = await provision(h);
  const persisted = h.state();
  for (const agent of persisted.agents) {
    agent.transport_proof = {
      schema: 'metaengine.browser.fleet-transport-proof.v1',
      transport_stage: 'PRECONVERSATION_ROOT',
      tab_id: agent.tab_id,
      target_id: agent.target_id,
      generation_epoch: agent.generation_epoch,
      conversation_url_sha256: hash('https://chatgpt.com/'),
      proven_at: '2026-10-04T08:00:00.000Z',
      authority_effect: false,
    };
  }
  const restored = harness({ persisted }).make();
  await restored.init();
  assert.equal(restored.snapshot().counts.BOUND_UNVERIFIED, 2);
  assert.equal(restored.snapshot().counts.PROVISIONING_AMBIGUOUS, 0);
  assert.ok(restored.snapshot().agents.every((agent) => agent.conversation_url_sha256 === null));
});

test('explicit legacy GLM identity remains readable but receives no bootstrap or new transport authority', async () => {
  const h = harness({ desired: 1 });
  const fleet = await provision(h);
  const persisted = h.state();
  const legacy = persisted.agents[0];
  legacy.provider = 'ZAI';
  legacy.platform = 'GLM_ZAI';
  const restoredHarness = harness({ persisted, desired: 1 });
  const restored = restoredHarness.make();
  await restored.init();
  const historical = restored.snapshot().agents[0];
  assert.equal(historical.provider, 'ZAI');
  assert.equal(historical.platform, 'GLM_ZAI');
  assert.equal(historical.legacy_read_only, true);
  await assert.rejects(restored.beginTransportBootstrapAttempt(proof(historical)), /fleet_transport_legacy_read_only/);
  await assert.rejects(restored.markTransportProven(proof(historical)), /fleet_transport_legacy_read_only/);
  await restored.reconcile({ active: true });
  assert.equal(restoredHarness.creates.length, 1);
  assert.ok(restoredHarness.creates.every((request) => request.url === 'https://chatgpt.com/'));
  assert.equal(restored.snapshot().agents.find((agent) => !agent.legacy_read_only).provider, 'OPENAI');
});

test('old GLM conversation evidence infers a read-only identity without rewriting its agent id or role', async () => {
  const h = harness({ desired: 1 });
  const fleet = await provision(h);
  await fleet.markTransportProven(proof(fleet.snapshot().agents[0]));
  const persisted = h.state();
  const legacy = persisted.agents[0];
  delete legacy.provider;
  delete legacy.platform;
  delete legacy.legacy_read_only;
  delete legacy.conversation_url_sha256;
  legacy.transport_proof.conversation_url = 'https://chat.z.ai/c/legacy-conversation';
  legacy.transport_proof.conversation_url_sha256 = hash(legacy.transport_proof.conversation_url);
  const restored = harness({ persisted, desired: 1 }).make();
  await restored.init();
  const historical = restored.snapshot().agents[0];
  assert.equal(historical.agent_id, legacy.agent_id);
  assert.equal(historical.role, legacy.role);
  assert.equal(historical.provider, 'ZAI');
  assert.equal(historical.platform, 'GLM_ZAI');
  assert.equal(historical.legacy_read_only, true);
  assert.equal(historical.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(historical.transport_proof, null);
});

test('legacy provider-only metadata stays read-compatible without adopting the active platform', async () => {
  const h = harness({ desired: 1 });
  const fleet = await provision(h);
  const persisted = h.state();
  persisted.agents[0].provider = 'ZAI';
  delete persisted.agents[0].platform;
  const restored = harness({ persisted, desired: 1 }).make();
  await restored.init();
  assert.equal(restored.snapshot().agents[0].provider, 'ZAI');
  assert.equal(restored.snapshot().agents[0].platform, 'GLM_ZAI');
  assert.equal(restored.snapshot().agents[0].legacy_read_only, true);
});
