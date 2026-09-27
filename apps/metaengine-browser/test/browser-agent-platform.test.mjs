import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PLATFORM_HOME_URL,
  AGENT_PLATFORM_ID,
  AGENT_PLATFORM_MODEL,
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

test('agent platform policy pins GLM 5.3 Flash on chat.z.ai', () => {
  const snapshot = agentPlatformSnapshot();
  assert.equal(snapshot.schema, 'metaengine.browser.agent-platform.v1');
  assert.equal(snapshot.platform, AGENT_PLATFORM_ID);
  assert.equal(AGENT_PLATFORM_ID, 'GLM_ZAI');
  assert.equal(AGENT_PLATFORM_HOME_URL, 'https://chat.z.ai/');
  assert.equal(AGENT_PLATFORM_MODEL, 'GLM-5.3-Flash');
  assert.equal(snapshot.model_selection, 'EXACT_SESSION_MODEL_REQUIRED');
  assert.equal(snapshot.composer_addressing, 'SEMANTIC_REF_BACKEND_NODE_ID');
  assert.equal(snapshot.named_control_click_authority, false);
  assert.equal(snapshot.authority_effect, false);
});

test('agent platform host and URL predicates accept only chat.z.ai over https', () => {
  assert.equal(isAgentPlatformHost('chat.z.ai'), true);
  assert.equal(isAgentPlatformHost('CHAT.Z.AI'), true);
  assert.equal(isAgentPlatformHost('www.chatgpt.com'), false);
  assert.equal(isAgentPlatformHost('chatgpt.com'), false);
  assert.equal(isAgentPlatformUrl('https://chat.z.ai/'), true);
  assert.equal(isAgentPlatformUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'), true);
  assert.equal(isAgentPlatformUrl('http://chat.z.ai/'), false);
  assert.equal(isAgentPlatformUrl('https://evil.chat.z.ai.attacker.io/'), false);
  assert.equal(isAgentPlatformUrl('not a url'), false);
});

test('agent platform conversation URLs follow the /c/<id> shape', () => {
  assert.equal(isAgentPlatformConversationUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'), true);
  assert.equal(isAgentPlatformConversationUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db/'), true);
  assert.equal(isAgentPlatformConversationUrl('https://chat.z.ai/'), false);
  assert.equal(isAgentPlatformConversationUrl('https://chat.z.ai/auth'), false);
  assert.equal(isAgentPlatformConversationUrl('https://chatgpt.com/c/11111111-2222-3333-4444-555555555555'), false);
});

test('agent platform auth redirect is /auth on chat.z.ai (live recon 2026-09-19)', () => {
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chat.z.ai/auth'), true);
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chat.z.ai/auth?next=%2Fc%2Fabc'), true);
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chat.z.ai/auth/login'), true);
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chat.z.ai/'), false);
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'), false);
  assert.equal(isAgentPlatformAuthRedirectUrl('https://chatgpt.com/auth/login'), false);

  assert.equal(classifyAgentPlatformAuthUrl('https://chat.z.ai/auth'), 'AUTH_REQUIRED');
  assert.equal(classifyAgentPlatformAuthUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'), 'AUTHENTICATED');
  assert.equal(classifyAgentPlatformAuthUrl('https://chat.z.ai/'), 'AUTHENTICATED');
  assert.equal(classifyAgentPlatformAuthUrl('https://chatgpt.com/c/abc'), 'NOT_AGENT_PLATFORM');
  assert.equal(classifyAgentPlatformAuthUrl('https://example.com/'), 'NOT_AGENT_PLATFORM');
});

test('agent platform conversation normalization is canonical and fail-closed', () => {
  assert.equal(
    normalizeAgentPlatformConversationUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'),
    'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db',
  );
  assert.equal(
    normalizeAgentPlatformConversationUrl('https://chat.z.ai/c/ABC-def-123/'),
    'https://chat.z.ai/c/abc-def-123',
  );
  assert.throws(() => normalizeAgentPlatformConversationUrl('https://chatgpt.com/c/11111111-2222'), /fleet_transport_conversation_origin_invalid/);
  assert.throws(() => normalizeAgentPlatformConversationUrl('https://chat.z.ai/'), /fleet_transport_conversation_path_invalid/);
  assert.throws(() => normalizeAgentPlatformConversationUrl('https://chat.z.ai/auth'), /fleet_transport_conversation_path_invalid/);
});

test('agent platform surface classification mirrors the fleet stage vocabulary', () => {
  assert.deepEqual(classifyAgentPlatformSurface('https://chat.z.ai/'), { url: 'https://chat.z.ai/', stage: 'PRECONVERSATION_ROOT' });
  assert.deepEqual(
    classifyAgentPlatformSurface('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'),
    { url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db', stage: 'CONVERSATION' },
  );
  assert.deepEqual(classifyAgentPlatformSurface('https://chat.z.ai/auth'), { url: 'https://chat.z.ai/auth', stage: 'OTHER' });
  assert.equal(classifyAgentPlatformSurface('https://chatgpt.com/c/abc'), null);
  assert.equal(classifyAgentPlatformSurface('https://example.com/'), null);
});

test('agent platform composer resolution requires exactly one textbox with a semantic ref', () => {
  const ref = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_'.padEnd(71, '0') };
  const named = resolveAgentPlatformComposer({
    semantic_targets: [
      { role: 'textbox', name: 'How can I help you today?', backend_node_id: 3, semantic_ref: ref },
      { role: 'button', name: 'Select a model', backend_node_id: 5 },
    ],
  });
  assert.equal(named.accessible_name, 'How can I help you today?');
  assert.equal(named.selector_mode, 'ROLE_NAME_OR_BACKEND_NODE_ID');
  assert.equal(named.semantic_ref, ref);

  const unnamed = resolveAgentPlatformComposer({
    semantic_targets: [
      { role: 'textbox', name: null, backend_node_id: 3, semantic_ref: ref },
    ],
  });
  assert.equal(unnamed.accessible_name, null);
  assert.equal(unnamed.selector_mode, 'BACKEND_NODE_ID_REQUIRED');

  assert.equal(resolveAgentPlatformComposer({ semantic_targets: [] }), null);
  assert.equal(resolveAgentPlatformComposer({ semantic_targets: [{ role: 'textbox', name: 'a', backend_node_id: 1 }] }), null);
  assert.equal(resolveAgentPlatformComposer({
    semantic_targets: [
      { role: 'textbox', name: 'a', backend_node_id: 1, semantic_ref: ref },
      { role: 'textbox', name: 'b', backend_node_id: 2, semantic_ref: ref },
    ],
  }), null);
  assert.equal(resolveAgentPlatformComposer(null), null);
});

test('combined chat auth readback watches both chat platforms', async () => {
  const { classifyChatAuthReadbackFromTabs, classifyChatAuthUrl, isChatAuthRedirectUrl } = await import('../src/chatgpt-auth-readback.mjs');
  assert.equal(classifyChatAuthUrl('https://chat.z.ai/auth'), 'AUTH_REQUIRED');
  assert.equal(classifyChatAuthUrl('https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db'), 'AUTHENTICATED');
  assert.equal(classifyChatAuthUrl('https://chatgpt.com/auth/login'), 'AUTH_REQUIRED');
  assert.equal(classifyChatAuthUrl('https://example.com/'), 'NOT_CHAT');
  assert.equal(isChatAuthRedirectUrl('https://chat.z.ai/auth?next=%2Fc%2Fabc'), true);
  assert.equal(isChatAuthRedirectUrl('https://chatgpt.com/auth/login'), true);
  assert.equal(isChatAuthRedirectUrl('https://chat.z.ai/c/abc'), false);

  const mixed = classifyChatAuthReadbackFromTabs([
    { url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db' },
    { url: 'https://chatgpt.com/' },
    { url: 'https://example.com/' },
  ]);
  assert.equal(mixed.schema, 'metaengine.chat-auth-readback.v2');
  assert.equal(mixed.auth_state, 'AUTHENTICATED');
  assert.equal(mixed.agent_platform_tab_count, 1);
  assert.equal(mixed.chatgpt_tab_count, 1);

  const loggedOut = classifyChatAuthReadbackFromTabs([
    { url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db' },
    { url: 'https://chat.z.ai/auth' },
  ]);
  assert.equal(loggedOut.auth_state, 'AUTH_REQUIRED');
  assert.equal(loggedOut.agent_platform_auth_redirect_tab_count, 1);
  assert.deepEqual(loggedOut.auth_redirect_url_samples, ['https://chat.z.ai/auth']);

  const empty = classifyChatAuthReadbackFromTabs([{ url: 'https://example.com/' }]);
  assert.equal(empty.auth_state, 'NO_CHAT_TABS');
});

test('reload auth-redirect gate fences the GLM platform auth surface too', async () => {
  const { reloadBlockedByAuthRedirect } = await import('../src/reload-auth-redirect-gate.mjs');
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chat.z.ai/auth' }), true);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chat.z.ai/auth?next=%2Fc%2Fabc' }), true);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chatgpt.com/auth/login' }), true);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db' }), false);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'NAVIGATE', url: 'https://chat.z.ai/auth' }), false);
});


function semref(id) {
  return {
    schema: 'metaengine.native-browser.semantic-ref.v1',
    semantic_ref_id: `semref_${String(id).padEnd(64, '0').slice(0,64)}`,
  };
}

function liveAgentFrame({ model = 'GLM-5.3-Flash', omit = [] } = {}) {
  const skip = new Set(omit);
  const semantic_targets = [
    ['button','Agent',3336],
    ['button','Chat',3331],
    ['button','New Task',3346],
    ['button','Select a model',9469],
    ['button','Full-Stack',11846],
    ['button','Writing',11852],
    ['button','Data Insight',11858],
    ['button','IM',11841],
  ].filter(([,name]) => !skip.has(name)).map(([role,name,id]) => ({
    role, name, backend_node_id:id, semantic_ref:semref(name),
  }));
  return {
    schema:'metaengine.native-browser.perception.v1',
    url:'https://chat.z.ai/',
    target_id:'webcontents:196',
    process_incarnation_id:'d1fc5af9-de4f-404e-8cc1-92a3e83282e7',
    state_revision_id:'rev_'.padEnd(68,'a'),
    semantic_targets,
    interaction_tree:{
      schema:'metaengine.native-browser.interaction-tree.v1',
      elements:[
        {role:'statictext',text:model},
        {role:'statictext',text:'Create anything you can imagine'},
      ],
    },
    authority_effect:false,
  };
}

test('z.ai Agent SPA readiness is semantic and does not use URL/title guessing', () => {
  const frame = liveAgentFrame();
  const proof = resolveAgentPlatformAgentSurface(frame);
  assert.equal(proof.schema, 'metaengine.browser.agent-platform-surface-proof.v1');
  assert.equal(proof.stage, 'AGENT_HOME');
  assert.equal(proof.url, 'https://chat.z.ai/');
  assert.equal(proof.target_id, 'webcontents:196');
  assert.equal(proof.process_incarnation_id, frame.process_incarnation_id);
  assert.equal(proof.state_revision_id, frame.state_revision_id);
  assert.equal(proof.new_task.accessible_name, 'New Task');
  assert.equal(proof.semantic_marker_count, 5);
  assert.deepEqual(proof.template_names, ['Data Insight','Full-Stack','IM','Writing']);
  assert.equal(proof.execution_authority, false);
  assert.equal(proof.authority_effect, false);
});

test('z.ai Agent SPA proof fails closed without New Task or enough Agent-template controls', () => {
  assert.equal(resolveAgentPlatformAgentSurface(liveAgentFrame({ omit:['New Task'] })), null);
  assert.equal(resolveAgentPlatformAgentSurface(liveAgentFrame({ omit:['Full-Stack','Writing','Data Insight'] })), null);
  const chatLike = liveAgentFrame({ omit:['New Task','Full-Stack','Writing','Data Insight','IM'] });
  assert.equal(resolveAgentPlatformAgentSurface(chatLike), null);
  assert.equal(resolveAgentPlatformAgentSurface({ ...liveAgentFrame(), url:'https://chat.z.ai/auth' }), null);
  assert.equal(resolveAgentPlatformAgentSurface({ ...liveAgentFrame(), authority_effect:true }), null);
});

test('z.ai selected model is exact UI evidence and title branding is not accepted', () => {
  const good = resolveAgentPlatformSelectedModel(liveAgentFrame({ model:'GLM-5.3-Flash' }));
  assert.equal(good.model, 'GLM-5.3-Flash');
  assert.equal(good.matches_required_model, true);
  const wrong = resolveAgentPlatformSelectedModel(liveAgentFrame({ model:'GLM-5.2' }));
  assert.equal(wrong.model, 'GLM-5.2');
  assert.equal(wrong.matches_required_model, false);
  assert.equal(resolveAgentPlatformSelectedModel({
    ...liveAgentFrame(),
    interaction_tree:{ elements:[{role:'statictext',text:'Z.ai - powered by GLM-5.3-Flash'}] },
  }), null);
  assert.equal(resolveAgentPlatformSelectedModel({
    ...liveAgentFrame(),
    interaction_tree:{ elements:[{role:'statictext',text:'GLM-5.2'},{role:'statictext',text:'GLM-5.3-Flash'}] },
  }), null);
});

test('Agent/Chat/model navigation controls resolve only by exact semantic refs', () => {
  const frame = liveAgentFrame();
  assert.equal(resolveAgentPlatformNavControl(frame,'Agent').backend_node_id,3336);
  assert.equal(resolveAgentPlatformNavControl(frame,'Chat').backend_node_id,3331);
  assert.equal(resolveAgentPlatformNavControl(frame,'Select a model').backend_node_id,9469);
  assert.equal(resolveAgentPlatformNavControl(frame,'API'),null);
  assert.equal(resolveAgentPlatformNavControl(liveAgentFrame({ omit:['Agent'] }),'Agent'),null);
});


test('GLM-5.3-Flash model option resolves only as one exact semantic control', () => {
  const frame = liveAgentFrame();
  const single = {
    ...frame,
    semantic_targets:[
      ...frame.semantic_targets,
      { role:'menuitem', name:'GLM-5.3-Flash', backend_node_id:15001, semantic_ref:semref('flash-option') },
    ],
  };
  const option = resolveAgentPlatformModelOption(single);
  assert.equal(option.role,'menuitem');
  assert.equal(option.accessible_name,'GLM-5.3-Flash');
  assert.equal(option.backend_node_id,15001);

  assert.equal(resolveAgentPlatformModelOption({
    ...single,
    semantic_targets:[
      ...single.semantic_targets,
      { role:'button', name:'GLM-5.3-Flash', backend_node_id:15002, semantic_ref:semref('duplicate-flash') },
    ],
  }),null);
  assert.equal(resolveAgentPlatformModelOption(frame),null);
  assert.equal(resolveAgentPlatformModelOption(single,'unknown-model'),null);
});
