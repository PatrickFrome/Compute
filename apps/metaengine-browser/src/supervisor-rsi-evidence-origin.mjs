import crypto from 'node:crypto';

import {
  RSI_HYPOTHESIS_EVIDENCE_RESULT_SCHEMA,
  applyRsiHypothesisEvidenceGate,
  verifyRsiHypothesisEvidenceGatePlan,
  verifyRsiHypothesisEvidenceReceipt,
} from './supervisor-rsi-hypothesis-evidence-gate.mjs';

export const RSI_EVIDENCE_ORIGIN_SUBJECT_SCHEMA = 'metaengine.rsi.evidence-origin-subject.v1';
export const RSI_EVIDENCE_ORIGIN_READBACK_SCHEMA = 'metaengine.rsi.evidence-origin-readback.v1';
export const RSI_EVIDENCE_ORIGIN_RESULT_SCHEMA = 'metaengine.rsi.evidence-origin-result.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256_RE = /^[0-9a-f]{64}$/;
const TERMINAL_STATES = new Set(['ADMITTED', 'FALSIFIED', 'REJECTED']);
const TRUSTED_REPOSITORY = 'PatrickFrome/Compute';
const TRUSTED_WORKFLOW_PATH = '.github/workflows/rsi-evidence-origin-attestation.yml';
const TRUSTED_WORKFLOW_REF = 'refs/heads/main';
const ATTEST_ACTION = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';
const VERIFY_COMMAND = 'gh attestation verify';
const ORIGIN_IDENTITY_SOURCE = 'PERSISTED_GITHUB_ATTESTATION_VERIFICATION_BYTES';

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
function stableJson(value) { return JSON.stringify(stable(value)); }
function digest(value) { return `sha256:${crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex')}`; }
function exactSha(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_evidence_origin_${label}_exact_sha_required`);
  return normalized;
}
function exactDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_evidence_origin_${label}_digest_invalid`);
  return normalized;
}
function rawDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!RAW_SHA256_RE.test(normalized)) throw new Error(`rsi_evidence_origin_${label}_digest_invalid`);
  return normalized;
}
function positiveInt(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error(`rsi_evidence_origin_${label}_invalid`);
  return normalized;
}
function zeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_evidence_origin_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_evidence_origin_${label}_automatic_retry_invalid`);
}
function attestationPolicy() {
  const core = {
    version: 1,
    repository: TRUSTED_REPOSITORY,
    workflow_path: TRUSTED_WORKFLOW_PATH,
    workflow_ref: TRUSTED_WORKFLOW_REF,
    signer: 'GITHUB_OIDC_SIGSTORE',
    attestation_action: ATTEST_ACTION,
    independent_verifier: VERIFY_COMMAND,
    persisted_verification_bytes_required: true,
    exact_workflow_commit_required: true,
    exact_workflow_blob_required: true,
    trusted_main_required: true,
    pull_request_live_attestation_allowed: false,
    attest_without_verify_sufficient: false,
    candidate_can_select_workflow: false,
    candidate_can_override_repository: false,
    candidate_can_override_verifier: false,
    attestation_grants_project_authority: false,
  };
  return Object.freeze({ ...core, policy_digest: digest(core) });
}
function canonicalReceipts(plan, receipts) {
  if (!Array.isArray(receipts) || receipts.length < 1) throw new Error('rsi_evidence_origin_receipts_invalid');
  const seen = new Set();
  const verified = receipts.map((receipt) => {
    const normalized = verifyRsiHypothesisEvidenceReceipt({ plan, receipt });
    if (seen.has(normalized.receipt_digest)) throw new Error('rsi_evidence_origin_receipt_duplicate');
    seen.add(normalized.receipt_digest);
    return normalized;
  });
  return verified.sort((a, b) => a.receipt_digest.localeCompare(b.receipt_digest));
}
function canonicalResult(plan, receipts, result) {
  if (!plainObject(result) || result.schema !== RSI_HYPOTHESIS_EVIDENCE_RESULT_SCHEMA) throw new Error('rsi_evidence_origin_result_invalid');
  zeroAuthority(result, 'result');
  const recomputed = applyRsiHypothesisEvidenceGate({ plan, receipts });
  if (stableJson(recomputed) !== stableJson(result)) throw new Error('rsi_evidence_origin_result_mismatch');
  if (result.complete !== true || !TERMINAL_STATES.has(result.state)) throw new Error('rsi_evidence_origin_result_not_terminal');
  return recomputed;
}
function subjectCore(plan, receipts, result) {
  return {
    schema: RSI_EVIDENCE_ORIGIN_SUBJECT_SCHEMA,
    version: 1,
    evidence_class: 'RSI_HYPOTHESIS_EVIDENCE_READY_NON_AUTHORITY',
    plan: {
      plan_id: plan.plan_id,
      plan_digest: plan.plan_digest,
      hypothesis_id: plan.hypothesis.hypothesis_id,
      hypothesis_digest: plan.hypothesis.hypothesis_digest,
      experiment_id: plan.experiment.experiment_id,
      source_sha: plan.hypothesis.source_sha,
      candidate_id: plan.candidate.candidate_id,
      candidate_sha: plan.candidate.candidate_sha,
      handoff_digest: plan.candidate.handoff_digest,
      evaluator_mesh_plan_id: plan.evaluator_mesh_binding.plan_id,
      evaluator_mesh_plan_digest: plan.evaluator_mesh_binding.plan_digest,
    },
    terminal_result: {
      state: result.state,
      disposition: result.disposition,
      result_digest: result.result_digest,
      eligible_for_evaluator_mesh_before_origin_proof: false,
    },
    receipt_digests: receipts.map((receipt) => receipt.receipt_digest),
    receipt_set_digest: digest(receipts.map((receipt) => receipt.receipt_digest)),
    attestation_policy: attestationPolicy(),
    origin_proven: false,
    eligible_for_evaluator_mesh: false,
    replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function createRsiEvidenceOriginSubject({ plan, receipts = [], result } = {}) {
  verifyRsiHypothesisEvidenceGatePlan(plan);
  const canonical = canonicalReceipts(plan, receipts);
  const terminal = canonicalResult(plan, canonical, result);
  const core = subjectCore(plan, canonical, terminal);
  const subjectDigest = digest(core);
  return Object.freeze({ ...core, subject_id: `rsi_origin_${subjectDigest.slice('sha256:'.length)}`, subject_digest: subjectDigest });
}

export function verifyRsiEvidenceOriginSubject(subject) {
  if (!plainObject(subject) || subject.schema !== RSI_EVIDENCE_ORIGIN_SUBJECT_SCHEMA || subject.version !== 1) throw new Error('rsi_evidence_origin_subject_invalid');
  zeroAuthority(subject, 'subject');
  if (subject.evidence_class !== 'RSI_HYPOTHESIS_EVIDENCE_READY_NON_AUTHORITY' || subject.origin_proven !== false || subject.eligible_for_evaluator_mesh !== false || subject.replay_authorized !== false) throw new Error('rsi_evidence_origin_subject_policy_invalid');
  exactSha(subject.plan?.source_sha, 'subject_source');
  exactSha(subject.plan?.candidate_sha, 'subject_candidate');
  exactDigest(subject.plan?.plan_digest, 'subject_plan');
  exactDigest(subject.plan?.hypothesis_digest, 'subject_hypothesis');
  exactDigest(subject.plan?.handoff_digest, 'subject_handoff');
  exactDigest(subject.plan?.evaluator_mesh_plan_digest, 'subject_evaluator');
  exactDigest(subject.terminal_result?.result_digest, 'subject_result');
  exactDigest(subject.receipt_set_digest, 'subject_receipt_set');
  if (!Array.isArray(subject.receipt_digests) || subject.receipt_digests.length < 1 || new Set(subject.receipt_digests).size !== subject.receipt_digests.length) throw new Error('rsi_evidence_origin_subject_receipts_invalid');
  for (const receiptDigest of subject.receipt_digests) exactDigest(receiptDigest, 'subject_receipt');
  if (subject.receipt_set_digest !== digest(subject.receipt_digests)) throw new Error('rsi_evidence_origin_subject_receipt_set_mismatch');
  if (stableJson(subject.attestation_policy) !== stableJson(attestationPolicy())) throw new Error('rsi_evidence_origin_attestation_policy_tampered');
  const core = structuredClone(subject);
  delete core.subject_id;
  delete core.subject_digest;
  const expected = digest(core);
  if (subject.subject_digest !== expected || subject.subject_id !== `rsi_origin_${expected.slice('sha256:'.length)}`) throw new Error('rsi_evidence_origin_subject_digest_mismatch');
  return Object.freeze({ schema: 'metaengine.rsi.evidence-origin-subject-verify.v1', ok: true, subject_id: subject.subject_id, subject_digest: subject.subject_digest, origin_proven: false, eligible_for_evaluator_mesh: false, authority_effect: false });
}

function canonicalReadback(subject, readback) {
  if (!plainObject(readback) || readback.schema !== RSI_EVIDENCE_ORIGIN_READBACK_SCHEMA || readback.version !== 1) throw new Error('rsi_evidence_origin_readback_invalid');
  zeroAuthority(readback, 'readback');
  if (readback.repository !== TRUSTED_REPOSITORY || readback.workflow_path !== TRUSTED_WORKFLOW_PATH || readback.workflow_ref !== TRUSTED_WORKFLOW_REF) throw new Error('rsi_evidence_origin_readback_workflow_mismatch');
  const workflowSha = exactSha(readback.workflow_sha, 'workflow');
  const workflowBlobSha = exactSha(readback.workflow_blob_sha, 'workflow_blob');
  const runId = positiveInt(readback.run_id, 'run_id');
  const runAttempt = positiveInt(readback.run_attempt, 'run_attempt');
  const bundleSha = rawDigest(readback.bundle_sha256, 'bundle');
  const verificationSha = rawDigest(readback.verification_bytes_sha256, 'verification_bytes');
  if (readback.subject_id !== subject.subject_id || exactDigest(readback.subject_digest, 'readback_subject') !== subject.subject_digest) throw new Error('rsi_evidence_origin_readback_subject_mismatch');
  if (readback.attestation_action !== ATTEST_ACTION || readback.verification_method !== VERIFY_COMMAND || readback.verification_repository !== TRUSTED_REPOSITORY) throw new Error('rsi_evidence_origin_readback_verifier_mismatch');
  if (readback.identity_source !== ORIGIN_IDENTITY_SOURCE || readback.attestation_verified !== true || readback.independent_verification_passed !== true) throw new Error('rsi_evidence_origin_readback_verification_invalid');
  if (readback.external_trusted_workflow !== true || readback.authored_by_candidate !== false || readback.project_authority_granted !== false) throw new Error('rsi_evidence_origin_readback_origin_invalid');
  return {
    schema: RSI_EVIDENCE_ORIGIN_READBACK_SCHEMA,
    version: 1,
    subject_id: subject.subject_id,
    subject_digest: subject.subject_digest,
    repository: TRUSTED_REPOSITORY,
    workflow_path: TRUSTED_WORKFLOW_PATH,
    workflow_ref: TRUSTED_WORKFLOW_REF,
    workflow_sha: workflowSha,
    workflow_blob_sha: workflowBlobSha,
    run_id: runId,
    run_attempt: runAttempt,
    bundle_sha256: bundleSha,
    verification_bytes_sha256: verificationSha,
    attestation_action: ATTEST_ACTION,
    verification_method: VERIFY_COMMAND,
    verification_repository: TRUSTED_REPOSITORY,
    identity_source: ORIGIN_IDENTITY_SOURCE,
    attestation_verified: true,
    independent_verification_passed: true,
    external_trusted_workflow: true,
    authored_by_candidate: false,
    project_authority_granted: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function verifyRsiEvidenceOriginReadback({ subject, readback } = {}) {
  verifyRsiEvidenceOriginSubject(subject);
  const core = canonicalReadback(subject, readback);
  const expected = digest(core);
  if (readback.readback_digest !== expected) throw new Error('rsi_evidence_origin_readback_digest_mismatch');
  const resultCore = {
    schema: RSI_EVIDENCE_ORIGIN_RESULT_SCHEMA,
    version: 1,
    subject_id: subject.subject_id,
    subject_digest: subject.subject_digest,
    readback_digest: expected,
    terminal_state: subject.terminal_result.state,
    origin_proven: true,
    evidence_class: 'ATTESTED_EVIDENCE_READY_NON_AUTHORITY',
    eligible_for_evaluator_mesh: subject.terminal_result.state === 'ADMITTED',
    replay_authorized: false,
    project_authority_granted: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...resultCore, result_digest: digest(resultCore) });
}
