const freeze = (value) => Object.freeze(value);
const rows = (items) => freeze(items.map((item) => freeze({ ...item, values: item.values ? freeze([...item.values]) : undefined })));

export const CHATGPT_CONTROL_PROFILE_VERSION = '1.0.0-dev.1';

export const CHATGPT_SETTING_SPECS = rows([
  { id: 'appearance', section: 'GENERAL', effect: 'ACCOUNT_OR_DEVICE_SETTING', values: ['system','light','dark'], readback_required: true },
  { id: 'contrast', section: 'GENERAL', effect: 'ACCOUNT_SETTING', values: ['system','medium','increased'], readback_required: true },
  { id: 'accent_color', section: 'GENERAL', effect: 'ACCOUNT_SETTING', values: ['default','blue','green','yellow','pink','orange','purple','black','white'], readback_required: true },
  { id: 'language', section: 'GENERAL', effect: 'ACCOUNT_SETTING', values: null, readback_required: true },
  { id: 'personality', section: 'PERSONALIZATION', effect: 'ACCOUNT_SETTING', values: null, readback_required: true },
  { id: 'custom_instructions', section: 'PERSONALIZATION', effect: 'ACCOUNT_SETTING', values: null, readback_required: true, max_chars_hint: 5000 },
  { id: 'memory_enabled', section: 'PERSONALIZATION', effect: 'ACCOUNT_SETTING', values: ['on','off'], readback_required: true },
  { id: 'reference_chat_history', section: 'PERSONALIZATION', effect: 'ACCOUNT_SETTING', values: ['on','off'], readback_required: true },
  { id: 'improve_model_for_everyone', section: 'DATA_CONTROLS', effect: 'ACCOUNT_PRIVACY_SETTING', values: ['on','off'], readback_required: true },
  { id: 'location_services', section: 'DATA_CONTROLS', effect: 'ACCOUNT_PRIVACY_SETTING', values: ['on','off'], readback_required: true },
]);

export const CHATGPT_MODE_SURFACES = rows([
  { id: 'model_reasoning', surface: 'COMPOSER_MODEL_PICKER', values: ['instant','medium','high','extra_high','pro_standard','pro_extended'], availability: 'DISCOVER_AT_RUNTIME' },
  { id: 'search', surface: 'COMPOSER_TOOLS', values: ['auto','search'], availability: 'DISCOVER_AT_RUNTIME' },
  { id: 'temporary_chat', surface: 'CHAT_MODE', values: ['regular','temporary'], availability: 'DISCOVER_AT_RUNTIME' },
]);

export const CHATGPT_WORKSPACE_SURFACES = rows([
  { id: 'project_instructions', surface: 'PROJECT_SETTINGS', effect: 'PROJECT_SETTING', availability: 'DISCOVER_AT_RUNTIME' },
  { id: 'apps_plugins', surface: 'SETTINGS_APPS_PLUGINS', effect: 'ACCOUNT_INTEGRATION_SETTING', availability: 'DISCOVER_AT_RUNTIME', auth_boundary: 'USER_MEDIATED_OAUTH' },
  { id: 'memory_summary', surface: 'PERSONALIZATION_MEMORY', effect: 'READ_ONLY_OR_EXPLICIT_EDIT', availability: 'DISCOVER_AT_RUNTIME' },
]);

export const CHATGPT_ADAPTER_POLICY = freeze({
  schema: 'metaengine.chatgpt-control-profile.v1',
  discover_before_act: true,
  exact_visible_option_only: true,
  readback_after_mutation: true,
  css_xpath_is_primary: false,
  accessibility_semantics_primary: true,
  page_text_has_authority: false,
  no_hidden_internal_api_dependency: true,
  no_secret_capture: true,
  oauth_is_user_mediated: true,
  destructive_account_actions_require_explicit_user_intent: true,
  authority_effect: false,
});

export function chatGptControlProfile() {
  return freeze({
    schema: 'metaengine.chatgpt-control-profile.v1',
    version: CHATGPT_CONTROL_PROFILE_VERSION,
    settings: CHATGPT_SETTING_SPECS.map((row) => ({ ...row, values: row.values ? [...row.values] : null })),
    modes: CHATGPT_MODE_SURFACES.map((row) => ({ ...row, values: row.values ? [...row.values] : null })),
    workspaces: CHATGPT_WORKSPACE_SURFACES.map((row) => ({ ...row })),
    policy: { ...CHATGPT_ADAPTER_POLICY },
    authority_effect: false,
  });
}
