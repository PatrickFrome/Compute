import assert from 'node:assert/strict';
import test from 'node:test';
import { browserControlCapabilities, CONTROL_ACTIONS, CONTROL_INVARIANTS, NEXT_CONTROL_ACTIONS } from '../src/browser-control-capabilities.mjs';
import { chatGptControlProfile } from '../src/chatgpt-control-profile.mjs';
import { chatGptControlMatches, chatGptUiControlVocabulary, uniqueChatGptControl } from '../src/chatgpt-ui-controls.mjs';

test('control plane advertises broad typed control without arbitrary eval or raw CDP passthrough', () => {
  const snapshot = browserControlCapabilities();
  assert.equal(snapshot.schema, 'metaengine.browser-control-capabilities.v2');
  assert.equal(snapshot.authority_effect, false);
  assert.ok(CONTROL_ACTIONS.some((row) => row.domain === 'TABS'));
  assert.ok(CONTROL_ACTIONS.some((row) => row.domain === 'PAGE_INPUT'));
  assert.ok(CONTROL_ACTIONS.some((row) => row.domain === 'SELF_UPDATE'));
  const capabilities = CONTROL_ACTIONS.find((row) => row.action === 'CONTROL_CAPABILITIES');
  assert.ok(capabilities);
  assert.equal(capabilities.effect, 'READ_ONLY');
  assert.equal(NEXT_CONTROL_ACTIONS.some((row) => row.action === 'CONTROL_CAPABILITIES'), false);
  assert.ok(NEXT_CONTROL_ACTIONS.some((row) => row.action === 'KEY_PRESS'));
  assert.ok(NEXT_CONTROL_ACTIONS.some((row) => row.action === 'CHATGPT_SET_SETTING'));
  assert.ok(NEXT_CONTROL_ACTIONS.some((row) => row.action === 'WEBMCP_INVOKE'));
  assert.equal(CONTROL_INVARIANTS.arbitrary_eval, false);
  assert.equal(CONTROL_INVARIANTS.raw_cdp_passthrough, false);
  assert.equal(CONTROL_INVARIANTS.os_shell_string_command, false);
  assert.equal(CONTROL_INVARIANTS.page_data_authority, false);
  assert.equal(CONTROL_INVARIANTS.mutating_actions_require_actuation_lease, true);
});

test('planned coordinate fallback remains fenced behind fresh viewport and tab identity', () => {
  for (const action of ['POINTER_CLICK','DRAG']) {
    const row = NEXT_CONTROL_ACTIONS.find((item) => item.action === action);
    assert.ok(row);
    assert.equal(row.effect, 'MUTATING');
    assert.equal(row.fence, 'CAPTURED_VIEWPORT_AND_TAB');
  }
  assert.equal(CONTROL_INVARIANTS.semantic_action_preferred_over_coordinate_action, true);
  assert.equal(CONTROL_INVARIANTS.coordinate_action_requires_fresh_viewport_fence, true);
});

test('ChatGPT adapter is discovery-first and readback-gated for account settings', () => {
  const profile = chatGptControlProfile();
  assert.equal(profile.schema, 'metaengine.chatgpt-control-profile.v1');
  assert.equal(profile.policy.discover_before_act, true);
  assert.equal(profile.policy.exact_visible_option_only, true);
  assert.equal(profile.policy.readback_after_mutation, true);
  assert.equal(profile.policy.no_hidden_internal_api_dependency, true);
  assert.equal(profile.policy.no_secret_capture, true);
  assert.equal(profile.policy.oauth_is_user_mediated, true);
  for (const setting of profile.settings) assert.equal(setting.readback_required, true);
  assert.ok(profile.settings.some((row) => row.id === 'appearance'));
  assert.ok(profile.settings.some((row) => row.id === 'personality'));
  assert.ok(profile.settings.some((row) => row.id === 'custom_instructions'));
  assert.ok(profile.settings.some((row) => row.id === 'memory_enabled'));
  assert.ok(profile.settings.some((row) => row.id === 'improve_model_for_everyone'));
  assert.ok(profile.modes.some((row) => row.id === 'model_reasoning'));
  assert.ok(profile.modes.some((row) => row.id === 'search'));
  assert.ok(profile.workspaces.some((row) => row.id === 'project_instructions'));
  assert.ok(profile.workspaces.some((row) => row.id === 'apps_plugins'));
});

test('ChatGPT UI vocabulary recognizes live and legacy stop controls without broad fuzzy matching', () => {
  const vocabulary = chatGptUiControlVocabulary();
  assert.equal(vocabulary.schema, 'metaengine.chatgpt-ui-control-vocabulary.v1');
  assert.equal(chatGptControlMatches('STOP', 'Stop generating'), true);
  assert.equal(chatGptControlMatches('STOP', 'Stop response'), true);
  assert.equal(chatGptControlMatches('STOP', 'Остановить создание'), true);
  assert.equal(chatGptControlMatches('STOP', 'Остановить ответ'), true);
  assert.equal(chatGptControlMatches('STOP', 'Удалить аккаунт'), false);
  const frame = {
    semantic_targets: [
      { role: 'button', name: 'Остановить ответ', backend_node_id: 42 },
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 43 },
    ],
  };
  assert.deepEqual(uniqueChatGptControl(frame, 'STOP'), { role: 'button', name: 'Остановить ответ', backend_node_id: 42 });
});
