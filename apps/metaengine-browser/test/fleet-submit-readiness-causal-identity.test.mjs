import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';


const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function semref(id) {
  return { schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:`semref_${String(id).padEnd(64,'0').slice(0,64)}` };
}

function glmAgentFrame({ model = 'GLM-5.3-Flash', tab_id = 'tab-fleet-1', target_id = 'webcontents:17' } = {}) {
  const target = (name, backend_node_id) => ({ role:'button', name, backend_node_id, semantic_ref:semref(name) });
  return {
    schema:'metaengine.native-browser.perception.v1',
    tab_id,
    target_id,
    url:'https://chat.z.ai/',
    process_incarnation_id:'11111111-2222-4333-8444-555555555555',
    state_revision_id:'rev_'.padEnd(68,'a'),
    viewport:{ width:0, height:0 },
    semantic_targets:[
      { role:'textbox', name:'Send a Message', backend_node_id:3, semantic_ref:semref('composer') },
      target('Agent',3336), target('New Task',3346), target('Select a model',9469),
      target('Full-Stack',11846), target('Writing',11852), target('Data Insight',11858),
    ],
    interaction_tree:{ schema:'metaengine.native-browser.interaction-tree.v1', elements:[{role:'statictext',text:model}] },
    authority_effect:false,
  };
}

const EXPECTED = Object.freeze({
  expected_tab_id: 'tab-fleet-1',
  observed_tab_id: 'tab-fleet-1',
  expected_target_id: 'webcontents:17',
  observed_target_id: 'webcontents:17',
  selected_tab_id: 'tab-fleet-1',
});

test('Fleet submit readiness fails closed when CAPTURE omits tab identity even if caller mirrors the expected lease tab', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  // D-C2: causal-identity failure of the CAPTUREd frame tab is a BINDING
  // failure, not a foreground failure — the caller mirror can never repair a
  // frame that never carried its own tab identity.
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE tab identity drifts even if caller mirrors the expected lease tab', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-2', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('D-C2: ChatGPT lane still fails closed on foreground mismatch with TAB_NOT_FOREGROUND_EXACT', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    selected_tab_id: 'tab-other',
    frame: { tab_id: 'tab-fleet-1', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_NOT_FOREGROUND_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('D-C2: Agent Home is bootstrap evidence only and cannot authorize a task before durable session creation', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform: 'GLM_ZAI',
    phase: 'PRE_TYPE',
    selected_tab_id: 'tab-other',
    frame: glmAgentFrame(),
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'AGENT_ORIGIN_PROOF_NOT_DURABLE');
  assert.equal(readiness.authority_effect, false);
});

test('D-C2: GLM lane still fails closed when the CAPTUREd frame tab drifts from the lease', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform: 'GLM_ZAI',
    phase: 'PRE_TYPE',
    frame: { tab_id: 'tab-fleet-2', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE omits target identity even if caller mirrors the expected lease target', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-1' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TARGET_INCARNATION_MISMATCH');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE target identity drifts even if caller mirrors the expected lease target', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-1', target_id: 'webcontents:18' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TARGET_INCARNATION_MISMATCH');
  assert.equal(readiness.authority_effect, false);
});


test('GLM lane rejects an ordinary z.ai Chat composer without Agent surface proof', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame:{
      ...glmAgentFrame(),
      semantic_targets:[{ role:'textbox', name:'How can I help you today?', backend_node_id:3, semantic_ref:semref('chat-composer') }],
    },
  });
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'AGENT_ORIGIN_PROOF_NOT_DURABLE');
});

test('GLM lane rejects model drift after exact durable Agent-origin proof', () => {
  const url = 'https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc';
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame:{ ...glmAgentFrame({model:'GLM-5.2'}), url },
    agent_transport_proof:{
      schema:'metaengine.browser.fleet-transport-proof.v1',
      tab_id:EXPECTED.expected_tab_id,
      target_id:EXPECTED.expected_target_id,
      generation_epoch:7,
      conversation_url_sha256:sha256(url),
      agent_surface_sha256:'d'.repeat(64),
      proven_at:'2026-09-28T00:00:00.000Z',
      authority_effect:false,
    },
    agent_lifecycle_state:'ACTIVE',
    expected_agent_generation_epoch:7,
  });
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'AGENT_MODEL_MISMATCH');
  assert.equal(readiness.observed_model,'GLM-5.2');
  assert.equal(readiness.required_model,'GLM-5.3-Flash');
});


test('GLM conversation readiness accepts only exact durable Agent-origin evidence for the same conversation', () => {
  const url = 'https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc';
  const frame = {
    ...glmAgentFrame(),
    url,
    semantic_targets: [
      { role:'textbox', name:'Describe your task', backend_node_id:33, semantic_ref:semref('task-composer') },
    ],
    interaction_tree:{ schema:'metaengine.native-browser.interaction-tree.v1', elements:[{role:'statictext',text:'GLM-5.3-Flash'}] },
  };
  const proof = {
    schema:'metaengine.browser.fleet-transport-proof.v1',
    tab_id:EXPECTED.expected_tab_id,
    target_id:EXPECTED.expected_target_id,
    generation_epoch:7,
    conversation_url_sha256:sha256(url),
    agent_surface_sha256:'d'.repeat(64),
    proven_at:'2026-09-28T00:00:00.000Z',
    authority_effect:false,
  };
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame,
    agent_transport_proof:proof,
    agent_lifecycle_state:'ACTIVE',
    expected_agent_generation_epoch:7,
  });
  assert.equal(readiness.ready,true);
  assert.equal(readiness.agent_surface,null);
  assert.equal(readiness.agent_origin_proof.stage,'AGENT_CONVERSATION');
  assert.equal(readiness.agent_origin_proof.agent_surface_sha256,'d'.repeat(64));
});

test('GLM conversation readiness rejects stale or mismatched durable Agent-origin evidence', () => {
  const url = 'https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc';
  const frame = {
    ...glmAgentFrame(),
    url,
    semantic_targets: [
      { role:'textbox', name:'Describe your task', backend_node_id:33, semantic_ref:semref('task-composer') },
    ],
    interaction_tree:{ schema:'metaengine.native-browser.interaction-tree.v1', elements:[{role:'statictext',text:'GLM-5.3-Flash'}] },
  };
  const baseProof = {
    schema:'metaengine.browser.fleet-transport-proof.v1',
    tab_id:EXPECTED.expected_tab_id,
    target_id:EXPECTED.expected_target_id,
    generation_epoch:7,
    conversation_url_sha256:sha256(url),
    agent_surface_sha256:'d'.repeat(64),
    proven_at:'2026-09-28T00:00:00.000Z',
    authority_effect:false,
  };
  for (const proof of [
    { ...baseProof, conversation_url_sha256:'e'.repeat(64) },
    { ...baseProof, agent_surface_sha256:null },
    { ...baseProof, generation_epoch:8 },
  ]) {
    const readiness = evaluateFleetSubmitReadiness({
      ...EXPECTED,
      platform:'GLM_ZAI',
      phase:'PRE_TYPE',
      frame,
      agent_transport_proof:proof,
      agent_lifecycle_state:'ACTIVE',
      expected_agent_generation_epoch:7,
    });
    assert.equal(readiness.ready,false);
    assert.equal(readiness.reason,'AGENT_ORIGIN_PROOF_NOT_DURABLE');
  }
});
