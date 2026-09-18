import crypto from 'node:crypto';

export const RSI_EXPERIENCE_CASE_SCHEMA = 'metaengine.rsi.experience-case.v1';
export const RSI_EXPERIENCE_UTILITY_RECEIPT_SCHEMA = 'metaengine.rsi.experience-utility-receipt.v1';
export const RSI_EXPERIENCE_GRAPH_SNAPSHOT_SCHEMA = 'metaengine.rsi.experience-graph-snapshot.v1';
export const RSI_EXPERIENCE_GRAPH_QUERY_SCHEMA = 'metaengine.rsi.experience-graph-query.v1';
export const RSI_EXPERIENCE_GRAPH_RETRIEVAL_SCHEMA = 'metaengine.rsi.experience-graph-retrieval.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_CASES = 4096;
const MAX_ANCHORS = 2048;
const MAX_SIMILARITY_EDGES = 16384;
const MAX_CORRECTION_EDGES = 8192;
const MAX_UTILITY_RECEIPTS = 16384;
const MAX_TAGS = 24;
const MAX_DIGEST_REFS = 32;
const MAX_EVIDENCE_REFS = 32;
const MAX_QUERY_BRIDGES = 16;
const MAX_RETRIEVAL_CASES = 12;
const MAX_DIFFUSION_HOPS = 2;
const SIMILARITY_THRESHOLD = 0.70;

const CASE_OUTCOMES = new Set(['SUCCESS', 'FAILURE']);
const UTILITY_OUTCOMES = new Set(['HELPFUL', 'HARMFUL', 'NEUTRAL']);

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

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw new Error(`rsi_exg_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_exg_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_exg_${label}_fields_invalid`);
  }
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_exg_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_exg_${label}_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_exg_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_exg_${label}_digest_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_exg_${label}_candidate_id_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_exg_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_exg_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_exg_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_exg_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_exg_${label}_automatic_retry_invalid`);
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalizeTokens(value, label, { min = 0, max = MAX_TAGS } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`rsi_exg_${label}_invalid`);
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (seen.has(token)) throw new Error(`rsi_exg_${label}_duplicate`);
    seen.add(token);
    out.push(token);
  }
  return out.sort();
}

function normalizeDigestRefs(value, label) {
  if (!Array.isArray(value) || value.length > MAX_DIGEST_REFS) throw new Error(`rsi_exg_${label}_invalid`);
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const ref = exactDigest(raw, label);
    if (seen.has(ref)) throw new Error(`rsi_exg_${label}_duplicate`);
    seen.add(ref);
    out.push(ref);
  }
  return out.sort();
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_exg_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_exg_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function normalizeTaskAnchor(anchor) {
  exactKeys(anchor, [
    'task_id',
    'task_signature_digest',
    'challenge_family',
    'hidden_manifest_digest',
    'external_writer',
    'authored_by_candidate',
  ], [], 'task_anchor');
  if (anchor.external_writer !== true || anchor.authored_by_candidate !== false) throw new Error('rsi_exg_task_anchor_external_origin_required');
  return Object.freeze({
    task_id: boundedId(anchor.task_id, 'task_id'),
    task_signature_digest: exactDigest(anchor.task_signature_digest, 'task_signature'),
    challenge_family: boundedToken(anchor.challenge_family, 'challenge_family'),
    hidden_manifest_digest: exactDigest(anchor.hidden_manifest_digest, 'hidden_manifest'),
    external_writer: true,
    authored_by_candidate: false,
  });
}

export function createRsiExperienceCase({
  case_id,
  task_id,
  task_signature_digest,
  attempt_index,
  candidate_id,
  candidate_sha,
  outcome,
  environment_fingerprint,
  model_family,
  execution_signature_digest,
  failure_codes = [],
  mechanism_tags = [],
  lesson_digests = [],
  attribution_digests = [],
  transfer_receipt_digests = [],
  evidence_digest,
  evidence_refs,
  external_writer = false,
  authored_by_candidate = true,
} = {}) {
  if (external_writer !== true || authored_by_candidate !== false) throw new Error('rsi_exg_case_external_origin_required');
  const normalizedOutcome = boundedToken(outcome, 'case_outcome');
  if (!CASE_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_exg_case_outcome_invalid');
  const failures = normalizeTokens(failure_codes, 'failure_code');
  if (normalizedOutcome === 'SUCCESS' && failures.length > 0) throw new Error('rsi_exg_success_failure_codes_forbidden');
  if (normalizedOutcome === 'FAILURE' && failures.length < 1) throw new Error('rsi_exg_failure_codes_required');

  const core = {
    schema: RSI_EXPERIENCE_CASE_SCHEMA,
    version: 1,
    case_id: boundedId(case_id, 'case_id'),
    task_id: boundedId(task_id, 'task_id'),
    task_signature_digest: exactDigest(task_signature_digest, 'task_signature'),
    attempt_index: positiveInt(attempt_index, 'attempt_index', 1_000_000),
    candidate_id: exactCandidateId(candidate_id, 'case'),
    candidate_sha: exactSha(candidate_sha, 'case'),
    outcome: normalizedOutcome,
    environment_fingerprint: boundedId(environment_fingerprint, 'environment_fingerprint'),
    model_family: boundedToken(model_family, 'model_family'),
    execution_signature_digest: exactDigest(execution_signature_digest, 'execution_signature'),
    failure_codes: failures,
    mechanism_tags: normalizeTokens(mechanism_tags, 'mechanism_tag'),
    lesson_digests: normalizeDigestRefs(lesson_digests, 'lesson'),
    attribution_digests: normalizeDigestRefs(attribution_digests, 'attribution'),
    transfer_receipt_digests: normalizeDigestRefs(transfer_receipt_digests, 'transfer_receipt'),
    evidence_digest: exactDigest(evidence_digest, 'case_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_writer: true,
    authored_by_candidate: false,
    raw_trajectory_present: false,
    raw_page_text_present: false,
    raw_user_input_present: false,
    secret_material_present: false,
    model_narrative_is_authority: false,
    candidate_can_edit_case: false,
    source_context_truth_is_portable: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, case_digest: digest(core) });
}

export function verifyRsiExperienceCase(row) {
  exactKeys(row, [
    'schema','version','case_id','task_id','task_signature_digest','attempt_index','candidate_id','candidate_sha',
    'outcome','environment_fingerprint','model_family','execution_signature_digest','failure_codes','mechanism_tags',
    'lesson_digests','attribution_digests','transfer_receipt_digests','evidence_digest','evidence_refs','external_writer',
    'authored_by_candidate','raw_trajectory_present','raw_page_text_present','raw_user_input_present','secret_material_present',
    'model_narrative_is_authority','candidate_can_edit_case','source_context_truth_is_portable','execution_authority',
    'production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect',
    'case_digest',
  ], [], 'case');
  if (row.schema !== RSI_EXPERIENCE_CASE_SCHEMA || row.version !== 1) throw new Error('rsi_exg_case_invalid');
  assertZeroAuthority(row, 'case');
  if (
    row.external_writer !== true
    || row.authored_by_candidate !== false
    || row.raw_trajectory_present !== false
    || row.raw_page_text_present !== false
    || row.raw_user_input_present !== false
    || row.secret_material_present !== false
    || row.model_narrative_is_authority !== false
    || row.candidate_can_edit_case !== false
    || row.source_context_truth_is_portable !== false
  ) throw new Error('rsi_exg_case_policy_invalid');
  const canonical = createRsiExperienceCase({
    case_id: row.case_id,
    task_id: row.task_id,
    task_signature_digest: row.task_signature_digest,
    attempt_index: row.attempt_index,
    candidate_id: row.candidate_id,
    candidate_sha: row.candidate_sha,
    outcome: row.outcome,
    environment_fingerprint: row.environment_fingerprint,
    model_family: row.model_family,
    execution_signature_digest: row.execution_signature_digest,
    failure_codes: row.failure_codes,
    mechanism_tags: row.mechanism_tags,
    lesson_digests: row.lesson_digests,
    attribution_digests: row.attribution_digests,
    transfer_receipt_digests: row.transfer_receipt_digests,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_writer: true,
    authored_by_candidate: false,
  });
  if (canonical.case_digest !== exactDigest(row.case_digest, 'case')) throw new Error('rsi_exg_case_digest_mismatch');
  return canonical;
}

export function createRsiExperienceUtilityReceipt({
  receipt_id,
  case_id,
  target_context_digest,
  outcome,
  evidence_digest,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_exg_utility_external_origin_required');
  const normalizedOutcome = boundedToken(outcome, 'utility_outcome');
  if (!UTILITY_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_exg_utility_outcome_invalid');
  const core = {
    schema: RSI_EXPERIENCE_UTILITY_RECEIPT_SCHEMA,
    version: 1,
    receipt_id: boundedId(receipt_id, 'utility_receipt_id'),
    case_id: boundedId(case_id, 'utility_case_id'),
    target_context_digest: exactDigest(target_context_digest, 'target_context'),
    outcome: normalizedOutcome,
    evidence_digest: exactDigest(evidence_digest, 'utility_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    utility_is_contextual_not_global_truth: true,
    candidate_can_edit_utility: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiExperienceUtilityReceipt(row) {
  exactKeys(row, [
    'schema','version','receipt_id','case_id','target_context_digest','outcome','evidence_digest','evidence_refs',
    'external_evaluator','authored_by_candidate','utility_is_contextual_not_global_truth','candidate_can_edit_utility',
    'execution_authority','production_mutation_authority','promotion_authority','self_update_authority',
    'automatic_retry_allowed','authority_effect','receipt_digest',
  ], [], 'utility_receipt');
  if (row.schema !== RSI_EXPERIENCE_UTILITY_RECEIPT_SCHEMA || row.version !== 1) throw new Error('rsi_exg_utility_receipt_invalid');
  assertZeroAuthority(row, 'utility_receipt');
  if (
    row.external_evaluator !== true
    || row.authored_by_candidate !== false
    || row.utility_is_contextual_not_global_truth !== true
    || row.candidate_can_edit_utility !== false
  ) throw new Error('rsi_exg_utility_policy_invalid');
  const canonical = createRsiExperienceUtilityReceipt({
    receipt_id: row.receipt_id,
    case_id: row.case_id,
    target_context_digest: row.target_context_digest,
    outcome: row.outcome,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(row.receipt_digest, 'utility_receipt')) throw new Error('rsi_exg_utility_receipt_digest_mismatch');
  return canonical;
}

function normalizeSimilarityEdge(row, caseById) {
  exactKeys(row, [
    'left_case_id','right_case_id','similarity_score','embedding_model_digest','external_indexer','authored_by_candidate',
  ], [], 'similarity_edge');
  if (row.external_indexer !== true || row.authored_by_candidate !== false) throw new Error('rsi_exg_similarity_external_origin_required');
  let left = boundedId(row.left_case_id, 'similarity_left');
  let right = boundedId(row.right_case_id, 'similarity_right');
  if (left === right || !caseById.has(left) || !caseById.has(right)) throw new Error('rsi_exg_similarity_binding_invalid');
  if (right < left) [left, right] = [right, left];
  const score = unitInterval(row.similarity_score, 'similarity_score');
  return Object.freeze({
    left_case_id: left,
    right_case_id: right,
    similarity_score: score,
    embedding_model_digest: exactDigest(row.embedding_model_digest, 'embedding_model'),
    external_indexer: true,
    authored_by_candidate: false,
    similarity_is_retrieval_signal_only: true,
  });
}

function normalizeCorrectionEdge(row, caseById) {
  exactKeys(row, [
    'from_case_id','to_case_id','evidence_digest','external_verifier','authored_by_candidate',
  ], [], 'correction_edge');
  if (row.external_verifier !== true || row.authored_by_candidate !== false) throw new Error('rsi_exg_correction_external_origin_required');
  const fromId = boundedId(row.from_case_id, 'correction_from');
  const toId = boundedId(row.to_case_id, 'correction_to');
  const from = caseById.get(fromId);
  const to = caseById.get(toId);
  if (!from || !to || fromId === toId) throw new Error('rsi_exg_correction_binding_invalid');
  if (from.outcome !== 'FAILURE' || to.outcome !== 'SUCCESS') throw new Error('rsi_exg_correction_outcome_invalid');
  if (from.task_id !== to.task_id || from.task_signature_digest !== to.task_signature_digest) throw new Error('rsi_exg_correction_task_mismatch');
  if (to.attempt_index <= from.attempt_index) throw new Error('rsi_exg_correction_attempt_order_invalid');
  return Object.freeze({
    from_case_id: fromId,
    to_case_id: toId,
    evidence_digest: exactDigest(row.evidence_digest, 'correction_evidence'),
    external_verifier: true,
    authored_by_candidate: false,
    fixed_by_relation_is_authority: false,
  });
}

function graphCore({
  graph_id,
  epoch,
  predecessor_snapshot_digest,
  task_anchors,
  cases,
  similarity_edges,
  correction_edges,
  utility_receipts,
}) {
  const anchors = task_anchors.map(normalizeTaskAnchor).sort((a, b) => a.task_id.localeCompare(b.task_id));
  const anchorById = new Map();
  for (const anchor of anchors) {
    if (anchorById.has(anchor.task_id)) throw new Error('rsi_exg_task_anchor_duplicate');
    anchorById.set(anchor.task_id, anchor);
  }

  const normalizedCases = cases.map(verifyRsiExperienceCase).sort((a, b) => a.case_id.localeCompare(b.case_id));
  const caseById = new Map();
  const taskAttemptKeys = new Set();
  for (const row of normalizedCases) {
    if (caseById.has(row.case_id)) throw new Error('rsi_exg_case_duplicate');
    caseById.set(row.case_id, row);
    const anchor = anchorById.get(row.task_id);
    if (!anchor || anchor.task_signature_digest !== row.task_signature_digest) throw new Error('rsi_exg_case_anchor_mismatch');
    const attemptKey = `${row.task_id}#${row.attempt_index}`;
    if (taskAttemptKeys.has(attemptKey)) throw new Error('rsi_exg_task_attempt_duplicate');
    taskAttemptKeys.add(attemptKey);
  }

  const similarities = similarity_edges.map((row) => normalizeSimilarityEdge(row, caseById))
    .sort((a, b) => a.left_case_id.localeCompare(b.left_case_id) || a.right_case_id.localeCompare(b.right_case_id));
  const simKeys = new Set();
  for (const row of similarities) {
    const key = `${row.left_case_id}<->${row.right_case_id}`;
    if (simKeys.has(key)) throw new Error('rsi_exg_similarity_duplicate');
    simKeys.add(key);
  }

  const corrections = correction_edges.map((row) => normalizeCorrectionEdge(row, caseById))
    .sort((a, b) => a.from_case_id.localeCompare(b.from_case_id) || a.to_case_id.localeCompare(b.to_case_id));
  const correctionKeys = new Set();
  for (const row of corrections) {
    const key = `${row.from_case_id}->${row.to_case_id}`;
    if (correctionKeys.has(key)) throw new Error('rsi_exg_correction_duplicate');
    correctionKeys.add(key);
  }

  const utilities = utility_receipts.map(verifyRsiExperienceUtilityReceipt)
    .sort((a, b) => a.receipt_id.localeCompare(b.receipt_id));
  const utilityIds = new Set();
  for (const row of utilities) {
    if (!caseById.has(row.case_id)) throw new Error('rsi_exg_utility_case_missing');
    if (utilityIds.has(row.receipt_id)) throw new Error('rsi_exg_utility_receipt_duplicate');
    utilityIds.add(row.receipt_id);
  }

  const contains = normalizedCases.map((row) => Object.freeze({
    task_id: row.task_id,
    case_id: row.case_id,
  })).sort((a, b) => a.task_id.localeCompare(b.task_id) || a.case_id.localeCompare(b.case_id));

  return {
    schema: RSI_EXPERIENCE_GRAPH_SNAPSHOT_SCHEMA,
    version: 1,
    graph_id: boundedId(graph_id, 'graph_id'),
    epoch: positiveInt(epoch, 'graph_epoch', 1_000_000),
    predecessor_snapshot_digest: predecessor_snapshot_digest == null ? null : exactDigest(predecessor_snapshot_digest, 'predecessor_snapshot'),
    task_anchors: anchors,
    cases: normalizedCases,
    contains_edges: contains,
    similarity_edges: similarities,
    correction_edges: corrections,
    utility_receipts: utilities,
    task_anchor_count: anchors.length,
    case_count: normalizedCases.length,
    similarity_edge_count: similarities.length,
    correction_edge_count: corrections.length,
    utility_receipt_count: utilities.length,
    append_only: true,
    time_travel_by_snapshot_digest: true,
    graph_writer_external_only: true,
    candidate_can_write_graph: false,
    source_context_truth_is_portable: false,
    similarity_is_authority: false,
    utility_is_global_truth: false,
    raw_trajectory_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function createRsiExperienceGraphSnapshot({
  graph_id,
  epoch = 1,
  predecessor_snapshot_digest = null,
  task_anchors = [],
  cases = [],
  similarity_edges = [],
  correction_edges = [],
  utility_receipts = [],
} = {}) {
  if (!Array.isArray(task_anchors) || task_anchors.length < 1 || task_anchors.length > MAX_ANCHORS) throw new Error('rsi_exg_task_anchors_invalid');
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) throw new Error('rsi_exg_cases_invalid');
  if (!Array.isArray(similarity_edges) || similarity_edges.length > MAX_SIMILARITY_EDGES) throw new Error('rsi_exg_similarity_edges_invalid');
  if (!Array.isArray(correction_edges) || correction_edges.length > MAX_CORRECTION_EDGES) throw new Error('rsi_exg_correction_edges_invalid');
  if (!Array.isArray(utility_receipts) || utility_receipts.length > MAX_UTILITY_RECEIPTS) throw new Error('rsi_exg_utility_receipts_invalid');
  const core = graphCore({
    graph_id,
    epoch,
    predecessor_snapshot_digest,
    task_anchors,
    cases,
    similarity_edges,
    correction_edges,
    utility_receipts,
  });
  return Object.freeze({ ...core, snapshot_digest: digest(core) });
}

export function verifyRsiExperienceGraphSnapshot(snapshot) {
  exactKeys(snapshot, [
    'schema','version','graph_id','epoch','predecessor_snapshot_digest','task_anchors','cases','contains_edges',
    'similarity_edges','correction_edges','utility_receipts','task_anchor_count','case_count','similarity_edge_count',
    'correction_edge_count','utility_receipt_count','append_only','time_travel_by_snapshot_digest','graph_writer_external_only',
    'candidate_can_write_graph','source_context_truth_is_portable','similarity_is_authority','utility_is_global_truth',
    'raw_trajectory_stored','raw_page_text_stored','raw_user_input_stored','secret_material_stored','execution_authority',
    'production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect',
    'snapshot_digest',
  ], [], 'snapshot');
  if (snapshot.schema !== RSI_EXPERIENCE_GRAPH_SNAPSHOT_SCHEMA || snapshot.version !== 1) throw new Error('rsi_exg_snapshot_invalid');
  assertZeroAuthority(snapshot, 'snapshot');
  if (
    snapshot.append_only !== true
    || snapshot.time_travel_by_snapshot_digest !== true
    || snapshot.graph_writer_external_only !== true
    || snapshot.candidate_can_write_graph !== false
    || snapshot.source_context_truth_is_portable !== false
    || snapshot.similarity_is_authority !== false
    || snapshot.utility_is_global_truth !== false
    || snapshot.raw_trajectory_stored !== false
    || snapshot.raw_page_text_stored !== false
    || snapshot.raw_user_input_stored !== false
    || snapshot.secret_material_stored !== false
  ) throw new Error('rsi_exg_snapshot_policy_invalid');

  const canonical = createRsiExperienceGraphSnapshot({
    graph_id: snapshot.graph_id,
    epoch: snapshot.epoch,
    predecessor_snapshot_digest: snapshot.predecessor_snapshot_digest,
    task_anchors: snapshot.task_anchors,
    cases: snapshot.cases,
    similarity_edges: snapshot.similarity_edges,
    correction_edges: snapshot.correction_edges,
    utility_receipts: snapshot.utility_receipts,
  });
  if (canonical.snapshot_digest !== exactDigest(snapshot.snapshot_digest, 'snapshot')) throw new Error('rsi_exg_snapshot_digest_mismatch');
  if (
    canonical.task_anchor_count !== snapshot.task_anchor_count
    || canonical.case_count !== snapshot.case_count
    || canonical.similarity_edge_count !== snapshot.similarity_edge_count
    || canonical.correction_edge_count !== snapshot.correction_edge_count
    || canonical.utility_receipt_count !== snapshot.utility_receipt_count
    || JSON.stringify(canonical.contains_edges) !== JSON.stringify(snapshot.contains_edges)
  ) throw new Error('rsi_exg_snapshot_projection_mismatch');
  return canonical;
}

function mergeByKey(previous, additions, keyFn, duplicateCode) {
  const map = new Map(previous.map((row) => [keyFn(row), row]));
  for (const row of additions) {
    const key = keyFn(row);
    if (map.has(key)) throw new Error(duplicateCode);
    map.set(key, row);
  }
  return [...map.values()];
}

export function extendRsiExperienceGraphSnapshot({
  previous_snapshot,
  task_anchors = [],
  cases = [],
  similarity_edges = [],
  correction_edges = [],
  utility_receipts = [],
} = {}) {
  const previous = verifyRsiExperienceGraphSnapshot(previous_snapshot);
  if (![task_anchors,cases,similarity_edges,correction_edges,utility_receipts].every(Array.isArray)) throw new Error('rsi_exg_extension_inputs_invalid');

  const nextAnchors = mergeByKey(previous.task_anchors, task_anchors, (row) => row.task_id, 'rsi_exg_extension_task_replacement_forbidden');
  const nextCases = mergeByKey(previous.cases, cases, (row) => row.case_id, 'rsi_exg_extension_case_replacement_forbidden');
  const nextSimilarities = mergeByKey(
    previous.similarity_edges,
    similarity_edges.map((row) => {
      const left = String(row.left_case_id || '');
      const right = String(row.right_case_id || '');
      return left <= right ? row : { ...row, left_case_id: right, right_case_id: left };
    }),
    (row) => `${row.left_case_id}<->${row.right_case_id}`,
    'rsi_exg_extension_similarity_replacement_forbidden',
  );
  const nextCorrections = mergeByKey(previous.correction_edges, correction_edges, (row) => `${row.from_case_id}->${row.to_case_id}`, 'rsi_exg_extension_correction_replacement_forbidden');
  const nextUtilities = mergeByKey(previous.utility_receipts, utility_receipts, (row) => row.receipt_id, 'rsi_exg_extension_utility_replacement_forbidden');

  return createRsiExperienceGraphSnapshot({
    graph_id: previous.graph_id,
    epoch: previous.epoch + 1,
    predecessor_snapshot_digest: previous.snapshot_digest,
    task_anchors: nextAnchors,
    cases: nextCases,
    similarity_edges: nextSimilarities,
    correction_edges: nextCorrections,
    utility_receipts: nextUtilities,
  });
}

export function createRsiExperienceGraphQuery({
  query_id,
  target_context_digest,
  task_signature_digest,
  challenge_family,
  environment_fingerprint,
  model_family,
  failure_codes = [],
  mechanism_tags = [],
  bridge_case_ids = [],
  external_query_context = false,
  authored_by_candidate = true,
} = {}) {
  if (external_query_context !== true || authored_by_candidate !== false) throw new Error('rsi_exg_query_external_origin_required');
  if (!Array.isArray(bridge_case_ids) || bridge_case_ids.length > MAX_QUERY_BRIDGES) throw new Error('rsi_exg_query_bridge_cases_invalid');
  const bridges = [...new Set(bridge_case_ids.map((row) => boundedId(row, 'bridge_case_id')))].sort();
  if (bridges.length !== bridge_case_ids.length) throw new Error('rsi_exg_query_bridge_case_duplicate');
  const core = {
    schema: RSI_EXPERIENCE_GRAPH_QUERY_SCHEMA,
    version: 1,
    query_id: boundedId(query_id, 'query_id'),
    target_context_digest: exactDigest(target_context_digest, 'query_target_context'),
    task_signature_digest: exactDigest(task_signature_digest, 'query_task_signature'),
    challenge_family: boundedToken(challenge_family, 'query_challenge_family'),
    environment_fingerprint: boundedId(environment_fingerprint, 'query_environment'),
    model_family: boundedToken(model_family, 'query_model_family'),
    failure_codes: normalizeTokens(failure_codes, 'query_failure_code'),
    mechanism_tags: normalizeTokens(mechanism_tags, 'query_mechanism_tag'),
    bridge_case_ids: bridges,
    external_query_context: true,
    authored_by_candidate: false,
    candidate_can_select_similarity_threshold: false,
    candidate_can_select_diffusion_depth: false,
    candidate_can_mark_portable: false,
    retrieval_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, query_digest: digest(core) });
}

export function verifyRsiExperienceGraphQuery(row) {
  exactKeys(row, [
    'schema','version','query_id','target_context_digest','task_signature_digest','challenge_family','environment_fingerprint',
    'model_family','failure_codes','mechanism_tags','bridge_case_ids','external_query_context','authored_by_candidate',
    'candidate_can_select_similarity_threshold','candidate_can_select_diffusion_depth','candidate_can_mark_portable',
    'retrieval_is_execution_authority','execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','automatic_retry_allowed','authority_effect','query_digest',
  ], [], 'query');
  if (row.schema !== RSI_EXPERIENCE_GRAPH_QUERY_SCHEMA || row.version !== 1) throw new Error('rsi_exg_query_invalid');
  assertZeroAuthority(row, 'query');
  if (
    row.external_query_context !== true
    || row.authored_by_candidate !== false
    || row.candidate_can_select_similarity_threshold !== false
    || row.candidate_can_select_diffusion_depth !== false
    || row.candidate_can_mark_portable !== false
    || row.retrieval_is_execution_authority !== false
  ) throw new Error('rsi_exg_query_policy_invalid');
  const canonical = createRsiExperienceGraphQuery({
    query_id: row.query_id,
    target_context_digest: row.target_context_digest,
    task_signature_digest: row.task_signature_digest,
    challenge_family: row.challenge_family,
    environment_fingerprint: row.environment_fingerprint,
    model_family: row.model_family,
    failure_codes: row.failure_codes,
    mechanism_tags: row.mechanism_tags,
    bridge_case_ids: row.bridge_case_ids,
    external_query_context: true,
    authored_by_candidate: false,
  });
  if (canonical.query_digest !== exactDigest(row.query_digest, 'query')) throw new Error('rsi_exg_query_digest_mismatch');
  return canonical;
}

function overlapCount(left, right) {
  const set = new Set(left);
  let count = 0;
  for (const value of right) if (set.has(value)) count += 1;
  return count;
}

function utilityForCase(snapshot, caseId, targetContextDigest) {
  let helpful = 0;
  let harmful = 0;
  let neutral = 0;
  for (const row of snapshot.utility_receipts) {
    if (row.case_id !== caseId || row.target_context_digest !== targetContextDigest) continue;
    if (row.outcome === 'HELPFUL') helpful += 1;
    else if (row.outcome === 'HARMFUL') harmful += 1;
    else neutral += 1;
  }
  const posteriorAlpha = 1 + helpful;
  const posteriorBeta = 1 + harmful + 0.25 * neutral;
  return Object.freeze({
    helpful,
    harmful,
    neutral,
    posterior_mean: posteriorAlpha / (posteriorAlpha + posteriorBeta),
    evidence_count: helpful + harmful + neutral,
  });
}

function similarityAdjacency(snapshot) {
  const adjacency = new Map(snapshot.cases.map((row) => [row.case_id, []]));
  for (const edge of snapshot.similarity_edges) {
    if (edge.similarity_score < SIMILARITY_THRESHOLD) continue;
    adjacency.get(edge.left_case_id).push({ case_id: edge.right_case_id, score: edge.similarity_score });
    adjacency.get(edge.right_case_id).push({ case_id: edge.left_case_id, score: edge.similarity_score });
  }
  for (const rows of adjacency.values()) rows.sort((a, b) => b.score - a.score || a.case_id.localeCompare(b.case_id));
  return adjacency;
}

function diffusionScores(snapshot, seedIds) {
  const adjacency = similarityAdjacency(snapshot);
  const best = new Map();
  const queue = [];
  for (const seed of seedIds) {
    if (!adjacency.has(seed)) continue;
    best.set(seed, 1);
    queue.push({ case_id: seed, hop: 0, score: 1 });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.hop >= MAX_DIFFUSION_HOPS) continue;
    for (const edge of adjacency.get(current.case_id) || []) {
      const nextScore = current.score * edge.score * 0.5;
      if (nextScore <= (best.get(edge.case_id) || 0)) continue;
      best.set(edge.case_id, nextScore);
      queue.push({ case_id: edge.case_id, hop: current.hop + 1, score: nextScore });
    }
  }
  return best;
}

export function retrieveRsiExperienceGraph({ snapshot, query } = {}) {
  const checkedSnapshot = verifyRsiExperienceGraphSnapshot(snapshot);
  const checkedQuery = verifyRsiExperienceGraphQuery(query);
  const caseById = new Map(checkedSnapshot.cases.map((row) => [row.case_id, row]));
  for (const bridgeId of checkedQuery.bridge_case_ids) {
    if (!caseById.has(bridgeId)) throw new Error('rsi_exg_query_bridge_case_missing');
  }

  const exactTaskSeeds = checkedSnapshot.cases
    .filter((row) => row.task_signature_digest === checkedQuery.task_signature_digest)
    .map((row) => row.case_id);
  const seedIds = [...new Set([...checkedQuery.bridge_case_ids, ...exactTaskSeeds])].sort();
  const diffusion = diffusionScores(checkedSnapshot, seedIds);

  const correctionTargets = new Map();
  for (const edge of checkedSnapshot.correction_edges) {
    if (seedIds.includes(edge.from_case_id) || diffusion.has(edge.from_case_id)) {
      correctionTargets.set(edge.to_case_id, Math.max(correctionTargets.get(edge.to_case_id) || 0, 1));
    }
  }

  const scored = checkedSnapshot.cases.map((row) => {
    const exactTask = row.task_signature_digest === checkedQuery.task_signature_digest;
    const bridge = checkedQuery.bridge_case_ids.includes(row.case_id);
    const correction = correctionTargets.has(row.case_id);
    const diffused = diffusion.get(row.case_id) || 0;
    const failureOverlap = overlapCount(row.failure_codes, checkedQuery.failure_codes);
    const mechanismOverlap = overlapCount(row.mechanism_tags, checkedQuery.mechanism_tags);
    const utility = utilityForCase(checkedSnapshot, row.case_id, checkedQuery.target_context_digest);
    let score = 0;
    if (exactTask) score += 100;
    if (bridge) score += 60;
    if (correction) score += 80;
    score += diffused * 30;
    score += failureOverlap * 8;
    score += mechanismOverlap * 4;
    if (row.environment_fingerprint === checkedQuery.environment_fingerprint) score += 3;
    if (row.model_family === checkedQuery.model_family) score += 1;
    score += (utility.posterior_mean - 0.5) * 20;
    if (row.outcome === 'SUCCESS') score += 2;
    return {
      row,
      score,
      exactTask,
      bridge,
      correction,
      diffused,
      failureOverlap,
      mechanismOverlap,
      utility,
    };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.case_id.localeCompare(b.row.case_id))
    .slice(0, MAX_RETRIEVAL_CASES);

  const items = scored.map((entry, index) => Object.freeze({
    rank: index + 1,
    case_id: entry.row.case_id,
    case_digest: entry.row.case_digest,
    task_id: entry.row.task_id,
    task_signature_digest: entry.row.task_signature_digest,
    candidate_id: entry.row.candidate_id,
    candidate_sha: entry.row.candidate_sha,
    outcome: entry.row.outcome,
    environment_fingerprint: entry.row.environment_fingerprint,
    model_family: entry.row.model_family,
    failure_codes: [...entry.row.failure_codes],
    mechanism_tags: [...entry.row.mechanism_tags],
    lesson_digests: [...entry.row.lesson_digests],
    attribution_digests: [...entry.row.attribution_digests],
    transfer_receipt_digests: [...entry.row.transfer_receipt_digests],
    exact_task_match: entry.exactTask,
    query_bridge: entry.bridge,
    corrective_trace_target: entry.correction,
    graph_diffusion_score: entry.diffused,
    contextual_utility: entry.utility,
    ranking_score: entry.score,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    candidate_can_mark_portable: false,
    raw_trajectory_exposed: false,
  }));

  const core = {
    schema: RSI_EXPERIENCE_GRAPH_RETRIEVAL_SCHEMA,
    version: 1,
    graph_id: checkedSnapshot.graph_id,
    snapshot_digest: checkedSnapshot.snapshot_digest,
    query_id: checkedQuery.query_id,
    query_digest: checkedQuery.query_digest,
    items,
    item_count: items.length,
    retrieval_policy: 'TASK_ANCHOR_PLUS_BRIDGE_DIFFUSION_PLUS_CORRECTION_PLUS_CONTEXTUAL_UTILITY_V1',
    similarity_threshold: SIMILARITY_THRESHOLD,
    max_diffusion_hops: MAX_DIFFUSION_HOPS,
    max_cases: MAX_RETRIEVAL_CASES,
    exact_task_anchor_enabled: true,
    correction_edge_following_enabled: true,
    similarity_diffusion_enabled: true,
    utility_aware_ranking_enabled: true,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    candidate_can_write_graph: false,
    candidate_can_select_thresholds: false,
    retrieval_is_promotion_authority: false,
    retrieval_is_execution_authority: false,
    raw_trajectory_exposed: false,
    raw_page_text_exposed: false,
    raw_user_input_exposed: false,
    secret_material_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, retrieval_digest: digest(core) });
}

export function verifyRsiExperienceGraphRetrieval(row, snapshot, query) {
  exactKeys(row, [
    'schema','version','graph_id','snapshot_digest','query_id','query_digest','items','item_count','retrieval_policy',
    'similarity_threshold','max_diffusion_hops','max_cases','exact_task_anchor_enabled','correction_edge_following_enabled',
    'similarity_diffusion_enabled','utility_aware_ranking_enabled','source_context_truth_is_portable',
    'external_transfer_validation_required','candidate_can_write_graph','candidate_can_select_thresholds',
    'retrieval_is_promotion_authority','retrieval_is_execution_authority','raw_trajectory_exposed','raw_page_text_exposed',
    'raw_user_input_exposed','secret_material_exposed','execution_authority','production_mutation_authority',
    'promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect','retrieval_digest',
  ], [], 'retrieval');
  if (row.schema !== RSI_EXPERIENCE_GRAPH_RETRIEVAL_SCHEMA || row.version !== 1) throw new Error('rsi_exg_retrieval_invalid');
  assertZeroAuthority(row, 'retrieval');
  if (
    row.source_context_truth_is_portable !== false
    || row.external_transfer_validation_required !== true
    || row.candidate_can_write_graph !== false
    || row.candidate_can_select_thresholds !== false
    || row.retrieval_is_promotion_authority !== false
    || row.retrieval_is_execution_authority !== false
    || row.raw_trajectory_exposed !== false
    || row.raw_page_text_exposed !== false
    || row.raw_user_input_exposed !== false
    || row.secret_material_exposed !== false
  ) throw new Error('rsi_exg_retrieval_policy_invalid');
  const canonical = retrieveRsiExperienceGraph({ snapshot, query });
  if (canonical.retrieval_digest !== exactDigest(row.retrieval_digest, 'retrieval')) throw new Error('rsi_exg_retrieval_digest_mismatch');
  if (JSON.stringify(canonical.items) !== JSON.stringify(row.items)) throw new Error('rsi_exg_retrieval_items_mismatch');
  return canonical;
}

export function rsiExperienceGraphTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.experience-graph-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-experience-graph.mjs',
    graph_is_append_only_snapshot_chain: true,
    task_anchor_nodes: true,
    case_nodes: true,
    contains_edges: true,
    similarity_edges: true,
    correction_fixed_by_edges: true,
    contextual_utility_receipts: true,
    graph_diffusion_max_hops: MAX_DIFFUSION_HOPS,
    similarity_threshold: SIMILARITY_THRESHOLD,
    max_retrieval_cases: MAX_RETRIEVAL_CASES,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    candidate_can_write_graph: false,
    candidate_can_edit_case: false,
    candidate_can_edit_utility: false,
    candidate_can_select_retrieval_thresholds: false,
    similarity_is_authority: false,
    utility_is_global_truth: false,
    raw_trajectory_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    retrieval_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, graph_root_digest: digest(root) });
}
