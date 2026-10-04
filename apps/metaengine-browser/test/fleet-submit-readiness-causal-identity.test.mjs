import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

function semref(id) {
  return { schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:`semref_${String(id).padEnd(64,'0').slice(0,64)}` };
}

const CONVERSATION = 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
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
    proven_at: '2026-10-04T00:00:00.000Z',
    authority_effect: false,
  };
}

function activeAgentFrame({ tab_id = 'tab-fleet-1', target_id = 'webcontents:17', viewport = { width:0, height:0 } } = {}) {
  return {
    schema:'metaengine.native-browser.perception.v1',
    tab_id,
    target_id,
    url:CONVERSATION,
    process_incarnation_id:'11111111-2222-4333-8444-555555555555',
    state_revision_id:'rev_'.padEnd(68,'a'),
    viewport,
    semantic_targets:[
      { role:'textbox', name:'Message ChatGPT', backend_node_id:3, semantic_ref:semref('composer') },
    ],
    interaction_tree:{ schema:'metaengine.native-browser.interaction-tree.v1', elements:[] },
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
  platform: 'CHATGPT',
  phase: 'PRE_TYPE',
});

test('active fleet readiness fails closed when CAPTURE omits tab identity', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, frame: { target_id:'webcontents:17' } });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('active fleet readiness fails closed when CAPTURE tab identity drifts', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, frame: activeAgentFrame({ tab_id:'tab-fleet-2' }) });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
});

test('ChatGPT fleet lane is tab-scoped and geometry-independent', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, selected_tab_id:'tab-other', frame:activeAgentFrame() });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, 'READY_FOR_AGENT_TASK_ENTER_SUBMIT');
  assert.equal(readiness.platform, 'CHATGPT');
  assert.equal(readiness.agent_origin_proof.agent_surface_sha256, 'c'.repeat(64));
  assert.equal(readiness.model_proof.model, 'CHATGPT_ACCOUNT_SELECTED');
  assert.equal(readiness.model_proof.exact_model_claimed, false);
  assert.equal(readiness.viewport_rendered, false);
});

test('active fleet lane fails closed when target incarnation drifts', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, frame:activeAgentFrame({ target_id:'webcontents:18' }) });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TARGET_INCARNATION_MISMATCH');
});

test('active fleet lane rejects missing durable origin proof', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, agent_origin_proof:null, frame:activeAgentFrame() });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'AGENT_ORIGIN_PROOF_INVALID');
});

test('active fleet lane rejects a proof whose exact conversation hash does not match', () => {
  const bad = agentOriginProof();
  bad.conversation_url_sha256 = 'd'.repeat(64);
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, agent_origin_proof:bad, frame:activeAgentFrame() });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'AGENT_ORIGIN_PROOF_INVALID');
});

test('active fleet lane has one pre-effect readiness phase', () => {
  const readiness = evaluateFleetSubmitReadiness({ ...EXPECTED, phase:'PRE_CLICK', frame:activeAgentFrame() });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'ACTIVE_AGENT_LANE_IS_SINGLE_PHASE_PRE_TYPE_ONLY');
});
