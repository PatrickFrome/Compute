import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PLATFORM_BOOTSTRAP_MODE,
  ACTIVE_AGENT_PLATFORM,
  LEGACY_GLM_PLATFORM,
  AGENT_PLATFORM_HOME_URL,
  AGENT_PLATFORM_ID,
  AGENT_PLATFORM_MODEL,
  AGENT_PLATFORM_PROVIDER,
  classifyAgentPlatformAuthUrl,
  classifyAgentPlatformSurface,
  isAgentPlatformAuthRedirectUrl,
  isAgentPlatformConversationUrl,
  isAgentPlatformHost,
  isAgentPlatformUrl,
  normalizeAgentPlatformConversationUrl,
  resolveAgentPlatformComposer,
  resolveAgentPlatformAgentSurface,
  resolveAgentPlatformSelectedModel,
  resolveAgentPlatformNavControl,
  resolveAgentPlatformModelOption,
  agentPlatformSnapshot,
} from '../src/browser-agent-platform.mjs';

const semref = (id) => ({ schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:`semref_${String(id).padEnd(64,'0').slice(0,64)}` });

function rootFrame(overrides = {}) {
  return {
    schema:'metaengine.native-browser.perception.v1',
    url:'https://chatgpt.com/',
    target_id:'webcontents:196',
    process_incarnation_id:'d1fc5af9-de4f-404e-8cc1-92a3e83282e7',
    state_revision_id:'rev_'.padEnd(68,'a'),
    semantic_targets:[
      { role:'textbox', name:'Message ChatGPT', backend_node_id:3, semantic_ref:semref('composer'), value_length:0 },
    ],
    authority_effect:false,
    ...overrides,
  };
}

test('active agent platform is ChatGPT/OpenAI and GLM routing is disabled', () => {
  const snapshot = agentPlatformSnapshot();
  assert.equal(AGENT_PLATFORM_ID, 'CHATGPT');
  assert.equal(ACTIVE_AGENT_PLATFORM, 'CHATGPT');
  assert.equal(LEGACY_GLM_PLATFORM, 'GLM_ZAI');
  assert.equal(AGENT_PLATFORM_PROVIDER, 'OPENAI');
  assert.equal(AGENT_PLATFORM_HOME_URL, 'https://chatgpt.com/');
  assert.equal(AGENT_PLATFORM_MODEL, 'CHATGPT_ACCOUNT_SELECTED');
  assert.equal(AGENT_PLATFORM_BOOTSTRAP_MODE, 'ROOT_COMPOSER_SEED');
  assert.equal(snapshot.legacy_glm_active_routing, false);
  assert.equal(snapshot.submit_path, 'TYPE_WITHOUT_SUBMIT_THEN_FRESH_EXACT_SEND_AND_EVENT_READBACK');
  assert.equal(snapshot.authority_effect, false);
});

test('agent platform host predicates accept ChatGPT only', () => {
  assert.equal(isAgentPlatformHost('chatgpt.com'), true);
  assert.equal(isAgentPlatformHost('WWW.CHATGPT.COM'), true);
  assert.equal(isAgentPlatformHost('chat.z.ai'), false);
  assert.equal(isAgentPlatformUrl('https://chatgpt.com/'), true);
  assert.equal(isAgentPlatformUrl('https://www.chatgpt.com/c/abc-def'), true);
  assert.equal(isAgentPlatformUrl('http://chatgpt.com/'), false);
  assert.equal(isAgentPlatformUrl('https://chat.z.ai/'), false);
});

test('conversation normalization canonicalizes www to chatgpt.com and fails closed elsewhere', () => {
  assert.equal(isAgentPlatformConversationUrl('https://chatgpt.com/c/ABC-def-123/'), true);
  assert.equal(normalizeAgentPlatformConversationUrl('https://www.chatgpt.com/c/ABC-def-123/'), 'https://chatgpt.com/c/abc-def-123');
  assert.throws(() => normalizeAgentPlatformConversationUrl('https://chat.z.ai/c/abc'), /fleet_transport_conversation_origin_invalid/);
  assert.throws(() => normalizeAgentPlatformConversationUrl('https://chatgpt.com/'), /fleet_transport_conversation_path_invalid/);
});

test('ChatGPT auth surfaces are fenced', () => {
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chatgpt.com/auth/login'), true);
  assert.equal(classifyAgentPlatformAuthUrl('https://chatgpt.com/auth/login'), 'AUTH_REQUIRED');
  assert.equal(classifyAgentPlatformAuthUrl('https://chatgpt.com/'), 'AUTHENTICATED');
  assert.equal(classifyAgentPlatformAuthUrl('https://chat.z.ai/auth'), 'NOT_AGENT_PLATFORM');
});

test('surface classifier exposes root and conversation stages for ChatGPT', () => {
  assert.deepEqual(classifyAgentPlatformSurface('https://chatgpt.com/'), { url:'https://chatgpt.com/', stage:'PRECONVERSATION_ROOT' });
  assert.deepEqual(classifyAgentPlatformSurface('https://www.chatgpt.com/c/abc-def'), { url:'https://chatgpt.com/c/abc-def', stage:'CONVERSATION' });
  assert.equal(classifyAgentPlatformSurface('https://chat.z.ai/c/abc'), null);
});

test('root composer is exact role/name/semantic-ref evidence', () => {
  const composer = resolveAgentPlatformComposer(rootFrame());
  assert.equal(composer.role, 'textbox');
  assert.equal(composer.accessible_name, 'Message ChatGPT');
  assert.equal(composer.selector_mode, 'EXACT_CHATGPT_COMPOSER_ROLE_NAME_AND_SEMANTIC_REF');
  assert.equal(resolveAgentPlatformComposer(rootFrame({ semantic_targets:[{ role:'textbox', name:'Search', semantic_ref:semref('x') }] })), null);
  assert.equal(resolveAgentPlatformComposer(rootFrame({ semantic_targets:[
    { role:'textbox', name:'Message ChatGPT', semantic_ref:semref('a') },
    { role:'textbox', name:'Message ChatGPT', semantic_ref:semref('b') },
  ] })), null);
});

test('ChatGPT root produces a durable compatibility origin proof without claiming an exact model', () => {
  const frame = rootFrame();
  const proof = resolveAgentPlatformAgentSurface(frame);
  assert.equal(proof.schema, 'metaengine.browser.agent-platform-surface-proof.v1');
  assert.equal(proof.stage, 'AGENT_HOME');
  assert.equal(proof.platform, 'CHATGPT');
  assert.equal(proof.provider, 'OPENAI');
  assert.equal(proof.target_id, frame.target_id);
  assert.equal(proof.process_incarnation_id, frame.process_incarnation_id);
  assert.equal(proof.state_revision_id, frame.state_revision_id);
  assert.equal(proof.new_task.role, 'textbox');
  assert.deepEqual(proof.template_names, ['CHATGPT_ISOLATED_CONVERSATION','CHATGPT_ROOT_COMPOSER']);

  const model = resolveAgentPlatformSelectedModel(frame);
  assert.equal(model.model, 'CHATGPT_ACCOUNT_SELECTED');
  assert.equal(model.matches_required_model, true);
  assert.equal(model.exact_model_claimed, false);
});

test('legacy z.ai navigation/model controls are not active routing surfaces', () => {
  assert.equal(resolveAgentPlatformNavControl(rootFrame(), 'Agent'), null);
  assert.equal(resolveAgentPlatformModelOption(rootFrame(), 'GLM-5.3-Flash'), null);
  assert.equal(resolveAgentPlatformAgentSurface({ ...rootFrame(), url:'https://chat.z.ai/' }), null);
});
