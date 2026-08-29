import crypto from 'node:crypto';

const NODE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const TOKEN_RE = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const PRINCIPAL_RE = /^[a-z0-9][a-z0-9._:@-]{2,127}$/;

export const TRUST_TAINT_GRAPH_VERSION = '1.0.0';
export const PRIVILEGED_SINKS = Object.freeze(['BROWSER_ACTUATION', 'LOCAL_EXEC', 'NETWORK_WRITE', 'SECRET_READ']);
const SINK_SET = new Set(PRIVILEGED_SINKS);

const SOURCE_POLICIES = Object.freeze({
  LOCAL_POLICY: Object.freeze({ integrity: 'TRUSTED', authority: true }),
  SIGNED_SUPERVISOR_DIRECTIVE: Object.freeze({ integrity: 'TRUSTED', authority: true }),
  USER_CONFIRMED_ACTION: Object.freeze({ integrity: 'TRUSTED', authority: true }),
  VERIFIED_TEST_EVIDENCE: Object.freeze({ integrity: 'EVIDENCE', authority: false }),
  ATTESTED_BUILD_EVIDENCE: Object.freeze({ integrity: 'EVIDENCE', authority: false }),
  PAGE_DATA: Object.freeze({ integrity: 'UNTRUSTED', authority: false }),
  MODEL_OUTPUT: Object.freeze({ integrity: 'UNTRUSTED', authority: false }),
  TOOL_OUTPUT: Object.freeze({ integrity: 'UNTRUSTED', authority: false }),
  EXTERNAL_FILE: Object.freeze({ integrity: 'UNTRUSTED', authority: false }),
  EXTERNAL_MESSAGE: Object.freeze({ integrity: 'UNTRUSTED', authority: false }),
});

export class TrustTaintGraphError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TrustTaintGraphError';
    this.code = code;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}
function digestObject(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`; }
function clone(value) { return value == null ? value : structuredClone(value); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrustTaintGraphError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) throw new TrustTaintGraphError(code);
}
function text(value, max, code) {
  if (typeof value !== 'string') throw new TrustTaintGraphError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new TrustTaintGraphError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new TrustTaintGraphError(code);
  return v;
}
function digest(value, code) { return token(value, DIGEST_RE, 71, code); }
function uniqueTokens(value, allowed, code) {
  if (!Array.isArray(value) || value.length > 16) throw new TrustTaintGraphError(code);
  const out = value.map((v) => token(v, TOKEN_RE, 64, code, (x) => x.toUpperCase())).sort();
  if (out.some((v, i) => i > 0 && v === out[i - 1])) throw new TrustTaintGraphError(code);
  if (allowed && out.some((v) => !allowed.has(v))) throw new TrustTaintGraphError(code);
  return Object.freeze(out);
}
function nodeIds(value, code) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new TrustTaintGraphError(code);
  const out = value.map((v) => token(v, NODE_ID_RE, 128, code, (x) => x.toLowerCase())).sort();
  if (out.some((v, i) => i > 0 && v === out[i - 1])) throw new TrustTaintGraphError(code);
  return Object.freeze(out);
}
function intersection(arrays) {
  if (!arrays.length) return [];
  const first = new Set(arrays[0]);
  for (const item of [...first]) if (arrays.slice(1).some((array) => !array.includes(item))) first.delete(item);
  return [...first].sort();
}
function derivedIntegrity(parents) {
  if (parents.some((p) => p.integrity === 'UNTRUSTED')) return 'UNTRUSTED';
  if (parents.some((p) => p.integrity === 'EVIDENCE')) return 'EVIDENCE';
  if (parents.some((p) => p.integrity === 'ENDORSED')) return 'ENDORSED';
  return 'TRUSTED';
}

export class TrustTaintGraphV1 {
  #nodes = new Map();
  #events = [];
  #seq = 0;
  #endorsementVerifier;

  constructor({ endorsementVerifier = null } = {}) {
    if (endorsementVerifier != null && typeof endorsementVerifier !== 'function') throw new TrustTaintGraphError('taint_endorsement_verifier_invalid');
    this.#endorsementVerifier = endorsementVerifier;
  }

  addSource(input) {
    exactKeys(input, ['node_id', 'source_class', 'content_digest', 'authority_capabilities'], 'taint_source_fields_invalid');
    const nodeId = token(input.node_id, NODE_ID_RE, 128, 'taint_node_id_invalid', (v) => v.toLowerCase());
    this.#assertNew(nodeId);
    const sourceClass = token(input.source_class, TOKEN_RE, 64, 'taint_source_class_invalid', (v) => v.toUpperCase());
    const policy = SOURCE_POLICIES[sourceClass];
    if (!policy) throw new TrustTaintGraphError('taint_source_class_invalid');
    const capabilities = uniqueTokens(input.authority_capabilities, SINK_SET, 'taint_authority_capabilities_invalid');
    if (!policy.authority && capabilities.length) throw new TrustTaintGraphError('taint_non_authority_source_capabilities_forbidden');
    const body = {
      version: TRUST_TAINT_GRAPH_VERSION,
      node_id: nodeId,
      node_kind: 'SOURCE',
      source_class: sourceClass,
      content_digest: digest(input.content_digest, 'taint_content_digest_invalid'),
      parent_ids: [],
      integrity: policy.integrity,
      taint_source_ids: policy.integrity === 'UNTRUSTED' ? [nodeId] : [],
      authority_eligible: policy.authority,
      authority_capabilities: capabilities,
      endorsement: null,
    };
    return this.#store(body, 'SOURCE_ADDED');
  }

  derive(input) {
    exactKeys(input, ['node_id', 'parent_ids', 'transform_kind', 'content_digest'], 'taint_derive_fields_invalid');
    const nodeId = token(input.node_id, NODE_ID_RE, 128, 'taint_node_id_invalid', (v) => v.toLowerCase());
    this.#assertNew(nodeId);
    const parentIds = nodeIds(input.parent_ids, 'taint_parent_ids_invalid');
    if (parentIds.includes(nodeId)) throw new TrustTaintGraphError('taint_self_parent_forbidden');
    const parents = parentIds.map((id) => this.#require(id));
    const authorityEligible = parents.every((p) => p.authority_eligible === true);
    const capabilities = authorityEligible ? intersection(parents.map((p) => p.authority_capabilities)) : [];
    const body = {
      version: TRUST_TAINT_GRAPH_VERSION,
      node_id: nodeId,
      node_kind: 'DERIVED',
      source_class: null,
      transform_kind: token(input.transform_kind, TOKEN_RE, 64, 'taint_transform_kind_invalid', (v) => v.toUpperCase()),
      content_digest: digest(input.content_digest, 'taint_content_digest_invalid'),
      parent_ids: parentIds,
      integrity: derivedIntegrity(parents),
      taint_source_ids: [...new Set(parents.flatMap((p) => p.taint_source_ids))].sort(),
      authority_eligible: authorityEligible,
      authority_capabilities: Object.freeze(capabilities),
      endorsement: null,
    };
    return this.#store(body, 'NODE_DERIVED');
  }

  endorse(input) {
    exactKeys(input, ['node_id', 'parent_id', 'content_digest', 'endorsement'], 'taint_endorse_fields_invalid');
    if (!this.#endorsementVerifier) throw new TrustTaintGraphError('taint_endorsement_verifier_required');
    const nodeId = token(input.node_id, NODE_ID_RE, 128, 'taint_node_id_invalid', (v) => v.toLowerCase());
    this.#assertNew(nodeId);
    const parentId = token(input.parent_id, NODE_ID_RE, 128, 'taint_parent_id_invalid', (v) => v.toLowerCase());
    const parent = this.#require(parentId);
    exactKeys(input.endorsement, ['endorsement_id', 'principal_id', 'scopes', 'evidence_digest'], 'taint_endorsement_fields_invalid');
    const endorsement = deepFreeze({
      endorsement_id: token(input.endorsement.endorsement_id, NODE_ID_RE, 128, 'taint_endorsement_id_invalid', (v) => v.toLowerCase()),
      principal_id: token(input.endorsement.principal_id, PRINCIPAL_RE, 128, 'taint_endorsement_principal_invalid', (v) => v.toLowerCase()),
      scopes: uniqueTokens(input.endorsement.scopes, SINK_SET, 'taint_endorsement_scopes_invalid'),
      evidence_digest: digest(input.endorsement.evidence_digest, 'taint_endorsement_evidence_digest_invalid'),
    });
    if (!endorsement.scopes.length) throw new TrustTaintGraphError('taint_endorsement_scope_required');
    const verified = this.#endorsementVerifier(clone(endorsement), clone(parent));
    if (verified !== true) throw new TrustTaintGraphError('taint_endorsement_not_verified');
    const body = {
      version: TRUST_TAINT_GRAPH_VERSION,
      node_id: nodeId,
      node_kind: 'ENDORSEMENT',
      source_class: null,
      content_digest: digest(input.content_digest, 'taint_content_digest_invalid'),
      parent_ids: [parentId],
      integrity: 'ENDORSED',
      taint_source_ids: [...parent.taint_source_ids],
      authority_eligible: true,
      authority_capabilities: endorsement.scopes,
      endorsement,
    };
    return this.#store(body, 'NODE_ENDORSED');
  }

  assessPrivilegedSink({ authority_node_id, data_node_ids = [], sink_kind, requested_capabilities = [] } = {}) {
    const authorityId = token(authority_node_id, NODE_ID_RE, 128, 'taint_authority_node_id_invalid', (v) => v.toLowerCase());
    const authority = this.#require(authorityId);
    const sink = token(sink_kind, TOKEN_RE, 64, 'taint_sink_kind_invalid', (v) => v.toUpperCase());
    if (!SINK_SET.has(sink)) throw new TrustTaintGraphError('taint_sink_kind_invalid');
    const dataIds = data_node_ids.length ? nodeIds(data_node_ids, 'taint_data_node_ids_invalid') : Object.freeze([]);
    if (dataIds.includes(authorityId)) throw new TrustTaintGraphError('taint_authority_data_lane_alias_forbidden');
    const dataNodes = dataIds.map((id) => this.#require(id));
    const requested = uniqueTokens(requested_capabilities, SINK_SET, 'taint_requested_capabilities_invalid');
    if (authority.authority_eligible !== true) throw new TrustTaintGraphError('taint_authority_node_not_eligible');
    if (!authority.authority_capabilities.includes(sink)) throw new TrustTaintGraphError('taint_authority_sink_capability_missing');
    if (requested.some((cap) => !authority.authority_capabilities.includes(cap))) throw new TrustTaintGraphError('taint_requested_capability_not_granted');
    const taintedDataNodes = dataNodes.filter((node) => node.taint_source_ids.length > 0).map((node) => node.node_id).sort();
    const taintSources = [...new Set(dataNodes.flatMap((node) => node.taint_source_ids))].sort();
    const receipt = {
      version: TRUST_TAINT_GRAPH_VERSION,
      allowed: true,
      sink_kind: sink,
      authority_node_id: authorityId,
      authority_integrity: authority.integrity,
      authority_capabilities: [...authority.authority_capabilities],
      requested_capabilities: [...requested],
      data_node_ids: [...dataIds],
      tainted_data_node_ids: taintedDataNodes,
      taint_source_ids: taintSources,
      data_granted_authority: false,
      live_revalidation_required: sink === 'BROWSER_ACTUATION' && taintedDataNodes.length > 0,
      authority_effect: false,
      actuation_eligible: false,
    };
    this.#record('SINK_ASSESSED', { sink_kind: sink, authority_node_id: authorityId, taint_source_ids: taintSources });
    return deepFreeze(receipt);
  }

  getNode(nodeId) {
    const id = token(nodeId, NODE_ID_RE, 128, 'taint_node_id_invalid', (v) => v.toLowerCase());
    return this.#nodes.has(id) ? clone(this.#nodes.get(id)) : null;
  }

  snapshot() {
    return deepFreeze({
      version: TRUST_TAINT_GRAPH_VERSION,
      nodes: [...this.#nodes.values()].map(clone),
      events: this.#events.map(clone),
      authority_effect: false,
      actuation_eligible: false,
    });
  }

  #assertNew(id) { if (this.#nodes.has(id)) throw new TrustTaintGraphError('taint_node_id_exists'); }
  #require(id) {
    const node = this.#nodes.get(id);
    if (!node) throw new TrustTaintGraphError('taint_node_not_found');
    return node;
  }
  #store(body, eventType) {
    const node = deepFreeze({ ...body, node_digest: digestObject(body) });
    this.#nodes.set(node.node_id, node);
    this.#record(eventType, { node_id: node.node_id, node_digest: node.node_digest, integrity: node.integrity });
    return clone(node);
  }
  #record(eventType, detail) {
    const event = deepFreeze({
      version: TRUST_TAINT_GRAPH_VERSION,
      seq: ++this.#seq,
      event_type: eventType,
      detail: clone(detail),
      authority_effect: false,
      actuation_eligible: false,
    });
    this.#events.push(event);
    return event;
  }
}

export function createTrustTaintGraph(options) { return new TrustTaintGraphV1(options); }
