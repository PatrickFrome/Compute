import crypto from 'node:crypto';
import { isAgentPlatformUrl, isAgentPlatformAuthRedirectUrl, resolveAgentPlatformComposer } from './browser-agent-platform.mjs';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

// One draft mutation, a fresh exact readback, then one Send effect. A missing
// effect proof is ambiguous and never creates an Enter/click fallback.
export async function submitFencedChatGptPrompt({ executeCommand, tab_id, frame, text, validateTypedFrame = null, beforeType = null, beforeSend = null } = {}) {
  const tabId = String(tab_id || '');
  const targetId = String(frame?.target_id || '').toLowerCase();
  const prompt = String(text || '');
  const assertFrame = (row) => {
    if (!tabId || String(row?.tab_id || '') !== tabId) throw new Error('chatgpt_submit_tab_binding_mismatch');
    if (!targetId || String(row?.target_id || '').toLowerCase() !== targetId) throw new Error('chatgpt_submit_target_binding_mismatch');
    if (!isAgentPlatformUrl(row?.url) || isAgentPlatformAuthRedirectUrl(row?.url)) throw new Error('chatgpt_submit_origin_invalid');
    if (String(row.url) !== String(frame.url)) throw new Error('chatgpt_submit_conversation_drift');
    if (frame.process_incarnation_id && row.process_incarnation_id !== frame.process_incarnation_id) throw new Error('chatgpt_submit_process_incarnation_drift');
    if (chatGptControlCount(row, 'STOP') > 0) throw new Error('chatgpt_submit_generation_already_active');
    const composer = resolveAgentPlatformComposer(row);
    if (!composer || composer.legacy_compatibility === true) throw new Error('chatgpt_submit_composer_not_unique');
    return composer;
  };
  const composer = assertFrame(frame);
  if (!prompt || prompt.length > 120000) throw new Error('chatgpt_submit_prompt_invalid');
  // Read-only preflight failures have no effect ambiguity. Persist the caller's
  // replay fence only after preflight, immediately before the first draft write.
  if (beforeType) await beforeType(frame);
  const typed = await executeCommand({ action: 'SEMANTIC_TYPE', platform: 'CHATGPT', payload: {
    tab_id: tabId, role: composer.role, accessible_name: composer.accessible_name,
    semantic_ref: composer.semantic_ref, text: prompt, replace_existing: true, submit_after_type: false,
  } });
  if (typed?.suppressed === true) throw new Error(String(typed.reason || 'SEMANTIC_SUBMIT_SUPPRESSED'));
  const typedFrame = await executeCommand({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: tabId } });
  const typedComposer = assertFrame(typedFrame);
  const promptHash = sha256(prompt);
  if (typedComposer.value_length !== prompt.length || typedComposer.value_sha256 !== promptHash) throw new Error('chatgpt_submit_typed_draft_not_exact');
  if (chatGptControlCount(typedFrame, 'SEND') !== 1) throw new Error('chatgpt_submit_send_not_unique');
  const send = (typedFrame.semantic_targets || []).find((row) => String(row?.role || '').toLowerCase() === 'button' && chatGptControlCount({ semantic_targets: [row] }, 'SEND') === 1);
  if (!send?.semantic_ref) throw new Error('chatgpt_submit_send_semantic_ref_required');
  if (validateTypedFrame) await validateTypedFrame(typedFrame);
  if (beforeSend) await beforeSend(typedFrame);
  return executeCommand({ action: 'TYPED_CLICK', platform: 'CHATGPT', payload: {
    tab_id: tabId, role: 'button', accessible_name: send.name, semantic_ref: send.semantic_ref,
    chatgpt_submit: true, prompt_sha256: promptHash, prompt_length: prompt.length,
  } });
}
