import crypto from 'node:crypto';

export const RSI_SKILL_CAPSULE_SCHEMA = 'metaengine.rsi.skill-capsule.v1';
export const RSI_SKILL_EVIDENCE_SCHEMA = 'metaengine.rsi.skill-evidence.v1';
export const RSI_SKILL_LIBRARY_SCHEMA = 'metaengine.rsi.skill-library.v1';
export const RSI_SKILL_COMPOSITION_PLAN_SCHEMA = 'metaengine.rsi.skill-composition-plan.v1';
export const RSI_SKILL_USAGE_RECEIPT_SCHEMA = 'metaengine.rsi.skill-usage-receipt.v1';
export const RSI_SKILL_PORTABILITY_RECEIPT_SCHEMA = 'metaengine.rsi.skill-portability-receipt.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;

const MAX_SKILLS = 1024;
const MAX_COMPONENTS = 32;
const MAX_COMPOSITION_NODES = 16;
const MAX_COMPOSITION_EDGES = 32;
const MAX_COMPOSITION_DEPTH = 8;
const MAX_CONTEXT_TOKENS = 262_144;
const MAX_OUTPUT_TOKENS = 65_536;
const MAX_INVOCATIONS = 64;
const MAX_EVIDENCE_REFS = 32;

const SKILL_ROLES = new Set([
  'ANALYZER',
  'RETRIEVER',
  'ALLOCATOR',
  'PROPOSER',
  'EVOLVER',
  'VERIFIER',
  'TRACE_SUMMARIZER',
  'PLAN_TRANSFORM',
]);

const SAFE_CAPABILITIES = new Set([
  'READ_VERIFIED_CONTEXT',
  'SELECT_VERIFIED_MEMORY',
  'PROPOSE_TYPED_TRANSFORM',
  'CHECK_TYPED_OUTPUT',
  'SUMMARIZE_VERIFIED_TRACE',
  'ALLOCATE_PROPOSAL_BUDGET',
  'ANALYZE_FAILURE_CODES',
  'SYNTHESIZE_STRUCTURED_PLAN',
]);

const FORBIDDEN_CAPABILITIES = new Set([
  'DIRECT_TOOL_EXECUTION',
  'ARBITRARY_TOOL_EXECUTION',
  'SHELL',
  'EVAL',
  'PROCESS',
  'NETWORK_AUTHORITY',
  'FILESYSTEM_WRITE_AUTHORITY',
  'SCHEDULER_AUTHORITY',
  'PROMOTION_AUTHORITY',
  'SELF_UPDATE_AUTHORITY',
  'SIGNING_AUTHORITY',
  'SECRET_READ_AUTHORITY',
  'MODEL_TEXT_AUTHORITY',
]);

const USAGE_OUTCOMES = new Set([
  'HELPFUL',
  'NEUTRAL',
  'HARMFUL',
  'INSUFFICIENT_EVIDENCE',
]);

const PORTABILITY_OUTCOMES = new Set([
  'PORTABLE_VERIFIED',
  'NEGATIVE_TRANSFER',
  'INSUFFICIENT_EVIDENCE',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_skill_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_skill_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_skill_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_skill_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_skill_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_skill_${label}_invalid`);
  return out;
}

function finiteNumber(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`rsi_skill_${label}_invalid`);
  return out;
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw new Error(`rsi_skill_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_skill_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_skill_${label}_fields_invalid`);
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'direct_tool_execution_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_skill_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_skill_${label}_automatic_retry_invalid`);
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error('rsi_skill_capabilities_invalid');
  const set = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, 'capability');
    if (FORBIDDEN_CAPABILITIES.has(token)) throw new Error('rsi_skill_forbidden_capability');
    if (!SAFE_CAPABILITIES.has(token)) throw new Error('rsi_skill_unknown_capability');
    if (set.has(token)) throw new Error('rsi_skill_capability_duplicate');
    set.add(token);
  }
  return Object.freeze([...set].sort());
}

function normalizeComponents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMPONENTS) throw new Error('rsi_skill_components_invalid');
  const seen = new Set();
  return Object.freeze(value.map((row) => {
    exactKeys(row, ['component_id','artifact_digest','kind'], [], 'component');
    const id = boundedId(row.component_id, 'component_id');
    if (seen.has(id)) throw new Error('rsi_skill_component_duplicate');
    seen.add(id);
    return Object.freeze({
      component_id: id,
      artifact_digest: exactDigest(row.artifact_digest, 'component_artifact'),
      kind: boundedToken(row.kind, 'component_kind'),
    });
  }).sort((a,b)=>a.component_id.localeCompare(b.component_id)));
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_skill_evidence_refs_invalid');
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_skill_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

function normalizeRole(value) {
  const role = boundedToken(value, 'role');
  if (!SKILL_ROLES.has(role)) throw new Error('rsi_skill_role_invalid');
  return role;
}

function normalizeModelFamily(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,95}$/.test(out)) throw new Error(`rsi_skill_${label}_model_family_invalid`);
  return out;
}

export function createRsiSkillCapsule({
  skill_id,
  version,
  parent_skill_digest = null,
  source_candidate_sha,
  role,
  input_schema_digest,
  output_schema_digest,
  implementation_digest,
  components,
  capabilities,
  max_context_tokens,
  max_output_tokens,
  max_invocations,
  deterministic_interface = true,
  external_builder = false,
  authored_by_candidate = true,
} = {}) {
  if (external_builder !== true || authored_by_candidate !== false) throw new Error('rsi_skill_capsule_external_origin_required');
  const checkedRole = normalizeRole(role);
  const core = {
    schema: RSI_SKILL_CAPSULE_SCHEMA,
    version: 1,
    skill_id: boundedId(skill_id, 'skill_id'),
    skill_version: positiveInt(version, 'skill_version', 1_000_000),
    parent_skill_digest: parent_skill_digest == null ? null : exactDigest(parent_skill_digest, 'parent_skill'),
    source_candidate_sha: exactSha(source_candidate_sha, 'source_candidate'),
    role: checkedRole,
    input_schema_digest: exactDigest(input_schema_digest, 'input_schema'),
    output_schema_digest: exactDigest(output_schema_digest, 'output_schema'),
    implementation_digest: exactDigest(implementation_digest, 'implementation'),
    components: normalizeComponents(components),
    capabilities: normalizeCapabilities(capabilities),
    max_context_tokens: positiveInt(max_context_tokens, 'max_context_tokens', MAX_CONTEXT_TOKENS),
    max_output_tokens: positiveInt(max_output_tokens, 'max_output_tokens', MAX_OUTPUT_TOKENS),
    max_invocations: positiveInt(max_invocations, 'max_invocations', MAX_INVOCATIONS),
    deterministic_interface: deterministic_interface === true,
    raw_prompt_text_stored: false,
    raw_model_transcript_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    arbitrary_code_execution_surface: false,
    direct_tool_execution_allowed: false,
    candidate_can_mark_verified: false,
    candidate_can_edit_trust_root: false,
    external_builder: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const capsuleDigest = digest(core);
  return Object.freeze({
    ...core,
    skill_digest: capsuleDigest,
  });
}

export function verifyRsiSkillCapsule(capsule) {
  if (!plainObject(capsule) || capsule.schema !== RSI_SKILL_CAPSULE_SCHEMA || capsule.version !== 1) throw new Error('rsi_skill_capsule_invalid');
  assertZeroAuthority(capsule, 'capsule');
  if (
    capsule.raw_prompt_text_stored !== false
    || capsule.raw_model_transcript_stored !== false
    || capsule.raw_page_text_stored !== false
    || capsule.raw_user_input_stored !== false
    || capsule.secret_material_stored !== false
    || capsule.arbitrary_code_execution_surface !== false
    || capsule.direct_tool_execution_allowed !== false
    || capsule.candidate_can_mark_verified !== false
    || capsule.candidate_can_edit_trust_root !== false
    || capsule.external_builder !== true
    || capsule.authored_by_candidate !== false
  ) throw new Error('rsi_skill_capsule_policy_invalid');

  const canonical = createRsiSkillCapsule({
    skill_id: capsule.skill_id,
    version: capsule.skill_version,
    parent_skill_digest: capsule.parent_skill_digest,
    source_candidate_sha: capsule.source_candidate_sha,
    role: capsule.role,
    input_schema_digest: capsule.input_schema_digest,
    output_schema_digest: capsule.output_schema_digest,
    implementation_digest: capsule.implementation_digest,
    components: capsule.components,
    capabilities: capsule.capabilities,
    max_context_tokens: capsule.max_context_tokens,
    max_output_tokens: capsule.max_output_tokens,
    max_invocations: capsule.max_invocations,
    deterministic_interface: capsule.deterministic_interface,
    external_builder: true,
    authored_by_candidate: false,
  });
  if (canonical.skill_digest !== exactDigest(capsule.skill_digest, 'capsule')) throw new Error('rsi_skill_capsule_digest_mismatch');
  return canonical;
}

export function createRsiSkillEvidence({
  capsule,
  hidden_holdout_digest,
  evaluator_root_digest,
  unit_test_digest,
  runtime_feedback_digest,
  attempt_count,
  success_count,
  hard_invariants_pass,
  verified_for_library,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiSkillCapsule(capsule);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_skill_evidence_external_origin_required');
  const attempts = positiveInt(attempt_count, 'attempt_count', 1_000_000);
  const successes = nonNegativeInt(success_count, 'success_count', attempts);
  const hard = hard_invariants_pass === true;
  const verified = verified_for_library === true;
  if (verified && !hard) throw new Error('rsi_skill_verified_without_hard_invariants');
  const core = {
    schema: RSI_SKILL_EVIDENCE_SCHEMA,
    version: 1,
    skill_id: checked.skill_id,
    skill_digest: checked.skill_digest,
    skill_version: checked.skill_version,
    source_candidate_sha: checked.source_candidate_sha,
    hidden_holdout_digest: exactDigest(hidden_holdout_digest, 'hidden_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    unit_test_digest: exactDigest(unit_test_digest, 'unit_test'),
    runtime_feedback_digest: exactDigest(runtime_feedback_digest, 'runtime_feedback'),
    attempt_count: attempts,
    success_count: successes,
    observed_success_rate: successes / attempts,
    hard_invariants_pass: hard,
    verified_for_library: verified,
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    candidate_can_self_certify_skill: false,
    evidence_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, evidence_digest: digest(core) });
}

export function verifyRsiSkillEvidence(evidence, capsule) {
  if (!plainObject(evidence) || evidence.schema !== RSI_SKILL_EVIDENCE_SCHEMA || evidence.version !== 1) throw new Error('rsi_skill_evidence_invalid');
  assertZeroAuthority(evidence, 'evidence');
  if (
    evidence.external_evaluator !== true
    || evidence.authored_by_candidate !== false
    || evidence.candidate_can_self_certify_skill !== false
    || evidence.evidence_is_promotion_authority !== false
  ) throw new Error('rsi_skill_evidence_policy_invalid');
  const canonical = createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest: evidence.hidden_holdout_digest,
    evaluator_root_digest: evidence.evaluator_root_digest,
    unit_test_digest: evidence.unit_test_digest,
    runtime_feedback_digest: evidence.runtime_feedback_digest,
    attempt_count: evidence.attempt_count,
    success_count: evidence.success_count,
    hard_invariants_pass: evidence.hard_invariants_pass,
    verified_for_library: evidence.verified_for_library,
    evidence_refs: evidence.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.evidence_digest !== exactDigest(evidence.evidence_digest, 'evidence')) throw new Error('rsi_skill_evidence_digest_mismatch');
  return canonical;
}

export function createRsiVerifiedSkillLibrary({
  library_id,
  entries,
  external_library_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_library_owner !== true || authored_by_candidate !== false) throw new Error('rsi_skill_library_external_origin_required');
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_SKILLS) throw new Error('rsi_skill_library_entries_invalid');

  const normalized = [];
  const seenDigest = new Set();
  const versionMap = new Map();
  for (const row of entries) {
    if (!plainObject(row)) throw new Error('rsi_skill_library_entry_invalid');
    const capsule = verifyRsiSkillCapsule(row.capsule);
    const evidence = verifyRsiSkillEvidence(row.evidence, capsule);
    if (evidence.verified_for_library !== true || evidence.hard_invariants_pass !== true) throw new Error('rsi_skill_library_unverified_entry');
    if (seenDigest.has(capsule.skill_digest)) throw new Error('rsi_skill_library_digest_duplicate');
    seenDigest.add(capsule.skill_digest);
    const key = `${capsule.skill_id}:${capsule.skill_version}`;
    if (versionMap.has(key)) throw new Error('rsi_skill_library_version_duplicate');
    versionMap.set(key, capsule.skill_digest);
    normalized.push(Object.freeze({
      skill_id: capsule.skill_id,
      skill_version: capsule.skill_version,
      skill_digest: capsule.skill_digest,
      evidence_digest: evidence.evidence_digest,
      role: capsule.role,
      input_schema_digest: capsule.input_schema_digest,
      output_schema_digest: capsule.output_schema_digest,
      capabilities: capsule.capabilities,
      max_context_tokens: capsule.max_context_tokens,
      max_output_tokens: capsule.max_output_tokens,
      max_invocations: capsule.max_invocations,
      observed_success_rate: evidence.observed_success_rate,
      source_candidate_sha: capsule.source_candidate_sha,
      capsule,
      evidence,
      state: 'VERIFIED',
      reusable: true,
      direct_execution_allowed: false,
      candidate_can_activate_without_plan: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      signing_authority: false,
      direct_tool_execution_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    }));
  }
  normalized.sort((a,b)=>a.skill_id.localeCompare(b.skill_id)||a.skill_version-b.skill_version);

  const core = {
    schema: RSI_SKILL_LIBRARY_SCHEMA,
    version: 1,
    library_id: boundedId(library_id, 'library_id'),
    entries: normalized,
    entry_count: normalized.length,
    library_is_append_only_evidence: true,
    stable_versioning_required: true,
    candidate_can_mark_skill_verified: false,
    candidate_can_replace_skill_in_place: false,
    candidate_can_activate_skill_directly: false,
    cross_context_portability_requires_receipt: true,
    raw_model_transcript_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    external_library_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, library_digest: digest(core) });
}

export function verifyRsiVerifiedSkillLibrary(library) {
  if (!plainObject(library) || library.schema !== RSI_SKILL_LIBRARY_SCHEMA || library.version !== 1) throw new Error('rsi_skill_library_invalid');
  assertZeroAuthority(library, 'library');
  if (
    library.library_is_append_only_evidence !== true
    || library.stable_versioning_required !== true
    || library.candidate_can_mark_skill_verified !== false
    || library.candidate_can_replace_skill_in_place !== false
    || library.candidate_can_activate_skill_directly !== false
    || library.cross_context_portability_requires_receipt !== true
    || library.raw_model_transcript_stored !== false
    || library.raw_page_text_stored !== false
    || library.raw_user_input_stored !== false
    || library.secret_material_stored !== false
    || library.external_library_owner !== true
    || library.authored_by_candidate !== false
  ) throw new Error('rsi_skill_library_policy_invalid');
  const canonical = createRsiVerifiedSkillLibrary({
    library_id: library.library_id,
    entries: library.entries.map((entry) => ({
      capsule: entry.capsule,
      evidence: entry.evidence,
    })),
    external_library_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.library_digest !== exactDigest(library.library_digest, 'library')) throw new Error('rsi_skill_library_digest_mismatch');
  return canonical;
}

function normalizeCompositionNodes(nodes, library) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_COMPOSITION_NODES) throw new Error('rsi_skill_composition_nodes_invalid');
  const ids = new Set();
  return Object.freeze(nodes.map((row) => {
    exactKeys(row, ['node_id','skill_id','skill_version','skill_digest','max_invocations'], [], 'composition_node');
    const nodeId = boundedId(row.node_id, 'composition_node_id');
    if (ids.has(nodeId)) throw new Error('rsi_skill_composition_node_duplicate');
    ids.add(nodeId);
    const skillId = boundedId(row.skill_id, 'composition_skill_id');
    const skillVersion = positiveInt(row.skill_version, 'composition_skill_version', 1_000_000);
    const skillDigest = exactDigest(row.skill_digest, 'composition_skill');
    const entry = library.entries.find((candidate) =>
      candidate.skill_id === skillId
      && candidate.skill_version === skillVersion
      && candidate.skill_digest === skillDigest);
    if (!entry) throw new Error('rsi_skill_composition_skill_not_in_library');
    const maxInvocations = positiveInt(row.max_invocations, 'composition_node_max_invocations', entry.max_invocations);
    return Object.freeze({
      node_id: nodeId,
      skill_id: skillId,
      skill_version: skillVersion,
      skill_digest: skillDigest,
      role: entry.role,
      input_schema_digest: entry.input_schema_digest,
      output_schema_digest: entry.output_schema_digest,
      max_invocations: maxInvocations,
      direct_execution_allowed: false,
    });
  }));
}

function normalizeCompositionEdges(edges, nodes) {
  if (!Array.isArray(edges) || edges.length > MAX_COMPOSITION_EDGES) throw new Error('rsi_skill_composition_edges_invalid');
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const seen = new Set();
  const out = edges.map((row) => {
    exactKeys(row, ['from','to'], [], 'composition_edge');
    const from = boundedId(row.from, 'composition_edge_from');
    const to = boundedId(row.to, 'composition_edge_to');
    if (from === to) throw new Error('rsi_skill_composition_self_edge');
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target) throw new Error('rsi_skill_composition_edge_node_missing');
    if (source.output_schema_digest !== target.input_schema_digest) throw new Error('rsi_skill_composition_interface_mismatch');
    const key = `${from}->${to}`;
    if (seen.has(key)) throw new Error('rsi_skill_composition_edge_duplicate');
    seen.add(key);
    return Object.freeze({ from, to });
  });
  return Object.freeze(out.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)));
}

function compositionTopology(nodes, edges) {
  const indegree = new Map(nodes.map((node) => [node.node_id, 0]));
  const children = new Map(nodes.map((node) => [node.node_id, []]));
  for (const edge of edges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    children.get(edge.from).push(edge.to);
  }
  const queue = [...nodes.filter((node)=>indegree.get(node.node_id)===0).map((node)=>node.node_id)].sort();
  const order = [];
  const depth = new Map(queue.map((id)=>[id,1]));
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const child of children.get(id)) {
      depth.set(child, Math.max(depth.get(child)||1,(depth.get(id)||1)+1));
      indegree.set(child, indegree.get(child)-1);
      if (indegree.get(child)===0) {
        queue.push(child);
        queue.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('rsi_skill_composition_cycle_forbidden');
  const maxDepth = Math.max(...nodes.map((node)=>depth.get(node.node_id)||1));
  if (maxDepth > MAX_COMPOSITION_DEPTH) throw new Error('rsi_skill_composition_depth_exceeded');
  return Object.freeze({
    topological_order: Object.freeze(order),
    max_depth: maxDepth,
    entry_nodes: Object.freeze(nodes.filter((node)=>!edges.some((edge)=>edge.to===node.node_id)).map((node)=>node.node_id).sort()),
    exit_nodes: Object.freeze(nodes.filter((node)=>!edges.some((edge)=>edge.from===node.node_id)).map((node)=>node.node_id).sort()),
  });
}

export function createRsiSkillCompositionPlan({
  plan_id,
  library,
  input_schema_digest,
  output_schema_digest,
  nodes,
  edges,
  max_total_context_tokens,
  max_total_output_tokens,
  external_planner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  if (external_planner !== true || authored_by_candidate !== false) throw new Error('rsi_skill_composition_external_origin_required');
  const checkedNodes = normalizeCompositionNodes(nodes, checkedLibrary);
  const checkedEdges = normalizeCompositionEdges(edges, checkedNodes);
  const topology = compositionTopology(checkedNodes, checkedEdges);
  const inputDigest = exactDigest(input_schema_digest, 'composition_input_schema');
  const outputDigest = exactDigest(output_schema_digest, 'composition_output_schema');

  for (const entryNode of topology.entry_nodes) {
    const node = checkedNodes.find((row)=>row.node_id===entryNode);
    if (node.input_schema_digest !== inputDigest) throw new Error('rsi_skill_composition_entry_schema_mismatch');
  }
  for (const exitNode of topology.exit_nodes) {
    const node = checkedNodes.find((row)=>row.node_id===exitNode);
    if (node.output_schema_digest !== outputDigest) throw new Error('rsi_skill_composition_exit_schema_mismatch');
  }

  const requestedContext = positiveInt(max_total_context_tokens, 'composition_max_context_tokens', MAX_CONTEXT_TOKENS);
  const requestedOutput = positiveInt(max_total_output_tokens, 'composition_max_output_tokens', MAX_OUTPUT_TOKENS);
  const declaredContext = checkedNodes.reduce((sum,node)=>{
    const entry=checkedLibrary.entries.find((x)=>x.skill_digest===node.skill_digest);
    return sum + Math.min(entry.max_context_tokens,node.max_invocations*entry.max_context_tokens);
  },0);
  const declaredOutput = checkedNodes.reduce((sum,node)=>{
    const entry=checkedLibrary.entries.find((x)=>x.skill_digest===node.skill_digest);
    return sum + Math.min(entry.max_output_tokens,node.max_invocations*entry.max_output_tokens);
  },0);
  if (declaredContext > requestedContext) throw new Error('rsi_skill_composition_context_budget_exceeded');
  if (declaredOutput > requestedOutput) throw new Error('rsi_skill_composition_output_budget_exceeded');

  const core = {
    schema: RSI_SKILL_COMPOSITION_PLAN_SCHEMA,
    version: 1,
    plan_id: boundedId(plan_id, 'composition_plan_id'),
    library_id: checkedLibrary.library_id,
    library_digest: checkedLibrary.library_digest,
    input_schema_digest: inputDigest,
    output_schema_digest: outputDigest,
    nodes: checkedNodes,
    edges: checkedEdges,
    topological_order: topology.topological_order,
    entry_nodes: topology.entry_nodes,
    exit_nodes: topology.exit_nodes,
    max_depth: topology.max_depth,
    max_total_context_tokens: requestedContext,
    max_total_output_tokens: requestedOutput,
    declared_context_tokens: declaredContext,
    declared_output_tokens: declaredOutput,
    composition_is_dag: true,
    exact_interface_compatibility_required: true,
    verified_library_skills_only: true,
    direct_execution_allowed: false,
    candidate_can_inject_unverified_skill: false,
    candidate_can_skip_interface_check: false,
    external_planner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, plan_digest: digest(core) });
}

export function verifyRsiSkillCompositionPlan(plan, library) {
  if (!plainObject(plan) || plan.schema !== RSI_SKILL_COMPOSITION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_skill_composition_plan_invalid');
  assertZeroAuthority(plan, 'composition_plan');
  if (
    plan.composition_is_dag !== true
    || plan.exact_interface_compatibility_required !== true
    || plan.verified_library_skills_only !== true
    || plan.direct_execution_allowed !== false
    || plan.candidate_can_inject_unverified_skill !== false
    || plan.candidate_can_skip_interface_check !== false
    || plan.external_planner !== true
    || plan.authored_by_candidate !== false
  ) throw new Error('rsi_skill_composition_plan_policy_invalid');
  const canonical = createRsiSkillCompositionPlan({
    plan_id: plan.plan_id,
    library,
    input_schema_digest: plan.input_schema_digest,
    output_schema_digest: plan.output_schema_digest,
    nodes: plan.nodes.map((node)=>({
      node_id: node.node_id,
      skill_id: node.skill_id,
      skill_version: node.skill_version,
      skill_digest: node.skill_digest,
      max_invocations: node.max_invocations,
    })),
    edges: plan.edges,
    max_total_context_tokens: plan.max_total_context_tokens,
    max_total_output_tokens: plan.max_total_output_tokens,
    external_planner: true,
    authored_by_candidate: false,
  });
  if (canonical.plan_digest !== exactDigest(plan.plan_digest, 'composition_plan')) throw new Error('rsi_skill_composition_plan_digest_mismatch');
  return canonical;
}

export function createRsiSkillUsageReceipt({
  plan,
  library,
  target_context_digest,
  hidden_holdout_digest,
  evaluator_root_digest,
  outcome,
  measured_delta,
  hard_invariants_pass,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPlan = verifyRsiSkillCompositionPlan(plan, library);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_skill_usage_external_origin_required');
  const normalizedOutcome = boundedToken(outcome, 'usage_outcome');
  if (!USAGE_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_skill_usage_outcome_invalid');
  const hard = hard_invariants_pass === true;
  if (normalizedOutcome === 'HELPFUL' && !hard) throw new Error('rsi_skill_usage_helpful_without_hard_invariants');
  const core = {
    schema: RSI_SKILL_USAGE_RECEIPT_SCHEMA,
    version: 1,
    plan_id: checkedPlan.plan_id,
    plan_digest: checkedPlan.plan_digest,
    library_digest: checkedPlan.library_digest,
    target_context_digest: exactDigest(target_context_digest, 'usage_target_context'),
    hidden_holdout_digest: exactDigest(hidden_holdout_digest, 'usage_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'usage_evaluator_root'),
    outcome: normalizedOutcome,
    measured_delta: finiteNumber(measured_delta, 'usage_measured_delta'),
    hard_invariants_pass: hard,
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    usage_feedback_is_skill_memory_only: true,
    usage_receipt_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiSkillUsageReceipt(receipt, plan, library) {
  if (!plainObject(receipt) || receipt.schema !== RSI_SKILL_USAGE_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_skill_usage_receipt_invalid');
  assertZeroAuthority(receipt, 'usage_receipt');
  if (
    receipt.external_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.usage_feedback_is_skill_memory_only !== true
    || receipt.usage_receipt_is_promotion_authority !== false
  ) throw new Error('rsi_skill_usage_receipt_policy_invalid');
  const canonical = createRsiSkillUsageReceipt({
    plan,
    library,
    target_context_digest: receipt.target_context_digest,
    hidden_holdout_digest: receipt.hidden_holdout_digest,
    evaluator_root_digest: receipt.evaluator_root_digest,
    outcome: receipt.outcome,
    measured_delta: receipt.measured_delta,
    hard_invariants_pass: receipt.hard_invariants_pass,
    evidence_refs: receipt.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'usage_receipt')) throw new Error('rsi_skill_usage_receipt_digest_mismatch');
  return canonical;
}

export function createRsiSkillPortabilityReceipt({
  skill,
  evidence,
  target_model_family,
  target_environment_family,
  target_context_digest,
  target_holdout_digest,
  evaluator_root_digest,
  outcome,
  hard_invariants_pass,
  measured_delta,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedSkill = verifyRsiSkillCapsule(skill);
  verifyRsiSkillEvidence(evidence, checkedSkill);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_skill_portability_external_origin_required');
  const normalizedOutcome = boundedToken(outcome, 'portability_outcome');
  if (!PORTABILITY_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_skill_portability_outcome_invalid');
  const hard = hard_invariants_pass === true;
  if (normalizedOutcome === 'PORTABLE_VERIFIED' && !hard) throw new Error('rsi_skill_portability_positive_without_hard_invariants');
  const core = {
    schema: RSI_SKILL_PORTABILITY_RECEIPT_SCHEMA,
    version: 1,
    skill_id: checkedSkill.skill_id,
    skill_version: checkedSkill.skill_version,
    skill_digest: checkedSkill.skill_digest,
    source_candidate_sha: checkedSkill.source_candidate_sha,
    target_model_family: normalizeModelFamily(target_model_family, 'target'),
    target_environment_family: boundedToken(target_environment_family, 'target_environment'),
    target_context_digest: exactDigest(target_context_digest, 'portability_target_context'),
    target_holdout_digest: exactDigest(target_holdout_digest, 'portability_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'portability_evaluator_root'),
    outcome: normalizedOutcome,
    hard_invariants_pass: hard,
    measured_delta: finiteNumber(measured_delta, 'portability_measured_delta'),
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    portable_to_target: normalizedOutcome === 'PORTABLE_VERIFIED',
    negative_transfer_memory: normalizedOutcome === 'NEGATIVE_TRANSFER',
    insufficient_evidence: normalizedOutcome === 'INSUFFICIENT_EVIDENCE',
    candidate_can_self_certify_portability: false,
    portability_receipt_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiSkillPortabilityReceipt(receipt, skill, evidence) {
  if (!plainObject(receipt) || receipt.schema !== RSI_SKILL_PORTABILITY_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_skill_portability_receipt_invalid');
  assertZeroAuthority(receipt, 'portability_receipt');
  if (
    receipt.external_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.candidate_can_self_certify_portability !== false
    || receipt.portability_receipt_is_promotion_authority !== false
  ) throw new Error('rsi_skill_portability_receipt_policy_invalid');
  const canonical = createRsiSkillPortabilityReceipt({
    skill,
    evidence,
    target_model_family: receipt.target_model_family,
    target_environment_family: receipt.target_environment_family,
    target_context_digest: receipt.target_context_digest,
    target_holdout_digest: receipt.target_holdout_digest,
    evaluator_root_digest: receipt.evaluator_root_digest,
    outcome: receipt.outcome,
    hard_invariants_pass: receipt.hard_invariants_pass,
    measured_delta: receipt.measured_delta,
    evidence_refs: receipt.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'portability_receipt')) throw new Error('rsi_skill_portability_receipt_digest_mismatch');
  return canonical;
}

export function rsiVerifiedSkillLibraryTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.verified-skill-library-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-verified-skill-library.mjs',
    roles: [...SKILL_ROLES].sort(),
    safe_capabilities: [...SAFE_CAPABILITIES].sort(),
    forbidden_capabilities: [...FORBIDDEN_CAPABILITIES].sort(),
    stable_versioning_required: true,
    verified_library_skills_only: true,
    exact_interface_compatibility_required: true,
    composition_is_dag: true,
    max_composition_nodes: MAX_COMPOSITION_NODES,
    max_composition_depth: MAX_COMPOSITION_DEPTH,
    cross_context_portability_requires_receipt: true,
    raw_model_transcript_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    candidate_can_mark_skill_verified: false,
    candidate_can_activate_skill_directly: false,
    candidate_can_self_certify_portability: false,
    arbitrary_code_execution_surface: false,
    direct_tool_execution_allowed: false,
    skill_library_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, skill_root_digest: digest(root) });
}
