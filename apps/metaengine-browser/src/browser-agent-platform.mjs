// GLM agent platform policy — the single source of truth for the browser
// fleet's inference platform.
//
// Operator directive (2026-09-19): every browser agent runs on GLM 5.3
// (chat.z.ai) instead of ChatGPT. This module owns every platform constant
// the fleet, supervisor and devos task cycles need: hosts, home URL,
// conversation URL shape, auth-redirect surfaces and composer resolution.
// Modules must import these predicates instead of hard-coding hosts so the
// platform stays swappable and auditable in one place.
//
// Live DOM recon (2026-09-19, chat.z.ai):
//   - composer: <textarea id="chat-input"> named only through the localized
//     placeholder ("How can I help you today?"); the name is therefore NOT a
//     stable addressing key — the exact semantic_ref (backend node id) is.
//   - send control: an unnamed button inside a named generic wrapper
//     ("Send Message"); name-based click authority is impossible, submits go
//     through Enter with composer-cleared / new-conversation readback.
//   - models: GLM-5.3 (flagship, login required), GLM-5.3-Flash (default),
//     GLM-5.2; per-session model choice is selected by the operator and
//     persisted by the site — the fleet types into whatever model the
//     signed-in session has selected.
//   - auth surface: https://chat.z.ai/auth (Google / Email / Github).
//   - conversation URLs: https://chat.z.ai/c/<uuid>.

export const AGENT_PLATFORM_SCHEMA = 'metaengine.browser.agent-platform.v1';
export const AGENT_PLATFORM_ID = 'GLM_ZAI';
export const AGENT_PLATFORM_HOSTS = Object.freeze(['chat.z.ai']);
export const AGENT_PLATFORM_HOME_URL = 'https://chat.z.ai/';
export const AGENT_PLATFORM_MODEL = 'GLM-5.3';
export const AGENT_PLATFORM_MODEL_SELECTION = 'OPERATOR_SESSION_DEFAULT';

const CONVERSATION_PATH_RE = /^\/c\/[a-z0-9-]+\/?$/i;
const AUTH_PATH_RE = /^\/auth(\/|$)/i;

function hostnameOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

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

// A fleet conversation surface: https://chat.z.ai/c/<id>.
export function isAgentPlatformConversationUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && isAgentPlatformHost(url.hostname) && CONVERSATION_PATH_RE.test(url.pathname);
}

// The deterministic post-logout destination of every chat.z.ai surface.
export function isAgentPlatformAuthRedirectUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url) && isAgentPlatformHost(url.hostname) && AUTH_PATH_RE.test(url.pathname);
}

// Single-URL classification (metadata only, mirrors the ChatGPT readback):
//   AUTH_REQUIRED        — auth-redirect surface (logged out or challenged)
//   AUTHENTICATED        — a signed-in surface (conversation or root)
//   NOT_AGENT_PLATFORM   — not a GLM agent platform surface at all
export function classifyAgentPlatformAuthUrl(value) {
  if (!isAgentPlatformUrl(value)) return 'NOT_AGENT_PLATFORM';
  return isAgentPlatformAuthRedirectUrl(value) ? 'AUTH_REQUIRED' : 'AUTHENTICATED';
}

// Canonical conversation URL for transport proofs and mesh normalization.
// Throws the fleet's transport-origin/path vocabulary on invalid input.
export function normalizeAgentPlatformConversationUrl(value) {
  const url = parsedUrl(value);
  if (!url || !isAgentPlatformHost(url.hostname)) {
    throw new Error('fleet_transport_conversation_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!CONVERSATION_PATH_RE.test(path)) throw new Error('fleet_transport_conversation_path_invalid');
  return `https://chat.z.ai${path.toLowerCase()}`;
}

// Surface classification for stage-sensitive consumers (fleet bridge, task
// cycles): PRECONVERSATION_ROOT before the first submit, CONVERSATION after.
// Returns null for non-platform URLs.
export function classifyAgentPlatformSurface(value) {
  const url = parsedUrl(value);
  if (!url || !isAgentPlatformHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '') return Object.freeze({ url: AGENT_PLATFORM_HOME_URL, stage: 'PRECONVERSATION_ROOT' });
  if (CONVERSATION_PATH_RE.test(path)) {
    return Object.freeze({ url: `https://chat.z.ai${path.toLowerCase()}`, stage: 'CONVERSATION' });
  }
  return Object.freeze({ url: `https://chat.z.ai${path.toLowerCase()}`, stage: 'OTHER' });
}

// Composer resolution for semantic typing. The GLM composer is a textarea
// whose accessible name is a localized placeholder, so the ONLY stable
// addressing key is the semantic_ref captured from a fresh perception.
// A unique textbox (named or unnamed) on a platform surface resolves;
// zero or multiple textboxes fail closed.
export function resolveAgentPlatformComposer(frame) {
  const rows = Array.isArray(frame?.semantic_targets)
    ? frame.semantic_targets.filter((row) => String(row?.role || '').toLowerCase() === 'textbox')
    : [];
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row?.semantic_ref) return null;
  return Object.freeze({
    role: 'textbox',
    accessible_name: row.name || null,
    semantic_ref: row.semantic_ref,
    backend_node_id: Number(row.backend_node_id || 0) || null,
    selector_mode: row.name ? 'ROLE_NAME_OR_BACKEND_NODE_ID' : 'BACKEND_NODE_ID_REQUIRED',
  });
}

export function agentPlatformSnapshot() {
  return Object.freeze({
    schema: AGENT_PLATFORM_SCHEMA,
    platform: AGENT_PLATFORM_ID,
    hosts: AGENT_PLATFORM_HOSTS,
    home_url: AGENT_PLATFORM_HOME_URL,
    conversation_url_shape: '/c/<id>',
    auth_redirect_path: '/auth',
    model: AGENT_PLATFORM_MODEL,
    model_selection: AGENT_PLATFORM_MODEL_SELECTION,
    composer_addressing: 'SEMANTIC_REF_BACKEND_NODE_ID',
    composer_name_is_localized_placeholder: true,
    submit_path: 'ENTER_KEY_WITH_COMPOSER_CLEARED_OR_NEW_CONVERSATION_READBACK',
    named_control_click_authority: false,
    authority_effect: false,
  });
}
