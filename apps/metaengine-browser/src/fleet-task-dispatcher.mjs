import crypto from 'node:crypto';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import { evaluateFleetSubmitReadiness } from './fleet-submit-readiness.mjs';

const TASK_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA_RE = /^[a-f0-9]{40}$/;

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

function assertLiveView(getView, tabId, targetId) {
  const view = getView(tabId);
  if (!view || view.webContents?.isDestroyed?.()) throw new Error('fleet_task_target_view_unavailable');
  const liveTargetId = `webcontents:${String(view.webContents.id)}`.toLowerCase();
  if (liveTargetId !== targetId) throw new Error('fleet_task_target_incarnation_mismatch');
  return { view, live_target_id: liveTargetId };
}

function readinessOrThrow({ frame, tabId, targetId, selectedTabId, phase }) {
  const readiness = evaluateFleetSubmitReadiness({
    frame,
    expected_tab_id: tabId,
    observed_tab_id: tabId,
    expected_target_id: targetId,
    observed_target_id: targetId,
    selected_tab_id: selectedTabId,
  });
  if (!readiness.ready) {
    const error = new Error(`fleet_task_submit_not_ready:${phase}:${readiness.reason}`);
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

export async function dispatchFleetTask({
  payload,
  fleet,
  getView,
  selectTab,
  getSelectedTabId,
  publishSnapshot = async () => {},
  captureSemanticFrame,
  executeSemanticCommand,
} = {}) {
  if (!fleet || typeof getView !== 'function') throw new Error('fleet_task_runtime_dependencies_invalid');
  if (typeof selectTab !== 'function' || typeof getSelectedTabId !== 'function') throw new Error('fleet_task_selection_dependencies_invalid');
  if (typeof captureSemanticFrame !== 'function' || typeof executeSemanticCommand !== 'function') throw new Error('fleet_task_control_dependencies_invalid');

  const task = normalizePayload(payload);
  const agent = fleet.snapshot().agents.find((row) => row.agent_id === task.agent_id);
  if (!agent) throw new Error('fleet_task_agent_not_found');
  if (!['BOUND_UNVERIFIED','ACTIVE'].includes(String(agent.lifecycle_state))) throw new Error(`fleet_task_agent_state_invalid:${agent.lifecycle_state}`);
  if (Number(agent.generation_epoch) !== task.generation_epoch) throw new Error('fleet_task_generation_binding_mismatch');

  const tabId = String(agent.tab_id || '');
  const targetId = String(agent.target_id || '').toLowerCase();
  if (!tabId || !targetId) throw new Error('fleet_task_physical_binding_missing');
  assertLiveView(getView, tabId, targetId);

  await selectTab(tabId);
  const selectedAfterSelection = String(await getSelectedTabId() || '');
  if (selectedAfterSelection !== tabId) throw new Error('fleet_task_foreground_selection_unproven');

  const { view, live_target_id: selectedTargetId } = assertLiveView(getView, tabId, targetId);
  const pre = await captureSemanticFrame(view.webContents);
  const preReady = readinessOrThrow({
    frame: pre,
    tabId,
    targetId: selectedTargetId,
    selectedTabId: selectedAfterSelection,
    phase: 'PRE_TYPE',
  });
  const preConversation = isConversationUrl(pre?.url);

  let typed = null;
  let click = null;
  let post = null;
  try {
    typed = await executeSemanticCommand(view.webContents, {
      action: 'SEMANTIC_TYPE',
      platform: 'CHATGPT',
      payload: {
        role: preReady.composer.role,
        accessible_name: preReady.composer.name,
        text: task.prompt,
        replace_existing: true,
        submit_after_type: false,
      },
    });

    const selectedBeforeClick = String(await getSelectedTabId() || '');
    if (selectedBeforeClick !== tabId) throw new Error('fleet_task_foreground_lost_after_type');
    const { view: clickView, live_target_id: clickTargetId } = assertLiveView(getView, tabId, targetId);
    const typedFrame = await captureSemanticFrame(clickView.webContents);
    const typedReady = readinessOrThrow({
      frame: typedFrame,
      tabId,
      targetId: clickTargetId,
      selectedTabId: selectedBeforeClick,
      phase: 'PRE_CLICK',
    });

    click = await executeSemanticCommand(clickView.webContents, {
      action: 'TYPED_CLICK',
      platform: 'CHATGPT',
      payload: {
        role: typedReady.send_control.role,
        accessible_name: typedReady.send_control.name,
      },
    });
    post = await captureSemanticFrame(clickView.webContents);
  } finally {
    await publishSnapshot().catch(() => {});
  }

  const stopObserved = chatGptControlCount(post, 'STOP') === 1;
  const postConversation = isConversationUrl(post?.url);
  const newConversationObserved = !preConversation && postConversation;
  const effectProven = stopObserved || newConversationObserved;
  const effectState = effectProven
    ? (stopObserved ? 'PROVEN_GENERATING' : 'PROVEN_NEW_CONVERSATION')
    : 'AMBIGUOUS_AFTER_CLICK';

  const receipt = {
    schema: 'metaengine.browser.fleet-task-dispatch.v3',
    task_id: task.task_id,
    agent_id: task.agent_id,
    role: agent.role,
    point_id: task.point_id,
    base_sha: task.base_sha,
    generation_epoch: task.generation_epoch,
    tab_id: tabId,
    target_id: targetId,
    prompt_sha256: sha256(task.prompt),
    submit_after_type: false,
    type_effect_observed: typed?.authority_effect === true,
    click_effect_observed: click?.authority_effect === true,
    effect_state: effectState,
    stop_observed: stopObserved,
    new_conversation_observed: newConversationObserved,
    post_url_sha256: post?.url ? sha256(post.url) : null,
    prompt_included: false,
    selected_tab_mutation: true,
    viewport_geometry_required: true,
    mouse_geometry_required: true,
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
