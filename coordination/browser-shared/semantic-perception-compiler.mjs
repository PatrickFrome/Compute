const DEFAULT_MIN_NODES = 30;
const DEFAULT_MAX_NODES = 80;
const DEFAULT_BUDGET = 60;
const MAX_NAME = 320;
const MAX_VALUE = 320;

const ACTIONABLE_ROLES = new Set(['button','link','textbox','searchbox','combobox','checkbox','radio','switch','menuitem','tab','option','slider','spinbutton']);
const EDITABLE_ROLES = new Set(['textbox','searchbox','combobox','spinbutton']);
const CLICKABLE_TAGS = new Set(['BUTTON','A','INPUT','SELECT','OPTION','SUMMARY']);

function clip(value, max) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  return text.length <= max ? text : text.slice(0, max);
}

function normalizeToken(value) {
  return clip(value, 512).toLowerCase().replace(/\s+/g, ' ').trim();
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(value ?? ''))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function propertyMap(node) {
  const out = new Map();
  for (const row of Array.isArray(node?.properties) ? node.properties : []) {
    if (!row?.name) continue;
    out.set(String(row.name), row.value);
  }
  return out;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['true','1','yes','mixed'].includes(normalized)) return true;
    if (['false','0','no','undefined','none'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function geometryBucket(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 4) return 'none';
  const [x,y,w,h] = bounds.map((n) => Number.isFinite(Number(n)) ? Number(n) : 0);
  const q = (n) => Math.round(n / 32);
  return `${q(x)}:${q(y)}:${q(w)}:${q(h)}`;
}

function viewportVisible(bounds, viewport) {
  if (!Array.isArray(bounds) || bounds.length < 4 || !viewport) return false;
  const [x,y,w,h] = bounds.map(Number);
  const width = Number(viewport.width || viewport.clientWidth || 0);
  const height = Number(viewport.height || viewport.clientHeight || 0);
  if (![x,y,w,h,width,height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  return w > 0 && h > 0 && x < width && y < height && x + w > 0 && y + h > 0;
}

function domIndexes(domRecords) {
  const byBackend = new Map();
  const byNodeIndex = new Map();
  for (const row of Array.isArray(domRecords) ? domRecords : []) {
    if (row?.backend_node_id != null) byBackend.set(String(row.backend_node_id), row);
    if (row?.node_index != null) byNodeIndex.set(`${row.document_index ?? 0}:${row.node_index}`, row);
  }
  return { byBackend, byNodeIndex };
}

function parentDescriptor(dom, indexes) {
  if (!dom || dom.parent_index == null) return 'root';
  const parent = indexes.byNodeIndex.get(`${dom.document_index ?? 0}:${dom.parent_index}`);
  if (!parent) return 'unknown';
  const attrs = parent.attributes || {};
  return [parent.node_name || '', attrs.role || '', attrs['data-testid'] || '', attrs.id || ''].map(normalizeToken).join('|');
}

function taskTerms(taskText) {
  return new Set(normalizeToken(taskText).split(/[^a-z0-9_:-]+/i).filter((v) => v.length >= 3).slice(0, 64));
}

function taskOverlap(name, value, terms) {
  if (!terms.size) return 0;
  const hay = `${normalizeToken(name)} ${normalizeToken(value)}`;
  let hits = 0;
  for (const term of terms) if (hay.includes(term)) hits += 1;
  return Math.min(3, hits);
}

function stateObject(ax, dom) {
  const props = propertyMap(ax);
  const attrs = dom?.attributes || {};
  const state = {};
  for (const key of ['disabled','focused','expanded','checked','selected','required','readonly','busy','invalid']) {
    if (props.has(key)) state[key] = props.get(key);
  }
  if (!Object.hasOwn(state, 'disabled') && Object.hasOwn(attrs, 'disabled')) state.disabled = true;
  return state;
}

function semanticCandidate(ax, indexes, raw, terms) {
  if (!ax || ax.ignored === true) return null;
  const role = normalizeToken(ax.role || 'generic') || 'generic';
  const name = clip(ax.name || ax.description || '', MAX_NAME);
  const valueSummary = clip(ax.value || '', MAX_VALUE);
  const backend = ax.backend_dom_node_id ?? null;
  const dom = backend != null ? indexes.byBackend.get(String(backend)) || null : null;
  const attrs = dom?.attributes || {};
  const tag = String(dom?.node_name || '').toUpperCase();
  const props = propertyMap(ax);
  const states = stateObject(ax, dom);
  const editable = EDITABLE_ROLES.has(role) || tag === 'TEXTAREA' || tag === 'INPUT' || normalizeToken(attrs.contenteditable) === 'true';
  const clickable = ACTIONABLE_ROLES.has(role) || CLICKABLE_TAGS.has(tag);
  const focusable = boolValue(props.get('focusable')) || editable || clickable;
  const bounds = Array.isArray(dom?.bounds) ? dom.bounds.slice(0, 4).map(Number) : null;
  const parent = parentDescriptor(dom, indexes);
  const nameFingerprint = fnv1a64(normalizeToken(name));
  const structuralSignature = fnv1a64([role, nameFingerprint, normalizeToken(tag), parent, normalizeToken(attrs.role || ''), normalizeToken(attrs['data-testid'] || '')].join('||'));
  const visible = viewportVisible(bounds, raw.viewport || raw.page?.viewport || raw.layout?.css_visual_viewport || null);
  let relevance = ACTIONABLE_ROLES.has(role) ? 45 : 5;
  if (editable) relevance += 20;
  if (clickable) relevance += 10;
  if (focusable) relevance += 5;
  if (boolValue(states.focused)) relevance += 18;
  if (visible) relevance += 12;
  relevance += taskOverlap(name, valueSummary, terms) * 10;
  if (!name && !valueSummary && !clickable && !editable) relevance -= 20;
  return {
    role,
    name,
    value_summary: valueSummary,
    states,
    editable,
    clickable,
    focusable,
    bounds,
    visible,
    frame_path: Array.isArray(raw.frame_path) ? raw.frame_path.slice(0, 16) : ['root'],
    relevance_score: Math.max(0, Math.min(100, relevance)),
    confidence: backend != null ? 0.98 : 0.82,
    binding_evidence: {
      backend_dom_node_id: backend,
      ax_node_id: ax.node_id || null,
      source_frame_id: String(raw.frame_id || '') || null
    },
    _structural_signature: structuralSignature,
    _name_fingerprint: nameFingerprint,
    _dom_tag: tag,
    _geometry_bucket: geometryBucket(bounds)
  };
}

function semanticCompatible(a, b) {
  if (!a || !b) return false;
  if (a.role !== b.role) return false;
  if (a._name_fingerprint && b._name_fingerprint && a._name_fingerprint !== b._name_fingerprint) return false;
  return true;
}

function structuralScore(candidate, previous) {
  let score = 0;
  if (candidate.role === previous.role) score += 0.35;
  if (candidate._name_fingerprint === previous._name_fingerprint) score += 0.30;
  if (candidate._structural_signature === previous._structural_signature) score += 0.25;
  if (candidate._dom_tag && candidate._dom_tag === previous._dom_tag) score += 0.05;
  if (candidate._geometry_bucket !== 'none' && candidate._geometry_bucket === previous._geometry_bucket) score += 0.05;
  return score;
}

function publicNode(node) {
  const { _structural_signature, _name_fingerprint, _dom_tag, _geometry_bucket, ...rest } = node;
  return rest;
}

function hydratePrevious(previousFrame) {
  return (Array.isArray(previousFrame?.nodes) ? previousFrame.nodes : []).map((node) => ({
    ...node,
    _structural_signature: node.structural_signature || fnv1a64([node.role || '', fnv1a64(normalizeToken(node.name || '')), String(node.dom_tag || ''), String(node.parent_signature || '')].join('||')),
    _name_fingerprint: node.name_fingerprint || fnv1a64(normalizeToken(node.name || '')),
    _dom_tag: node.dom_tag || '',
    _geometry_bucket: node.geometry_bucket || geometryBucket(node.bounds)
  }));
}

function assignIdentity(candidates, raw, previousFrame) {
  const previous = hydratePrevious(previousFrame);
  const sameDocument = previousFrame && String(previousFrame.document_epoch) === String(raw.document_epoch);
  const usedPrevious = new Set();
  const ambiguous = [];

  for (const candidate of candidates) {
    let assigned = null;
    if (sameDocument && candidate.binding_evidence.backend_dom_node_id != null) {
      const exact = previous.filter((row) => !usedPrevious.has(row.semantic_id)
        && row.binding_evidence?.backend_dom_node_id != null
        && String(row.binding_evidence.backend_dom_node_id) === String(candidate.binding_evidence.backend_dom_node_id)
        && semanticCompatible(candidate, row));
      if (exact.length === 1) {
        assigned = exact[0];
        candidate.semantic_id = assigned.semantic_id;
        candidate.binding_epoch = Number(assigned.binding_epoch || 1);
        candidate.continuity = 'EXACT_BINDING';
        usedPrevious.add(assigned.semantic_id);
      }
    }

    if (!assigned && sameDocument) {
      const scored = previous
        .filter((row) => !usedPrevious.has(row.semantic_id))
        .map((row) => ({ row, score: structuralScore(candidate, row) }))
        .filter((match) => match.score >= 0.90)
        .sort((a, b) => b.score - a.score || String(a.row.semantic_id).localeCompare(String(b.row.semantic_id)));
      if (scored.length === 1 || (scored.length > 1 && scored[0].score - scored[1].score >= 0.08)) {
        assigned = scored[0].row;
        candidate.semantic_id = assigned.semantic_id;
        candidate.binding_epoch = Number(assigned.binding_epoch || 1) + 1;
        candidate.continuity = 'STRUCTURAL_REBIND';
        candidate.confidence = Math.min(candidate.confidence, scored[0].score);
        usedPrevious.add(assigned.semantic_id);
      } else if (scored.length > 1) {
        candidate.continuity = 'AMBIGUOUS';
        candidate.confidence = Math.min(candidate.confidence, scored[0].score);
        ambiguous.push({ candidate, matches: scored.slice(0, 4).map((m) => ({ semantic_id: m.row.semantic_id, score: m.score })) });
      }
    }

    if (!candidate.semantic_id) {
      const material = [raw.target_id, raw.context_id, raw.document_epoch, candidate._structural_signature, candidate.binding_evidence.backend_dom_node_id ?? 'none'].join('||');
      candidate.semantic_id = `sem_${fnv1a64(material)}`;
      candidate.binding_epoch = 1;
      candidate.continuity ||= 'NEW_NODE';
    }
  }
  return ambiguous;
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function deltaScope(current, previousFrame) {
  const sameDocument = previousFrame && String(previousFrame.document_epoch) === String(current.document_epoch);
  const bounded = current.truncation?.applied === true || previousFrame?.truncation?.applied === true;
  if (!sameDocument) return bounded ? 'FULL_REFRESH_BOUNDED' : 'FULL_REFRESH';
  return bounded ? 'EMITTED_WORKING_SET' : 'FULL_CANDIDATE_SET';
}

function computeChanges(current, previousFrame) {
  const sameDocument = previousFrame && String(previousFrame.document_epoch) === String(current.document_epoch);
  const bounded = current.truncation?.applied === true || previousFrame?.truncation?.applied === true;
  const enteredType = bounded ? 'WORKING_SET_ENTERED' : 'ADDED';
  const exitedType = bounded ? 'WORKING_SET_EVICTED' : 'REMOVED';
  if (!sameDocument) {
    return current.nodes.map((node) => ({ type: enteredType, semantic_id: node.semantic_id }));
  }
  const before = new Map((previousFrame.nodes || []).map((node) => [node.semantic_id, node]));
  const after = new Map(current.nodes.map((node) => [node.semantic_id, node]));
  const changes = [];
  for (const [id, node] of after) {
    const prior = before.get(id);
    if (!prior) { changes.push({ type: enteredType, semantic_id: id }); continue; }
    const fields = [];
    if (prior.name !== node.name) fields.push('name');
    if (prior.value_summary !== node.value_summary) fields.push('value_summary');
    if (!sameJson(prior.states || {}, node.states || {})) fields.push('states');
    if (!sameJson(prior.bounds || null, node.bounds || null)) fields.push('bounds');
    if (Number(prior.binding_epoch || 1) !== Number(node.binding_epoch || 1)) fields.push('binding');
    if (fields.length) changes.push({ type: 'CHANGED', semantic_id: id, fields });
  }
  for (const id of before.keys()) if (!after.has(id)) changes.push({ type: exitedType, semantic_id: id });
  return changes.sort((a,b) => String(a.semantic_id).localeCompare(String(b.semantic_id)) || a.type.localeCompare(b.type));
}

function clampBudget(value) {
  const n = Number.isInteger(Number(value)) ? Number(value) : DEFAULT_BUDGET;
  return Math.max(DEFAULT_MIN_NODES, Math.min(DEFAULT_MAX_NODES, n));
}

export function compileSemanticFrame(rawObservation, options = {}) {
  const raw = structuredClone(rawObservation || {});
  if (!raw.frame_id) throw new Error('semantic_frame_id_required');
  if (!raw.target_id) throw new Error('semantic_target_id_required');
  if (!raw.context_id) throw new Error('semantic_context_id_required');
  if (raw.document_epoch == null) throw new Error('semantic_document_epoch_required');
  const maxNodes = clampBudget(options.maxNodes);
  const terms = taskTerms(options.taskText || '');
  const indexes = domIndexes(raw.dom_records || raw.dom_snapshot?.visible_records || []);
  const candidates = (raw.ax_nodes || raw.accessibility || []).map((node) => semanticCandidate(node, indexes, raw, terms)).filter(Boolean);
  const ambiguous = assignIdentity(candidates, raw, options.previousFrame || null);

  const ranked = candidates.sort((a,b) => b.relevance_score - a.relevance_score || a.semantic_id.localeCompare(b.semantic_id));
  const selectedInternal = ranked.slice(0, maxNodes);
  const nodes = selectedInternal.map((node) => ({
    ...publicNode(node),
    structural_signature: node._structural_signature,
    name_fingerprint: node._name_fingerprint,
    dom_tag: node._dom_tag,
    geometry_bucket: node._geometry_bucket
  }));

  const frame = {
    schema: 'metaengine.a2-browser-operator.semantic-frame.v1',
    frame_id: String(raw.frame_id),
    target_id: String(raw.target_id),
    context_id: String(raw.context_id),
    document_epoch: raw.document_epoch,
    captured_at: raw.captured_at || new Date(0).toISOString(),
    source_hashes: structuredClone(raw.source_hashes || raw.hashes || {}),
    tainted_page_data: true,
    authority_effect: false,
    nodes,
    changes: [],
    delta: { scope: 'PENDING', complete: false },
    ambiguity: ambiguous.map((item) => ({
      semantic_id: item.candidate.semantic_id,
      matches: item.matches
    })),
    truncation: {
      applied: candidates.length > nodes.length,
      source_candidate_count: candidates.length,
      emitted_node_count: nodes.length,
      max_nodes: maxNodes,
      omitted_node_count: Math.max(0, candidates.length - nodes.length)
    },
    metrics: {
      raw_observation_bytes: jsonBytes(rawObservation || {}),
      semantic_frame_bytes: 0,
      source_ax_nodes: Array.isArray(raw.ax_nodes || raw.accessibility) ? (raw.ax_nodes || raw.accessibility).length : 0,
      source_dom_records: Array.isArray(raw.dom_records || raw.dom_snapshot?.visible_records) ? (raw.dom_records || raw.dom_snapshot.visible_records).length : 0,
      semantic_candidates: candidates.length,
      exact_bindings: nodes.filter((node) => node.continuity === 'EXACT_BINDING').length,
      structural_rebinds: nodes.filter((node) => node.continuity === 'STRUCTURAL_REBIND').length,
      ambiguous_nodes: nodes.filter((node) => node.continuity === 'AMBIGUOUS').length
    }
  };
  const scope = deltaScope(frame, options.previousFrame || null);
  frame.delta = { scope, complete: scope === 'FULL_REFRESH' || scope === 'FULL_CANDIDATE_SET' };
  frame.changes = computeChanges(frame, options.previousFrame || null);
  frame.metrics.semantic_frame_bytes = jsonBytes(frame);
  frame.metrics.node_reduction_ratio = frame.metrics.source_ax_nodes > 0 ? Number((1 - nodes.length / frame.metrics.source_ax_nodes).toFixed(6)) : 0;
  return frame;
}

export const SEMANTIC_PERCEPTION_LIMITS = Object.freeze({
  min_nodes: DEFAULT_MIN_NODES,
  max_nodes: DEFAULT_MAX_NODES,
  default_nodes: DEFAULT_BUDGET,
  max_name_chars: MAX_NAME,
  max_value_chars: MAX_VALUE
});
