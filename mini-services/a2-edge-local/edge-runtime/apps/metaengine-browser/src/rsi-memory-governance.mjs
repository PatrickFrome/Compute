import crypto from 'node:crypto';

import {
  createRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphQuery,
  retrieveRsiExperienceGraph,
} from './rsi-experience-graph.mjs';

export const RSI_MEMORY_SECURITY_AUDIT_SCHEMA = 'metaengine.rsi.memory-security-audit.v1';
export const RSI_MEMORY_REPAIR_RECEIPT_SCHEMA = 'metaengine.rsi.memory-repair-receipt.v1';
export const RSI_MEMORY_GOVERNED_VIEW_SCHEMA = 'metaengine.rsi.memory-governed-view.v1';
export const RSI_MEMORY_GOVERNED_RETRIEVAL_SCHEMA = 'metaengine.rsi.memory-governed-retrieval.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_AUDITS = 16384;
const MAX_REPAIRS = 4096;
const MAX_EVIDENCE_REFS = 32;
const MAX_RISK_CODES = 12;
const MAX_REVALIDATE_EPOCH_DISTANCE = 64;

const DECISIONS = new Set(['ACCEPT', 'REVIEW', 'QUARANTINE', 'REVOKE']);
const RISK_CODES = new Set([
  'PERSISTENT_POISONING',
  'RETRIEVAL_INJECTION',
  'EXFILTRATION_RISK',
  'STATE_CORRUPTION',
  'PROVENANCE_LOSS',
  'TEMPORAL_DRIFT',
  'IDENTITY_SCOPE_MISMATCH',
  'UNVERIFIED_EXTERNAL_ORIGIN',
]);

const ACCEPT_MAX_SEMANTIC_RISK = 0.25;
const ACCEPT_MAX_ATTACK_RADIUS = 0.25;
const ACCEPT_MAX_ACCESS_RISK = 0.25;

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
  if (!plainObject(value)) throw new Error(`rsi_memgov_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_memgov_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_memgov_${label}_fields_invalid`);
  }
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_memgov_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_memgov_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_memgov_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_memgov_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_memgov_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_memgov_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_memgov_${label}_automatic_retry_invalid`);
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

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_memgov_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_memgov_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function normalizeRiskCodes(value) {
  if (!Array.isArray(value) || value.length > MAX_RISK_CODES) throw new Error('rsi_memgov_risk_codes_invalid');
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const code = boundedToken(raw, 'risk_code');
    if (!RISK_CODES.has(code)) throw new Error('rsi_memgov_risk_code_invalid');
    if (seen.has(code)) throw new Error('rsi_memgov_risk_code_duplicate');
    seen.add(code);
    out.push(code);
  }
  return out.sort();
}

function caseMap(snapshot) {
  return new Map(snapshot.cases.map((row) => [row.case_id, row]));
}

function decisionAllowedForRisk(decision, risks, semanticRisk, attackRadius, accessRisk) {
  if (decision !== 'ACCEPT') return true;
  return risks.length === 0
    && semanticRisk <= ACCEPT_MAX_SEMANTIC_RISK
    && attackRadius <= ACCEPT_MAX_ATTACK_RADIUS
    && accessRisk <= ACCEPT_MAX_ACCESS_RISK;
}

export function createRsiMemorySecurityAudit({
  audit_id,
  graph_id,
  observed_snapshot_digest,
  observed_graph_epoch,
  case_id,
  case_digest,
  audit_seq,
  decision,
  risk_codes = [],
  semantic_risk_score,
  attack_radius_score,
  access_risk_score,
  provenance_attestation_digest,
  revalidate_after_epoch,
  evidence_digest,
  evidence_refs,
  external_security_auditor = false,
  authored_by_candidate = true,
} = {}) {
  if (external_security_auditor !== true || authored_by_candidate !== false) throw new Error('rsi_memgov_audit_external_origin_required');
  const normalizedDecision = boundedToken(decision, 'audit_decision');
  if (!DECISIONS.has(normalizedDecision)) throw new Error('rsi_memgov_audit_decision_invalid');
  const risks = normalizeRiskCodes(risk_codes);
  const semanticRisk = unitInterval(semantic_risk_score, 'semantic_risk');
  const attackRadius = unitInterval(attack_radius_score, 'attack_radius');
  const accessRisk = unitInterval(access_risk_score, 'access_risk');
  if (!decisionAllowedForRisk(normalizedDecision, risks, semanticRisk, attackRadius, accessRisk)) {
    throw new Error('rsi_memgov_accept_risk_policy_violation');
  }
  const observedEpoch = positiveInt(observed_graph_epoch, 'observed_graph_epoch', 1_000_000);
  const revalidateEpoch = positiveInt(revalidate_after_epoch, 'revalidate_after_epoch', 1_000_000);
  if (revalidateEpoch <= observedEpoch || revalidateEpoch - observedEpoch > MAX_REVALIDATE_EPOCH_DISTANCE) {
    throw new Error('rsi_memgov_revalidation_horizon_invalid');
  }
  const core = {
    schema: RSI_MEMORY_SECURITY_AUDIT_SCHEMA,
    version: 1,
    audit_id: boundedId(audit_id, 'audit_id'),
    graph_id: boundedId(graph_id, 'graph_id'),
    observed_snapshot_digest: exactDigest(observed_snapshot_digest, 'observed_snapshot'),
    observed_graph_epoch: observedEpoch,
    case_id: boundedId(case_id, 'case_id'),
    case_digest: exactDigest(case_digest, 'case'),
    audit_seq: positiveInt(audit_seq, 'audit_seq', 1_000_000),
    decision: normalizedDecision,
    risk_codes: risks,
    semantic_risk_score: semanticRisk,
    attack_radius_score: attackRadius,
    access_risk_score: accessRisk,
    provenance_attestation_digest: exactDigest(provenance_attestation_digest, 'provenance_attestation'),
    revalidate_after_epoch: revalidateEpoch,
    evidence_digest: exactDigest(evidence_digest, 'audit_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_security_auditor: true,
    authored_by_candidate: false,
    candidate_can_self_clear_memory: false,
    candidate_can_choose_risk_thresholds: false,
    candidate_can_choose_revalidation_horizon: false,
    audit_is_append_only_evidence: true,
    audit_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, audit_digest: digest(core) });
}

export function verifyRsiMemorySecurityAudit(row) {
  exactKeys(row, [
    'schema','version','audit_id','graph_id','observed_snapshot_digest','observed_graph_epoch','case_id','case_digest',
    'audit_seq','decision','risk_codes','semantic_risk_score','attack_radius_score','access_risk_score',
    'provenance_attestation_digest','revalidate_after_epoch','evidence_digest','evidence_refs','external_security_auditor',
    'authored_by_candidate','candidate_can_self_clear_memory','candidate_can_choose_risk_thresholds',
    'candidate_can_choose_revalidation_horizon','audit_is_append_only_evidence','audit_is_execution_authority',
    'execution_authority','production_mutation_authority','promotion_authority','self_update_authority',
    'automatic_retry_allowed','authority_effect','audit_digest',
  ], [], 'audit');
  if (row.schema !== RSI_MEMORY_SECURITY_AUDIT_SCHEMA || row.version !== 1) throw new Error('rsi_memgov_audit_invalid');
  assertZeroAuthority(row, 'audit');
  if (
    row.external_security_auditor !== true
    || row.authored_by_candidate !== false
    || row.candidate_can_self_clear_memory !== false
    || row.candidate_can_choose_risk_thresholds !== false
    || row.candidate_can_choose_revalidation_horizon !== false
    || row.audit_is_append_only_evidence !== true
    || row.audit_is_execution_authority !== false
  ) throw new Error('rsi_memgov_audit_policy_invalid');
  const canonical = createRsiMemorySecurityAudit({
    audit_id: row.audit_id,
    graph_id: row.graph_id,
    observed_snapshot_digest: row.observed_snapshot_digest,
    observed_graph_epoch: row.observed_graph_epoch,
    case_id: row.case_id,
    case_digest: row.case_digest,
    audit_seq: row.audit_seq,
    decision: row.decision,
    risk_codes: row.risk_codes,
    semantic_risk_score: row.semantic_risk_score,
    attack_radius_score: row.attack_radius_score,
    access_risk_score: row.access_risk_score,
    provenance_attestation_digest: row.provenance_attestation_digest,
    revalidate_after_epoch: row.revalidate_after_epoch,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_security_auditor: true,
    authored_by_candidate: false,
  });
  if (canonical.audit_digest !== exactDigest(row.audit_digest, 'audit')) throw new Error('rsi_memgov_audit_digest_mismatch');
  return canonical;
}

export function createRsiMemoryRepairReceipt({
  repair_id,
  graph_id,
  observed_snapshot_digest,
  source_case_id,
  source_case_digest,
  source_audit_digest,
  replacement_case_id,
  replacement_case_digest,
  replacement_audit_digest,
  evidence_digest,
  evidence_refs,
  external_repair_verifier = false,
  authored_by_candidate = true,
} = {}) {
  if (external_repair_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_memgov_repair_external_origin_required');
  const sourceId = boundedId(source_case_id, 'repair_source_case');
  const replacementId = boundedId(replacement_case_id, 'repair_replacement_case');
  if (sourceId === replacementId) throw new Error('rsi_memgov_repair_same_case_forbidden');
  const core = {
    schema: RSI_MEMORY_REPAIR_RECEIPT_SCHEMA,
    version: 1,
    repair_id: boundedId(repair_id, 'repair_id'),
    graph_id: boundedId(graph_id, 'graph_id'),
    observed_snapshot_digest: exactDigest(observed_snapshot_digest, 'repair_snapshot'),
    source_case_id: sourceId,
    source_case_digest: exactDigest(source_case_digest, 'repair_source_case'),
    source_audit_digest: exactDigest(source_audit_digest, 'repair_source_audit'),
    replacement_case_id: replacementId,
    replacement_case_digest: exactDigest(replacement_case_digest, 'repair_replacement_case'),
    replacement_audit_digest: exactDigest(replacement_audit_digest, 'repair_replacement_audit'),
    evidence_digest: exactDigest(evidence_digest, 'repair_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_repair_verifier: true,
    authored_by_candidate: false,
    destructive_delete_authorized: false,
    source_history_preserved: true,
    replacement_must_be_independently_accepted: true,
    candidate_can_self_repair_memory: false,
    repair_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, repair_digest: digest(core) });
}

export function verifyRsiMemoryRepairReceipt(row) {
  exactKeys(row, [
    'schema','version','repair_id','graph_id','observed_snapshot_digest','source_case_id','source_case_digest',
    'source_audit_digest','replacement_case_id','replacement_case_digest','replacement_audit_digest','evidence_digest',
    'evidence_refs','external_repair_verifier','authored_by_candidate','destructive_delete_authorized',
    'source_history_preserved','replacement_must_be_independently_accepted','candidate_can_self_repair_memory',
    'repair_is_execution_authority','execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','automatic_retry_allowed','authority_effect','repair_digest',
  ], [], 'repair');
  if (row.schema !== RSI_MEMORY_REPAIR_RECEIPT_SCHEMA || row.version !== 1) throw new Error('rsi_memgov_repair_invalid');
  assertZeroAuthority(row, 'repair');
  if (
    row.external_repair_verifier !== true
    || row.authored_by_candidate !== false
    || row.destructive_delete_authorized !== false
    || row.source_history_preserved !== true
    || row.replacement_must_be_independently_accepted !== true
    || row.candidate_can_self_repair_memory !== false
    || row.repair_is_execution_authority !== false
  ) throw new Error('rsi_memgov_repair_policy_invalid');
  const canonical = createRsiMemoryRepairReceipt({
    repair_id: row.repair_id,
    graph_id: row.graph_id,
    observed_snapshot_digest: row.observed_snapshot_digest,
    source_case_id: row.source_case_id,
    source_case_digest: row.source_case_digest,
    source_audit_digest: row.source_audit_digest,
    replacement_case_id: row.replacement_case_id,
    replacement_case_digest: row.replacement_case_digest,
    replacement_audit_digest: row.replacement_audit_digest,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_repair_verifier: true,
    authored_by_candidate: false,
  });
  if (canonical.repair_digest !== exactDigest(row.repair_digest, 'repair')) throw new Error('rsi_memgov_repair_digest_mismatch');
  return canonical;
}

function auditStateForCase(snapshot, row, audits) {
  const relevant = audits.filter((audit) => audit.case_id === row.case_id);
  if (relevant.length === 0) return Object.freeze({
    case_id: row.case_id,
    case_digest: row.case_digest,
    state: 'REVIEW_REQUIRED',
    latest_audit_digest: null,
    latest_audit_seq: null,
    risk_codes: [],
    eligible_for_retrieval: false,
  });
  relevant.sort((a, b) => a.audit_seq - b.audit_seq || a.audit_digest.localeCompare(b.audit_digest));
  for (let index = 1; index < relevant.length; index += 1) {
    if (relevant[index].audit_seq === relevant[index - 1].audit_seq) throw new Error('rsi_memgov_audit_seq_duplicate');
  }
  const latest = relevant.at(-1);
  if (latest.graph_id !== snapshot.graph_id || latest.case_digest !== row.case_digest || latest.observed_graph_epoch > snapshot.epoch) {
    throw new Error('rsi_memgov_audit_case_binding_mismatch');
  }
  let state;
  let eligible = false;
  if (latest.decision === 'ACCEPT') {
    if (snapshot.epoch >= latest.revalidate_after_epoch) {
      state = 'STALE_REVIEW_REQUIRED';
    } else {
      state = 'ACTIVE';
      eligible = true;
    }
  } else if (latest.decision === 'REVIEW') {
    state = 'REVIEW_REQUIRED';
  } else if (latest.decision === 'QUARANTINE') {
    state = 'QUARANTINED';
  } else {
    state = 'REVOKED';
  }
  return Object.freeze({
    case_id: row.case_id,
    case_digest: row.case_digest,
    state,
    latest_audit_digest: latest.audit_digest,
    latest_audit_seq: latest.audit_seq,
    risk_codes: [...latest.risk_codes],
    eligible_for_retrieval: eligible,
  });
}

function deriveGovernedSnapshot(source, eligibleIds) {
  if (eligibleIds.size === 0) return null;
  const cases = source.cases.filter((row) => eligibleIds.has(row.case_id));
  const taskIds = new Set(cases.map((row) => row.task_id));
  const taskAnchors = source.task_anchors.filter((row) => taskIds.has(row.task_id));
  const similarityEdges = source.similarity_edges.filter((row) => eligibleIds.has(row.left_case_id) && eligibleIds.has(row.right_case_id));
  const correctionEdges = source.correction_edges.filter((row) => eligibleIds.has(row.from_case_id) && eligibleIds.has(row.to_case_id));
  const utilityReceipts = source.utility_receipts.filter((row) => eligibleIds.has(row.case_id));
  return createRsiExperienceGraphSnapshot({
    graph_id: `${source.graph_id}.governed`,
    epoch: source.epoch,
    predecessor_snapshot_digest: source.snapshot_digest,
    task_anchors: taskAnchors,
    cases,
    similarity_edges: similarityEdges,
    correction_edges: correctionEdges,
    utility_receipts: utilityReceipts,
  });
}

export function createRsiMemoryGovernedView({
  snapshot,
  audit_receipts = [],
  repair_receipts = [],
} = {}) {
  const source = verifyRsiExperienceGraphSnapshot(snapshot);
  if (!Array.isArray(audit_receipts) || audit_receipts.length > MAX_AUDITS) throw new Error('rsi_memgov_audits_invalid');
  if (!Array.isArray(repair_receipts) || repair_receipts.length > MAX_REPAIRS) throw new Error('rsi_memgov_repairs_invalid');
  const audits = audit_receipts.map(verifyRsiMemorySecurityAudit);
  const auditIds = new Set();
  for (const audit of audits) {
    if (auditIds.has(audit.audit_id)) throw new Error('rsi_memgov_audit_id_duplicate');
    auditIds.add(audit.audit_id);
  }

  const states = source.cases.map((row) => auditStateForCase(source, row, audits));
  const stateByCase = new Map(states.map((row) => [row.case_id, row]));
  const sourceCaseById = caseMap(source);
  const auditByDigest = new Map(audits.map((row) => [row.audit_digest, row]));

  const repairs = repair_receipts.map(verifyRsiMemoryRepairReceipt);
  const repairIds = new Set();
  const appliedRepairs = [];
  for (const repair of repairs) {
    if (repairIds.has(repair.repair_id)) throw new Error('rsi_memgov_repair_id_duplicate');
    repairIds.add(repair.repair_id);
    if (repair.graph_id !== source.graph_id || repair.observed_snapshot_digest !== source.snapshot_digest) {
      throw new Error('rsi_memgov_repair_snapshot_binding_mismatch');
    }
    const sourceCase = sourceCaseById.get(repair.source_case_id);
    const replacement = sourceCaseById.get(repair.replacement_case_id);
    if (!sourceCase || !replacement || sourceCase.case_digest !== repair.source_case_digest || replacement.case_digest !== repair.replacement_case_digest) {
      throw new Error('rsi_memgov_repair_case_binding_mismatch');
    }
    const sourceState = stateByCase.get(sourceCase.case_id);
    const replacementState = stateByCase.get(replacement.case_id);
    if (!['QUARANTINED', 'REVOKED'].includes(sourceState?.state)) throw new Error('rsi_memgov_repair_source_not_blocked');
    if (replacementState?.state !== 'ACTIVE') throw new Error('rsi_memgov_repair_replacement_not_active');
    if (sourceState.latest_audit_digest !== repair.source_audit_digest || replacementState.latest_audit_digest !== repair.replacement_audit_digest) {
      throw new Error('rsi_memgov_repair_audit_binding_mismatch');
    }
    if (!auditByDigest.has(repair.source_audit_digest) || !auditByDigest.has(repair.replacement_audit_digest)) {
      throw new Error('rsi_memgov_repair_audit_missing');
    }
    if (
      sourceCase.task_id !== replacement.task_id
      || sourceCase.task_signature_digest !== replacement.task_signature_digest
      || replacement.attempt_index <= sourceCase.attempt_index
    ) throw new Error('rsi_memgov_repair_task_binding_mismatch');

    const index = states.findIndex((row) => row.case_id === sourceCase.case_id);
    states[index] = Object.freeze({
      ...states[index],
      state: 'SUPERSEDED_BY_VERIFIED_REPAIR',
      eligible_for_retrieval: false,
      repair_digest: repair.repair_digest,
      replacement_case_id: replacement.case_id,
    });
    stateByCase.set(sourceCase.case_id, states[index]);
    appliedRepairs.push(Object.freeze({
      repair_id: repair.repair_id,
      repair_digest: repair.repair_digest,
      source_case_id: sourceCase.case_id,
      replacement_case_id: replacement.case_id,
    }));
  }

  const eligibleIds = new Set(states.filter((row) => row.eligible_for_retrieval).map((row) => row.case_id));
  const governedSnapshot = deriveGovernedSnapshot(source, eligibleIds);
  const counts = Object.freeze(Object.fromEntries([
    'ACTIVE',
    'REVIEW_REQUIRED',
    'STALE_REVIEW_REQUIRED',
    'QUARANTINED',
    'REVOKED',
    'SUPERSEDED_BY_VERIFIED_REPAIR',
  ].map((state) => [state, states.filter((row) => row.state === state).length])));

  const core = {
    schema: RSI_MEMORY_GOVERNED_VIEW_SCHEMA,
    version: 1,
    graph_id: source.graph_id,
    source_snapshot_digest: source.snapshot_digest,
    source_graph_epoch: source.epoch,
    case_states: states,
    state_counts: counts,
    applied_repairs: appliedRepairs,
    eligible_case_ids: [...eligibleIds].sort(),
    excluded_case_ids: states.filter((row) => !row.eligible_for_retrieval).map((row) => row.case_id).sort(),
    governed_snapshot: governedSnapshot,
    governed_snapshot_digest: governedSnapshot?.snapshot_digest || null,
    all_memory_requires_explicit_security_audit: true,
    unaudited_memory_default: 'REVIEW_REQUIRED',
    stale_memory_default: 'STALE_REVIEW_REQUIRED',
    blocked_nodes_removed_before_graph_diffusion: true,
    blocked_edges_removed_before_graph_diffusion: true,
    destructive_delete_authorized: false,
    source_history_preserved: true,
    selective_repair_supported: true,
    candidate_can_clear_quarantine: false,
    candidate_can_write_audit: false,
    candidate_can_write_repair: false,
    view_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, view_digest: digest(core) });
}

export function verifyRsiMemoryGovernedView(row, { snapshot, audit_receipts = [], repair_receipts = [] } = {}) {
  if (!plainObject(row) || row.schema !== RSI_MEMORY_GOVERNED_VIEW_SCHEMA || row.version !== 1) throw new Error('rsi_memgov_view_invalid');
  assertZeroAuthority(row, 'view');
  if (
    row.all_memory_requires_explicit_security_audit !== true
    || row.unaudited_memory_default !== 'REVIEW_REQUIRED'
    || row.stale_memory_default !== 'STALE_REVIEW_REQUIRED'
    || row.blocked_nodes_removed_before_graph_diffusion !== true
    || row.blocked_edges_removed_before_graph_diffusion !== true
    || row.destructive_delete_authorized !== false
    || row.source_history_preserved !== true
    || row.selective_repair_supported !== true
    || row.candidate_can_clear_quarantine !== false
    || row.candidate_can_write_audit !== false
    || row.candidate_can_write_repair !== false
    || row.view_is_execution_authority !== false
  ) throw new Error('rsi_memgov_view_policy_invalid');
  const self = structuredClone(row);
  delete self.view_digest;
  if (exactDigest(row.view_digest, 'view') !== digest(self)) throw new Error('rsi_memgov_view_digest_mismatch');
  const canonical = createRsiMemoryGovernedView({ snapshot, audit_receipts, repair_receipts });
  if (canonical.view_digest !== row.view_digest) throw new Error('rsi_memgov_view_recompute_mismatch');
  return canonical;
}

export function retrieveRsiGovernedExperience({
  snapshot,
  audit_receipts = [],
  repair_receipts = [],
  query,
} = {}) {
  const checkedQuery = verifyRsiExperienceGraphQuery(query);
  const view = createRsiMemoryGovernedView({ snapshot, audit_receipts, repair_receipts });
  const eligible = new Set(view.eligible_case_ids);
  for (const bridgeId of checkedQuery.bridge_case_ids) {
    if (!eligible.has(bridgeId)) throw new Error('rsi_memgov_query_bridge_case_not_eligible');
  }

  if (!view.governed_snapshot) {
    const core = {
      schema: RSI_MEMORY_GOVERNED_RETRIEVAL_SCHEMA,
      version: 1,
      state: 'BLOCKED_NO_ELIGIBLE_MEMORY',
      source_snapshot_digest: view.source_snapshot_digest,
      governed_view_digest: view.view_digest,
      governed_snapshot_digest: null,
      query_digest: checkedQuery.query_digest,
      retrieval_digest: null,
      items: [],
      item_count: 0,
      blocked_memory_cannot_influence_graph_diffusion: true,
      external_transfer_validation_required: true,
      candidate_can_bypass_governance: false,
      retrieval_is_execution_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, governed_retrieval_digest: digest(core) });
  }

  const retrieval = retrieveRsiExperienceGraph({
    snapshot: view.governed_snapshot,
    query: checkedQuery,
  });
  const core = {
    schema: RSI_MEMORY_GOVERNED_RETRIEVAL_SCHEMA,
    version: 1,
    state: 'GOVERNED_RETRIEVAL',
    source_snapshot_digest: view.source_snapshot_digest,
    governed_view_digest: view.view_digest,
    governed_snapshot_digest: view.governed_snapshot_digest,
    query_digest: checkedQuery.query_digest,
    retrieval_digest: retrieval.retrieval_digest,
    items: retrieval.items,
    item_count: retrieval.item_count,
    blocked_memory_cannot_influence_graph_diffusion: true,
    external_transfer_validation_required: true,
    candidate_can_bypass_governance: false,
    retrieval_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, governed_retrieval_digest: digest(core) });
}

export function rsiMemoryGovernanceTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.memory-governance-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-memory-governance.mjs',
    risk_codes: [...RISK_CODES].sort(),
    decisions: [...DECISIONS].sort(),
    accept_max_semantic_risk: ACCEPT_MAX_SEMANTIC_RISK,
    accept_max_attack_radius: ACCEPT_MAX_ATTACK_RADIUS,
    accept_max_access_risk: ACCEPT_MAX_ACCESS_RISK,
    max_revalidate_epoch_distance: MAX_REVALIDATE_EPOCH_DISTANCE,
    unaudited_memory_default: 'REVIEW_REQUIRED',
    stale_memory_default: 'STALE_REVIEW_REQUIRED',
    quarantine_fail_closed: true,
    revocation_fail_closed: true,
    selective_repair_preserves_history: true,
    blocked_nodes_removed_before_graph_diffusion: true,
    blocked_edges_removed_before_graph_diffusion: true,
    candidate_can_choose_thresholds: false,
    candidate_can_clear_quarantine: false,
    candidate_can_write_audit: false,
    candidate_can_write_repair: false,
    raw_memory_payload_is_authority: false,
    retrieval_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, governance_root_digest: digest(root) });
}
