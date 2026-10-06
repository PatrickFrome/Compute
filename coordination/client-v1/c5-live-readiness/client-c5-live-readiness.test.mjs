import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA,
  CLIENT_C5_LIVE_OBJECTIVE,
  CLIENT_C5_LIVE_READINESS_SCHEMA,
  clientC5LiveCapsuleDigest,
  clientC5LiveReadinessMatchesSubmission,
  clientC5LiveReadinessMatchesUsefulWork,
  normalizeClientC5LiveDispatchAuthorization,
  normalizeClientC5LiveReadinessCapsule,
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

const head = 'a'.repeat(40);
const repoDigest = '1'.repeat(64);
const commandDigest = '2'.repeat(64);
const manifestDigest = '3'.repeat(64);
const patchDigest = '4'.repeat(64);
const artifactDigest = '5'.repeat(64);
const fixtureDigest = '6'.repeat(64);
const answerBefore = '7'.repeat(64);
const answerAfter = '8'.repeat(64);
const testDigest = '9'.repeat(64);
const buildDigest = 'a'.repeat(64);
const objective = CLIENT_C5_LIVE_OBJECTIVE;

function capsule(mutator = null) {
  const material = {
    schema: CLIENT_C5_LIVE_READINESS_SCHEMA,
    source_head: head,
    repository_identity_sha256: repoDigest,
    roadmap_id: 'metaengine-client-v1',
    canonical_owner: 'C2_FIRST_SERIAL_CODING_LOOP',
    client_gate: 'C5_USEFUL_WORK',
    objective,
    objective_sha256: sha256ClientC5(objective),
    fixture_snapshot_sha256: fixtureDigest,
    target: {
      fixture_root: 'coordination/client-v1/c5-live-readiness/fixture',
      allowed_changed_paths: ['coordination/client-v1/c5-live-readiness/fixture/answer.mjs'],
      max_changed_files: 1,
      test_path: 'coordination/client-v1/c5-live-readiness/fixture/answer.test.mjs',
      build_path: 'coordination/client-v1/c5-live-readiness/fixture/build.mjs',
      artifact_path: 'coordination/client-v1/c5-live-readiness/fixture/dist/live-artifact.json',
      network_required: false,
      isolated_workspace_required: true,
      host_repository_mutation_allowed: false,
      host_git_exposed_allowed: false,
      linked_worktree_allowed: false,
    },
    commands: {
      pre_repair: ['node', '--test', 'coordination/client-v1/c5-live-readiness/fixture/answer.test.mjs'],
      post_repair: ['node', '--test', 'coordination/client-v1/c5-live-readiness/fixture/answer.test.mjs'],
      build: ['node', 'coordination/client-v1/c5-live-readiness/fixture/build.mjs'],
      shell: false,
      network_required: false,
    },
    command_contract_sha256: commandDigest,
    fixture: {
      answer_before_sha256: answerBefore,
      answer_after_sha256: answerAfter,
      test_sha256: testDigest,
      build_sha256: buildDigest,
      pre_repair_exit_code: 1,
      post_repair_exit_code: 0,
      build_exit_code: 0,
    },
    changed_file_manifest_sha256: manifestDigest,
    canonical_patch_sha256: patchDigest,
    expected_artifact_sha256: artifactDigest,
    expected_artifact_bytes: 96,
    expected_artifact: {
      path: 'coordination/client-v1/c5-live-readiness/fixture/dist/live-artifact.json',
      schema: 'metaengine.client-v1.c5-live-artifact.v1',
      sha256: artifactDigest,
      bytes: 96,
      answer: 42,
      verified_behavior: 'answer-is-42',
    },
    live_readback_contract: {
      evidence_class: 'LIVE',
      evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
      baseline_sha: head,
      repository_identity_sha256: repoDigest,
      command_contract_sha256: commandDigest,
      changed_file_manifest_sha256: manifestDigest,
      patch_sha256: patchDigest,
      artifact_sha256: artifactDigest,
      artifact_bytes: 96,
      independent_verifier_required: true,
      user_goal_to_agent_readback_required: true,
      user_goal_to_result_readback_required: true,
    },
    dispatch_gate: {
      required_environment: 'client-v1-c5-live',
      environment_protection_verified: false,
      human_approval_required: true,
      prevent_self_review_required: true,
      explicit_live_effect_authorization_required: true,
      single_flight_required: true,
      live_effect_authorized: false,
      provider_contacted: false,
      goal_submitted: false,
      execution_ready: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    },
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
  if (mutator) mutator(material);
  return {
    ...material,
    capsule_sha256: clientC5LiveCapsuleDigest(material),
  };
}

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const planSha = 'b'.repeat(64);
const taskSpec = 'c'.repeat(64);
const conversation = 'd'.repeat(64);
const resultSha = 'e'.repeat(64);
const claimSha = 'f'.repeat(64);

function executionProof(overrides = {}) {
  return {
    schema: 'metaengine.client.goal-execution-proof.v1',
    request_id: requestId,
    found: true,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 1,
    alignment_epoch: 1,
    baseline_sha: head,
    plan_sha256: planSha,
    point_id: 'obj.client-c5-live-useful-work.v1',
    task_id: taskId,
    task_spec_sha256: taskSpec,
    task_state: 'COMPLETED',
    terminal: true,
    lease_generation: 1,
    survives_plan_retirement: true,
    agent_origin_proof: {
      proven: true,
      contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
      conversation_url_sha256: conversation,
      agent_surface_sha256: '1'.repeat(64),
      prompt_sha256: '2'.repeat(64),
      effect_state: 'PROVEN_CONVERSATION',
      lease_generation: 1,
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
    schema: 'metaengine.client-v1.useful-work-proof.v1',
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 1,
    alignment_epoch: 1,
    baseline_sha: head,
    plan_sha256: planSha,
    point_id: 'obj.client-c5-live-useful-work.v1',
    task_id: taskId,
    task_spec_sha256: taskSpec,
    lease_generation: 1,
    result_sha256: resultSha,
    claim_sha256: claimSha,
    conversation_url_sha256: conversation,
    evidence_class: 'LIVE',
    evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
    repository: {
      repository_identity_sha256: repoDigest,
      checkout_sha: head,
      source_snapshot_sha256: '3'.repeat(64),
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: patchDigest,
      changed_file_manifest_sha256: manifestDigest,
      changed_file_count: 1,
      materialized_edit_operations: 1,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: commandDigest,
      pre_repair_receipt_sha256: '4'.repeat(64),
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: '5'.repeat(64),
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactDigest,
      artifact_bytes: 96,
      artifact_subject_sha256: artifactDigest,
      provenance_sha256: '6'.repeat(64),
      verification_receipt_sha256: '7'.repeat(64),
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: '8'.repeat(64),
      independent_verifier: true,
      accepted: true,
      accepted_artifact_sha256: artifactDigest,
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

test('PREPARE_ONLY capsule is valid but cannot authorize live execution', () => {
  const out = normalizeClientC5LiveReadinessCapsule(capsule());
  assert.equal(out.dispatch_gate.environment_protection_verified, false);
  assert.equal(out.dispatch_gate.live_effect_authorized, false);
  assert.equal(out.dispatch_gate.execution_ready, false);
  assert.equal(out.dispatch_gate.goal_submitted, false);
  assert.equal(out.authority_effect, false);
});

test('capsule digest binds the complete launch contract', () => {
  const row = capsule();
  row.target.max_changed_files = 2;
  assert.throws(() => normalizeClientC5LiveReadinessCapsule(row), /client_c5_live_target_boundary_invalid|client_c5_live_capsule_digest_mismatch/);
});

test('objective, path and network drift fail closed', () => {
  const objectiveDrift = capsule((row) => { row.objective += ' extra'; });
  objectiveDrift.objective_sha256 = sha256ClientC5(objectiveDrift.objective);
  objectiveDrift.capsule_sha256 = clientC5LiveCapsuleDigest(objectiveDrift);
  assert.throws(() => normalizeClientC5LiveReadinessCapsule(objectiveDrift), /client_c5_live_objective_invalid|capsule/);

  const pathDrift = capsule((row) => { row.target.allowed_changed_paths.push('README.md'); });
  pathDrift.capsule_sha256 = clientC5LiveCapsuleDigest(pathDrift);
  assert.throws(() => normalizeClientC5LiveReadinessCapsule(pathDrift), /client_c5_live_target_boundary_invalid/);

  const network = capsule((row) => { row.target.network_required = true; });
  network.capsule_sha256 = clientC5LiveCapsuleDigest(network);
  assert.throws(() => normalizeClientC5LiveReadinessCapsule(network), /client_c5_live_target_boundary_invalid/);
});

test('capsule rejects secret-like fields', () => {
  const row = capsule((value) => { value.dispatch_gate.provider_token = 'do-not-store'; });
  row.capsule_sha256 = clientC5LiveCapsuleDigest(row);
  assert.throws(() => normalizeClientC5LiveReadinessCapsule(row), /client_c5_live_secret_field_forbidden/);
});

test('exact Client submission must match objective and source baseline', () => {
  const row = capsule();
  const receipt = {
    schema: 'metaengine.client.goal-submission.v1',
    goal: objective,
    roadmap_id: 'metaengine-client-v1',
    baseline_sha: head,
    atomic_plan_and_admission: true,
    exact_activation_readback: true,
    operator_initiated: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    authority_effect: false,
  };
  assert.equal(clientC5LiveReadinessMatchesSubmission(row, receipt), true);
  assert.equal(clientC5LiveReadinessMatchesSubmission(row, { ...receipt, baseline_sha: 'b'.repeat(40) }), false);
  assert.equal(clientC5LiveReadinessMatchesSubmission(row, { ...receipt, goal: objective + ' drift' }), false);
});

test('only exact LIVE signed Supervisor useful-work proof matches the capsule', () => {
  const row = capsule();
  assert.equal(clientC5LiveReadinessMatchesUsefulWork(row, usefulWork(), executionProof()), true);

  assert.equal(clientC5LiveReadinessMatchesUsefulWork(
    row,
    usefulWork({ evidence_class: 'SYNTHETIC', evidence_origin: 'CONTROLLED_FIXTURE', client_c5_useful_work_verified: false }),
    executionProof(),
  ), false);

  const artifactDrift = usefulWork();
  artifactDrift.artifact = { ...artifactDrift.artifact, artifact_sha256: '9'.repeat(64), artifact_subject_sha256: '9'.repeat(64) };
  artifactDrift.review = { ...artifactDrift.review, accepted_artifact_sha256: '9'.repeat(64) };
  assert.equal(clientC5LiveReadinessMatchesUsefulWork(row, artifactDrift, executionProof()), false);

  const commandDrift = usefulWork();
  commandDrift.verification = { ...commandDrift.verification, command_contract_sha256: 'a'.repeat(64) };
  assert.equal(clientC5LiveReadinessMatchesUsefulWork(row, commandDrift, executionProof()), false);

  const manifestDrift = usefulWork();
  manifestDrift.edit = { ...manifestDrift.edit, changed_file_manifest_sha256: 'b'.repeat(64) };
  assert.equal(clientC5LiveReadinessMatchesUsefulWork(row, manifestDrift, executionProof()), false);
});

test('dispatch authorization is a separate post-readiness proof and fails closed without environment approval', () => {
  const row = capsule();
  const good = {
    schema: CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA,
    capsule_sha256: row.capsule_sha256,
    source_head: head,
    environment: 'client-v1-c5-live',
    environment_protection_verified: true,
    required_reviewer_approved: true,
    self_review_used: false,
    explicit_live_effect_authorized: true,
    single_flight: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
  assert.equal(normalizeClientC5LiveDispatchAuthorization(good, row).explicit_live_effect_authorized, true);

  for (const mutation of [
    { environment_protection_verified: false },
    { required_reviewer_approved: false },
    { self_review_used: true },
    { explicit_live_effect_authorized: false },
    { single_flight: false },
    { automatic_retry_allowed: true },
  ]) {
    assert.throws(
      () => normalizeClientC5LiveDispatchAuthorization({ ...good, ...mutation }, row),
      /client_c5_live_dispatch_authorization_invalid/,
    );
  }
});

test('stable JSON hashing is order-insensitive for object keys', () => {
  assert.equal(
    sha256ClientC5(stableClientC5Json({ b: 2, a: 1 })),
    sha256ClientC5(stableClientC5Json({ a: 1, b: 2 })),
  );
});
