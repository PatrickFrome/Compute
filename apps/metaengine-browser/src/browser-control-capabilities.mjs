import {
  CONTROL_ACTION_MANIFEST_REVISION,
  publicBrowserControlActions,
} from './control-actions-manifest.mjs';

const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

export const BROWSER_CONTROL_PLANE_VERSION = '2.5.0-dev.1';

export const CONTROL_ACTIONS = freezeRows(publicBrowserControlActions().map((row) => ({
  action: row.action,
  domain: row.domain,
  effect: row.effect,
  backend: row.backend,
})));

export const NEXT_CONTROL_ACTIONS = freezeRows([
  { action: 'KEY_PRESS', domain: 'PAGE_INPUT', effect: 'MUTATING', backend: 'CDP_INPUT' },
  { action: 'POINTER_CLICK', domain: 'PAGE_INPUT', effect: 'MUTATING', backend: 'CDP_INPUT', fence: 'CAPTURED_VIEWPORT_AND_TAB' },
  { action: 'DRAG', domain: 'PAGE_INPUT', effect: 'MUTATING', backend: 'CDP_INPUT', fence: 'CAPTURED_VIEWPORT_AND_TAB' },
  { action: 'SET_ZOOM', domain: 'VIEW', effect: 'MUTATING', backend: 'ELECTRON_WEB_CONTENTS' },
  { action: 'DUPLICATE_TAB', domain: 'TABS', effect: 'MUTATING', backend: 'SHELL_REGISTRY' },
  { action: 'MOVE_TAB', domain: 'TABS', effect: 'MUTATING', backend: 'SHELL_REGISTRY' },
  { action: 'PIN_TAB', domain: 'TABS', effect: 'MUTATING', backend: 'SHELL_REGISTRY' },
  { action: 'MUTE_TAB', domain: 'TABS', effect: 'MUTATING', backend: 'ELECTRON_WEB_CONTENTS' },
  { action: 'SEARCH_WEB', domain: 'SEARCH', effect: 'MUTATING', backend: 'NAVIGATION_PROVIDER' },
  { action: 'FIND_IN_PAGE', domain: 'SEARCH', effect: 'READ_ONLY', backend: 'ELECTRON_WEB_CONTENTS' },
  { action: 'SESSION_STATUS', domain: 'SESSION', effect: 'READ_ONLY', backend: 'ELECTRON_SESSION' },
  { action: 'SET_SITE_PERMISSION', domain: 'SESSION', effect: 'MUTATING', backend: 'ELECTRON_SESSION', fence: 'ORIGIN_AND_PERMISSION_ALLOWLIST' },
  { action: 'SET_PROXY', domain: 'SESSION', effect: 'MUTATING', backend: 'ELECTRON_SESSION', fence: 'TYPED_PROXY_SCHEMA' },
  { action: 'CLEAR_SITE_DATA', domain: 'SESSION', effect: 'MUTATING', backend: 'ELECTRON_SESSION', fence: 'EXACT_ORIGIN' },
  { action: 'CHATGPT_STATUS', domain: 'CHATGPT', effect: 'READ_ONLY', backend: 'SITE_ADAPTER' },
  { action: 'CHATGPT_SET_SETTING', domain: 'CHATGPT', effect: 'MUTATING', backend: 'SITE_ADAPTER', fence: 'DISCOVER_THEN_READBACK' },
  { action: 'CHATGPT_SET_MODE', domain: 'CHATGPT', effect: 'MUTATING', backend: 'SITE_ADAPTER', fence: 'AVAILABLE_OPTION_ONLY' },
  { action: 'CHATGPT_SEARCH', domain: 'CHATGPT', effect: 'MUTATING', backend: 'SITE_ADAPTER', fence: 'VISIBLE_TOOL_ONLY' },
  { action: 'CHATGPT_PROJECT_CONFIGURE', domain: 'CHATGPT', effect: 'MUTATING', backend: 'SITE_ADAPTER', fence: 'EXACT_PROJECT_IDENTITY' },
  { action: 'WEBMCP_LIST', domain: 'PAGE_TOOLS', effect: 'READ_ONLY', backend: 'WEBMCP' },
  { action: 'WEBMCP_INVOKE', domain: 'PAGE_TOOLS', effect: 'MUTATING', backend: 'WEBMCP', fence: 'DECLARED_TOOL_SCHEMA' },
]);

export const CONTROL_INVARIANTS = Object.freeze({
  arbitrary_eval: false,
  raw_cdp_passthrough: false,
  os_shell_string_command: false,
  page_data_authority: false,
  mutating_actions_require_typed_schema: true,
  mutating_actions_require_actuation_lease: true,
  target_tab_identity_required_when_ambiguous: true,
  semantic_action_preferred_over_coordinate_action: true,
  coordinate_action_requires_fresh_viewport_fence: true,
  account_setting_changes_require_readback: true,
  destructive_account_actions_require_explicit_user_intent: true,
  secrets_must_not_be_extracted_from_page: true,
  process_observation_requires_no_actuation_authority: true,
  process_observation_must_not_create_second_command_scheduler: true,
  process_lifecycle_events_are_event_driven: true,
  semantic_observation_is_event_driven: true,
  semantic_observation_uses_persistent_cdp_sessions: true,
  semantic_read_does_not_require_cdp_reattach: true,
  remote_observation_push_is_not_command_authority: true,
  project_internal_safety_gates_owner_overridable: true,
  owner_gate_override_is_durable_and_audited: true,
  external_platform_safety_gates_controlled_by_metaengine: false,
  canonical_action_manifest_required: true,
  capability_revision_required: true,
});

export function browserControlCapabilities() {
  return Object.freeze({
    schema: 'metaengine.browser-control-capabilities.v2',
    version: BROWSER_CONTROL_PLANE_VERSION,
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    implemented: CONTROL_ACTIONS.map((row) => ({ ...row })),
    next: NEXT_CONTROL_ACTIONS.map((row) => ({ ...row })),
    invariants: { ...CONTROL_INVARIANTS },
    authority_effect: false,
  });
}
