import crypto from 'node:crypto';
import { chatGptControlCount, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';

const TASK_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const COMPOSER_NAMES = Object.freeze(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
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

export async function dispatchFleetTask({
  payload,
  fleet,
  registry,
  getView,
  attachSelected,
  publishSnapshot = async () => {},
  captureSemanticFrame,
  executeSemanticCommand,
  sleep = delay,
} = {}) {
  if (!fleet || !registry || typeof getView !== 'function' || typeof attachSelected !== 'function') throw new Error('fleet_task_runtime_dependencies_invalid');
  if (typeof captureSemanticFrame !== 'function' || typeof executeSemanticCommand !== 'function') throw new Error('fleet_task_control_dependencies_invalid');
  const task = normalizePayload(payload);
  const agent = fleet.snapshot().agents.find((row) => row.agent_id === task.agent_id);
  if (!agent) throw new Error('fleet_task_agent_not_found');
  if (!['BOUND_UNVERIFIED','ACTIVE'].includes(String(agent.lifecycle_state))) throw new Error(`fleet_task_agent_state_invalid:${agent.lifecycle_state}`);
  if (Number(agent.generation_epoch) !== task.generation_epoch) throw new Error('fleet_task_generation_binding_mismatch');
  const tabId = String(agent.tab_id || '');
  const targetId = String(agent.target_id || '').toLowerCase();
  if (!tabId || !targetId) throw new Error('fleet_task_physical_binding_missing');
  const view = getView(tabId);
  if (!view || view.webContents?.isDestroyed?.()) throw new Error('fleet_task_target_view_unavailable');
  const liveTargetId = `webcontents:${String(view.webContents.id)}`.toLowerCase();
  if (liveTargetId !== targetId) throw new Error('fleet_task_target_incarnation_mismatch');

  const pre = await captureSemanticFrame(view.webContents);
  if (chatGptControlCount(pre, 'STOP') > 0) throw new Error('fleet_task_agent_busy_generating');
  const composer = exactComposer(pre);
  if (!composer) throw new Error('fleet_task_composer_not_unique');

  await executeSemanticCommand(view.webContents, {
    action: 'SEMANTIC_TYPE',
    payload: {
      role: composer.role,
      accessible_name: composer.name,
      text: task.prompt,
      replace_existing: true,
    },
  });

  const priorSelected = registry.selected()?.tab_id || null;
  let sendAttempted = false;
  let post = null;
  let sendTarget = null;
  try {
    registry.select(tabId);
    attachSelected();
    await sleep(0);
    await sleep(0);
    const ready = await captureSemanticFrame(view.webContents);
    const viewport = ready?.viewport || {};
    if (!(Number(viewport.width) > 0 && Number(viewport.height) > 0)) throw new Error('fleet_task_selected_view_geometry_unready');
    sendTarget = uniqueChatGptControl(ready, 'SEND');
    if (!sendTarget) throw new Error('fleet_task_send_control_not_unique');
    sendAttempted = true;
    await executeSemanticCommand(view.webContents, {
      action: 'TYPED_CLICK',
      payload: { role: 'button', accessible_name: sendTarget.name },
    });
    await sleep(80);
    post = await captureSemanticFrame(view.webContents);
  } finally {
    if (priorSelected && priorSelected !== tabId) {
      try { registry.select(priorSelected); attachSelected(); } catch {}
    }
    await publishSnapshot().catch(() => {});
  }

  const stopObserved = chatGptControlCount(post, 'STOP') === 1;
  const preConversation = isConversationUrl(pre?.url);
  const postConversation = isConversationUrl(post?.url);
  const newConversationObserved = !preConversation && postConversation;
  const sendControlRemaining = chatGptControlCount(post, 'SEND') > 0;
  const effectProven = stopObserved || newConversationObserved;
  const effectState = effectProven
    ? (stopObserved ? 'PROVEN_GENERATING' : 'PROVEN_NEW_CONVERSATION')
    : (sendAttempted ? 'AMBIGUOUS_AFTER_SEND' : 'NOT_ATTEMPTED');

  const receipt = {
    schema: 'metaengine.browser.fleet-task-dispatch.v1',
    task_id: task.task_id,
    agent_id: task.agent_id,
    role: agent.role,
    point_id: task.point_id,
    base_sha: task.base_sha,
    generation_epoch: task.generation_epoch,
    tab_id: tabId,
    target_id: targetId,
    prompt_sha256: sha256(task.prompt),
    send_control_name: sendTarget?.name || null,
    send_attempted: sendAttempted,
    effect_state: effectState,
    stop_observed: stopObserved,
    new_conversation_observed: newConversationObserved,
    send_control_remaining: sendControlRemaining,
    post_url_sha256: post?.url ? sha256(post.url) : null,
    prompt_included: false,
    page_data_authority: false,
    automatic_retry_allowed: false,
    authority_effect: true,
  };

  if (!effectProven) {
    const error = new Error('fleet_task_send_effect_ambiguous');
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
