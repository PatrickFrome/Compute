// Client V1 C5 useful-work proof contract.
//
// This module does not execute work, schedule agents, or promote roadmap state.
// It validates a digest-only signed/read-only evidence projection against the
// already-normalized Client goal execution proof.
//
// Positive C5 evidence requires the concrete useful-work chain:
// repo checkout -> isolated edit -> failing pre-repair test -> passing repair
// test/build -> content-addressed artifact -> independent verification.
//
// Even a valid LIVE proof has no canonical C2 promotion authority. R1/C1
// dependencies and Supervisor review remain external gates.

export const CLIENT_USEFUL_WORK_PROOF_SCHEMA = 'metaengine.client-v1.useful-work-proof.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;
const EVIDENCE_CLASSES = new Set(['LIVE', 'SYNTHETIC']);
const EVIDENCE_ORIGINS = new Set(['SIGNED_SUPERVISOR_READBACK', 'CONTROLLED_FIXTURE']);
const ZERO_AUTHORITY_KEYS = [
  'automatic_retry_allowed',
  'scheduler_authority',
  'browser_authority',
  'release_authority',
  'authority_effect',
];

const FORBIDDEN_RAW_KEYS = new Set([
  'agent_id',
  'tab_id',
  'target_id',
  'repository_url',
  'repository_path',
  'workspace_path',
  'git_dir',
  'patch',
  'diff',
  'stdout',
  'stderr',
  'artifact_path',
  'result_summary',
  'model_output',
  'page_content',
]);

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) => typeof value === 'string' && SHA256_RE.test(value);
const zeroAuthority = (value) => object(value) && ZERO_AUTHORITY_KEYS.every((key) => value[key] === false);

function scanForbiddenRawFields(value, trail = 'proof') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenRawFields(item, `${trail}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_KEYS.has(key)) {
      throw new Error(`client_useful_work_raw_field_forbidden:${trail}.${key}`);
    }
    scanForbiddenRawFields(child, `${trail}.${key}`);
  }
}

function requireNormalizedExecutionProof(proof) {
  const row = object(proof);
  const result = object(row?.result_proof);
  const origin = object(row?.agent_origin_proof);
  if (
    !row
    || row.schema !== 'metaengine.client.goal-execution-proof.v1'
    || row.found !== true
    || row.roadmap_id !== 'metaengine-client-v1'
    || row.task_state !== 'COMPLETED'
    || row.terminal !== true
    || !positiveInteger(row.lease_generation)
    || row.user_goal_to_agent_readback !== true
    || row.user_goal_to_result_readback !== true
    || row.authority_effect !== false
    || row.automatic_retry_allowed !== false
    || !origin
    || origin.proven !== true
    || !digest(origin.conversation_url_sha256)
    || !result
    || result.available !== true
    || result.claim_valid !== true
    || result.origin_bound !== true
    || result.accepted !== true
    || !digest(result.result_sha256)
    || !digest(result.claim_sha256)
    || result.conversation_url_sha256 !== origin.conversation_url_sha256
  ) {
    throw new Error('client_useful_work_execution_proof_not_completed');
  }
  return row;
}

function validateExactBinding(row, execution) {
  const binding = [
    'request_id',
    'workspace_id',
    'roadmap_id',
    'plan_generation',
    'alignment_epoch',
    'baseline_sha',
    'plan_sha256',
    'point_id',
    'task_id',
    'task_spec_sha256',
    'lease_generation',
  ];
  if (binding.some((key) => row[key] == null || row[key] !== execution[key])) {
    throw new Error('client_useful_work_execution_binding_drift');
  }
  if (
    row.result_sha256 !== execution.result_proof.result_sha256
    || row.claim_sha256 !== execution.result_proof.claim_sha256
    || row.conversation_url_sha256 !== execution.agent_origin_proof.conversation_url_sha256
  ) {
    throw new Error('client_useful_work_result_binding_drift');
  }
}

function normalizeRepository(value, baselineSha) {
  const row = object(value);
  if (
    !row
    || !digest(row.repository_identity_sha256)
    || typeof row.checkout_sha !== 'string'
    || !SHA40_RE.test(row.checkout_sha)
    || row.checkout_sha !== baselineSha
    || !digest(row.source_snapshot_sha256)
    || row.isolated_workspace !== true
    || row.host_repository_mounted !== false
    || row.host_git_directory_mounted !== false
    || row.linked_git_worktree_exposed !== false
    || row.source_snapshot_read_only !== true
    || row.authority_effect !== false
  ) throw new Error('client_useful_work_repository_invalid');
  return Object.freeze({
    repository_identity_sha256: row.repository_identity_sha256,
    checkout_sha: row.checkout_sha,
    source_snapshot_sha256: row.source_snapshot_sha256,
    isolated_workspace: true,
    host_repository_mounted: false,
    host_git_directory_mounted: false,
    linked_git_worktree_exposed: false,
    source_snapshot_read_only: true,
    authority_effect: false,
  });
}

function normalizeEdit(value) {
  const row = object(value);
  if (
    !row
    || !digest(row.patch_sha256)
    || !digest(row.changed_file_manifest_sha256)
    || !positiveInteger(row.changed_file_count)
    || !positiveInteger(row.materialized_edit_operations)
    || row.edit_materialized !== true
    || row.protected_root_modified !== false
    || row.host_repository_modified !== false
    || row.authority_effect !== false
  ) throw new Error('client_useful_work_edit_invalid');
  return Object.freeze({
    patch_sha256: row.patch_sha256,
    changed_file_manifest_sha256: row.changed_file_manifest_sha256,
    changed_file_count: row.changed_file_count,
    materialized_edit_operations: row.materialized_edit_operations,
    edit_materialized: true,
    protected_root_modified: false,
    host_repository_modified: false,
    authority_effect: false,
  });
}

function normalizeVerification(value) {
  const row = object(value);
  if (
    !row
    || !digest(row.command_contract_sha256)
    || !digest(row.pre_repair_receipt_sha256)
    || !digest(row.post_repair_receipt_sha256)
    || row.pre_repair_test_observed !== true
    || !positiveInteger(row.pre_repair_exit_code)
    || row.post_repair_test_observed !== true
    || row.post_repair_exit_code !== 0
    || row.real_build_or_test !== true
    || row.repair_verified !== true
    || row.authority_effect !== false
  ) throw new Error('client_useful_work_verification_invalid');
  return Object.freeze({
    command_contract_sha256: row.command_contract_sha256,
    pre_repair_receipt_sha256: row.pre_repair_receipt_sha256,
    pre_repair_test_observed: true,
    pre_repair_exit_code: row.pre_repair_exit_code,
    post_repair_receipt_sha256: row.post_repair_receipt_sha256,
    post_repair_test_observed: true,
    post_repair_exit_code: 0,
    real_build_or_test: true,
    repair_verified: true,
    authority_effect: false,
  });
}

function normalizeArtifact(value) {
  const row = object(value);
  if (
    !row
    || !digest(row.artifact_sha256)
    || !positiveInteger(row.artifact_bytes)
    || row.artifact_subject_sha256 !== row.artifact_sha256
    || !digest(row.provenance_sha256)
    || !digest(row.verification_receipt_sha256)
    || row.provenance_verified !== true
    || row.subject_digest_verified !== true
    || row.artifact_verified !== true
    || row.authority_effect !== false
  ) throw new Error('client_useful_work_artifact_invalid');
  return Object.freeze({
    artifact_sha256: row.artifact_sha256,
    artifact_bytes: row.artifact_bytes,
    artifact_subject_sha256: row.artifact_subject_sha256,
    provenance_sha256: row.provenance_sha256,
    verification_receipt_sha256: row.verification_receipt_sha256,
    provenance_verified: true,
    subject_digest_verified: true,
    artifact_verified: true,
    authority_effect: false,
  });
}

function normalizeReview(value, artifactSha256) {
  const row = object(value);
  if (
    !row
    || !digest(row.review_receipt_sha256)
    || row.independent_verifier !== true
    || row.accepted !== true
    || row.accepted_artifact_sha256 !== artifactSha256
    || row.authority_effect !== false
  ) throw new Error('client_useful_work_review_invalid');
  return Object.freeze({
    review_receipt_sha256: row.review_receipt_sha256,
    independent_verifier: true,
    accepted: true,
    accepted_artifact_sha256: row.accepted_artifact_sha256,
    authority_effect: false,
  });
}

export function normalizeClientUsefulWorkProof(value, executionProof) {
  const row = object(value);
  if (
    !row
    || row.schema !== CLIENT_USEFUL_WORK_PROOF_SCHEMA
    || typeof row.found !== 'boolean'
    || !zeroAuthority(row)
  ) throw new Error('client_useful_work_proof_invalid');

  scanForbiddenRawFields(row);

  if (row.found === false) {
    if (row.user_goal_to_verified_artifact_readback !== false || row.client_c5_useful_work_verified !== false) {
      throw new Error('client_useful_work_absent_invalid');
    }
    return Object.freeze({
      schema: CLIENT_USEFUL_WORK_PROOF_SCHEMA,
      found: false,
      user_goal_to_verified_artifact_readback: false,
      client_c5_useful_work_verified: false,
      canonical_c2_promotion_authorized: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    });
  }

  const execution = requireNormalizedExecutionProof(executionProof);
  if (
    typeof row.request_id !== 'string' || !UUID_RE.test(row.request_id)
    || typeof row.workspace_id !== 'string' || !UUID_RE.test(row.workspace_id)
    || row.roadmap_id !== 'metaengine-client-v1'
    || !positiveInteger(row.plan_generation)
    || !positiveInteger(row.alignment_epoch)
    || typeof row.baseline_sha !== 'string' || !SHA40_RE.test(row.baseline_sha)
    || !digest(row.plan_sha256)
    || typeof row.point_id !== 'string' || !POINT_RE.test(row.point_id)
    || typeof row.task_id !== 'string' || !UUID_RE.test(row.task_id)
    || !digest(row.task_spec_sha256)
    || !positiveInteger(row.lease_generation)
    || !digest(row.result_sha256)
    || !digest(row.claim_sha256)
    || !digest(row.conversation_url_sha256)
    || !EVIDENCE_CLASSES.has(row.evidence_class)
    || !EVIDENCE_ORIGINS.has(row.evidence_origin)
    || row.serial_loop_end_to_end !== true
    || row.user_goal_to_verified_artifact_readback !== true
  ) throw new Error('client_useful_work_binding_invalid');

  validateExactBinding(row, execution);

  const repository = normalizeRepository(row.repository, row.baseline_sha);
  const edit = normalizeEdit(row.edit);
  const verification = normalizeVerification(row.verification);
  const artifact = normalizeArtifact(row.artifact);
  const review = normalizeReview(row.review, artifact.artifact_sha256);

  const liveQualified = row.evidence_class === 'LIVE'
    && row.evidence_origin === 'SIGNED_SUPERVISOR_READBACK';

  if (row.client_c5_useful_work_verified !== liveQualified) {
    throw new Error('client_useful_work_evidence_class_summary_invalid');
  }

  return Object.freeze({
    schema: CLIENT_USEFUL_WORK_PROOF_SCHEMA,
    found: true,
    request_id: row.request_id,
    workspace_id: row.workspace_id,
    roadmap_id: row.roadmap_id,
    plan_generation: row.plan_generation,
    alignment_epoch: row.alignment_epoch,
    baseline_sha: row.baseline_sha,
    plan_sha256: row.plan_sha256,
    point_id: row.point_id,
    task_id: row.task_id,
    task_spec_sha256: row.task_spec_sha256,
    lease_generation: row.lease_generation,
    result_sha256: row.result_sha256,
    claim_sha256: row.claim_sha256,
    conversation_url_sha256: row.conversation_url_sha256,
    evidence_class: row.evidence_class,
    evidence_origin: row.evidence_origin,
    repository,
    edit,
    verification,
    artifact,
    review,
    serial_loop_end_to_end: true,
    user_goal_to_verified_artifact_readback: true,
    client_c5_useful_work_verified: liveQualified,
    canonical_c2_criteria: Object.freeze({
      repo_checkout: true,
      isolated_edit: true,
      real_build_or_test: true,
      verified_artifact: true,
      serial_loop_end_to_end: true,
    }),
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}


export function clientUsefulWorkProofMatchesExecution(proof, executionProof) {
  const row = object(proof);
  const execution = object(executionProof);
  const artifact = object(row?.artifact);
  const review = object(row?.review);
  const result = object(execution?.result_proof);
  const origin = object(execution?.agent_origin_proof);
  if (
    !row || !execution
    || row.schema !== CLIENT_USEFUL_WORK_PROOF_SCHEMA
    || row.found !== true
    || row.user_goal_to_verified_artifact_readback !== true
    || row.serial_loop_end_to_end !== true
    || row.authority_effect !== false
    || row.automatic_retry_allowed !== false
    || execution.schema !== 'metaengine.client.goal-execution-proof.v1'
    || execution.found !== true
    || execution.authority_effect !== false
    || execution.automatic_retry_allowed !== false
    || !artifact
    || artifact.artifact_verified !== true
    || !digest(artifact.artifact_sha256)
    || !digest(artifact.provenance_sha256)
    || !digest(artifact.verification_receipt_sha256)
    || !review
    || review.accepted !== true
    || review.independent_verifier !== true
    || review.accepted_artifact_sha256 !== artifact.artifact_sha256
    || !result
    || !origin
  ) return false;

  const binding = [
    'request_id',
    'workspace_id',
    'roadmap_id',
    'plan_generation',
    'alignment_epoch',
    'baseline_sha',
    'plan_sha256',
    'point_id',
    'task_id',
    'task_spec_sha256',
    'lease_generation',
  ];
  if (binding.some((key) => row[key] == null || row[key] !== execution[key])) return false;

  return (
    row.result_sha256 === result.result_sha256
    && row.claim_sha256 === result.claim_sha256
    && row.conversation_url_sha256 === origin.conversation_url_sha256
  );
}

export function clientUsefulWorkProofSameArtifact(left, right) {
  const a = object(left);
  const b = object(right);
  if (!a || !b) return false;
  const aa = object(a.artifact);
  const ba = object(b.artifact);
  const ar = object(a.review);
  const br = object(b.review);
  if (!aa || !ba || !ar || !br) return false;
  return (
    a.evidence_class === b.evidence_class
    && a.evidence_origin === b.evidence_origin
    && a.client_c5_useful_work_verified === b.client_c5_useful_work_verified
    && aa.artifact_sha256 === ba.artifact_sha256
    && aa.provenance_sha256 === ba.provenance_sha256
    && aa.verification_receipt_sha256 === ba.verification_receipt_sha256
    && ar.review_receipt_sha256 === br.review_receipt_sha256
    && ar.accepted_artifact_sha256 === br.accepted_artifact_sha256
  );
}
