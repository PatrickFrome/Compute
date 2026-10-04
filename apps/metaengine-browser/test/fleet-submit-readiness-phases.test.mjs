import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const semref = { schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:'semref_' + 'a'.repeat(64) };

const proof = Object.freeze({
  schema:'metaengine.browser.fleet-transport-proof.v1',
  tab_id:'tab_fleet_test',
  target_id:'webcontents:17',
  generation_epoch:5,
  conversation_url:CONVERSATION,
  conversation_url_sha256:sha256(CONVERSATION),
  agent_surface_sha256:'b'.repeat(64),
  proven_at:'2026-10-04T00:00:00.000Z',
  authority_effect:false,
});

const exact = Object.freeze({
  expected_tab_id:'tab_fleet_test',
  observed_tab_id:'tab_fleet_test',
  expected_target_id:'webcontents:17',
  observed_target_id:'webcontents:17',
  selected_tab_id:'tab_other',
  expected_agent_generation_epoch:5,
  agent_origin_proof:proof,
  platform:'CHATGPT',
});

const frame = Object.freeze({
  tab_id:'tab_fleet_test',
  target_id:'webcontents:17',
  url:CONVERSATION,
  viewport:{ width:0, height:0 },
  semantic_targets:[{ role:'textbox', name:'Message ChatGPT', semantic_ref:semref, backend_node_id:3 }],
  interaction_tree:{ schema:'metaengine.native-browser.interaction-tree.v1', elements:[] },
  authority_effect:false,
});

test('active ChatGPT PRE_TYPE is tab-scoped and does not require foreground geometry', () => {
  const pre=evaluateFleetSubmitReadiness({ ...exact, frame, phase:'PRE_TYPE' });
  assert.equal(pre.ready,true);
  assert.equal(pre.reason,'READY_FOR_TYPE_THEN_SEND_REOBSERVE');
  assert.equal(pre.platform,'CHATGPT');
  assert.equal(pre.viewport_rendered,false);
  assert.equal(pre.send_control,null);
  assert.equal(pre.send_required_before_type,false);
  assert.equal(pre.send_required_before_click,true);
  assert.equal(pre.automatic_retry_allowed,false);
  assert.equal(pre.authority_effect,false);
});

test('active ChatGPT PRE_CLICK requires a fresh exact Send semantic ref', () => {
  const out=evaluateFleetSubmitReadiness({ ...exact, frame, phase:'PRE_CLICK' });
  assert.equal(out.ready,false);
  assert.equal(out.reason,'SEND_CONTROL_NOT_UNIQUE');
  assert.equal(out.authority_effect,false);
  const ready = evaluateFleetSubmitReadiness({ ...exact, frame: { ...frame, semantic_targets: [...frame.semantic_targets, { role:'button', name:'Send prompt', semantic_ref:semref }] }, phase:'PRE_CLICK' });
  assert.equal(ready.ready,true);
  assert.equal(ready.reason,'READY_FOR_TWO_PHASE_SEND');
  assert.ok(ready.send_control.semantic_ref);
});

test('active ChatGPT PRE_TYPE still requires exact durable origin proof', () => {
  const out=evaluateFleetSubmitReadiness({ ...exact, agent_origin_proof:null, frame, phase:'PRE_TYPE' });
  assert.equal(out.ready,false);
  assert.equal(out.reason,'AGENT_ORIGIN_PROOF_INVALID');
});

test('legacy platform never regains an active single-phase task lane', () => {
  const out = evaluateFleetSubmitReadiness({ ...exact, frame, platform:'GLM_ZAI', phase:'PRE_TYPE' });
  assert.equal(out.ready,false);
  assert.equal(out.reason,'LEGACY_AGENT_PLATFORM_READ_ONLY');
});

test('active ChatGPT generation blocks both readiness phases', () => {
  for (const phase of ['PRE_TYPE','PRE_CLICK']) {
    const out = evaluateFleetSubmitReadiness({ ...exact, frame: { ...frame, semantic_targets: [...frame.semantic_targets, { role:'button', name:'Stop generating' }] }, phase });
    assert.equal(out.ready,false);
    assert.equal(out.reason,'GENERATION_ALREADY_ACTIVE');
  }
});
