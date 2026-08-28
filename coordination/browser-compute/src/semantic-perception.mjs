import crypto from 'node:crypto';
import '../../chat-control-plane/extension/semantic-perception-compiler.js';

const compiler = globalThis.A2_SEMANTIC_PERCEPTION_COMPILER;
if (!compiler?.compileFrame) throw new Error('semantic_compiler_unavailable');

const MAX_AX_NODES = 2000;
const MAX_DOM_RECORDS = 3000;
const MAX_NODE_TEXT = 640;
const ALLOWED_ATTRS = new Set(['id', 'class', 'role', 'aria-label', 'aria-live', 'aria-busy', 'title', 'data-testid', 'contenteditable', 'disabled', 'type']);

const clip = (value, max = MAX_NODE_TEXT) => {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
};

function axValue(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  return Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : null;
}

export function compactAccessibility(tree) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  return nodes.slice(0, MAX_AX_NODES).map((node) => ({
    node_id: node.nodeId || null,
    backend_dom_node_id: node.backendDOMNodeId || null,
    frame_id: node.frameId || null,
    ignored: node.ignored === true,
    role: axValue(node.role),
    name: clip(axValue(node.name) || '', 320),
    value: clip(axValue(node.value) || '', 320),
    properties: Array.isArray(node.properties)
      ? node.properties.slice(0, 32).map((property) => ({ name: property?.name || null, value: axValue(property?.value) }))
      : []
  }));
}

function decodeAttributes(strings, encoded) {
  const out = {};
  if (!Array.isArray(encoded)) return out;
  for (let index = 0; index + 1 < encoded.length; index += 2) {
    const key = strings[encoded[index]];
    if (!ALLOWED_ATTRS.has(key)) continue;
    out[key] = clip(strings[encoded[index + 1]] || '', 320);
  }
  return out;
}

export function compactDomSnapshot(snapshot) {
  const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
  const records = [];
  const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  for (let documentIndex = 0; documentIndex < documents.length && records.length < MAX_DOM_RECORDS; documentIndex += 1) {
    const document = documents[documentIndex] || {};
    const nodes = document.nodes || {};
    const layout = document.layout || {};
    const indexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
    for (let layoutIndex = 0; layoutIndex < indexes.length && records.length < MAX_DOM_RECORDS; layoutIndex += 1) {
      const nodeIndex = indexes[layoutIndex];
      const nodeName = strings[nodes.nodeName?.[nodeIndex]] || '';
      const nodeValue = strings[nodes.nodeValue?.[nodeIndex]] || '';
      const attributes = decodeAttributes(strings, nodes.attributes?.[nodeIndex]);
      if (!nodeValue && !Object.keys(attributes).length && !['BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'A', 'SUMMARY', 'IFRAME'].includes(nodeName)) continue;
      records.push({
        document_index: documentIndex,
        node_index: nodeIndex,
        backend_node_id: nodes.backendNodeId?.[nodeIndex] || null,
        parent_index: nodes.parentIndex?.[nodeIndex] ?? null,
        node_name: nodeName,
        node_value: clip(nodeValue),
        attributes,
        bounds: Array.isArray(layout.bounds?.[layoutIndex]) ? layout.bounds[layoutIndex].slice(0, 4) : null
      });
    }
  }
  return {
    document_count: documents.length,
    visible_records: records,
    visible_record_count: records.length,
    truncated: records.length >= MAX_DOM_RECORDS
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function documentToken(frameTree, processIncarnationId, conversationEpoch) {
  const frame = frameTree?.frameTree?.frame || frameTree?.frame || {};
  return `${Number(conversationEpoch || 1)}:${String(processIncarnationId || 'no-process')}:${String(frame.id || 'no-frame')}:${String(frame.loaderId || 'no-loader')}`;
}

export async function captureSemanticFrame({
  cdp,
  cdpTargetId,
  targetId,
  contextId = 'default',
  conversationEpoch = 1,
  processIncarnationId,
  previousFrame = null,
  nodeBudget = 80,
  taskTerms = []
} = {}) {
  if (!cdp?.call) throw new Error('semantic_cdp_required');
  if (!cdpTargetId) throw new Error('semantic_cdp_target_id_required');
  if (!targetId) throw new Error('semantic_target_id_required');
  const attached = await cdp.call('Target.attachToTarget', { targetId: cdpTargetId, flatten: true });
  const sessionId = String(attached?.sessionId || '');
  if (!sessionId) throw new Error('semantic_target_attach_failed');
  let accessibilityEnabled = false;
  try {
    await cdp.call('Page.enable', {}, { sessionId });
    await cdp.call('Accessibility.enable', {}, { sessionId });
    accessibilityEnabled = true;
    const [axRaw, domRaw, layout, frameTree] = await Promise.all([
      cdp.call('Accessibility.getFullAXTree', {}, { sessionId }),
      cdp.call('DOMSnapshot.captureSnapshot', { computedStyles: [], includePaintOrder: true, includeDOMRects: true }, { sessionId }),
      cdp.call('Page.getLayoutMetrics', {}, { sessionId }),
      cdp.call('Page.getFrameTree', {}, { sessionId })
    ]);
    const accessibility = compactAccessibility(axRaw);
    const domSnapshot = compactDomSnapshot(domRaw);
    const viewport = layout?.cssVisualViewport || layout?.cssLayoutViewport || {};
    return compiler.compileFrame({
      target_id: targetId,
      context_id: contextId,
      conversation_epoch: conversationEpoch,
      document_epoch: documentToken(frameTree, processIncarnationId, conversationEpoch),
      captured_at: new Date().toISOString(),
      page: { viewport: { width: Number(viewport.clientWidth || 0), height: Number(viewport.clientHeight || 0) } },
      accessibility,
      dom_snapshot: domSnapshot,
      layout: {
        css_layout_viewport: layout?.cssLayoutViewport || null,
        css_visual_viewport: layout?.cssVisualViewport || null,
        content_size: layout?.cssContentSize || layout?.contentSize || null
      },
      source_hashes: {
        accessibility_sha256: sha256(accessibility),
        dom_snapshot_sha256: sha256(domSnapshot)
      }
    }, {
      previous_frame: previousFrame,
      node_budget: nodeBudget,
      task_terms: taskTerms
    });
  } finally {
    if (accessibilityEnabled) await cdp.call('Accessibility.disable', {}, { sessionId }).catch(() => {});
    await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}
