import crypto from 'node:crypto';

export const PERCEPTION_COMPUTED_STYLES = Object.freeze([
  'display',
  'visibility',
  'opacity',
  'pointer-events'
]);

export const DEFAULT_PERCEPTION_LIMITS = Object.freeze({
  maxDocuments: 32,
  maxDomNodes: 50000,
  maxAxNodes: 20000,
  maxOutputNodes: 20000,
  maxStrings: 100000,
  maxStringBytes: 8 * 1024 * 1024,
  maxSingleStringBytes: 16384,
  maxAttributeIndexes: 200000,
  deadlineMs: 10000
});

const ALLOWED_STATES = new Set([
  'busy', 'disabled', 'editable', 'focusable', 'focused', 'hidden', 'invalid',
  'multiselectable', 'readonly', 'required', 'checked', 'expanded', 'pressed',
  'selected'
]);

function denseArray(value, code, max = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value) || value.length > max) throw new Error(code);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new Error(`${code}_sparse`);
  }
  return value;
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function exactLength(value, length, code) {
  const array = denseArray(value, code);
  if (array.length !== length) throw new Error(`${code}_length`);
  return array;
}

function integer(value, code, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(code);
  return value;
}

function finite(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(code);
  return Object.is(value, -0) ? 0 : value;
}

function stringAt(strings, index) {
  return strings[integer(index, 'snapshot_string_index_invalid', { max: strings.length - 1 })];
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function axScalar(axValue, limits, code) {
  if (axValue == null) return null;
  const row = object(axValue, `${code}_invalid`);
  const value = row.value;
  if (value == null) return null;
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`${code}_value_invalid`);
  }
  const normalized = String(value);
  if (Buffer.byteLength(normalized, 'utf8') > limits.maxSingleStringBytes) throw new Error(`${code}_too_large`);
  return normalized;
}

function axState(properties, limits) {
  const state = {};
  for (const property of denseArray(properties || [], 'ax_properties_invalid', 256)) {
    const row = object(property, 'ax_property_invalid');
    if (!ALLOWED_STATES.has(row.name)) continue;
    const value = row.value?.value;
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) continue;
    const normalized = typeof value === 'string' ? value : String(value);
    if (Buffer.byteLength(normalized, 'utf8') > limits.maxSingleStringBytes) throw new Error('ax_state_too_large');
    state[row.name] = normalized;
  }
  return state;
}

function mergeLimits(overrides) {
  const limits = { ...DEFAULT_PERCEPTION_LIMITS, ...(overrides || {}) };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`perception_limit_invalid:${name}`);
  }
  return limits;
}

function validateStrings(raw, limits) {
  const strings = denseArray(raw, 'snapshot_strings_invalid', limits.maxStrings);
  let bytes = 0;
  for (const value of strings) {
    if (typeof value !== 'string') throw new Error('snapshot_string_invalid');
    const length = Buffer.byteLength(value, 'utf8');
    if (length > limits.maxSingleStringBytes) throw new Error('snapshot_string_too_large');
    bytes += length;
    if (bytes > limits.maxStringBytes) throw new Error('snapshot_strings_too_large');
  }
  return strings;
}

function compileDom(domSnapshot, limits) {
  const root = object(domSnapshot, 'dom_snapshot_invalid');
  const strings = validateStrings(root.strings, limits);
  const documents = denseArray(root.documents, 'snapshot_documents_invalid', limits.maxDocuments);
  const domByBackendId = new Map();
  let totalNodes = 0;
  let attributeIndexes = 0;

  for (let documentIndex = 0; documentIndex < documents.length; documentIndex += 1) {
    const document = object(documents[documentIndex], 'snapshot_document_invalid');
    const nodes = object(document.nodes, 'snapshot_nodes_invalid');
    const nodeTypes = denseArray(nodes.nodeType, 'snapshot_node_types_invalid');
    const count = nodeTypes.length;
    totalNodes += count;
    if (totalNodes > limits.maxDomNodes) throw new Error('snapshot_dom_nodes_too_many');
    const parentIndexes = exactLength(nodes.parentIndex, count, 'snapshot_parent_indexes_invalid');
    const nodeNames = exactLength(nodes.nodeName, count, 'snapshot_node_names_invalid');
    const nodeValues = exactLength(nodes.nodeValue, count, 'snapshot_node_values_invalid');
    const backendIds = exactLength(nodes.backendNodeId, count, 'snapshot_backend_ids_invalid');
    const attributes = exactLength(nodes.attributes, count, 'snapshot_attributes_invalid');
    if (document.frameId != null) stringAt(strings, document.frameId);
    if (document.documentURL != null) stringAt(strings, document.documentURL);

    for (let index = 0; index < count; index += 1) {
      integer(nodeTypes[index], 'snapshot_node_type_invalid', { max: 255 });
      integer(parentIndexes[index], 'snapshot_parent_index_invalid', { min: -1, max: Math.max(-1, count - 1) });
      stringAt(strings, nodeNames[index]);
      stringAt(strings, nodeValues[index]);
      const backendNodeId = integer(backendIds[index], 'snapshot_backend_id_invalid', { min: 1 });
      if (domByBackendId.has(backendNodeId)) throw new Error('snapshot_backend_id_duplicate');
      const attr = denseArray(attributes[index], 'snapshot_attribute_row_invalid');
      if (attr.length % 2 !== 0) throw new Error('snapshot_attribute_row_odd');
      attributeIndexes += attr.length;
      if (attributeIndexes > limits.maxAttributeIndexes) throw new Error('snapshot_attributes_too_many');
      for (const stringIndex of attr) stringAt(strings, stringIndex);
      domByBackendId.set(backendNodeId, {
        documentIndex,
        nodeIndex: index,
        bounds: null,
        paintOrder: null,
        visible: false
      });
    }

    const layout = object(document.layout, 'snapshot_layout_invalid');
    const layoutNodeIndexes = denseArray(layout.nodeIndex, 'snapshot_layout_node_indexes_invalid', count);
    const layoutCount = layoutNodeIndexes.length;
    const styles = exactLength(layout.styles, layoutCount, 'snapshot_layout_styles_invalid');
    const bounds = exactLength(layout.bounds, layoutCount, 'snapshot_layout_bounds_invalid');
    exactLength(layout.text, layoutCount, 'snapshot_layout_text_invalid');
    const paintOrders = layout.paintOrders == null ? null : exactLength(layout.paintOrders, layoutCount, 'snapshot_paint_orders_invalid');
    const seenLayoutNodes = new Set();
    for (let layoutIndex = 0; layoutIndex < layoutCount; layoutIndex += 1) {
      const nodeIndex = integer(layoutNodeIndexes[layoutIndex], 'snapshot_layout_node_index_invalid', { max: count - 1 });
      if (seenLayoutNodes.has(nodeIndex)) throw new Error('snapshot_layout_node_duplicate');
      seenLayoutNodes.add(nodeIndex);
      const styleIndexes = denseArray(styles[layoutIndex], 'snapshot_layout_style_row_invalid', PERCEPTION_COMPUTED_STYLES.length);
      if (styleIndexes.length !== PERCEPTION_COMPUTED_STYLES.length) throw new Error('snapshot_layout_style_row_length');
      const styleValues = styleIndexes.map((stringIndex) => stringAt(strings, stringIndex));
      const rectangle = denseArray(bounds[layoutIndex], 'snapshot_layout_bounds_row_invalid', 4);
      if (rectangle.length !== 4) throw new Error('snapshot_layout_bounds_row_length');
      const normalizedBounds = rectangle.map((value) => finite(value, 'snapshot_layout_bound_invalid'));
      const paintOrder = paintOrders == null ? null : integer(paintOrders[layoutIndex], 'snapshot_paint_order_invalid');
      const row = domByBackendId.get(backendIds[nodeIndex]);
      row.bounds = normalizedBounds;
      row.paintOrder = paintOrder;
      row.visible = normalizedBounds[2] > 0 && normalizedBounds[3] > 0 &&
        styleValues[0] !== 'none' && !['hidden', 'collapse'].includes(styleValues[1]) && Number(styleValues[2]) > 0;
    }
  }
  return { domByBackendId, totalNodes, documentCount: documents.length, strings };
}

export function compileSemanticSnapshot({ domSnapshot, axTree, identity, sessionGeneration, nodeKey, limits: overrides } = {}) {
  const limits = mergeLimits(overrides);
  if (!Buffer.isBuffer(nodeKey) || nodeKey.length < 32) throw new Error('perception_node_key_invalid');
  if (typeof identity?.targetId !== 'string' || !identity.targetId) throw new Error('target_id_invalid');
  if (!Number.isSafeInteger(identity?.conversationEpoch) || identity.conversationEpoch < 1) throw new Error('conversation_epoch_invalid');
  if (typeof identity?.processIncarnationId !== 'string' || !identity.processIncarnationId) throw new Error('process_incarnation_id_invalid');
  integer(sessionGeneration, 'session_generation_invalid', { min: 1 });

  const dom = compileDom(domSnapshot, limits);
  const axNodes = denseArray(object(axTree, 'ax_tree_invalid').nodes, 'ax_nodes_invalid', limits.maxAxNodes);
  const candidates = [];
  const publicIdByAxId = new Map();
  const seenAxIds = new Set();
  const seenNodeIds = new Set();
  const nodeBindings = new Map();
  for (const raw of axNodes) {
    const ax = object(raw, 'ax_node_invalid');
    if (typeof ax.nodeId !== 'string' || !ax.nodeId) throw new Error('ax_node_id_invalid');
    if (seenAxIds.has(ax.nodeId)) throw new Error('ax_node_id_duplicate');
    seenAxIds.add(ax.nodeId);
    if (ax.backendDOMNodeId == null) continue;
    const backendNodeId = integer(ax.backendDOMNodeId, 'ax_backend_node_id_invalid', { min: 1 });
    const domNode = dom.domByBackendId.get(backendNodeId);
    if (!domNode) continue;
    if (candidates.length >= limits.maxOutputNodes) throw new Error('semantic_nodes_too_many');
    const material = `${identity.targetId}\0${identity.conversationEpoch}\0${identity.processIncarnationId}\0${sessionGeneration}\0${backendNodeId}`;
    const nodeId = `node_${crypto.createHmac('sha256', nodeKey).update(material).digest('hex').slice(0, 32)}`;
    if (seenNodeIds.has(nodeId)) throw new Error('semantic_node_id_duplicate');
    seenNodeIds.add(nodeId);
    publicIdByAxId.set(ax.nodeId, nodeId);
    const candidate = {
      axId: ax.nodeId,
      parentAxId: typeof ax.parentId === 'string' ? ax.parentId : null,
      nodeId,
      backendNodeId,
      role: axScalar(ax.role, limits, 'ax_role'),
      name: axScalar(ax.name, limits, 'ax_name'),
      description: axScalar(ax.description, limits, 'ax_description'),
      ignored: ax.ignored === true,
      state: axState(ax.properties, limits),
      domNode
    };
    candidates.push(candidate);
    nodeBindings.set(nodeId, {
      backendNodeId,
      targetId: identity.targetId,
      conversationEpoch: identity.conversationEpoch,
      processIncarnationId: identity.processIncarnationId,
      sessionGeneration
    });
  }

  const nodes = candidates.map((candidate) => ({
    node_id: candidate.nodeId,
    parent_node_id: publicIdByAxId.get(candidate.parentAxId) || null,
    role: candidate.role,
    name: candidate.name,
    description: candidate.description,
    ignored: candidate.ignored,
    state: candidate.state,
    visible: candidate.domNode.visible,
    bounds: candidate.domNode.bounds,
    paint_order: candidate.domNode.paintOrder
  }));
  const content = {
    schema: 'metaengine.a2-compute-browser.semantic-snapshot.v1',
    target_id: identity.targetId,
    conversation_epoch: identity.conversationEpoch,
    process_incarnation_id: identity.processIncarnationId,
    session_generation: sessionGeneration,
    scope: 'MAIN_TARGET',
    oopif_complete: false,
    consistency: 'SEQUENTIAL_READ_ONLY',
    actuation_eligible: false,
    nodes,
    counts: {
      documents: dom.documentCount,
      dom_nodes: dom.totalNodes,
      ax_nodes: axNodes.length,
      semantic_nodes: nodes.length
    }
  };
  const snapshotId = `snapshot_${crypto.createHash('sha256').update(canonical(content)).digest('hex')}`;
  return {
    snapshot: { ...content, snapshot_id: snapshotId },
    nodeBindings
  };
}

export async function captureSemanticSnapshot({ scheduler, identity, nodeKey, limits, capturedAt = new Date().toISOString() } = {}) {
  if (!scheduler || typeof scheduler.run !== 'function') throw new Error('perception_scheduler_invalid');
  const mergedLimits = mergeLimits(limits);
  return scheduler.run(identity, async ({ call, sessionGeneration }) => {
    const domSnapshot = await call('DOMSnapshot.captureSnapshot', {
      computedStyles: [...PERCEPTION_COMPUTED_STYLES],
      includePaintOrder: true,
      includeDOMRects: false
    });
    const axTree = await call('Accessibility.getFullAXTree', {});
    const compiled = compileSemanticSnapshot({ domSnapshot, axTree, identity, sessionGeneration, nodeKey, limits: mergedLimits });
    return {
      ...compiled,
      snapshot: { ...compiled.snapshot, captured_at: capturedAt }
    };
  }, { deadlineMs: mergedLimits.deadlineMs });
}
