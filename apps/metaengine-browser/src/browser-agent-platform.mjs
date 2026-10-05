// ChatGPT agent platform policy — single source of truth for the active
// METAENGINE browser fleet inference surface.
//
// Operator directive (2026-10-04): every active browser agent runs on ChatGPT.
// Z.ai/GLM remains legacy compatibility data only; no new fleet task is routed
// there by this module.
//
// The fleet identity is provider-neutral: agent_id/role/target_id/generation
// remain the authority coordinates. "CHATGPT" is a transport/runtime policy,
// not the agent identity itself.

export const AGENT_PLATFORM_SCHEMA = 'metaengine.browser.agent-platform.v1';
export const ACTIVE_AGENT_PLATFORM = 'CHATGPT';
export const LEGACY_GLM_PLATFORM = 'GLM_ZAI';
export const AGENT_PLATFORM_ID = ACTIVE_AGENT_PLATFORM;
export const AGENT_PLATFORM_PROVIDER = 'OPENAI';
export const AGENT_PLATFORM_HOSTS = Object.freeze(['chatgpt.com', 'www.chatgpt.com']);
export const AGENT_PLATFORM_HOME_URL = 'https://chatgpt.com/';
export const AGENT_PLATFORM_MODEL = 'CHATGPT_ACCOUNT_SELECTED';
export const AGENT_PLATFORM_MODEL_SELECTION = 'ACCOUNT_SESSION_RUNTIME';
export const AGENT_PLATFORM_BOOTSTRAP_MODE = 'ROOT_COMPOSER_SEED';
// Kept as AGENT_HOME for persisted proof-schema compatibility. On ChatGPT this
// means "exact authenticated root composer surface", not the former z.ai
// Agent product page.
export const AGENT_PLATFORM_AGENT_SURFACE_STAGE = 'AGENT_HOME';
export const AGENT_PLATFORM_AGENT_TEMPLATE_NAMES = Object.freeze([]);
export const AGENT_PLATFORM_KNOWN_MODELS = Object.freeze([]);

const CONVERSATION_PATH_RE = /^\/c\/[a-z0-9-]+\/?$/i;
const AUTH_PATH_RE = /^\/auth(\/|$)/i;
const CHATGPT_COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Спросить ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const LEGACY_GLM_HOST = 'chat.z.ai';

function parsedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function isAgentPlatformHost(host) {
  return AGENT_PLATFORM_HOSTS.includes(String(host || '').toLowerCase());
}

export function isAgentPlatformUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && isAgentPlatformHost(url.hostname);
}

export function isLegacyAgentPlatformUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && url.hostname.toLowerCase() === LEGACY_GLM_HOST;
}

export function isAgentPlatformConversationUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && isAgentPlatformHost(url.hostname) && CONVERSATION_PATH_RE.test(url.pathname);
}

export function isAgentPlatformAuthRedirectUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && isAgentPlatformHost(url.hostname) && AUTH_PATH_RE.test(url.pathname);
}

export function classifyAgentPlatformAuthUrl(value) {
  if (!isAgentPlatformUrl(value)) return 'NOT_AGENT_PLATFORM';
  return isAgentPlatformAuthRedirectUrl(value) ? 'AUTH_REQUIRED' : 'AUTHENTICATED';
}

export function normalizeAgentPlatformConversationUrl(value) {
  const url = parsedUrl(value);
  if (!url || !isAgentPlatformHost(url.hostname)) {
    throw new Error('fleet_transport_conversation_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!CONVERSATION_PATH_RE.test(path)) throw new Error('fleet_transport_conversation_path_invalid');
  return `https://chatgpt.com${path.toLowerCase()}`;
}

export function classifyAgentPlatformSurface(value) {
  const url = parsedUrl(value);
  if (!url || !isAgentPlatformHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '') return Object.freeze({ url: AGENT_PLATFORM_HOME_URL, stage: 'PRECONVERSATION_ROOT' });
  if (CONVERSATION_PATH_RE.test(path)) {
    return Object.freeze({ url: `https://chatgpt.com${path.toLowerCase()}`, stage: 'CONVERSATION' });
  }
  return Object.freeze({ url: `https://chatgpt.com${path.toLowerCase()}`, stage: 'OTHER' });
}

function targetProjection(row) {
  if (!row?.semantic_ref) return null;
  return Object.freeze({
    role: String(row.role || '').toLowerCase(),
    accessible_name: row.name == null ? null : String(row.name),
    semantic_ref: row.semantic_ref,
    backend_node_id: Number(row.backend_node_id || 0) || null,
  });
}

export function resolveAgentPlatformComposer(frame) {
  if (!frame || frame.authority_effect === true) return null;

  const url = parsedUrl(frame?.url);
  const activeChatGptSurface = Boolean(url) && isAgentPlatformHost(url.hostname) && !isAgentPlatformAuthRedirectUrl(frame.url);
  const legacyGlmSurface = Boolean(url) && url.hostname.toLowerCase() === LEGACY_GLM_HOST;
  if (url && !activeChatGptSurface && !legacyGlmSurface) return null;

  const rows = Array.isArray(frame?.semantic_targets)
    ? frame.semantic_targets.filter((row) => String(row?.role || '').toLowerCase() === 'textbox')
    : [];
  const usable = rows.filter((row) => row?.semantic_ref);
  if (usable.length === 0) return null;

  // Active ChatGPT actuation is intentionally stricter than the old z.ai
  // textarea contract: exact localized composer name + semantic ref.
  if (activeChatGptSurface) {
    const exact = usable.filter((row) => CHATGPT_COMPOSER_NAMES.has(String(row?.name || '')));
    if (exact.length !== 1) return null;
    const pick = exact[0];
    return Object.freeze({
      role: 'textbox',
      accessible_name: String(pick.name),
      semantic_ref: pick.semantic_ref,
      backend_node_id: Number(pick.backend_node_id || 0) || null,
      selector_mode: 'EXACT_CHATGPT_COMPOSER_ROLE_NAME_AND_SEMANTIC_REF',
      value_length: Number.isFinite(Number(pick.value_length)) ? Number(pick.value_length) : null,
      value_sha256: pick.value_sha256 || null,
    });
  }

  // Legacy compatibility/readback only. Historical GLM qualification tests and
  // persisted evidence can still resolve their old textarea shape, but active
  // routing, URL normalization and target admission remain ChatGPT-only.
  // Missing URL is accepted only for this pure resolver utility so old
  // shape-level unit tests remain meaningful.
  let pick = null;
  if (rows.length === 1 && usable.length === 1) {
    pick = usable[0];
  } else {
    const named = usable.filter((row) => row.name);
    if (named.length === 1) pick = named[0];
  }
  if (!pick) return null;
  return Object.freeze({
    role: 'textbox',
    accessible_name: pick.name || null,
    semantic_ref: pick.semantic_ref,
    backend_node_id: Number(pick.backend_node_id || 0) || null,
    selector_mode: pick.name ? 'ROLE_NAME_OR_BACKEND_NODE_ID' : 'BACKEND_NODE_ID_REQUIRED',
    value_length: Number.isFinite(Number(pick.value_length)) ? Number(pick.value_length) : null,
    value_sha256: pick.value_sha256 || null,
    legacy_compatibility: true,
  });
}

// Compatibility proof for the existing durable origin-proof schema.
// ChatGPT has no separate z.ai-style Agent page. The positive origin is the
// exact root composer on the bound process/target/state revision. template_names
// is retained only so historical proof material stays structurally compatible;
// the values identify capabilities, not z.ai templates.
export function resolveAgentPlatformAgentSurface(frame) {
  const surface = classifyAgentPlatformSurface(frame?.url);
  if (!surface || surface.stage !== 'PRECONVERSATION_ROOT' || frame?.authority_effect === true) return null;
  const composer = resolveAgentPlatformComposer(frame);
  if (!composer) return null;
  const targetId = String(frame.target_id || '').toLowerCase();
  const processIncarnationId = String(frame.process_incarnation_id || '');
  const stateRevisionId = String(frame.state_revision_id || '');
  if (!targetId || !processIncarnationId || !stateRevisionId) return null;
  return Object.freeze({
    schema: 'metaengine.browser.agent-platform-surface-proof.v1',
    stage: AGENT_PLATFORM_AGENT_SURFACE_STAGE,
    platform: AGENT_PLATFORM_ID,
    provider: AGENT_PLATFORM_PROVIDER,
    url: AGENT_PLATFORM_HOME_URL,
    target_id: targetId,
    process_incarnation_id: processIncarnationId,
    state_revision_id: stateRevisionId,
    // devos-native-task-cycle historically activates new_task before the seed.
    // For ChatGPT root bootstrap this is the exact composer focus target; the
    // bootstrap-mode flag causes the runtime to skip that compatibility click.
    new_task: targetProjection(composer),
    template_names: Object.freeze(['CHATGPT_ISOLATED_CONVERSATION', 'CHATGPT_ROOT_COMPOSER']),
    semantic_marker_count: 1,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

// The operator requested ChatGPT, not an exact model SKU. Model selection is
// therefore account/session runtime policy. This proof intentionally makes no
// claim about the hidden serving model.
export function resolveAgentPlatformSelectedModel(frame) {
  if (!frame || frame.authority_effect === true || !isAgentPlatformUrl(frame.url) || isAgentPlatformAuthRedirectUrl(frame.url)) return null;
  return Object.freeze({
    schema: 'metaengine.browser.agent-platform-model-proof.v1',
    model: AGENT_PLATFORM_MODEL,
    required_model: AGENT_PLATFORM_MODEL,
    matches_required_model: true,
    selection_mode: AGENT_PLATFORM_MODEL_SELECTION,
    exact_model_claimed: false,
    target_id: String(frame.target_id || '').toLowerCase() || null,
    process_incarnation_id: String(frame.process_incarnation_id || '') || null,
    state_revision_id: String(frame.state_revision_id || '') || null,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

// Legacy API kept for callers that used z.ai navigation/model controls. The
// active ChatGPT bootstrap does not need either control.
export function resolveAgentPlatformNavControl() {
  return null;
}

export function resolveAgentPlatformModelOption() {
  return null;
}

export function agentPlatformSnapshot() {
  return Object.freeze({
    schema: AGENT_PLATFORM_SCHEMA,
    platform: AGENT_PLATFORM_ID,
    provider: AGENT_PLATFORM_PROVIDER,
    hosts: AGENT_PLATFORM_HOSTS,
    home_url: AGENT_PLATFORM_HOME_URL,
    conversation_url_shape: '/c/<id>',
    auth_redirect_path: '/auth',
    model: AGENT_PLATFORM_MODEL,
    model_selection: AGENT_PLATFORM_MODEL_SELECTION,
    bootstrap_mode: AGENT_PLATFORM_BOOTSTRAP_MODE,
    agent_surface_stage: AGENT_PLATFORM_AGENT_SURFACE_STAGE,
    agent_surface_readiness: 'EXACT_ROOT_CHATGPT_COMPOSER_SAME_REVISION',
    model_readback: 'NO_EXACT_MODEL_CLAIM_ACCOUNT_SESSION_RUNTIME',
    url_is_agent_surface_authority: false,
    composer_addressing: 'EXACT_CHATGPT_ROLE_NAME_PLUS_SEMANTIC_REF',
    composer_name_is_localized_allowlist: true,
    submit_path: 'TYPE_WITHOUT_SUBMIT_THEN_FRESH_EXACT_SEND_AND_EVENT_READBACK',
    named_control_click_authority: 'ONE_SEND_AFTER_EXACT_TYPED_DRAFT_READBACK',
    legacy_glm_active_routing: false,
    authority_effect: false,
  });
}
