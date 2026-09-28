import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';


function semref(id) {
  return { schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:`semref_${String(id).padEnd(64,'0').slice(0,64)}` };
}

const CONVERSATION = 'https://chat.z.ai/c/11111111-2222-4333-8444-555555555555';
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function agentOriginProof({ tab_id = 'tab-fleet-1', target_id = 'webcontents:17', generation_epoch = 7 } = {}) {
  return {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    tab_id,
    target_id,
    generation_epoch,
    conversation_url: CONVERSATION,
    conversation_url_sha256: sha256(CONVERSATION),
    agent_surface_sha256: 'c'.repeat(64),
    proven_at: '2026-09-28T00:00:00.000Z',
    authority_effect: false,
  };
}

function glmAgentFrame({ model = 'GLM-5.3-Flash', tab_id = 'tab-fleet-1', target_id = 'webcontents:17' } = {}) {
  const target = (name, backend_node_id) => ({ role:'button', name, backend_node_id, semantic_ref:semref(name) });
  return {
    schema:'metaengine.native-browser.perception.v1',
    tab_id,
    target_id,
    url:CONVERSATION,
    process_incarnation_id:'11111111-2222-4333-8444-555555555555',
    state_revision_id:'rev_'.padEnd(68,'a'),
    viewport:{ width:0, height:0 },
    semantic_targets:[
      { role:'textbox', name:'Send a Message', backend_node_id:3, semantic_ref:semref('composer') },
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
  expected_agent_generation_epoch: 7,
  agent_origin_proof: agentOriginProof(),
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

test('D-C2: GLM lane readiness is TAB-SCOPED — a foreground mismatch never fails the submit gate', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform: 'GLM_ZAI',
    phase: 'PRE_TYPE',
    selected_tab_id: 'tab-other',
    frame: glmAgentFrame(),
  });

  // Semantic addressing is geometry-independent and dispatch is tab-scoped.
  // Agent origin comes from the durable promotion proof; AGENT_HOME controls
  // need not remain rendered inside the created conversation.
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, 'READY_FOR_AGENT_TASK_ENTER_SUBMIT');
  assert.equal(readiness.agent_origin_proof.agent_surface_sha256, 'c'.repeat(64));
  assert.equal(readiness.model_proof.model, 'GLM-5.3-Flash');
  assert.equal(readiness.viewport_rendered, false);
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


test('R98 GLM lane rejects a conversation when durable Agent-origin proof is absent', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    agent_origin_proof:null,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame:glmAgentFrame(),
  });
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'AGENT_ORIGIN_PROOF_INVALID');
});

test('R98 GLM lane rejects proof whose exact conversation hash does not match the captured session', () => {
  const bad = agentOriginProof();
  bad.conversation_url_sha256 = 'd'.repeat(64);
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    agent_origin_proof:bad,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame:glmAgentFrame(),
  });
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'AGENT_ORIGIN_PROOF_INVALID');
});

test('GLM lane rejects Agent surface when selected model is GLM-5.2', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform:'GLM_ZAI',
    phase:'PRE_TYPE',
    frame:glmAgentFrame({model:'GLM-5.2'}),
  });
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'AGENT_MODEL_MISMATCH');
  assert.equal(readiness.observed_model,'GLM-5.2');
  assert.equal(readiness.required_model,'GLM-5.3-Flash');
});
