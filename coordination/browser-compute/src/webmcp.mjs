import {
  WEBMCP_TOOLS_LIMITS,
  assertWebMcpEnvelope,
  unsupportedWebMcpEnvelope,
  webMcpEnvelopeFromCdpTools
} from '../../browser-shared/webmcp-tools-v1.mjs';
import { computeDocumentEpoch, mainLoaderId } from './perception-envelope.mjs';

const DEFAULT_SETTLE_MS = 60;
const DEFAULT_DEADLINE_MS = 5000;

function mainFrameId(frameTreeResult) {
  const frameId = frameTreeResult?.frameTree?.frame?.id;
  if (typeof frameId !== 'string' || frameId.length < 1 || frameId.length > 512) throw new Error('webmcp_main_frame_id_invalid');
  return frameId;
}

function keyForTool(value) {
  const frameId = typeof value?.frameId === 'string' ? value.frameId : '';
  const name = typeof value?.name === 'string' ? value.name : '';
  if (!frameId || frameId.length > 512 || !name || name.length > 256) throw new Error('webmcp_tool_identity_invalid');
  return `${frameId}\u0000${name}`;
}

function methodUnavailable(error) {
  const message = String(error?.message || error || '');
  return /cdp_error:-32601:/i.test(message) || /method.*not found|wasn['’]?t found/i.test(message);
}

function boundedDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureWebMcpTools({
  scheduler,
  identity,
  contextId,
  nodeKey,
  capturedAt = new Date().toISOString(),
  settleMs = DEFAULT_SETTLE_MS,
  deadlineMs = DEFAULT_DEADLINE_MS,
  maxTools = WEBMCP_TOOLS_LIMITS.maxTools
} = {}) {
  if (!scheduler || typeof scheduler.run !== 'function') throw new Error('webmcp_scheduler_invalid');
  if (typeof contextId !== 'string' || !contextId) throw new Error('webmcp_context_id_required');
  if (!Number.isSafeInteger(settleMs) || settleMs < 0 || settleMs > 500) throw new Error('webmcp_settle_ms_invalid');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 10000) throw new Error('webmcp_deadline_invalid');
  if (!Number.isSafeInteger(maxTools) || maxTools < 1 || maxTools > WEBMCP_TOOLS_LIMITS.maxTools) throw new Error('webmcp_max_tools_invalid');

  return scheduler.run(identity, async ({ call, onEvent }) => {
    const before = await call('Page.getFrameTree', {});
    const loaderBefore = mainLoaderId(before);
    const mainFrame = mainFrameId(before);
    const documentEpoch = computeDocumentEpoch({
      loaderId: loaderBefore,
      targetId: identity.targetId,
      conversationEpoch: identity.conversationEpoch,
      nodeKey
    });
    const tools = new Map();
    let eventError = null;
    let enabled = false;

    const recordError = (error) => {
      if (!eventError) eventError = error instanceof Error ? error : new Error(String(error));
    };
    const stopAdded = onEvent('WebMCP.toolsAdded', (params) => {
      try {
        const rows = params?.tools;
        if (!Array.isArray(rows)) throw new Error('webmcp_tools_added_invalid');
        if (rows.length > maxTools) throw new Error('webmcp_tools_too_many');
        for (const tool of rows) {
          const key = keyForTool(tool);
          tools.set(key, tool);
          if (tools.size > maxTools) throw new Error('webmcp_tools_too_many');
        }
      } catch (error) { recordError(error); }
    });
    const stopRemoved = onEvent('WebMCP.toolsRemoved', (params) => {
      try {
        const rows = params?.tools;
        if (!Array.isArray(rows)) throw new Error('webmcp_tools_removed_invalid');
        for (const tool of rows) tools.delete(keyForTool(tool));
      } catch (error) { recordError(error); }
    });

    try {
      try {
        await call('WebMCP.enable', {});
        enabled = true;
      } catch (error) {
        if (!methodUnavailable(error)) throw error;
        const afterUnsupported = await call('Page.getFrameTree', {});
        if (mainLoaderId(afterUnsupported) !== loaderBefore) throw new Error('webmcp_document_changed_during_capture');
        return assertWebMcpEnvelope(unsupportedWebMcpEnvelope({
          targetId: identity.targetId,
          contextId,
          conversationEpoch: identity.conversationEpoch,
          documentEpoch,
          capturedAt
        }));
      }
      if (settleMs) await boundedDelay(settleMs);
      if (eventError) throw eventError;
      const after = await call('Page.getFrameTree', {});
      if (mainLoaderId(after) !== loaderBefore) throw new Error('webmcp_document_changed_during_capture');
      const envelope = webMcpEnvelopeFromCdpTools([...tools.values()], {
        targetId: identity.targetId,
        contextId,
        conversationEpoch: identity.conversationEpoch,
        documentEpoch,
        mainFrameId: mainFrame,
        capturedAt,
        maxTools
      });
      return assertWebMcpEnvelope(envelope);
    } finally {
      stopAdded();
      stopRemoved();
      if (enabled) await call('WebMCP.disable', {}).catch(() => {});
    }
  }, { deadlineMs });
}

export const WEBMCP_DISCOVERY_CDP_METHODS = Object.freeze([
  'Page.getFrameTree',
  'WebMCP.enable',
  'WebMCP.disable'
]);
export const WEBMCP_INVOCATION_EXPOSED_R6A = false;
