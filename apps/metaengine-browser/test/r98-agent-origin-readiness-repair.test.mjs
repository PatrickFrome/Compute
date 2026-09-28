import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const semref = (id) => ({
  schema: 'metaengine.native-browser.semantic-ref.v1',
  semantic_ref_id: `semref_${String(id).padEnd(64, '0').slice(0, 64)}`,
});

function conversationFrame(url = 'https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc') {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: 'tab-agent-1',
    target_id: 'webcontents:17',
    url,
    process_incarnation_id: 'process-agent-1',
    viewport: { width: 0, height: 0 },
    semantic_targets: [
      { role: 'textbox', name: 'Describe your task', backend_node_id: 33, semantic_ref: semref('composer') },
    ],
    interaction_tree: {
      schema: 'metaengine.native-browser.interaction-tree.v1',
      elements: [{ role: 'statictext', text: 'GLM-5.3-Flash' }],
    },
    authority_effect: false,
  };
}

function agentHomeFrame() {
  const button = (name, backend_node_id) => ({ role: 'button', name, backend_node_id, semantic_ref: semref(name) });
  return {
    ...conversationFrame('https://chat.z.ai/'),
    semantic_targets: [
      { role: 'textbox', name: 'Send a Message', backend_node_id: 3, semantic_ref: semref('home-composer') },
      button('Agent', 10),
      button('New Task', 11),
      button('Select a model', 12),
      button('Full-Stack', 13),
      button('Writing', 14),
      button('Data Insight', 15),
    ],
  };
}

function proof(url) {
  return {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    transport_stage: 'CONVERSATION',
    tab_id: 'tab-agent-1',
    target_id: 'webcontents:17',
    generation_epoch: 7,
    conversation_url_sha256: sha256(url),
    agent_surface_sha256: 'd'.repeat(64),
    proven_at: '2026-09-28T00:00:00.000Z',
    authority_effect: false,
  };
}

const base = {
  expected_tab_id: 'tab-agent-1',
  observed_tab_id: 'tab-agent-1',
  expected_target_id: 'webcontents:17',
  observed_target_id: 'webcontents:17',
  selected_tab_id: 'tab-other',
  expected_agent_generation_epoch: 7,
  phase: 'PRE_TYPE',
  platform: 'GLM_ZAI',
};

test('R98 repair: visible Agent Home cannot authorize ordinary task dispatch without durable origin', () => {
  const out = evaluateFleetSubmitReadiness({ ...base, frame: agentHomeFrame() });
  assert.equal(out.ready, false);
  assert.equal(out.reason, 'AGENT_ORIGIN_PROOF_NOT_DURABLE');
  assert.equal(out.authority_effect, false);
});

test('R98 repair: restart-safe Agent proof needs only exact durable hashes, not a persisted raw conversation URL', () => {
  const frame = conversationFrame();
  const out = evaluateFleetSubmitReadiness({
    ...base,
    frame,
    agent_transport_proof: proof(frame.url),
    agent_lifecycle_state: 'ACTIVE',
  });
  assert.equal(out.ready, true);
  assert.equal(out.agent_origin_proof.stage, 'AGENT_CONVERSATION');
  assert.equal(out.agent_origin_proof.agent_surface_sha256, 'd'.repeat(64));
  assert.equal(out.authority_effect, false);
});

test('R98 repair: stale conversation hash is fenced before submit', () => {
  const frame = conversationFrame();
  const stale = proof('https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const out = evaluateFleetSubmitReadiness({
    ...base,
    frame,
    agent_transport_proof: stale,
    agent_lifecycle_state: 'ACTIVE',
  });
  assert.equal(out.ready, false);
  assert.equal(out.reason, 'AGENT_ORIGIN_PROOF_NOT_DURABLE');
});

test('R98 repair: a non-ACTIVE lifecycle cannot borrow an otherwise exact proof', () => {
  const frame = conversationFrame();
  const out = evaluateFleetSubmitReadiness({
    ...base,
    frame,
    agent_transport_proof: proof(frame.url),
    agent_lifecycle_state: 'BOUND_UNVERIFIED',
  });
  assert.equal(out.ready, false);
  assert.equal(out.reason, 'AGENT_ORIGIN_PROOF_NOT_DURABLE');
});
