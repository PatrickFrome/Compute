import crypto from 'node:crypto';
import { DEFAULT_PERCEPTION_LIMITS, PERCEPTION_COMPUTED_STYLES, compileSemanticSnapshot } from './perception.mjs';
import { assertPerceptionEnvelope, envelopeFromComputeSnapshot } from '../../browser-shared/perception-envelope-v1.mjs';

export function mainLoaderId(frameTreeResult) {
  const loaderId = frameTreeResult?.frameTree?.frame?.loaderId;
  if (typeof loaderId !== 'string' || loaderId.length < 1 || loaderId.length > 512) throw new Error('perception_main_loader_id_invalid');
  return loaderId;
}

export function computeDocumentEpoch({ loaderId, targetId, conversationEpoch, nodeKey }) {
  if (!Buffer.isBuffer(nodeKey) || nodeKey.length < 32) throw new Error('perception_node_key_invalid');
  const material = `${targetId}\0${conversationEpoch}\0${loaderId}`;
  return `doc_${crypto.createHmac('sha256', nodeKey).update(material).digest('hex').slice(0, 32)}`;
}

export async function captureComputePerceptionEnvelope({
  scheduler,
  identity,
  contextId,
  nodeKey,
  limits,
  maxNodes,
  capturedAt = new Date().toISOString()
} = {}) {
  if (!scheduler || typeof scheduler.run !== 'function') throw new Error('perception_scheduler_invalid');
  if (typeof contextId !== 'string' || !contextId) throw new Error('perception_context_id_required');
  const deadlineMs = Number(limits?.deadlineMs ?? DEFAULT_PERCEPTION_LIMITS.deadlineMs);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new Error('perception_deadline_invalid');

  return scheduler.run(identity, async ({ call, sessionGeneration }) => {
    const frameTreeBefore = await call('Page.getFrameTree', {});
    const loaderBefore = mainLoaderId(frameTreeBefore);
    const domSnapshot = await call('DOMSnapshot.captureSnapshot', {
      computedStyles: [...PERCEPTION_COMPUTED_STYLES],
      includePaintOrder: true,
      includeDOMRects: false
    });
    const axTree = await call('Accessibility.getFullAXTree', {});
    const frameTreeAfter = await call('Page.getFrameTree', {});
    const loaderAfter = mainLoaderId(frameTreeAfter);
    if (loaderBefore !== loaderAfter) throw new Error('perception_document_changed_during_capture');

    const compiled = compileSemanticSnapshot({
      domSnapshot,
      axTree,
      identity,
      sessionGeneration,
      nodeKey,
      limits
    });
    const snapshot = { ...compiled.snapshot, captured_at: capturedAt };
    const epoch = computeDocumentEpoch({
      loaderId: loaderBefore,
      targetId: identity.targetId,
      conversationEpoch: identity.conversationEpoch,
      nodeKey
    });
    const envelope = envelopeFromComputeSnapshot(snapshot, { contextId, documentEpoch: epoch, maxNodes });
    return {
      envelope: assertPerceptionEnvelope(envelope),
      snapshot,
      nodeBindings: compiled.nodeBindings,
      documentEpoch: epoch
    };
  }, { deadlineMs });
}

export const COMPUTE_PERCEPTION_LOADER_GUARD = 'PAGE_MAIN_LOADER_SANDWICH_V1';
