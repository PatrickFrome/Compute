import crypto from 'node:crypto';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { SupervisorLifecycleRuntime as CoreSupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime-core.mjs';

const NATIVE_FRAME_SCHEMA = 'metaengine.native-browser.perception.v1';
const CHAT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/c\/[a-z0-9-]+/i;
const CHAT_ROOT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/?$/i;
const clip = (value, max = 180) => String(value ?? '').slice(0, max);

function isNativeFrame(frame) {
  return String(frame?.schema || '') === NATIVE_FRAME_SCHEMA;
}

function isGenerating(frame) {
  return Boolean(frame?.semantic_targets?.some((row) => row?.role === 'button' && chatGptControlMatches('STOP', row?.name)));
}

function exactSelectedTab(state, tabId) {
  const selected = (state?.tabs || []).filter((row) => row?.selected === true);
  return selected.length === 1 && String(selected[0]?.tab_id || '') === String(tabId || '');
}

function positiveViewport(frame) {
  return Number(frame?.viewport?.width || 0) > 0 && Number(frame?.viewport?.height || 0) > 0;
}

function exactIncarnation(before, after, tabId) {
  const expectedTabId = String(tabId || '');
  const beforeProcess = String(before?.process_incarnation_id || '');
  const afterProcess = String(after?.process_incarnation_id || '');
  const beforeTarget = String(before?.target_id || '');
  const afterTarget = String(after?.target_id || '');
  if (!expectedTabId || String(before?.tab_id || '') !== expectedTabId || String(after?.tab_id || '') !== expectedTabId) return false;
  if (!beforeProcess || beforeProcess !== afterProcess) return false;
  if (!beforeTarget || beforeTarget !== afterTarget) return false;
  return String(before?.url || '') === String(after?.url || '');
}

function promptSha(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function promptMarker(text) {
  const match = /(?:^|\n)wake_id=([^\s\n]+)/i.exec(String(text || ''));
  return match ? String(match[1]) : null;
}

function suppressed(action, reason, frame = null) {
  return Object.freeze({
    action,
    suppressed: true,
    reason: String(reason),
    tab_id: frame?.tab_id ? String(frame.tab_id) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function failClosedReadbackFrame(fallback, tabId, error) {
  return {
    schema: NATIVE_FRAME_SCHEMA,
    captured_at: new Date().toISOString(),
    tab_id: String(tabId || fallback?.tab_id || ''),
    process_incarnation_id: fallback?.process_incarnation_id || null,
    target_id: fallback?.target_id || null,
    url: String(fallback?.url || ''),
    title: String(fallback?.title || ''),
    semantic_targets: [],
    text_excerpt: '',
    viewport: fallback?.viewport ? { ...fallback.viewport } : null,
    perception_error: `SEND_READBACK_UNAVAILABLE:${clip(error?.message || error)}`,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function positiveReadback(frame, fence) {
  if (!fence || !isNativeFrame(frame)) return false;
  if (isGenerating(frame)) return true;
  if (fence.marker && String(frame?.text_excerpt || '').includes(fence.marker)) return true;
  return CHAT_ROOT_RE.test(String(fence.pre_url || '')) && CHAT_RE.test(String(frame?.url || ''));
}

export function createSupervisorSendBoundaryExecutor({ getState, executeCommand } = {}) {
  if (typeof getState !== 'function' || typeof executeCommand !== 'function') throw new Error('supervisor_send_boundary_dependencies_required');
  const lastNativeFrame = new Map();
  const promptFence = new Map();
  const readbackFence = new Map();

  const rememberFrame = (tabId, frame) => {
    const id = String(tabId || frame?.tab_id || '');
    if (!id || !isNativeFrame(frame)) return;
    lastNativeFrame.set(id, frame);
    const fence = promptFence.get(id);
    if (positiveReadback(frame, fence)) {
      promptFence.delete(id);
      readbackFence.delete(id);
    }
  };

  const capture = async (command) => {
    const tabId = String(command?.payload?.tab_id || '');
    try {
      const frame = await executeCommand(command);
      rememberFrame(tabId, frame);
      const readback = readbackFence.get(tabId);
      if (readback) {
        readback.remaining -= 1;
        if (readback.remaining <= 0 || positiveReadback(frame, promptFence.get(tabId))) readbackFence.delete(tabId);
      }
      return frame;
    } catch (error) {
      const fence = promptFence.get(tabId);
      const readback = readbackFence.get(tabId);
      if (!fence || !readback) throw error;
      readback.remaining -= 1;
      if (readback.remaining <= 0) readbackFence.delete(tabId);
      return failClosedReadbackFrame(readback.fallback || lastNativeFrame.get(tabId), tabId, error);
    }
  };

  return async function executeWithSupervisorSendBoundary(command) {
    const action = String(command?.action || '');
    const tabId = String(command?.payload?.tab_id || '');

    if (action === 'CAPTURE') return capture(command);

    if (action === 'SEMANTIC_TYPE') {
      const baseline = lastNativeFrame.get(tabId);
      if (!isNativeFrame(baseline)) return executeCommand(command);
      const text = String(command?.payload?.text ?? '');
      const sha = promptSha(text);
      const prior = promptFence.get(tabId);
      if (prior?.prompt_sha256 === sha) {
        return suppressed(action, 'DUPLICATE_PROMPT_TYPE_SUPPRESSED', baseline);
      }
      const fence = {
        prompt_sha256: sha,
        marker: promptMarker(text),
        pre_url: String(baseline?.url || ''),
        phase: 'TYPE_ATTEMPTED',
        attempted_at: new Date().toISOString(),
      };
      promptFence.set(tabId, fence);
      try {
        const result = await executeCommand(command);
        fence.phase = 'TYPED';
        return result;
      } catch (error) {
        fence.phase = 'TYPE_EFFECT_AMBIGUOUS';
        fence.error = clip(error?.message || error);
        return suppressed(action, 'TYPE_EFFECT_AMBIGUOUS', baseline);
      }
    }

    const isSendClick = action === 'TYPED_CLICK'
      && String(command?.payload?.role || '').toLowerCase() === 'button'
      && chatGptControlMatches('SEND', command?.payload?.accessible_name);
    if (!isSendClick) return executeCommand(command);

    const fence = promptFence.get(tabId);
    if (fence?.phase === 'CLICK_ATTEMPTED') {
      return suppressed(action, 'SEND_CLICK_ALREADY_ATTEMPTED', lastNativeFrame.get(tabId));
    }

    let before = null;
    let activated = null;
    const block = (reason, error = null) => {
      if (fence) {
        fence.phase = 'PRECLICK_BLOCKED';
        if (error) fence.error = clip(error?.message || error);
      }
      const fallback = activated || before || lastNativeFrame.get(tabId) || null;
      readbackFence.set(tabId, { remaining: 6, fallback });
      return suppressed(action, reason, fallback);
    };

    try {
      before = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      rememberFrame(tabId, before);
      // Non-native executors are test/model adapters and retain the proven core path.
      // The installed Electron path always exposes metaengine.native-browser.perception.v1.
      if (!isNativeFrame(before)) return executeCommand(command);

      await executeCommand({ action: 'SELECT_TAB', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      const state = await getState();
      if (!exactSelectedTab(state, tabId)) return block('SUPERVISOR_TAB_NOT_EXACTLY_SELECTED');

      activated = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      rememberFrame(tabId, activated);
      if (!isNativeFrame(activated)) return block('SUPERVISOR_NATIVE_FRAME_LOST');
      if (!exactIncarnation(before, activated, tabId)) return block('SUPERVISOR_TARGET_INCARNATION_CHANGED');
      if (!positiveViewport(activated)) return block('SUPERVISOR_VIEWPORT_NOT_VISIBLE');

      const send = uniqueChatGptControl(activated, 'SEND');
      if (!send) return block('SUPERVISOR_SEND_NOT_UNIQUE_AFTER_SELECT');
      if (String(send.name || '') !== String(command?.payload?.accessible_name || '')) return block('SUPERVISOR_SEND_CONTROL_CHANGED');

      if (fence) fence.phase = 'CLICK_ATTEMPTED';
      readbackFence.set(tabId, { remaining: 6, fallback: activated });
      try {
        return await executeCommand(command);
      } catch (error) {
        if (fence) fence.error = clip(error?.message || error);
        return suppressed(action, 'SEND_CLICK_EFFECT_AMBIGUOUS', activated);
      }
    } catch (error) {
      return block('SUPERVISOR_SEND_BOUNDARY_REVALIDATION_FAILED', error);
    }
  };
}

// Static continuity markers retained because the implementation itself remains in
// supervisor-lifecycle-runtime-core.mjs: CHATGPT_CONVERSATION_LIMIT_HINT and
// reason.startsWith('MAX_CYCLES_PER_EPOCH'). The wrapper adds no page authority.
export class SupervisorLifecycleRuntime extends CoreSupervisorLifecycleRuntime {
  constructor(options = {}) {
    const guardedExecute = createSupervisorSendBoundaryExecutor({
      getState: options.getState,
      executeCommand: options.executeCommand,
    });
    super({ ...options, executeCommand: guardedExecute });
  }
}
