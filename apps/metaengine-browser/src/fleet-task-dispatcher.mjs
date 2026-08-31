import crypto from 'node:crypto';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';

const TASK_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const COMPOSER_NAMES = Object.freeze(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);

function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function normalizePayload(payload = {}) {
  const taskId = String(payload.task_id || '').trim();
  const agentId = String(payload.agent_id || '').trim().toLowerCase();
  const pointId = String(payload.point_id || '').trim().toLowerCase();
  const baseSha = String(payload.base_sha || '').trim().toLowerCase();
  const prompt = String(payload.prompt || '');
  const generationEpoch = Number(payload.generation_epoch);
  if (!TASK_ID_RE.test(taskId)) throw new Error('fleet_task_id_invalid');
  if (!AGENT_ID_RE.test(agentId)) throw new Error('fleet_task_agent_id_invalid');
  if (!POINT_ID_RE.test(pointId)) throw new Error('fleet_task_point_id_invalid');
  if (!SHA_RE.test(baseSha)) throw new Error('fleet_task_base_sha_invalid');
  if (!Number.isSafeInteger(generationEpoch) || generationEpoch < 1) throw new Error('fleet_task_generation_epoch_invalid');
  if (!prompt || prompt.length > 24000) throw new Error('fleet_task_prompt_invalid');
  return { task_id: taskId, agent_id: agentId, point_id: pointId, base_sha: baseSha, generation_epoch: generationEpoch, prompt };
}
function isConversationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && ['chatgpt.com','www.chatgpt.com'].includes(url.hostname.toLowerCase())
      && /^\/c\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch { return false; }
}
function exactComposer(frame) {
  const rows = (frame?.semantic_targets || []).filter((row) => String(row?.role || '').toLowerCase() === 'textbox' && COMPOSER_NAMES.includes(String(row?.name || '')));
  return rows.length === 1 ? structuredClone(rows[0]) : null;
}

async function requireLiveBoundView({ fleet, getView, tabId, targetId, unavailableReason, mismatchReason }) {
  const view = getView(tabId);
  const webContents = view?.webContents;
  if (!webContents || typeof webContents.isDestroyed !== 'function' || webContents.isDestroyed()) {
    await fleet.onTabClosed(tabId, unavailableReason);
    throw new Error('fleet_task_target_view_unavailable');
  }
  const liveTargetId = `webcontents:${String(webContents.id)}`.toLowerCase();
  if (liveTargetId !== targetId) {
    await fleet.onTabClosed(tabId, mismatchReason);
    throw new Error('fleet_task_target_incarnation_mismatch');
  }
  return view;
}

export async function dispatchFleetTask({
  payload,
  fleet,
  getView,
  publishSnapshot = async () => {},
  captureSemanticFrame,
  executeSemanticCommand,
} = {}) {
  if (!fleet || typeof fleet.onTabClosed !== 'function' || typeof getView !== 'function') throw new Error('fleet_task_runtime_dependencies_invalid');
  if (typeof captureSemanticFrame !== 'function' || typeof executeSemanticCommand !== 'function') throw new Error('fleet_task_control_dependencies_invalid');
  const task = normalizePayload(payload);
  const agent = fleet.snapshot().agents.find((row) => row.agent_id === task.agent_id);
  if (!agent) throw new Error('fleet_task_agent_not_found');
  if (!['BOUND_UNVERIFIED','ACTIVE'].includes(String(agent.lifecycle_state))) throw new Error(`fleet_task_agent_state_invalid:${agent.lifecycle_state}`);
  if (Number(agent.generation_epoch) !== task.generation_epoch) throw new Error('fleet_task_generation_binding_mismatch');
  const tabId = String(agent.tab_id || '');
  const targetId = String(agent.target_id || '').toLowerCase();
  if (!tabId || !targetId) throw new Error('fleet_task_physical_binding_missing');

  let view = await requireLiveBoundView({
    fleet,
    getView,
    tabId,
    targetId,
    unavailableReason: 'DISPATCH_TARGET_UNAVAILABLE_PRE_CAPTURE',
    mismatchReason: 'DISPATCH_TARGET_INCARCATION_MISMATCH_PRE_CAPTURE',
  });

  const pre = await captureSemanticFrame(view.webContents);
  if (chatGptControlCount(pre, 'STOP') > 0) throw new Error('fleet_task_agent_busy_generating');
  const composer = exactComposer(pre);
  if (!composer) throw new Error('fleet_task_composer_not_unique');

  // Re-read the physical tab immediately before the only effect. Capture/model/page data
  // never authorizes this binding. A replaced WebContents persistently fences the agent,
  // increments its generation through FleetProvisioner.onTabClosed(), and aborts dispatch.
  view = await requireLiveBoundView({
    fleet,
    getView,
    tabId,
    targetId,
    unavailableReason: 'DISPATCH_TARGET_UNAVAILABLE_PRE_EFFECT',
    mismatchReason: 'DISPATCH_TARGET_INCARCATION_MISMATCH_PRE_EFFECT',
  });

  let submit = null;
  let post = null;
  try {
    submit = await executeSemanticCommand(view.webContents, {
      action: 'SEMANTIC_TYPE',
      platform: 'CHATGPT',
      payload: {
        role: composer.role,
        accessible_name: composer.name,
        text: task.prompt,
        replace_existing: true,
        submit_after_type: true,
      },
    });
    post = await captureSemanticFrame(view.webContents);
  } finally {
    await publishSnapshot().catch(() => {});
  }

  const stopObserved = chatGptControlCount(post, 'STOP') === 1 || submit?.stop_observed === true;
  const preConversation = isConversationUrl(pre?.url);
  const postConversation = isConversationUrl(post?.url);
  const newConversationObserved = (!preConversation && postConversation) || submit?.new_conversation_observed === true;
  const effectProven = stopObserved || postConversation || String(submit?.effect_state || '').startsWith('PROVEN_');
  const effectState = effectProven
    ? (stopObserved ? 'PROVEN_GENERATING' : 'PROVEN_CONVERSATION')
    : 'AMBIGUOUS_AFTER_ENTER';

  const receipt = {
    schema: 'metaengine.browser.fleet-task-dispatch.v2',
    task_id: task.task_id,
    agent_id: task.agent_id,
    role: agent.role,
    point_id: task.point_id,
    base_sha: task.base_sha,
    generation_epoch: task.generation_epoch,
    tab_id: tabId,
    target_id: targetId,
    prompt_sha256: sha256(task.prompt),
    submit_after_type: true,
    submit_effect_state: submit?.effect_state || null,
    effect_state: effectState,
    stop_observed: stopObserved,
    new_conversation_observed: newConversationObserved,
    post_url_sha256: post?.url ? sha256(post.url) : (submit?.post_url_sha256 || null),
    prompt_included: false,
    selected_tab_mutation: false,
    viewport_geometry_required: false,
    mouse_geometry_required: false,
    page_data_authority: false,
    automatic_retry_allowed: false,
    authority_effect: true,
  };

  if (!effectProven || !postConversation) {
    const error = new Error(effectProven ? 'fleet_task_conversation_readback_missing' : 'fleet_task_send_effect_ambiguous');
    error.receipt = receipt;
    throw error;
  }

  await fleet.markTransportProven({
    agent_id: task.agent_id,
    tab_id: tabId,
    target_id: targetId,
    generation_epoch: task.generation_epoch,
    conversation_url: post.url,
  });
  return { ...receipt, fleet: fleet.snapshot() };
}
