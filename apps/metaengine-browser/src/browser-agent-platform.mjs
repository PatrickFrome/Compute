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
//     GLM-5.2; the fleet target model is GLM-5.3-Flash. The selected session model must
//     be proven from fresh browser perception before task dispatch; page text
//     never grants authority and an unproven/mismatched model is fenced.
//   - auth surface: https://chat.z.ai/auth (Google / Email / Github).
//   - conversation URLs: https://chat.z.ai/c/<uuid>.

export const AGENT_PLATFORM_SCHEMA = 'metaengine.browser.agent-platform.v1';
export const AGENT_PLATFORM_ID = 'GLM_ZAI';
export const AGENT_PLATFORM_HOSTS = Object.freeze(['chat.z.ai']);
export const AGENT_PLATFORM_HOME_URL = 'https://chat.z.ai/';
export const AGENT_PLATFORM_MODEL = 'GLM-5.3-Flash';
export const AGENT_PLATFORM_MODEL_SELECTION = 'EXACT_SESSION_MODEL_REQUIRED';
export const AGENT_PLATFORM_AGENT_SURFACE_STAGE = 'AGENT_HOME';
export const AGENT_PLATFORM_AGENT_TEMPLATE_NAMES = Object.freeze(['Full-Stack','Writing','Data Insight','IM']);
export const AGENT_PLATFORM_KNOWN_MODELS = Object.freeze(['GLM-5.3','GLM-5.3-Flash','GLM-5.2']);

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


function exactSemanticTarget(frame, role, name) {
  const rows = Array.isArray(frame?.semantic_targets)
    ? frame.semantic_targets.filter((row) =>
        String(row?.role || '').toLowerCase() === String(role || '').toLowerCase()
        && String(row?.name || '') === String(name || '')
        && row?.semantic_ref)
    : [];
  return rows.length === 1 ? rows[0] : null;
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

// z.ai Agent is SPA state on the same https://chat.z.ai/ URL as Chat. URL,
// title and selected-tab state therefore cannot prove Agent readiness. The
// minimum positive proof is a unique exact "New Task" control plus at least
// two Agent-template controls observed in the SAME native perception revision.
// The proof is read-only and carries no execution authority.
export function resolveAgentPlatformAgentSurface(frame) {
  if (!frame || frame.authority_effect === true || !isAgentPlatformUrl(frame.url) || isAgentPlatformAuthRedirectUrl(frame.url)) return null;
  const newTask = exactSemanticTarget(frame, 'button', 'New Task');
  if (!newTask) return null;
  const agentNav = exactSemanticTarget(frame, 'button', 'Agent');
  const templates = AGENT_PLATFORM_AGENT_TEMPLATE_NAMES
    .map((name) => ({ name, row: exactSemanticTarget(frame, 'button', name) }))
    .filter(({ row }) => Boolean(row));
  if (templates.length < 2) return null;
  const targetId = String(frame.target_id || '').toLowerCase();
  const processIncarnationId = String(frame.process_incarnation_id || '');
  const stateRevisionId = String(frame.state_revision_id || '');
  if (!targetId || !processIncarnationId || !stateRevisionId) return null;
  return Object.freeze({
    schema: 'metaengine.browser.agent-platform-surface-proof.v1',
    stage: AGENT_PLATFORM_AGENT_SURFACE_STAGE,
    url: String(frame.url || ''),
    target_id: targetId,
    process_incarnation_id: processIncarnationId,
    state_revision_id: stateRevisionId,
    agent_nav: targetProjection(agentNav),
    new_task: targetProjection(newTask),
    template_names: Object.freeze(templates.map(({ name }) => name).sort()),
    semantic_marker_count: 1 + templates.length,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

// The selected model is evidence, not authority. It must be read from the
// current accessibility interaction tree; page title branding is deliberately
// ignored because the live Agent page can say "powered by GLM-5.3-Flash"
// while the selected model control still shows GLM-5.2.
export function resolveAgentPlatformSelectedModel(frame) {
  if (!frame || frame.authority_effect === true || !isAgentPlatformUrl(frame.url)) return null;
  const rows = Array.isArray(frame?.interaction_tree?.elements) ? frame.interaction_tree.elements : [];
  const observed = [...new Set(rows
    .map((row) => String(row?.text || '').trim())
    .filter((text) => AGENT_PLATFORM_KNOWN_MODELS.includes(text)))];
  if (observed.length !== 1) return null;
  return Object.freeze({
    schema: 'metaengine.browser.agent-platform-model-proof.v1',
    model: observed[0],
    required_model: AGENT_PLATFORM_MODEL,
    matches_required_model: observed[0] === AGENT_PLATFORM_MODEL,
    target_id: String(frame.target_id || '').toLowerCase() || null,
    process_incarnation_id: String(frame.process_incarnation_id || '') || null,
    state_revision_id: String(frame.state_revision_id || '') || null,
    page_data_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

export function resolveAgentPlatformNavControl(frame, name) {
  if (!['Agent','Chat','Select a model'].includes(String(name || ''))) return null;
  return targetProjection(exactSemanticTarget(frame, 'button', String(name)));
}

export function resolveAgentPlatformModelOption(frame, model = AGENT_PLATFORM_MODEL) {
  const requested = String(model || '');
  if (!AGENT_PLATFORM_KNOWN_MODELS.includes(requested)) return null;
  const allowedRoles = new Set(['button','menuitem','radio']);
  const rows = Array.isArray(frame?.semantic_targets)
    ? frame.semantic_targets.filter((row) =>
        allowedRoles.has(String(row?.role || '').toLowerCase())
        && String(row?.name || '') === requested
        && row?.semantic_ref)
    : [];
  return rows.length === 1 ? targetProjection(rows[0]) : null;
}

// Composer resolution for semantic typing. The GLM composer is a textarea
// whose accessible name is a localized placeholder, so the ONLY stable
// addressing key is the semantic_ref captured from a fresh perception.
// A unique textbox (named or unnamed) on a platform surface resolves;
// zero or multiple textboxes fail closed.
//
// D-K1 (live 2026-09-19): a signed-in chat.z.ai CONVERSATION surface renders
// an auxiliary unnamed textbox alongside the real composer (live capture:
// composer named "Send a Message" backend node 1770 + an unnamed secondary
// textbox backend node 1864). Every exactly-one-textbox consumer — the
// supervisor keepalive wake send, rollover, ambiguity continuation and the
// fleet task dispatcher — went fail-closed on that surface and the primary
// supervisor loop silently livelocked (WAKE_PENDING -> WAKE_AMBIGUOUS ->
// WAITING every tick, no history, no wake consumed). Resolution policy:
//   1. exactly one textbox with a semantic_ref resolves (unchanged);
//   2. multiple textboxes -> the uniquely NAMED one is the composer
//      (placeholders are localized but always present on the composer);
//   3. anything else (zero, or zero/multiple named) fails closed.
// Unnamed auxiliaries never win the composer role.
export function resolveAgentPlatformComposer(frame) {
  const rows = Array.isArray(frame?.semantic_targets)
    ? frame.semantic_targets.filter((row) => String(row?.role || '').toLowerCase() === 'textbox')
    : [];
  const usable = rows.filter((row) => row?.semantic_ref);
  if (usable.length === 0) return null;
  let pick = null;
  if (rows.length === 1 && usable.length === 1) {
    pick = usable[0];
  } else {
    // Multi-textbox surface: the composer is the uniquely NAMED addressable
    // row. A named-but-unaddressable row (no semantic_ref) means the real
    // composer cannot be typed into — fail closed rather than diverting the
    // effect to an unnamed auxiliary.
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
    agent_surface_stage: AGENT_PLATFORM_AGENT_SURFACE_STAGE,
    agent_surface_readiness: 'NEW_TASK_PLUS_TWO_TEMPLATE_CONTROLS_SAME_REVISION',
    model_readback: 'ACCESSIBILITY_INTERACTION_TREE_EXACT_LABEL',
    url_is_agent_surface_authority: false,
    composer_addressing: 'SEMANTIC_REF_BACKEND_NODE_ID',
    composer_name_is_localized_placeholder: true,
    submit_path: 'ENTER_KEY_WITH_COMPOSER_CLEARED_OR_NEW_CONVERSATION_READBACK',
    named_control_click_authority: false,
    authority_effect: false,
  });
}
