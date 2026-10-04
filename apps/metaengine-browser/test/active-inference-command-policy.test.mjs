import test from 'node:test';
import assert from 'node:assert/strict';
import { assertActiveInferenceCommandPolicy } from '../src/active-inference-command-policy.mjs';

for (const action of ['SEMANTIC_TYPE','TYPED_CLICK','PRESS_KEY','STOP_GENERATION','NEW_TAB','NAVIGATE','FLEET_RECONCILE','UNKNOWN_LEGACY_EFFECT']) {
  test(`legacy ${action} is refused before Browser actuation`, () => {
    assert.throws(() => assertActiveInferenceCommandPolicy({ action,platform:'GLM_ZAI',payload:{ tab_id:'tab_existing' } }),/legacy_agent_platform_read_only/);
  });
}
test('legacy explicit targets and new z.ai URLs cannot bypass policy by relabeling platform', () => {
  for (const platform of ['CHATGPT',null]) {
    assert.throws(() => assertActiveInferenceCommandPolicy({ action:'SEMANTIC_TYPE',platform },{ target_url:'https://chat.z.ai/c/old-proof' }),/legacy_agent_platform_read_only/);
    assert.throws(() => assertActiveInferenceCommandPolicy({ action:'NEW_TAB',platform,payload:{ url:'https://chat.z.ai/' } }),/legacy_agent_platform_read_only/);
    assert.throws(() => assertActiveInferenceCommandPolicy({ action:'NAVIGATE',platform,payload:{ url:'https://chat.z.ai/c/new' } }),/legacy_agent_platform_read_only/);
  }
});
test('historical legacy observations remain readable and new ChatGPT effects remain admitted', () => {
  for (const action of ['CAPTURE','CAPTURE_VIEW','READ_TRANSCRIPT','TAB_TELEMETRY','POLL']) {
    assert.doesNotThrow(() => assertActiveInferenceCommandPolicy({ action,platform:'GLM_ZAI' },{ target_url:'https://chat.z.ai/c/old' }));
  }
  assert.doesNotThrow(() => assertActiveInferenceCommandPolicy({ action:'SEMANTIC_TYPE',platform:'CHATGPT' },{ target_url:'https://chatgpt.com/c/independent' }));
  assert.doesNotThrow(() => assertActiveInferenceCommandPolicy({ action:'NEW_TAB',platform:'CHATGPT',payload:{ url:'https://chatgpt.com/' } }));
});
