import crypto from 'node:crypto';

import { normalizeClientUsefulWorkProof } from './client-useful-work-proof.mjs';

export const CLIENT_C5_LIVE_READINESS_SCHEMA = 'metaengine.client-v1.c5-live-readiness.v1';
export const CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA = 'metaengine.client-v1.c5-live-dispatch-authorization.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RELPATH_RE = /^[a-zA-Z0-9._/-]+$/;
const REQUIRED_ENVIRONMENT = 'client-v1-c5-live';
const FIXTURE_ROOT = 'apps/metaengine-browser/test/fixtures/client-c5-live-project';
const ANSWER_PATH = `${FIXTURE_ROOT}/answer.mjs`;
const TEST_PATH = `${FIXTURE_ROOT}/answer.test.mjs`;
const BUILD_PATH = `${FIXTURE_ROOT}/build.mjs`;
const ARTIFACT_PATH = `${FIXTURE_ROOT}/dist/live-artifact.json`;

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const digest = (value) => typeof value === 'string' && SHA256_RE.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableClientC5Json(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function sha256ClientC5(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function clientC5LiveCapsuleDigest(value) {
  const row = object(value);
  if (!row) throw new Error('client_c5_live_capsule_invalid');
  const { capsule_sha256: _ignored, ...material } = row;
  return sha256ClientC5(stableClientC5Json(material));
}

function assertPath(value, expected, code) {
  if (typeof value !== 'string' || !RELPATH_RE.test(value) || value !== expected) throw new Error(code);
}

function assertCommand(value, expected, code) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((part, index) => part !== expected[index])) {
    throw new Error(code);
  }
}

function assertNoSecrets(value, trail = 'capsule') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${trail}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/secret|token|private[_-]?key|service[_-]?role|password|credential/i.test(key)) {
      throw new Error(`client_c5_live_secret_field_forbidden:${trail}.${key}`);
    }
    assertNoSecrets(child, `${trail}.${key}`);
  }
}

export function normalizeClientC5LiveReadinessCapsule(value) {
  const row = object(value);
  if (
    !row
    || row.schema !== CLIENT_C5_LIVE_READINESS_SCHEMA
    || typeof row.source_head !== 'string'
    || !SHA40_RE.test(row.source_head)
    || !digest(row.repository_identity_sha256)
    || !digest(row.objective_sha256)
    || !digest(row.command_contract_sha256)
    || !digest(row.changed_file_manifest_sha256)
    || !digest(row.canonical_patch_sha256)
    || !digest(row.expected_artifact_sha256)
    || !positiveInteger(row.expected_artifact_bytes)
    || !digest(row.fixture_snapshot_sha256)
    || !digest(row.capsule_sha256)
  ) throw new Error('client_c5_live_capsule_invalid');

  assertNoSecrets(row);

  if (
    typeof row.objective !== 'string'
    || !row.objective.trim()
    || row.objective.length > 480
    || sha256ClientC5(row.objective) !== row.objective_sha256
  ) throw new Error('client_c5_live_objective_invalid');

  if (
    row.roadmap_id !== 'metaengine-client-v1'
    || row.canonical_owner !== 'C2_FIRST_SERIAL_CODING_LOOP'
    || row.client_gate !== 'C5_USEFUL_WORK'
  ) throw new Error('client_c5_live_roadmap_binding_invalid');

  const target = object(row.target);
  if (!target) throw new Error('client_c5_live_target_invalid');
  assertPath(target.fixture_root, FIXTURE_ROOT, 'client_c5_live_fixture_root_invalid');
  if (
    !Array.isArray(target.allowed_changed_paths)
    || target.allowed_changed_paths.length !== 1
    || target.allowed_changed_paths[0] !== ANSWER_PATH
    || target.max_changed_files !== 1
    || target.network_required !== false
    || target.isolated_workspace_required !== true
    || target.host_repository_mutation_allowed !== false
    || target.host_git_exposed_allowed !== false
    || target.linked_worktree_allowed !== false
  ) throw new Error('client_c5_live_target_boundary_invalid');
  assertPath(target.test_path, TEST_PATH, 'client_c5_live_test_path_invalid');
  assertPath(target.build_path, BUILD_PATH, 'client_c5_live_build_path_invalid');
  assertPath(target.artifact_path, ARTIFACT_PATH, 'client_c5_live_artifact_path_invalid');

  const commands = object(row.commands);
  if (!commands) throw new Error('client_c5_live_commands_invalid');
  assertCommand(commands.pre_repair, ['node', '--test', TEST_PATH], 'client_c5_live_pre_command_invalid');
  assertCommand(commands.post_repair, ['node', '--test', TEST_PATH], 'client_c5_live_post_command_invalid');
  assertCommand(commands.build, ['node', BUILD_PATH], 'client_c5_live_build_command_invalid');
  if (commands.shell !== false || commands.network_required !== false) throw new Error('client_c5_live_command_authority_invalid');

  const fixture = object(row.fixture);
  if (
    !fixture
    || !digest(fixture.answer_before_sha256)
    || !digest(fixture.answer_after_sha256)
    || fixture.answer_before_sha256 === fixture.answer_after_sha256
    || !digest(fixture.test_sha256)
    || !digest(fixture.build_sha256)
    || fixture.pre_repair_exit_code <= 0
    || fixture.post_repair_exit_code !== 0
    || fixture.build_exit_code !== 0
  ) throw new Error('client_c5_live_fixture_invalid');

  const artifact = object(row.expected_artifact);
  if (
    !artifact
    || artifact.path !== ARTIFACT_PATH
    || artifact.schema !== 'metaengine.client-v1.c5-live-artifact.v1'
    || artifact.sha256 !== row.expected_artifact_sha256
    || artifact.bytes !== row.expected_artifact_bytes
    || artifact.answer !== 42
    || artifact.verified_behavior !== 'answer-is-42'
  ) throw new Error('client_c5_live_artifact_contract_invalid');

  const readback = object(row.live_readback_contract);
  if (
    !readback
    || readback.evidence_class !== 'LIVE'
    || readback.evidence_origin !== 'SIGNED_SUPERVISOR_READBACK'
    || readback.baseline_sha !== row.source_head
    || readback.repository_identity_sha256 !== row.repository_identity_sha256
    || readback.command_contract_sha256 !== row.command_contract_sha256
    || readback.changed_file_manifest_sha256 !== row.changed_file_manifest_sha256
    || readback.patch_sha256 !== row.canonical_patch_sha256
    || readback.artifact_sha256 !== row.expected_artifact_sha256
    || readback.artifact_bytes !== row.expected_artifact_bytes
    || readback.independent_verifier_required !== true
    || readback.user_goal_to_agent_readback_required !== true
    || readback.user_goal_to_result_readback_required !== true
  ) throw new Error('client_c5_live_readback_contract_invalid');

  const gate = object(row.dispatch_gate);
  if (
    !gate
    || gate.required_environment !== REQUIRED_ENVIRONMENT
    || gate.environment_protection_verified !== false
    || gate.human_approval_required !== true
    || gate.prevent_self_review_required !== true
    || gate.explicit_live_effect_authorization_required !== true
    || gate.single_flight_required !== true
    || gate.live_effect_authorized !== false
    || gate.provider_contacted !== false
    || gate.goal_submitted !== false
    || gate.execution_ready !== false
    || gate.automatic_retry_allowed !== false
    || gate.scheduler_authority !== false
    || gate.browser_authority !== false
    || gate.release_authority !== false
    || gate.authority_effect !== false
  ) throw new Error('client_c5_live_dispatch_gate_invalid');

  if (
    row.automatic_retry_allowed !== false
    || row.scheduler_authority !== false
    || row.browser_authority !== false
    || row.release_authority !== false
    || row.authority_effect !== false
  ) throw new Error('client_c5_live_authority_invalid');

  if (clientC5LiveCapsuleDigest(row) !== row.capsule_sha256) {
    throw new Error('client_c5_live_capsule_digest_mismatch');
  }

  return Object.freeze(structuredClone(row));
}

export function clientC5LiveReadinessMatchesSubmission(capsuleValue, submissionReceipt) {
  try {
    const capsule = normalizeClientC5LiveReadinessCapsule(capsuleValue);
    const receipt = object(submissionReceipt);
    return Boolean(
      receipt
      && receipt.schema === 'metaengine.client.goal-submission.v1'
      && receipt.goal === capsule.objective
      && receipt.roadmap_id === 'metaengine-client-v1'
      && receipt.baseline_sha === capsule.source_head
      && receipt.atomic_plan_and_admission === true
      && receipt.exact_activation_readback === true
      && receipt.operator_initiated === true
      && receipt.automatic_retry_allowed === false
      && receipt.scheduler_authority === false
      && receipt.browser_actuation_authority === false
      && receipt.release_authority === false
      && receipt.authority_effect === false
    );
  } catch {
    return false;
  }
}

export function clientC5LiveReadinessMatchesUsefulWork(capsuleValue, proofValue, executionProof) {
  try {
    const capsule = normalizeClientC5LiveReadinessCapsule(capsuleValue);
    const proof = normalizeClientUsefulWorkProof(proofValue, executionProof);
    return proof.client_c5_useful_work_verified === true
      && proof.evidence_class === 'LIVE'
      && proof.evidence_origin === 'SIGNED_SUPERVISOR_READBACK'
      && proof.baseline_sha === capsule.source_head
      && proof.repository.repository_identity_sha256 === capsule.repository_identity_sha256
      && proof.repository.checkout_sha === capsule.source_head
      && proof.edit.changed_file_manifest_sha256 === capsule.changed_file_manifest_sha256
      && proof.edit.patch_sha256 === capsule.canonical_patch_sha256
      && proof.verification.command_contract_sha256 === capsule.command_contract_sha256
      && proof.artifact.artifact_sha256 === capsule.expected_artifact_sha256
      && proof.artifact.artifact_subject_sha256 === capsule.expected_artifact_sha256
      && proof.artifact.artifact_bytes === capsule.expected_artifact_bytes
      && proof.review.independent_verifier === true
      && proof.review.accepted === true
      && proof.review.accepted_artifact_sha256 === capsule.expected_artifact_sha256
      && proof.canonical_c2_promotion_authorized === false
      && proof.automatic_retry_allowed === false
      && proof.authority_effect === false;
  } catch {
    return false;
  }
}

export function normalizeClientC5LiveDispatchAuthorization(value, capsuleValue) {
  const row = object(value);
  const capsule = normalizeClientC5LiveReadinessCapsule(capsuleValue);
  if (
    !row
    || row.schema !== CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA
    || row.capsule_sha256 !== capsule.capsule_sha256
    || row.source_head !== capsule.source_head
    || row.environment !== REQUIRED_ENVIRONMENT
    || row.environment_protection_verified !== true
    || row.required_reviewer_approved !== true
    || row.self_review_used !== false
    || row.explicit_live_effect_authorized !== true
    || row.single_flight !== true
    || row.automatic_retry_allowed !== false
    || row.scheduler_authority !== false
    || row.release_authority !== false
    || row.authority_effect !== false
  ) throw new Error('client_c5_live_dispatch_authorization_invalid');

  return Object.freeze(structuredClone(row));
}
