import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import { AGENT_PLATFORM_ID, resolveAgentPlatformComposer } from './browser-agent-platform.mjs';

const COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const READINESS_PHASES = new Set(['PRE_TYPE', 'PRE_CLICK']);
const GLM_READINESS_PHASES = new Set(['PRE_TYPE']);

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
  if (!expectedTab || !frameTab || frameTab !== expectedTab || observedTab !== expectedTab || selectedTab !== expectedTab) {
    return Object.freeze({ ready: false, reason: 'TAB_NOT_FOREGROUND_EXACT', authority_effect: false });
  }
  if (!expectedTarget || !frameTarget || frameTarget !== expectedTarget || observedTarget !== expectedTarget) {
    return Object.freeze({ ready: false, reason: 'TARGET_INCARNATION_MISMATCH', authority_effect: false });
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
    const composer = resolveAgentPlatformComposer(frame);
    if (!composer) {
      return Object.freeze({ ready: false, reason: 'COMPOSER_NOT_UNIQUE', authority_effect: false });
    }
    return Object.freeze({
      ready: true,
      reason: 'READY_FOR_ENTER_SUBMIT',
      phase: readinessPhase,
      platform: AGENT_PLATFORM_ID,
      composer,
      send_control: null,
      viewport: Object.freeze({ width, height }),
      viewport_rendered: width > 0 && height > 0,
      submit_strategy: 'TYPE_WITH_ENTER_SUBMIT_READBACK',
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
