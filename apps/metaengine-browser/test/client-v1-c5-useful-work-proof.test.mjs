import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_USEFUL_WORK_PROOF_SCHEMA,
  normalizeClientUsefulWorkProof,
} from '../src/client-useful-work-proof.mjs';

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const baseline = 'b'.repeat(40);
const plan = 'c'.repeat(64);
const taskSpec = 'd'.repeat(64);
const pointId = 'obj.ship-useful-work.v1';
const conversation = 'a'.repeat(64);
const resultSha = '1'.repeat(64);
const claimSha = '2'.repeat(64);
const artifactSha = '3'.repeat(64);

function executionProof(overrides = {}) {
  return {
    schema: 'metaengine.client.goal-execution-proof.v1',
    request_id: requestId,
    found: true,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 4,
    alignment_epoch: 3,
    baseline_sha: baseline,
    plan_sha256: plan,
    point_id: pointId,
    task_id: taskId,
    task_spec_sha256: taskSpec,
    task_state: 'COMPLETED',
    terminal: true,
    lease_generation: 2,
    survives_plan_retirement: true,
    agent_origin_proof: {
      proven: true,
      contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
      conversation_url_sha256: conversation,
      agent_surface_sha256: 'e'.repeat(64),
      prompt_sha256: 'f'.repeat(64),
      effect_state: 'PROVEN_CONVERSATION',
      lease_generation: 2,
      agent_identity_exposed: false,
      tab_identity_exposed: false,
      target_identity_exposed: false,
      authority_effect: false,
    },
    result_proof: {
      available: true,
      result_summary_sha256: resultSha,
      result_sha256: resultSha,
      claim_valid: true,
      claim_schema: 'metaengine.agent-result-claim.v1',
      claim_sha256: claimSha,
      claim_disposition: 'ACCEPT',
      conversation_url_sha256: conversation,
      origin_bound: true,
      accepted: true,
      result_summary_exposed: false,
      model_output_exposed: false,
      page_content_exposed: false,
      authority_effect: false,
    },
    user_goal_to_agent_readback: true,
    user_goal_to_result_readback: true,
    task_payload_exposed: false,
    result_summary_exposed: false,
    page_content_exposed: false,
    model_output_exposed: false,
    scheduler_identity_exposed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

function usefulWork(overrides = {}) {
  return {
    schema: CLIENT_USEFUL_WORK_PROOF_SCHEMA,
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 4,
    alignment_epoch: 3,
    baseline_sha: baseline,
    plan_sha256: plan,
    point_id: pointId,
    task_id: taskId,
    task_spec_sha256: taskSpec,
    lease_generation: 2,
    result_sha256: resultSha,
    claim_sha256: claimSha,
    conversation_url_sha256: conversation,
    evidence_class: 'LIVE',
    evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
    repository: {
      repository_identity_sha256: '4'.repeat(64),
      checkout_sha: baseline,
      source_snapshot_sha256: '5'.repeat(64),
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: '6'.repeat(64),
      changed_file_manifest_sha256: '7'.repeat(64),
      changed_file_count: 2,
      materialized_edit_operations: 3,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: '8'.repeat(64),
      pre_repair_receipt_sha256: '9'.repeat(64),
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: 'a'.repeat(64),
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactSha,
      artifact_bytes: 4096,
      artifact_subject_sha256: artifactSha,
      provenance_sha256: 'b'.repeat(64),
      verification_receipt_sha256: 'c'.repeat(64),
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: 'd'.repeat(64),
      independent_verifier: true,
      accepted: true,
      accepted_artifact_sha256: artifactSha,
      authority_effect: false,
    },
    serial_loop_end_to_end: true,
    user_goal_to_verified_artifact_readback: true,
    client_c5_useful_work_verified: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

test('LIVE useful-work proof requires the full repo-edit-test-artifact-review chain', () => {
  const out = normalizeClientUsefulWorkProof(usefulWork(), executionProof());
  assert.equal(out.client_c5_useful_work_verified, true);
  assert.equal(out.user_goal_to_verified_artifact_readback, true);
  assert.deepEqual(out.canonical_c2_criteria, {
    repo_checkout: true,
    isolated_edit: true,
    real_build_or_test: true,
    verified_artifact: true,
    serial_loop_end_to_end: true,
  });
  assert.equal(out.canonical_c2_promotion_authorized, false);
  assert.equal(out.authority_effect, false);
});

test('SYNTHETIC contract fixture can validate structure but cannot qualify C5', () => {
  const out = normalizeClientUsefulWorkProof(usefulWork({
    evidence_class: 'SYNTHETIC',
    evidence_origin: 'CONTROLLED_FIXTURE',
    client_c5_useful_work_verified: false,
  }), executionProof());
  assert.equal(out.client_c5_useful_work_verified, false);
  assert.equal(out.canonical_c2_promotion_authorized, false);
});

test('absence stays an explicit non-claim', () => {
  const out = normalizeClientUsefulWorkProof({
    schema: CLIENT_USEFUL_WORK_PROOF_SCHEMA,
    found: false,
    user_goal_to_verified_artifact_readback: false,
    client_c5_useful_work_verified: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  }, null);
  assert.equal(out.found, false);
  assert.equal(out.client_c5_useful_work_verified, false);
});

test('C5 useful work refuses a merely RESULT_READY execution proof', () => {
  assert.throws(
    () => normalizeClientUsefulWorkProof(usefulWork(), executionProof({ task_state: 'RESULT_READY', terminal: false })),
    /client_useful_work_execution_proof_not_completed/,
  );
});

test('C5 useful work refuses execution binding drift', () => {
  assert.throws(
    () => normalizeClientUsefulWorkProof(usefulWork({ lease_generation: 3 }), executionProof()),
    /client_useful_work_execution_binding_drift/,
  );
});

test('C5 useful work refuses result/Agent-origin binding drift', () => {
  assert.throws(
    () => normalizeClientUsefulWorkProof(usefulWork({ claim_sha256: 'e'.repeat(64) }), executionProof()),
    /client_useful_work_result_binding_drift/,
  );
});

test('repo checkout must equal exact goal baseline and remain isolated from host repository', () => {
  const drift = usefulWork();
  drift.repository = { ...drift.repository, checkout_sha: 'f'.repeat(40) };
  assert.throws(
    () => normalizeClientUsefulWorkProof(drift, executionProof()),
    /client_useful_work_repository_invalid/,
  );

  const mounted = usefulWork();
  mounted.repository = { ...mounted.repository, host_repository_mounted: true };
  assert.throws(
    () => normalizeClientUsefulWorkProof(mounted, executionProof()),
    /client_useful_work_repository_invalid/,
  );
});

test('edit proof requires materialized change without protected or host-root mutation', () => {
  const noEdit = usefulWork();
  noEdit.edit = { ...noEdit.edit, changed_file_count: 0 };
  assert.throws(
    () => normalizeClientUsefulWorkProof(noEdit, executionProof()),
    /client_useful_work_edit_invalid/,
  );

  const hostEdit = usefulWork();
  hostEdit.edit = { ...hostEdit.edit, host_repository_modified: true };
  assert.throws(
    () => normalizeClientUsefulWorkProof(hostEdit, executionProof()),
    /client_useful_work_edit_invalid/,
  );
});

test('verification requires an observed failing pre-repair test and passing post-repair test', () => {
  const noFailure = usefulWork();
  noFailure.verification = { ...noFailure.verification, pre_repair_exit_code: 0 };
  assert.throws(
    () => normalizeClientUsefulWorkProof(noFailure, executionProof()),
    /client_useful_work_verification_invalid/,
  );

  const noRepair = usefulWork();
  noRepair.verification = { ...noRepair.verification, post_repair_exit_code: 1 };
  assert.throws(
    () => normalizeClientUsefulWorkProof(noRepair, executionProof()),
    /client_useful_work_verification_invalid/,
  );
});

test('artifact must bind verified provenance to the exact subject digest', () => {
  const drift = usefulWork();
  drift.artifact = { ...drift.artifact, artifact_subject_sha256: 'e'.repeat(64) };
  assert.throws(
    () => normalizeClientUsefulWorkProof(drift, executionProof()),
    /client_useful_work_artifact_invalid/,
  );

  const unverified = usefulWork();
  unverified.artifact = { ...unverified.artifact, provenance_verified: false };
  assert.throws(
    () => normalizeClientUsefulWorkProof(unverified, executionProof()),
    /client_useful_work_artifact_invalid/,
  );
});

test('independent review must accept the exact verified artifact', () => {
  const wrong = usefulWork();
  wrong.review = { ...wrong.review, accepted_artifact_sha256: 'f'.repeat(64) };
  assert.throws(
    () => normalizeClientUsefulWorkProof(wrong, executionProof()),
    /client_useful_work_review_invalid/,
  );

  const notIndependent = usefulWork();
  notIndependent.review = { ...notIndependent.review, independent_verifier: false };
  assert.throws(
    () => normalizeClientUsefulWorkProof(notIndependent, executionProof()),
    /client_useful_work_review_invalid/,
  );
});

test('raw repository, patch, logs, artifact path, model output and scheduler identities are forbidden', () => {
  for (const [field, value] of [
    ['repository_url', 'https://example.invalid/repo'],
    ['patch', 'raw patch'],
    ['stdout', 'raw output'],
    ['artifact_path', 'C:/artifact.bin'],
    ['model_output', 'secret model output'],
    ['agent_id', 'agent_should_not_escape'],
  ]) {
    const row = usefulWork();
    row.review = { ...row.review, [field]: value };
    assert.throws(
      () => normalizeClientUsefulWorkProof(row, executionProof()),
      /client_useful_work_raw_field_forbidden/,
      field,
    );
  }
});

test('LIVE evidence cannot claim false and synthetic evidence cannot claim true', () => {
  assert.throws(
    () => normalizeClientUsefulWorkProof(usefulWork({ client_c5_useful_work_verified: false }), executionProof()),
    /client_useful_work_evidence_class_summary_invalid/,
  );
  assert.throws(
    () => normalizeClientUsefulWorkProof(usefulWork({
      evidence_class: 'SYNTHETIC',
      evidence_origin: 'CONTROLLED_FIXTURE',
      client_c5_useful_work_verified: true,
    }), executionProof()),
    /client_useful_work_evidence_class_summary_invalid/,
  );
});
