import crypto from 'node:crypto';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import {
  AGENT_PLATFORM_ID,
  AGENT_PLATFORM_MODEL,
  resolveAgentPlatformAgentSurface,
  resolveAgentPlatformComposer,
  resolveAgentPlatformSelectedModel,
  normalizeAgentPlatformConversationUrl,
} from './browser-agent-platform.mjs';

const COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const READINESS_PHASES = new Set(['PRE_TYPE', 'PRE_CLICK']);
const GLM_READINESS_PHASES = new Set(['PRE_TYPE']);
const HASH_RE = /^[a-f0-9]{64}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function durableAgentOriginProof({
  frame,
  proof,
  lifecycle_state,
  expected_tab_id,
  expected_target_id,
  expected_generation_epoch,
} = {}) {
  if (String(lifecycle_state || '') !== 'ACTIVE') return null;
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1' || proof.authority_effect !== false) return null;
  if (String(proof.transport_stage || 'CONVERSATION') !== 'CONVERSATION') return null;
  if (String(proof.tab_id || '') !== String(expected_tab_id || '')) return null;
  if (String(proof.target_id || '').toLowerCase() !== String(expected_target_id || '').toLowerCase()) return null;
  if (!Number.isSafeInteger(Number(expected_generation_epoch))
      || Number(proof.generation_epoch) !== Number(expected_generation_epoch)) return null;
  const conversationHash = String(proof.conversation_url_sha256 || '').toLowerCase();
  const agentSurfaceHash = String(proof.agent_surface_sha256 || '').toLowerCase();
  if (!HASH_RE.test(conversationHash) || !HASH_RE.test(agentSurfaceHash)) return null;
  const provenAt = Date.parse(String(proof.proven_at || ''));
  if (!Number.isFinite(provenAt)) return null;
  let currentUrl = null;
  try {
    currentUrl = normalizeAgentPlatformConversationUrl(frame?.url);
  } catch {
    return null;
  }
  if (sha256(currentUrl) !== conversationHash) return null;
  return Object.freeze({
    schema: 'metaengine.browser.agent-origin-readiness-proof.v1',
    stage: 'AGENT_CONVERSATION',
    conversation_url_sha256: conversationHash,
    agent_surface_sha256: agentSurfaceHash,
    proven_at: String(proof.proven_at),
    authority_effect: false,
  });
}

function exact(frame, role, names) {
  const rows = (frame?.semantic_targets || []).filter((row) => {
    const rowRole = String(row?.role || '').toLowerCase();
    const rowName = String(row?.name || '');
    return rowRole === role && names.has(rowName);
  });
  return rows.length === 1 ? structuredClone(rows[0]) : null;
}

export function evaluateFleetSubmitReadiness({
  frame,
  expected_tab_id,
  observed_tab_id,
  expected_target_id,
  observed_target_id,
  selected_tab_id,
  agent_transport_proof = null,
  agent_lifecycle_state = null,
  expected_agent_generation_epoch = null,
  phase = 'PRE_CLICK',
  platform = 'CHATGPT',
} = {}) {
  const expectedTab = String(expected_tab_id || '');
  const frameTab = String(frame?.tab_id || '');
  const observedTab = String(observed_tab_id || '');
  const expectedTarget = String(expected_target_id || '').toLowerCase();
  const frameTarget = String(frame?.target_id || '').toLowerCase();
  const observedTarget = String(observed_target_id || '').toLowerCase();
  const selectedTab = String(selected_tab_id || '');
  const readinessPhase = String(phase || 'PRE_CLICK').toUpperCase();
  const semanticPlatform = String(platform || 'CHATGPT').toUpperCase();
  const glmLane = semanticPlatform === AGENT_PLATFORM_ID;
  const phases = glmLane ? GLM_READINESS_PHASES : READINESS_PHASES;

  if (!phases.has(readinessPhase)) {
    return Object.freeze({ ready: false, reason: glmLane ? 'GLM_LANE_IS_SINGLE_PHASE_PRE_TYPE_ONLY' : 'READINESS_PHASE_INVALID', authority_effect: false });
  }
  // D-C2 (2026-09-19): readiness is TAB-SCOPED on the GLM lane. The GLM lane
  // never required foreground selection in effect (D-S2: the bootstrap types
  // and Enter-submits on unselected, unrendered tabs — semantic addressing is
  // geometry-independent), and the dispatch no longer grabs SELECT_TAB, so a
  // foreground mismatch is reported as an observation instead of failing the
  // submit gate. The legacy ChatGPT lane keeps its foreground gate untouched.
  const foreground = selectedTab === expectedTab;
  if (!glmLane && selectedTab && selectedTab !== expectedTab) {
    return Object.freeze({ ready: false, reason: 'TAB_NOT_FOREGROUND_EXACT', authority_effect: false });
  }
  if (!expectedTab || !frameTab || frameTab !== expectedTab || observedTab !== expectedTab) {
    return Object.freeze({ ready: false, reason: 'TAB_BINDING_NOT_EXACT', foreground, authority_effect: false });
  }
  if (!expectedTarget || !frameTarget || frameTarget !== expectedTarget || observedTarget !== expectedTarget) {
    return Object.freeze({ ready: false, reason: 'TARGET_INCARNATION_MISMATCH', foreground, authority_effect: false });
  }
  const width = Number(frame?.viewport?.width || 0);
  const height = Number(frame?.viewport?.height || 0);

  // GLM agent platform lane: chat.z.ai exposes no named STOP/SEND controls, so
  // readiness is the exact foreground/incarnation binding plus a unique textbox
  // composer addressable through its semantic_ref. Submit is the SEMANTIC_TYPE
  // Enter path with composer-cleared / new-conversation readback inside the
  // native control contract — there is no PRE_CLICK phase.
  //
  // D-S2 (live-proven 2026-09-19): fleet agent tabs carry no DevOS surface pane
  // until their first conversation exists, so their captured viewport is 0x0
  // while the CDP semantic lane stays fully functional — the supervisor
  // bootstrap already types and Enter-submits on unselected, unrendered tabs
  // (semantic addressing is geometry-independent by design). The viewport is
  // therefore reported as an observation, never as a GLM submit gate.
  if (glmLane) {
    const agentSurface = resolveAgentPlatformAgentSurface(frame);
    const agentOrigin = durableAgentOriginProof({
      frame,
      proof: agent_transport_proof,
      lifecycle_state: agent_lifecycle_state,
      expected_tab_id: expectedTab,
      expected_target_id: expectedTarget,
      expected_generation_epoch: expected_agent_generation_epoch,
    });
    // A visible Agent Home is discovery/bootstrap evidence, not task-dispatch
    // authority. Normal work starts only after the wrapper has created a real
    // Agent session and persisted its exact origin proof against this current
    // conversation URL. This keeps "Agent UI is visible" distinct from
    // "this conversation is a canonical METAENGINE Agent session".
    if (!agentOrigin) {
      return Object.freeze({ ready: false, reason: 'AGENT_ORIGIN_PROOF_NOT_DURABLE', foreground, authority_effect: false });
    }
    const modelProof = resolveAgentPlatformSelectedModel(frame);
    if (!modelProof) {
      return Object.freeze({ ready: false, reason: 'AGENT_MODEL_NOT_PROVEN', foreground, authority_effect: false });
    }
    if (modelProof.model !== AGENT_PLATFORM_MODEL || modelProof.matches_required_model !== true) {
      return Object.freeze({
        ready: false,
        reason: 'AGENT_MODEL_MISMATCH',
        observed_model: modelProof.model,
        required_model: AGENT_PLATFORM_MODEL,
        foreground,
        authority_effect: false,
      });
    }
    const composer = resolveAgentPlatformComposer(frame);
    if (!composer) {
      return Object.freeze({ ready: false, reason: 'AGENT_TASK_COMPOSER_NOT_UNIQUE', foreground, authority_effect: false });
    }
    return Object.freeze({
      ready: true,
      reason: 'READY_FOR_AGENT_TASK_ENTER_SUBMIT',
      phase: readinessPhase,
      platform: AGENT_PLATFORM_ID,
      agent_surface: agentSurface,
      agent_origin_proof: agentOrigin,
      model_proof: modelProof,
      composer,
      send_control: null,
      viewport: Object.freeze({ width, height }),
      viewport_rendered: width > 0 && height > 0,
      submit_strategy: 'AGENT_UI_TYPE_WITH_ENTER_SUBMIT_READBACK',
      send_required_before_type: false,
      send_required_before_click: false,
      named_send_control_exists: false,
      automatic_retry_allowed: false,
      page_data_authority: false,
      authority_effect: false,
    });
  }
  if (!(width > 0 && height > 0)) {
    return Object.freeze({ ready: false, reason: 'VIEWPORT_NOT_RENDERABLE', authority_effect: false });
  }

  if (chatGptControlCount(frame, 'STOP') > 0) {
    return Object.freeze({ ready: false, reason: 'GENERATION_ALREADY_ACTIVE', authority_effect: false });
  }
  const composer = exact(frame, 'textbox', COMPOSER_NAMES);
  if (!composer) {
    return Object.freeze({ ready: false, reason: 'COMPOSER_NOT_UNIQUE', authority_effect: false });
  }

  // On the current ChatGPT root, an empty composer may not expose the Send
  // control until text exists. PRE_TYPE is therefore a zero-effect readiness
  // phase: prove exact foreground/incarnation/viewport/composer, type without
  // submitting, then require a fresh unique Send at PRE_CLICK. This preserves
  // the single click effect barrier and never relaxes post-type Send fencing.
  let send = null;
  if (readinessPhase === 'PRE_CLICK') {
    if (chatGptControlCount(frame, 'SEND') !== 1) {
      return Object.freeze({ ready: false, reason: 'SEND_CONTROL_NOT_UNIQUE', authority_effect: false });
    }
    send = (frame?.semantic_targets || []).find((row) => String(row?.role || '').toLowerCase() === 'button'
      && chatGptControlCount({ semantic_targets: [row] }, 'SEND') === 1);
    if (!send) return Object.freeze({ ready: false, reason: 'SEND_CONTROL_NOT_UNIQUE', authority_effect: false });
  }

  return Object.freeze({
    ready: true,
    reason: readinessPhase === 'PRE_TYPE' ? 'READY_FOR_TYPE_THEN_SEND_REOBSERVE' : 'READY_FOR_TWO_PHASE_SEND',
    phase: readinessPhase,
    platform: 'CHATGPT',
    composer,
    send_control: send ? structuredClone(send) : null,
    viewport: Object.freeze({ width, height }),
    submit_strategy: 'TYPE_WITHOUT_SUBMIT_THEN_TYPED_CLICK_SEND',
    send_required_before_type: false,
    send_required_before_click: true,
    automatic_retry_allowed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}
