import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  assertAgentSurfaceProofBinding,
  digestAgentSurfaceProof,
} from '../src/agent-origin-proof.mjs';
import {
  clearFleetRuntime,
  markFleetTransportProvenFromNativeFrame,
  registerFleetRuntime,
} from '../src/fleet-runtime-bridge.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const binding = Object.freeze({
  agent_id: 'agent_11111111-2222-4333-8444-555555555555',
  tab_id: 'tab_agent_origin_001',
  target_id: 'webcontents:71',
  agent_generation_epoch: 9,
});

function surfaceProof(overrides = {}) {
  return {
    schema: 'metaengine.browser.agent-platform-surface-proof.v1',
    stage: 'AGENT_HOME',
    target_id: binding.target_id,
    process_incarnation_id: 'process-agent-origin-001',
    state_revision_id: 'revision-agent-home-001',
    template_names: ['Full-Stack', 'Writing', 'Data Insight'],
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

function conversationFrame(overrides = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: binding.tab_id,
    target_id: binding.target_id,
    process_incarnation_id: 'process-agent-origin-001',
    url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
    authority_effect: false,
    ...overrides,
  };
}

function runtimeHarness() {
  let markCalls = 0;
  let state = {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    agents: [{
      agent_id: binding.agent_id,
      lifecycle_state: 'PROVISIONING_AMBIGUOUS',
      ambiguous_reason: 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING',
      tab_id: binding.tab_id,
      target_id: binding.target_id,
      generation_epoch: binding.agent_generation_epoch,
      transport_proof: null,
      authority_effect: false,
    }],
  };
  return {
    snapshot: () => structuredClone(state),
    markCalls: () => markCalls,
    async markTransportProven(args) {
      markCalls += 1;
      state = {
        ...state,
        agents: [{
          ...state.agents[0],
          lifecycle_state: 'ACTIVE',
          ambiguous_reason: null,
          transport_proof: {
            schema: 'metaengine.browser.fleet-transport-proof.v1',
            tab_id: args.tab_id,
            target_id: args.target_id,
            generation_epoch: args.generation_epoch,
            conversation_url_sha256: sha256(args.conversation_url),
            agent_surface_sha256: args.agent_surface_sha256,
            proven_at: '2026-09-28T02:50:00.000Z',
            authority_effect: false,
          },
        }],
      };
      return structuredClone(state);
    },
  };
}

test('R99 Agent surface digest is canonical and bound to target/process identity', () => {
  const proof = surfaceProof();
  const digest = digestAgentSurfaceProof(proof);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const bound = assertAgentSurfaceProofBinding({
    proof,
    expected_sha256: digest,
    target_id: binding.target_id,
    process_incarnation_id: proof.process_incarnation_id,
  });
  assert.equal(bound.state, 'PROVEN');
  assert.equal(bound.agent_surface_sha256, digest);
  assert.equal(bound.authority_effect, false);
});

test('R99 a fabricated Agent-surface hash cannot promote a conversation', async () => {
  const runtime = runtimeHarness();
  registerFleetRuntime(runtime);
  try {
    const proof = surfaceProof();
    await assert.rejects(
      () => markFleetTransportProvenFromNativeFrame({
        binding,
        frame: conversationFrame(),
        expected_transport_url_sha256: sha256(conversationFrame().url),
        expected_agent_surface_sha256: 'f'.repeat(64),
        expected_agent_surface_proof: proof,
      }),
      /agent_origin_surface_hash_mismatch/,
    );
    assert.equal(runtime.markCalls(), 0);
  } finally {
    clearFleetRuntime(runtime);
  }
});

test('R99 Agent-origin proof must match the exact target and process that produced the conversation', async () => {
  for (const [name, proof, pattern] of [
    ['target', surfaceProof({ target_id: 'webcontents:72' }), /agent_origin_surface_target_mismatch/],
    ['process', surfaceProof({ process_incarnation_id: 'process-agent-origin-stale' }), /agent_origin_surface_process_incarnation_mismatch/],
  ]) {
    const runtime = runtimeHarness();
    registerFleetRuntime(runtime);
    try {
      const digest = digestAgentSurfaceProof(proof);
      await assert.rejects(
        () => markFleetTransportProvenFromNativeFrame({
          binding,
          frame: conversationFrame(),
          expected_transport_url_sha256: sha256(conversationFrame().url),
          expected_agent_surface_sha256: digest,
          expected_agent_surface_proof: proof,
        }),
        pattern,
        name,
      );
      assert.equal(runtime.markCalls(), 0);
    } finally {
      clearFleetRuntime(runtime);
    }
  }
});

test('R99 first conversation promotion requires proof material, not only a 64-hex digest', async () => {
  const runtime = runtimeHarness();
  registerFleetRuntime(runtime);
  try {
    await assert.rejects(
      () => markFleetTransportProvenFromNativeFrame({
        binding,
        frame: conversationFrame(),
        expected_transport_url_sha256: sha256(conversationFrame().url),
        expected_agent_surface_sha256: digestAgentSurfaceProof(surfaceProof()),
      }),
      /fleet_runtime_agent_surface_proof_required/,
    );
    assert.equal(runtime.markCalls(), 0);
  } finally {
    clearFleetRuntime(runtime);
  }
});

test('R99 exact Agent-origin proof allows one bounded promotion and records validation', async () => {
  const runtime = runtimeHarness();
  registerFleetRuntime(runtime);
  try {
    const proof = surfaceProof();
    const out = await markFleetTransportProvenFromNativeFrame({
      binding,
      frame: conversationFrame(),
      expected_transport_url_sha256: sha256(conversationFrame().url),
      expected_agent_surface_sha256: digestAgentSurfaceProof(proof),
      expected_agent_surface_proof: proof,
    });
    assert.equal(out.state, 'PROVEN');
    assert.equal(out.agent_origin_proof_validated, true);
    assert.equal(runtime.markCalls(), 1);
  } finally {
    clearFleetRuntime(runtime);
  }
});
