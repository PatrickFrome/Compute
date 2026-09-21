import crypto from 'node:crypto';

import {
  RSI_HARD_INVARIANTS,
  RSI_SHADOW_STATES,
} from './rsi-shadow-core.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';

export const RSI_EVALUATOR_MESH_PLAN_SCHEMA = 'metaengine.rsi.evaluator-mesh-plan.v1';
export const RSI_EVALUATOR_RECEIPT_SCHEMA = 'metaengine.rsi.evaluator-receipt.v1';
export const RSI_EVALUATOR_MESH_RESULT_SCHEMA = 'metaengine.rsi.evaluator-mesh-result.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const EVIDENCE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,511}$/;
const MAX_EVIDENCE_REFS = 32;
const MAX_OBJECTIVES = 16;
const EVALUATOR_TRUST_ROOT_PATHS = new Set([
  'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
  'apps/metaengine-browser/src/rsi-shadow-core.mjs',
  'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
  'apps/metaengine-browser/src/candidate-capsule.cjs',
  'apps/metaengine-browser/src/verification-sandbox-plan.cjs',
  'apps/metaengine-browser/src/verification-sandbox-backend-binding.cjs',
  'apps/metaengine-browser/src/browser-identity-signer-runtime.mjs',
  'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
]);

const EVALUATOR_ROOT = Object.freeze([
  Object.freeze({ evaluator_id: 'rsi.source-identity.v1', invariant: 'EXACT_SOURCE_IDENTITY', evidence_class: 'EXACT_SOURCE_READBACK', runner: 'trusted/exact-source-identity' }),
  Object.freeze({ evaluator_id: 'rsi.workspace-isolation.v1', invariant: 'NO_WORKSPACE_ESCAPE', evidence_class: 'WORKSPACE_ISOLATION_READBACK', runner: 'trusted/workspace-isolation' }),
  Object.freeze({ evaluator_id: 'rsi.authority-boundary.v1', invariant: 'NO_AUTHORITY_VIOLATION', evidence_class: 'AUTHORITY_BOUNDARY_PROOF', runner: 'trusted/authority-boundary' }),
  Object.freeze({ evaluator_id: 'rsi.effect-once.v1', invariant: 'NO_DUPLICATE_IRREVERSIBLE_EFFECT', evidence_class: 'ONE_ATTEMPT_EFFECT_PROOF', runner: 'trusted/effect-once' }),
  Object.freeze({ evaluator_id: 'rsi.ambiguity-retry.v1', invariant: 'NO_AMBIGUOUS_EFFECT_RETRY', evidence_class: 'AMBIGUITY_FENCE_PROOF', runner: 'trusted/ambiguity-retry' }),
  Object.freeze({ evaluator_id: 'rsi.security-regression.v1', invariant: 'NO_SECURITY_REGRESSION', evidence_class: 'SECURITY_REGRESSION_PROOF', runner: 'trusted/security-regression' }),
]);

const OBJECTIVE_ROOT = Object.freeze([
  Object.freeze({ objective: 'task_success_rate', direction: 'MAXIMIZE', evaluator_id: 'rsi.objective.task-success.v1', runner: 'trusted/objective-task-success' }),
  Object.freeze({ objective: 'p95_latency_ms', direction: 'MINIMIZE', evaluator_id: 'rsi.objective.latency.v1', runner: 'trusted/objective-latency' }),
  Object.freeze({ objective: 'tokens_per_success', direction: 'MINIMIZE', evaluator_id: 'rsi.objective.tokens.v1', runner: 'trusted/objective-tokens' }),
  Object.freeze({ objective: 'peak_rss_bytes', direction: 'MINIMIZE', evaluator_id: 'rsi.objective.memory.v1', runner: 'trusted/objective-memory' }),
  Object.freeze({ objective: 'recovery_p95_ms', direction: 'MINIMIZE', evaluator_id: 'rsi.objective.recovery.v1', runner: 'trusted/objective-recovery' }),
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

function exactSha(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_evaluator_${label}_exact_sha_required`);
  return normalized;
}

function exactDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_evaluator_${label}_digest_invalid`);
  return normalized;
}

function zeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_evaluator_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_evaluator_${label}_automatic_retry_invalid`);
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_evaluator_evidence_refs_invalid');
  const seen = new Set();
  return value.map((entry) => {
    const ref = String(entry || '').trim();
    if (!EVIDENCE_REF_RE.test(ref) || seen.has(ref)) throw new Error('rsi_evaluator_evidence_ref_invalid');
    seen.add(ref);
    return ref;
  }).sort();
}

function rootProjection() {
  const invariants = EVALUATOR_ROOT.map((entry) => ({ ...entry, evaluator_digest: digest(entry) }));
  const objectives = OBJECTIVE_ROOT.map((entry) => ({ ...entry, evaluator_digest: digest(entry) }));
  return Object.freeze({
    version: 1,
    invariants,
    objectives,
    immutable_component_paths: [...EVALUATOR_TRUST_ROOT_PATHS].sort(),
    candidate_selectable: false,
    candidate_mutable: false,
    candidate_can_skip_required_invariant: false,
    candidate_can_override_verdict: false,
  });
}

function assertCandidateDoesNotMutateEvaluatorRoot(handoff) {
  const components = Array.isArray(handoff?.candidate_capsule?.components) ? handoff.candidate_capsule.components : [];
  for (const component of components) {
    const path = String(component?.path || '');
    if (EVALUATOR_TRUST_ROOT_PATHS.has(path)) throw new Error('rsi_evaluator_candidate_mutates_evaluator_root');
  }
}

function normalizeHandoff(handoff) {
  if (!plainObject(handoff) || handoff.schema !== RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA || handoff.version !== 1) throw new Error('rsi_evaluator_candidate_handoff_invalid');
  zeroAuthority(handoff, 'handoff');
  if (handoff.eligible_for_evaluation !== true || handoff.eligible_for_promotion !== false || handoff.materialization_replay_authorized !== false) throw new Error('rsi_evaluator_candidate_handoff_policy_invalid');
  if (handoff.candidate_verification?.ok !== true || handoff.candidate_verification?.executable !== false || handoff.candidate_verification?.promotion_authorized !== false) throw new Error('rsi_evaluator_candidate_verification_invalid');
  if (handoff.sandbox_plan?.mode !== 'PREPARE_ONLY' || handoff.sandbox_plan_verification?.execution_authorized !== false) throw new Error('rsi_evaluator_sandbox_handoff_invalid');
  assertCandidateDoesNotMutateEvaluatorRoot(handoff);
  const candidateSha = exactSha(handoff.candidate_sha, 'candidate');
  const parentSha = exactSha(handoff.parent_sha, 'parent');
  if (candidateSha === parentSha) throw new Error('rsi_evaluator_candidate_noop');
  const handoffDigest = exactDigest(handoff.handoff_digest, 'handoff');
  const candidateId = String(handoff.candidate_capsule?.candidate_id || '').toLowerCase();
  if (!/^candidate_sha256_[0-9a-f]{64}$/.test(candidateId) || handoff.shadow_archive_proposal?.candidate_id !== candidateId) throw new Error('rsi_evaluator_candidate_identity_invalid');
  if (handoff.candidate_capsule?.source?.head !== candidateSha || handoff.shadow_archive_proposal?.candidate_sha !== candidateSha || handoff.shadow_archive_proposal?.parent_sha !== parentSha) throw new Error('rsi_evaluator_candidate_lineage_mismatch');
  return Object.freeze({ candidate_id: candidateId, candidate_sha: candidateSha, parent_sha: parentSha, handoff_digest: handoffDigest });
}

export function createRsiEvaluatorMeshPlan({ candidate_handoff } = {}) {
  const candidate = normalizeHandoff(candidate_handoff);
  const root = rootProjection();
  const core = {
    schema: RSI_EVALUATOR_MESH_PLAN_SCHEMA,
    version: 1,
    candidate,
    evaluator_root: root,
    required_invariants: [...RSI_HARD_INVARIANTS],
    objective_policy: {
      allowed_objectives: root.objectives.map((entry) => entry.objective),
      at_least_one_objective_required: true,
      at_least_one_improvement_required: true,
      hard_invariant_failure_overrides_objective_gain: true,
      scalar_reward_authoritative: false,
      pareto_measurements_preserved: true,
    },
    receipt_policy: {
      external_evaluator_receipt_required: true,
      exact_candidate_binding_required: true,
      exact_handoff_binding_required: true,
      exact_evaluator_digest_required: true,
      evidence_refs_required: true,
      duplicate_receipt_allowed: false,
      candidate_authored_receipt_allowed: false,
    },
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({ ...core, plan_id: `rsi_eval_${planDigest.slice('sha256:'.length)}`, plan_digest: planDigest });
}

export function verifyRsiEvaluatorMeshPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_EVALUATOR_MESH_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_evaluator_plan_invalid');
  zeroAuthority(plan, 'plan');
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_eval_${expected.slice('sha256:'.length)}`) throw new Error('rsi_evaluator_plan_digest_mismatch');
  const canonicalRoot = rootProjection();
  if (JSON.stringify(stable(plan.evaluator_root)) !== JSON.stringify(stable(canonicalRoot))) throw new Error('rsi_evaluator_root_tampered');
  if (JSON.stringify([...plan.required_invariants].sort()) !== JSON.stringify([...RSI_HARD_INVARIANTS].sort())) throw new Error('rsi_evaluator_required_invariants_tampered');
  return Object.freeze({ schema: 'metaengine.rsi.evaluator-mesh-plan-verify.v1', ok: true, plan_id: plan.plan_id, plan_digest: plan.plan_digest, evaluator_root_digest: digest(canonicalRoot), execution_authorized: false, promotion_authorized: false, authority_effect: false });
}

function evaluatorSpec(plan, evaluatorId) {
  const id = String(evaluatorId || '');
  const all = [...plan.evaluator_root.invariants, ...plan.evaluator_root.objectives];
  const entry = all.find((row) => row.evaluator_id === id);
  if (!entry) throw new Error('rsi_evaluator_id_not_in_root');
  return entry;
}

export function verifyRsiEvaluatorReceipt({ plan, receipt } = {}) {
  verifyRsiEvaluatorMeshPlan(plan);
  if (!plainObject(receipt) || receipt.schema !== RSI_EVALUATOR_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_evaluator_receipt_invalid');
  zeroAuthority(receipt, 'receipt');
  if (receipt.plan_id !== plan.plan_id || receipt.plan_digest !== plan.plan_digest) throw new Error('rsi_evaluator_receipt_plan_mismatch');
  if (String(receipt.candidate_id || '').toLowerCase() !== plan.candidate.candidate_id || exactSha(receipt.candidate_sha, 'receipt_candidate') !== plan.candidate.candidate_sha || exactDigest(receipt.handoff_digest, 'receipt_handoff') !== plan.candidate.handoff_digest) throw new Error('rsi_evaluator_receipt_candidate_mismatch');
  if (receipt.authored_by_candidate !== false || receipt.external_evaluator !== true) throw new Error('rsi_evaluator_receipt_origin_invalid');
  const spec = evaluatorSpec(plan, receipt.evaluator_id);
  if (exactDigest(receipt.evaluator_digest, 'root') !== spec.evaluator_digest || receipt.runner !== spec.runner) throw new Error('rsi_evaluator_receipt_root_mismatch');
  const refs = normalizeEvidenceRefs(receipt.evidence_refs);
  const kind = String(receipt.kind || '').toUpperCase();
  let normalized;
  if (Object.hasOwn(spec, 'invariant')) {
    if (kind !== 'HARD_INVARIANT' || receipt.invariant !== spec.invariant) throw new Error('rsi_evaluator_receipt_invariant_mismatch');
    const result = String(receipt.result || '').toUpperCase();
    if (!['PASS', 'FAIL'].includes(result)) throw new Error('rsi_evaluator_receipt_result_invalid');
    normalized = { kind, invariant: spec.invariant, result };
  } else {
    if (kind !== 'OBJECTIVE' || receipt.objective?.name !== spec.objective || receipt.objective?.direction !== spec.direction) throw new Error('rsi_evaluator_receipt_objective_mismatch');
    const baseline = Number(receipt.objective?.baseline);
    const candidate = Number(receipt.objective?.candidate);
    if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) throw new Error('rsi_evaluator_receipt_objective_value_invalid');
    normalized = { kind, objective: { name: spec.objective, direction: spec.direction, baseline, candidate } };
  }
  const core = {
    schema: RSI_EVALUATOR_RECEIPT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    candidate_id: plan.candidate.candidate_id,
    candidate_sha: plan.candidate.candidate_sha,
    handoff_digest: plan.candidate.handoff_digest,
    evaluator_id: spec.evaluator_id,
    evaluator_digest: spec.evaluator_digest,
    runner: spec.runner,
    evidence_refs: refs,
    external_evaluator: true,
    authored_by_candidate: false,
    ...normalized,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const receiptDigest = digest(core);
  if (receipt.receipt_digest !== receiptDigest) throw new Error('rsi_evaluator_receipt_digest_mismatch');
  return Object.freeze({ ...core, receipt_digest: receiptDigest });
}

export function createRsiEvaluatorReceipt({ plan, evaluator_id, result = null, objective = null, evidence_refs = [] } = {}) {
  verifyRsiEvaluatorMeshPlan(plan);
  const spec = evaluatorSpec(plan, evaluator_id);
  const body = Object.hasOwn(spec, 'invariant')
    ? { kind: 'HARD_INVARIANT', invariant: spec.invariant, result: String(result || '').toUpperCase() }
    : { kind: 'OBJECTIVE', objective: { name: spec.objective, direction: spec.direction, baseline: Number(objective?.baseline), candidate: Number(objective?.candidate) } };
  const core = {
    schema: RSI_EVALUATOR_RECEIPT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    candidate_id: plan.candidate.candidate_id,
    candidate_sha: plan.candidate.candidate_sha,
    handoff_digest: plan.candidate.handoff_digest,
    evaluator_id: spec.evaluator_id,
    evaluator_digest: spec.evaluator_digest,
    runner: spec.runner,
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    ...body,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const receiptDigest = digest(core);
  return Object.freeze({ ...core, receipt_digest: receiptDigest });
}

export function applyRsiEvaluatorMesh({ archive, candidate_handoff, plan, receipts } = {}) {
  const candidate = normalizeHandoff(candidate_handoff);
  verifyRsiEvaluatorMeshPlan(plan);
  if (candidate.candidate_id !== plan.candidate.candidate_id || candidate.handoff_digest !== plan.candidate.handoff_digest) throw new Error('rsi_evaluator_apply_handoff_mismatch');
  if (!archive || typeof archive.get !== 'function' || typeof archive.beginEvaluation !== 'function' || typeof archive.recordInvariant !== 'function' || typeof archive.recordObjective !== 'function' || typeof archive.finalize !== 'function') throw new Error('rsi_evaluator_archive_required');
  if (!Array.isArray(receipts) || receipts.length < RSI_HARD_INVARIANTS.length + 1 || receipts.length > RSI_HARD_INVARIANTS.length + MAX_OBJECTIVES) throw new Error('rsi_evaluator_receipts_invalid');
  const verified = receipts.map((receipt) => verifyRsiEvaluatorReceipt({ plan, receipt }));
  const seenEvaluators = new Set();
  for (const receipt of verified) {
    if (seenEvaluators.has(receipt.evaluator_id)) throw new Error('rsi_evaluator_duplicate_receipt');
    seenEvaluators.add(receipt.evaluator_id);
  }
  for (const required of plan.evaluator_root.invariants) {
    if (!seenEvaluators.has(required.evaluator_id)) throw new Error(`rsi_evaluator_required_receipt_missing:${required.evaluator_id}`);
  }
  if (!verified.some((receipt) => receipt.kind === 'OBJECTIVE')) throw new Error('rsi_evaluator_objective_receipt_missing');

  const current = archive.get(candidate.candidate_id);
  if (current.state !== RSI_SHADOW_STATES.PROPOSED) throw new Error('rsi_evaluator_candidate_not_proposed');
  if (current.parent_sha !== candidate.parent_sha || current.candidate_sha !== candidate.candidate_sha) throw new Error('rsi_evaluator_archive_lineage_mismatch');
  archive.beginEvaluation(candidate.candidate_id);
  for (const receipt of verified) {
    const evaluatorDigest = receipt.evaluator_digest.slice('sha256:'.length);
    if (receipt.kind === 'HARD_INVARIANT') {
      archive.recordInvariant(candidate.candidate_id, { invariant: receipt.invariant, result: receipt.result, evaluator_id: receipt.evaluator_id, evaluator_digest: evaluatorDigest, evidence_refs: [...receipt.evidence_refs, receipt.receipt_digest] });
    } else {
      archive.recordObjective(candidate.candidate_id, { objective: receipt.objective, evaluator_id: receipt.evaluator_id, evaluator_digest: evaluatorDigest, evidence_refs: [...receipt.evidence_refs, receipt.receipt_digest] });
    }
  }
  const final = archive.finalize(candidate.candidate_id);
  const resultCore = {
    schema: RSI_EVALUATOR_MESH_RESULT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    state: final.state,
    final_digest: final.final_digest,
    receipt_digests: verified.map((entry) => entry.receipt_digest).sort(),
    hard_invariants: final.hard_invariants,
    objectives: final.objectives,
    eligible_for_promotion: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...resultCore, result_digest: digest(resultCore) });
}

export function rsiEvaluatorRootSnapshot() {
  const root = rootProjection();
  return Object.freeze({ ...root, evaluator_root_digest: digest(root) });
}
