import crypto from 'node:crypto';
import { compileSemanticFrame } from '../../browser-shared/semantic-perception-compiler.mjs';

const MAX_AX_NODES = 3000;
const MAX_DOM_RECORDS = 4000;
const MAX_NODE_TEXT = 640;
const ALLOWED_ATTRIBUTES = new Set(['id','class','role','aria-label','aria-live','aria-busy','title','data-testid','contenteditable','disabled']);

function clip(value, max = MAX_NODE_TEXT) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  return text.length <= max ? text : text.slice(0, max);
}

function axValue(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  return Object.hasOwn(value, 'value') ? value.value : null;
}

function compactAx(raw) {
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  return nodes.slice(0, MAX_AX_NODES).map((node) => ({
    node_id: node.nodeId || null,
    backend_dom_node_id: node.backendDOMNodeId ?? null,
    frame_id: node.frameId || null,
    ignored: node.ignored === true,
    role: axValue(node.role),
    name: clip(axValue(node.name) || ''),
    description: clip(axValue(node.description) || '', 320),
    value: clip(axValue(node.value) || ''),
    properties: Array.isArray(node.properties)
      ? node.properties.slice(0, 32).map((row) => ({ name: row?.name || null, value: axValue(row?.value) }))
      : []
  }));
}

function decodeAttributes(strings, encoded) {
  if (!Array.isArray(encoded)) return {};
  const out = {};
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const key = strings[encoded[i]];
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    out[key] = clip(strings[encoded[i + 1]] || '', 320);
  }
  return out;
}

function compactDom(snapshot) {
  const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
  const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  const records = [];
  for (let documentIndex = 0; documentIndex < documents.length && records.length < MAX_DOM_RECORDS; documentIndex += 1) {
    const document = documents[documentIndex] || {};
    const nodes = document.nodes || {};
    const layout = document.layout || {};
    const nodeIndexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
    for (let layoutIndex = 0; layoutIndex < nodeIndexes.length && records.length < MAX_DOM_RECORDS; layoutIndex += 1) {
      const nodeIndex = nodeIndexes[layoutIndex];
      const nodeName = strings[nodes.nodeName?.[nodeIndex]] || '';
      const nodeValue = strings[nodes.nodeValue?.[nodeIndex]] || '';
      const attrs = decodeAttributes(strings, nodes.attributes?.[nodeIndex]);
      if (!clip(nodeValue) && !Object.keys(attrs).length && !['BUTTON','TEXTAREA','INPUT','SELECT','A','IMG','IFRAME','SUMMARY'].includes(nodeName)) continue;
      records.push({
        document_index: documentIndex,
        node_index: nodeIndex,
        backend_node_id: nodes.backendNodeId?.[nodeIndex] ?? null,
        parent_index: nodes.parentIndex?.[nodeIndex] ?? null,
        node_name: nodeName,
        node_value: clip(nodeValue),
        attributes: attrs,
        bounds: Array.isArray(layout.bounds?.[layoutIndex]) ? layout.bounds[layoutIndex].slice(0, 4) : null
      });
    }
  }
  return records;
}

function mainFrame(frameTree) {
  const frame = frameTree?.frameTree?.frame || frameTree?.frame || null;
  if (!frame?.id) throw new Error('semantic_main_frame_unavailable');
  return frame;
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function validateBinding(target, binding) {
  if (!target || target.status !== 'ACTIVE') throw new Error('semantic_target_not_active');
  if (!binding?.cdp_target_id) throw new Error('semantic_target_not_bound');
  if (String(binding.context_id || '') !== String(target.context_id || '')) throw new Error('semantic_target_context_binding_mismatch');
  if (Number(binding.conversation_epoch || 0) !== Number(target.conversation_epoch || 0)) throw new Error('semantic_target_epoch_binding_mismatch');
}

export class SemanticCaptureAdapter {
  constructor({ cdp }) {
    if (!cdp || typeof cdp.call !== 'function') throw new Error('semantic_cdp_unavailable');
    this.cdp = cdp;
  }

  async capture({ target, binding, previousFrame = null, maxNodes = 60, taskText = '' } = {}) {
    validateBinding(target, binding);
    const attached = await this.cdp.call('Target.attachToTarget', { targetId: binding.cdp_target_id, flatten: true });
    const sessionId = attached?.sessionId;
    if (!sessionId) throw new Error('semantic_target_attach_failed');
    let accessibilityEnabled = false;
    try {
      await this.cdp.call('Page.enable', {}, { sessionId });
      await this.cdp.call('Accessibility.enable', {}, { sessionId });
      accessibilityEnabled = true;
      const [frameTree, axRaw, domRaw, layout] = await Promise.all([
        this.cdp.call('Page.getFrameTree', {}, { sessionId }),
        this.cdp.call('Accessibility.getFullAXTree', {}, { sessionId, timeoutMs: 20000 }),
        this.cdp.call('DOMSnapshot.captureSnapshot', { computedStyles: [], includePaintOrder: false, includeDOMRects: true }, { sessionId, timeoutMs: 20000 }),
        this.cdp.call('Page.getLayoutMetrics', {}, { sessionId })
      ]);
      const frame = mainFrame(frameTree);
      const accessibility = compactAx(axRaw);
      const domRecords = compactDom(domRaw);
      const documentEpoch = `${frame.id}:${frame.loaderId || 'loader-unavailable'}`;
      const capturedAt = new Date().toISOString();
      const sourceHashes = {
        ax_sha256: sha256(accessibility),
        dom_sha256: sha256(domRecords),
        document_loader_id: frame.loaderId || null,
        main_frame_id: frame.id
      };
      const rawObservation = {
        frame_id: `compute_${crypto.randomUUID()}`,
        target_id: target.target_id,
        context_id: target.context_id,
        document_epoch: documentEpoch,
        captured_at: capturedAt,
        source_hashes: sourceHashes,
        viewport: layout?.cssVisualViewport || layout?.cssLayoutViewport || null,
        accessibility,
        dom_snapshot: { visible_records: domRecords }
      };
      const semantic = compileSemanticFrame(rawObservation, { previousFrame, maxNodes, taskText });
      semantic.adapter = {
        surface: 'A2_COMPUTE_BROWSER',
        transport: 'NATIVE_CDP_PIPE',
        page_script_evaluation: false,
        raw_cdp_exposed: false,
        source_frame_url_sha256: sha256(frame.url || '')
      };
      return semantic;
    } finally {
      if (accessibilityEnabled) await this.cdp.call('Accessibility.disable', {}, { sessionId, timeoutMs: 2500 }).catch(() => {});
      await this.cdp.call('Target.detachFromTarget', { sessionId }, { timeoutMs: 2500 }).catch(() => {});
    }
  }
}
