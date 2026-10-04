import crypto from 'node:crypto';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import {
  ACTIVE_AGENT_PLATFORM,
  LEGACY_GLM_PLATFORM,
  AGENT_PLATFORM_MODEL,
  normalizeAgentPlatformConversationUrl,
  resolveAgentPlatformComposer,
  resolveAgentPlatformSelectedModel,
} from './browser-agent-platform.mjs';

const READINESS_PHASES = new Set(['PRE_TYPE', 'PRE_CLICK']);
const HASH_RE = /^[a-f0-9]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function exactAgentOriginProof({ proof, expectedTab, expectedTarget, expectedGeneration, frameUrl } = {}) {
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1' || proof.authority_effect !== false) return null;
  if (String(proof.tab_id || '') !== expectedTab || String(proof.target_id || '').toLowerCase() !== expectedTarget) return null;
  if (Number(proof.generation_epoch) !== Number(expectedGeneration)) return null;
  const agentSurfaceSha256 = String(proof.agent_surface_sha256 || '').toLowerCase();
  const conversationSha256 = String(proof.conversation_url_sha256 || '').toLowerCase();
  if (!HASH_RE.test(agentSurfaceSha256) || !HASH_RE.test(conversationSha256)) return null;
  let proofUrl;
  try {
    proofUrl = normalizeAgentPlatformConversationUrl(proof.conversation_url);
    if (proofUrl !== normalizeAgentPlatformConversationUrl(frameUrl) || sha256(proofUrl) !== conversationSha256) return null;
  } catch { return null; }
  return Object.freeze({
    schema: 'metaengine.browser.agent-origin-readiness-proof.v1', conversation_url: proofUrl,
    conversation_url_sha256: conversationSha256, agent_surface_sha256: agentSurfaceSha256,
    tab_id: expectedTab, target_id: expectedTarget, generation_epoch: Number(expectedGeneration), authority_effect: false,
  });
}

export function evaluateFleetSubmitReadiness({
  frame, expected_tab_id, observed_tab_id, expected_target_id, observed_target_id, selected_tab_id,
  expected_agent_generation_epoch = null, agent_origin_proof = null, phase = 'PRE_CLICK', platform = ACTIVE_AGENT_PLATFORM,
} = {}) {
  const expectedTab = String(expected_tab_id || '');
  const expectedTarget = String(expected_target_id || '').toLowerCase();
  const readinessPhase = String(phase || 'PRE_CLICK').toUpperCase();
  const semanticPlatform = String(platform || ACTIVE_AGENT_PLATFORM).toUpperCase();
  const fail = (reason) => Object.freeze({ ready: false, reason, authority_effect: false });
  // A legacy identifier is never an active lane. Keep the literal independent
  // of the active platform so changing policy cannot select the old Enter path.
  if (semanticPlatform === LEGACY_GLM_PLATFORM) return fail('LEGACY_AGENT_PLATFORM_READ_ONLY');
  if (semanticPlatform !== ACTIVE_AGENT_PLATFORM) return fail('ACTIVE_AGENT_PLATFORM_REQUIRED');
  if (!READINESS_PHASES.has(readinessPhase)) return fail('READINESS_PHASE_INVALID');
  if (!expectedTab || String(frame?.tab_id || '') !== expectedTab || String(observed_tab_id || '') !== expectedTab) return fail('TAB_BINDING_NOT_EXACT');
  if (!expectedTarget || String(frame?.target_id || '').toLowerCase() !== expectedTarget || String(observed_target_id || '').toLowerCase() !== expectedTarget) return fail('TARGET_INCARNATION_MISMATCH');
  const originProof = exactAgentOriginProof({ proof: agent_origin_proof, expectedTab, expectedTarget, expectedGeneration: expected_agent_generation_epoch, frameUrl: frame?.url });
  if (!originProof) return fail('AGENT_ORIGIN_PROOF_INVALID');
  const modelProof = resolveAgentPlatformSelectedModel(frame);
  if (!modelProof || modelProof.model !== AGENT_PLATFORM_MODEL || modelProof.matches_required_model !== true) return fail('AGENT_MODEL_NOT_PROVEN');
  if (chatGptControlCount(frame, 'STOP') > 0) return fail('GENERATION_ALREADY_ACTIVE');
  const composer = resolveAgentPlatformComposer(frame);
  if (!composer || composer.legacy_compatibility === true) return fail('AGENT_TASK_COMPOSER_NOT_UNIQUE');
  let send = null;
  if (readinessPhase === 'PRE_CLICK') {
    if (chatGptControlCount(frame, 'SEND') !== 1) return fail('SEND_CONTROL_NOT_UNIQUE');
    send = (frame?.semantic_targets || []).find((row) => String(row?.role || '').toLowerCase() === 'button' && chatGptControlCount({ semantic_targets: [row] }, 'SEND') === 1);
    if (!send?.semantic_ref) return fail('SEND_CONTROL_SEMANTIC_REF_REQUIRED');
  }
  const width = Number(frame?.viewport?.width || 0);
  const height = Number(frame?.viewport?.height || 0);
  return Object.freeze({
    ready: true, reason: readinessPhase === 'PRE_TYPE' ? 'READY_FOR_TYPE_THEN_SEND_REOBSERVE' : 'READY_FOR_TWO_PHASE_SEND',
    phase: readinessPhase, platform: ACTIVE_AGENT_PLATFORM, foreground: String(selected_tab_id || '') === expectedTab,
    agent_origin_proof: originProof, model_proof: modelProof, composer, send_control: send ? structuredClone(send) : null,
    viewport: Object.freeze({ width, height }), viewport_rendered: width > 0 && height > 0,
    submit_strategy: 'TYPE_WITHOUT_SUBMIT_THEN_TYPED_CLICK_SEND', send_required_before_type: false, send_required_before_click: true,
    automatic_retry_allowed: false, page_data_authority: false, authority_effect: false,
  });
}
