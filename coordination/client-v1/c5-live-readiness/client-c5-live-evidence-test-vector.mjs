import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_C5_LIVE_ARTIFACT_VERIFICATION_SCHEMA,
  CLIENT_C5_LIVE_PROVENANCE_SCHEMA,
  CLIENT_C5_LIVE_REVIEW_SCHEMA,
  CLIENT_C5_LIVE_SUPERVISOR_ENVELOPE_SCHEMA,
  CLIENT_C5_LIVE_SUPERVISOR_READBACK_SCHEMA,
  clientC5LiveSupervisorSigningBytes,
} from './client-c5-live-evidence-consumer.mjs';
import {
  CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA,
  normalizeClientC5LiveReadinessCapsule,
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const TASK_ID = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const POINT_ID = 'obj.client-c5-live-useful-work.v1';
const PLAN_SHA256 = 'b'.repeat(64);
const TASK_SPEC_SHA256 = 'c'.repeat(64);
const CONVERSATION_SHA256 = 'd'.repeat(64);
const RESULT_SHA256 = 'e'.repeat(64);
const CLAIM_SHA256 = 'f'.repeat(64);
const SOURCE_SNAPSHOT_SHA256 = '3'.repeat(64);
const PRE_RECEIPT_SHA256 = '4'.repeat(64);
const POST_RECEIPT_SHA256 = '5'.repeat(64);
const ISSUED_AT = '2026-10-06T02:30:00Z';
const KEY_ID = 'test-vector:c5-supervisor-01';

const canonicalDigest = (value) => sha256ClientC5(stableClientC5Json(value));

export function buildClientC5ControlledEvidenceVector({
  capsule: capsuleValue,
  artifact_bytes: artifactBytesValue,
  key_pair = crypto.generateKeyPairSync('ed25519'),
} = {}) {
  const capsule = normalizeClientC5LiveReadinessCapsule(capsuleValue);
  const artifactBytes = Buffer.isBuffer(artifactBytesValue)
    ? artifactBytesValue
    : Buffer.from(artifactBytesValue ?? '');

  const artifactSha256 = sha256ClientC5(artifactBytes);
  if (
    artifactSha256 !== capsule.expected_artifact_sha256
    || artifactBytes.length !== capsule.expected_artifact_bytes
  ) throw new Error('client_c5_test_vector_artifact_mismatch');

  const dispatchAuthorization = {
    schema: CLIENT_C5_LIVE_DISPATCH_AUTH_SCHEMA,
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
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

  const submissionReceipt = {
    schema: 'metaengine.client.goal-submission.v1',
    goal: capsule.objective,
    request_id: REQUEST_ID,
    request_replayed: false,
    exact_request_correlation: true,
    objective_id: 'metaengine-client-v1:g1',
    roadmap_id: 'metaengine-client-v1',
    workspace_id: WORKSPACE_ID,
    alignment_epoch: 1,
    baseline_sha: capsule.source_head,
    plan_sha256: PLAN_SHA256,
    task_spec_sha256: TASK_SPEC_SHA256,
    plan_generation: 1,
    point_ids: [POINT_ID],
    node_count: 1,
    task_id: TASK_ID,
    task_ids: [TASK_ID],
    task_admission_state: 'ADMITTED',
    atomic_plan_and_admission: true,
    exact_activation_readback: true,
    operator_initiated: true,
    reconciliation_required: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    authority_effect: false,
  };

  const executionProof = {
    schema: 'metaengine.client.goal-execution-proof.v1',
    request_id: REQUEST_ID,
    found: true,
    workspace_id: WORKSPACE_ID,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 1,
    alignment_epoch: 1,
    baseline_sha: capsule.source_head,
    plan_sha256: PLAN_SHA256,
    point_id: POINT_ID,
    task_id: TASK_ID,
    task_spec_sha256: TASK_SPEC_SHA256,
    task_state: 'COMPLETED',
    terminal: true,
    lease_generation: 1,
    survives_plan_retirement: true,
    agent_origin_proof: {
      proven: true,
      contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
      conversation_url_sha256: CONVERSATION_SHA256,
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
      result_summary_sha256: RESULT_SHA256,
      result_sha256: RESULT_SHA256,
      claim_valid: true,
      claim_schema: 'metaengine.agent-result-claim.v1',
      claim_sha256: CLAIM_SHA256,
      claim_disposition: 'ACCEPT',
      conversation_url_sha256: CONVERSATION_SHA256,
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
  };

  const provenance = {
    schema: CLIENT_C5_LIVE_PROVENANCE_SCHEMA,
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
    repository_identity_sha256: capsule.repository_identity_sha256,
    checkout_sha: capsule.source_head,
    patch_sha256: capsule.canonical_patch_sha256,
    changed_file_manifest_sha256: capsule.changed_file_manifest_sha256,
    command_contract_sha256: capsule.command_contract_sha256,
    artifact_sha256: artifactSha256,
    artifact_bytes: artifactBytes.length,
    isolated_workspace: true,
    host_repository_mounted: false,
    host_git_directory_mounted: false,
    linked_git_worktree_exposed: false,
    network_used: false,
    authority_effect: false,
  };
  const provenanceSha256 = canonicalDigest(provenance);

  const artifactVerificationReceipt = {
    schema: CLIENT_C5_LIVE_ARTIFACT_VERIFICATION_SCHEMA,
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
    artifact_sha256: artifactSha256,
    artifact_bytes: artifactBytes.length,
    provenance_sha256: provenanceSha256,
    subject_digest_verified: true,
    provenance_verified: true,
    test_and_build_receipts_verified: true,
    independent_verifier: true,
    authority_effect: false,
  };
  const artifactVerificationSha256 = canonicalDigest(artifactVerificationReceipt);

  const reviewReceipt = {
    schema: CLIENT_C5_LIVE_REVIEW_SCHEMA,
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
    artifact_sha256: artifactSha256,
    artifact_verification_receipt_sha256: artifactVerificationSha256,
    independent_reviewer: true,
    accepted: true,
    canonical_c2_promotion_authorized: false,
    authority_effect: false,
  };
  const reviewSha256 = canonicalDigest(reviewReceipt);

  const usefulWorkProof = {
    schema: 'metaengine.client-v1.useful-work-proof.v1',
    found: true,
    request_id: REQUEST_ID,
    workspace_id: WORKSPACE_ID,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 1,
    alignment_epoch: 1,
    baseline_sha: capsule.source_head,
    plan_sha256: PLAN_SHA256,
    point_id: POINT_ID,
    task_id: TASK_ID,
    task_spec_sha256: TASK_SPEC_SHA256,
    lease_generation: 1,
    result_sha256: RESULT_SHA256,
    claim_sha256: CLAIM_SHA256,
    conversation_url_sha256: CONVERSATION_SHA256,
    evidence_class: 'LIVE',
    evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
    repository: {
      repository_identity_sha256: capsule.repository_identity_sha256,
      checkout_sha: capsule.source_head,
      source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: capsule.canonical_patch_sha256,
      changed_file_manifest_sha256: capsule.changed_file_manifest_sha256,
      changed_file_count: 1,
      materialized_edit_operations: 1,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: capsule.command_contract_sha256,
      pre_repair_receipt_sha256: PRE_RECEIPT_SHA256,
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: POST_RECEIPT_SHA256,
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactSha256,
      artifact_bytes: artifactBytes.length,
      artifact_subject_sha256: artifactSha256,
      provenance_sha256: provenanceSha256,
      verification_receipt_sha256: artifactVerificationSha256,
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: reviewSha256,
      independent_verifier: true,
      accepted: true,
      accepted_artifact_sha256: artifactSha256,
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
  };

  const claims = {
    schema: CLIENT_C5_LIVE_SUPERVISOR_READBACK_SCHEMA,
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
    dispatch_authorization_sha256: canonicalDigest(dispatchAuthorization),
    submission_receipt_sha256: canonicalDigest(submissionReceipt),
    execution_proof_sha256: canonicalDigest(executionProof),
    useful_work_proof_sha256: canonicalDigest(usefulWorkProof),
    provenance_sha256: provenanceSha256,
    artifact_verification_receipt_sha256: artifactVerificationSha256,
    review_receipt_sha256: reviewSha256,
    artifact_sha256: artifactSha256,
    artifact_bytes: artifactBytes.length,
    request_id: REQUEST_ID,
    workspace_id: WORKSPACE_ID,
    task_id: TASK_ID,
    result_sha256: RESULT_SHA256,
    claim_sha256: CLAIM_SHA256,
    conversation_url_sha256: CONVERSATION_SHA256,
    issued_at: ISSUED_AT,
  };

  const supervisorEnvelope = {
    schema: CLIENT_C5_LIVE_SUPERVISOR_ENVELOPE_SCHEMA,
    alg: 'EdDSA',
    key_id: KEY_ID,
    claims,
    signature: crypto.sign(
      null,
      clientC5LiveSupervisorSigningBytes(claims),
      key_pair.privateKey,
    ).toString('base64url'),
  };

  return Object.freeze({
    capsule,
    dispatch_authorization: dispatchAuthorization,
    submission_receipt: submissionReceipt,
    execution_proof: executionProof,
    useful_work_proof: usefulWorkProof,
    artifact_bytes: Buffer.from(artifactBytes),
    provenance,
    artifact_verification_receipt: artifactVerificationReceipt,
    review_receipt: reviewReceipt,
    supervisor_envelope: supervisorEnvelope,
    public_key: key_pair.publicKey,
    key_id: KEY_ID,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) {
      throw new Error('client_c5_test_vector_args_invalid');
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const capsulePath = path.resolve(args.capsule || '');
  const artifactPath = path.resolve(args.artifact || '');
  const outDir = path.resolve(args.out || '');
  if (!args.capsule || !args.artifact || !args.out) throw new Error('client_c5_test_vector_args_missing');

  const capsule = JSON.parse(await readFile(capsulePath, 'utf8'));
  const artifactBytes = await readFile(artifactPath);
  const vector = buildClientC5ControlledEvidenceVector({ capsule, artifact_bytes: artifactBytes });

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const writes = [
    ['client-c5-live-readiness-capsule.json', stableClientC5Json(vector.capsule)],
    ['dispatch-authorization.json', stableClientC5Json(vector.dispatch_authorization)],
    ['submission-receipt.json', stableClientC5Json(vector.submission_receipt)],
    ['execution-proof.json', stableClientC5Json(vector.execution_proof)],
    ['useful-work-proof.json', stableClientC5Json(vector.useful_work_proof)],
    ['provenance.json', stableClientC5Json(vector.provenance)],
    ['artifact-verification-receipt.json', stableClientC5Json(vector.artifact_verification_receipt)],
    ['review-receipt.json', stableClientC5Json(vector.review_receipt)],
    ['supervisor-envelope.json', stableClientC5Json(vector.supervisor_envelope)],
    ['live-artifact.json', vector.artifact_bytes],
    ['test-vector-supervisor-public-key.pem', vector.public_key.export({ type: 'spki', format: 'pem' })],
  ];
  for (const [name, bytes] of writes) {
    await writeFile(path.join(outDir, name), bytes);
  }

  const manifest = {
    schema: 'metaengine.client-v1.c5-live-evidence-test-vector.v1',
    evidence_context: 'CONTROLLED_TEST_VECTOR',
    capsule_sha256: vector.capsule.capsule_sha256,
    source_head: vector.capsule.source_head,
    supervisor_key_id: vector.key_id,
    artifact_sha256: vector.capsule.expected_artifact_sha256,
    private_key_persisted: false,
    provider_contacted: false,
    goal_submitted: false,
    live_effect_authorized: false,
    client_c5_live_useful_work_verified: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  await writeFile(path.join(outDir, 'test-vector-manifest.json'), stableClientC5Json(manifest));
  process.stdout.write(stableClientC5Json(manifest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
