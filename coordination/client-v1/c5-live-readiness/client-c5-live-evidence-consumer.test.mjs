import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  CLIENT_C5_LIVE_OBJECTIVE,
  CLIENT_C5_LIVE_READINESS_SCHEMA,
  clientC5LiveCapsuleDigest,
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';
import {
  clientC5LiveEvidenceConsumerContract,
  clientC5LiveSupervisorSigningBytes,
  verifyClientC5LiveDevelopmentEvidence,
  verifyClientC5LiveEvidence,
} from './client-c5-live-evidence-consumer.mjs';
import {
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
  clientC5SupervisorTrustRootDigest,
  clientC5SupervisorTrustRootSigningBytes,
} from './client-c5-supervisor-trust-root.mjs';
import {
  buildClientC5ControlledEvidenceVector,
} from './client-c5-live-evidence-test-vector.mjs';

const H64 = (ch) => ch.repeat(64);
const head = 'a'.repeat(40);
const artifactBytes = Buffer.from(JSON.stringify({
  answer: 42,
  schema: 'metaengine.client-v1.c5-live-artifact.v1',
  verified_behavior: 'answer-is-42',
}) + '\n', 'utf8');

function capsule() {
  const material = {
    schema: CLIENT_C5_LIVE_READINESS_SCHEMA,
    source_head: head,
    repository_identity_sha256: H64('1'),
    roadmap_id: 'metaengine-client-v1',
    canonical_owner: 'C2_FIRST_SERIAL_CODING_LOOP',
    client_gate: 'C5_USEFUL_WORK',
    objective: CLIENT_C5_LIVE_OBJECTIVE,
    objective_sha256: sha256ClientC5(CLIENT_C5_LIVE_OBJECTIVE),
    fixture_snapshot_sha256: H64('2'),
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
    command_contract_sha256: H64('3'),
    fixture: {
      answer_before_sha256: H64('4'),
      answer_after_sha256: H64('5'),
      test_sha256: H64('6'),
      build_sha256: H64('7'),
      pre_repair_exit_code: 1,
      post_repair_exit_code: 0,
      build_exit_code: 0,
    },
    changed_file_manifest_sha256: H64('8'),
    canonical_patch_sha256: H64('9'),
    expected_artifact_sha256: sha256ClientC5(artifactBytes),
    expected_artifact_bytes: artifactBytes.length,
    expected_artifact: {
      path: 'coordination/client-v1/c5-live-readiness/fixture/dist/live-artifact.json',
      schema: 'metaengine.client-v1.c5-live-artifact.v1',
      sha256: sha256ClientC5(artifactBytes),
      bytes: artifactBytes.length,
      answer: 42,
      verified_behavior: 'answer-is-42',
    },
    live_readback_contract: {
      evidence_class: 'LIVE',
      evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
      baseline_sha: head,
      repository_identity_sha256: H64('1'),
      command_contract_sha256: H64('3'),
      changed_file_manifest_sha256: H64('8'),
      patch_sha256: H64('9'),
      artifact_sha256: sha256ClientC5(artifactBytes),
      artifact_bytes: artifactBytes.length,
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
  return { ...material, capsule_sha256: clientC5LiveCapsuleDigest(material) };
}

function vector() {
  return buildClientC5ControlledEvidenceVector({
    capsule: capsule(),
    artifact_bytes: artifactBytes,
  });
}

function evidenceArgs(v) {
  return {
    capsule: v.capsule,
    dispatch_authorization: v.dispatch_authorization,
    submission_receipt: v.submission_receipt,
    execution_proof: v.execution_proof,
    useful_work_proof: v.useful_work_proof,
    artifact_bytes: v.artifact_bytes,
    provenance: v.provenance,
    artifact_verification_receipt: v.artifact_verification_receipt,
    review_receipt: v.review_receipt,
    supervisor_envelope: v.supervisor_envelope,
  };
}

function verify(v, overrides = {}) {
  return verifyClientC5LiveEvidence({
    ...evidenceArgs(v),
    trusted_supervisor_public_keys: { [v.key_id]: v.public_key },
    ...overrides,
  });
}

function trustKeyEntry(key, { key_id, role, state = 'ACTIVE', invalid_since = null, revoked_at = null } = {}) {
  const publicKey = key.type === 'public' ? key : key.publicKey;
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    key_id,
    role,
    alg: 'EdDSA',
    public_key_spki_base64: der.toString('base64'),
    public_key_spki_sha256: sha256ClientC5(der),
    state,
    valid_from: '2026-10-01T00:00:00Z',
    valid_until: '2027-10-01T00:00:00Z',
    retired_at: null,
    revoked_at,
    invalid_since,
  };
}

function rootManifest({ generation, previous = null, issued_at, keys }) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
    version: '2.0.0',
    generation,
    issued_at,
    expires_at: '2027-01-01T00:00:00Z',
    previous_manifest_sha256: previous,
    root_signature_threshold: 1,
    usage: 'CLIENT_C5_SUPERVISOR_READBACK',
    keys: [...keys].sort((a, b) => a.key_id.localeCompare(b.key_id)),
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function rootSignatureEnvelope(target, signers) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
    manifest_sha256: clientC5SupervisorTrustRootDigest(target),
    signatures: signers.map(({ key_id, privateKey }) => ({
      key_id,
      alg: 'EdDSA',
      signature: crypto.sign(
        null,
        clientC5SupervisorTrustRootSigningBytes(target),
        privateKey,
      ).toString('base64url'),
    })).sort((a, b) => a.key_id.localeCompare(b.key_id)),
  };
}

function liveDevelopmentTrust(v, { supervisorEntry = null } = {}) {
  const rootA = crypto.generateKeyPairSync('ed25519');
  const rootB = crypto.generateKeyPairSync('ed25519');
  const fallbackSupervisor = crypto.generateKeyPairSync('ed25519');
  const supervisor = supervisorEntry || trustKeyEntry(v.public_key, {
    key_id: v.key_id,
    role: 'SUPERVISOR_READBACK',
  });

  const v1 = rootManifest({
    generation: 1,
    issued_at: '2026-10-05T00:00:00Z',
    keys: [
      trustKeyEntry(rootA, { key_id: 'root:a', role: 'ROOT' }),
      trustKeyEntry(fallbackSupervisor, { key_id: 'supervisor:bootstrap', role: 'SUPERVISOR_READBACK' }),
    ],
  });
  const v2 = rootManifest({
    generation: 2,
    previous: clientC5SupervisorTrustRootDigest(v1),
    issued_at: '2026-10-05T12:00:00Z',
    keys: [
      trustKeyEntry(rootB, { key_id: 'root:b', role: 'ROOT' }),
      supervisor,
      trustKeyEntry(fallbackSupervisor, { key_id: 'supervisor:fallback', role: 'SUPERVISOR_READBACK' }),
    ],
  });

  return {
    trust_root_bootstrap_manifest: v1,
    trust_root_bootstrap_signature_envelope: rootSignatureEnvelope(v1, [
      { key_id: 'root:a', privateKey: rootA.privateKey },
    ]),
    trust_root_candidate_manifest: v2,
    trust_root_candidate_signature_envelope: rootSignatureEnvelope(v2, [
      { key_id: 'root:a', privateKey: rootA.privateKey },
      { key_id: 'root:b', privateKey: rootB.privateKey },
    ]),
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    expected_pinned_root_spki_sha256: {
      'root:a': sha256ClientC5(rootA.publicKey.export({ type: 'spki', format: 'der' })),
    },
    now: new Date('2026-10-06T00:00:00Z'),
  };
}

function resign(v, claims) {
  const pair = crypto.generateKeyPairSync('ed25519');
  return {
    ...v,
    public_key: pair.publicKey,
    supervisor_envelope: {
      ...v.supervisor_envelope,
      claims,
      signature: crypto.sign(
        null,
        clientC5LiveSupervisorSigningBytes(claims),
        pair.privateKey,
      ).toString('base64url'),
    },
  };
}

test('controlled cryptographic vector verifies structure but cannot claim LIVE', () => {
  const v = vector();
  const receipt = verify(v);
  assert.equal(receipt.verification_state, 'CONTROLLED_TEST_VECTOR_VERIFIED');
  assert.equal(receipt.signed_supervisor_readback_verified, true);
  assert.equal(receipt.trusted_supervisor_key_verified, false);
  assert.equal(receipt.client_c5_live_useful_work_verified, false);
  assert.equal(receipt.production_trust_root_verified, false);
  assert.equal(receipt.canonical_c2_promotion_authorized, false);
  assert.equal(receipt.authority_effect, false);
});

test('raw key map and legacy trust-root label cannot escalate controlled verifier to LIVE', () => {
  const v = vector();
  const receipt = verify(v, {
    trust_root_kind: 'PINNED_SUPERVISOR',
    verification_context: 'LIVE_DEVELOPMENT_TRUST',
    trust_metadata: {
      live_development_pin_verified: true,
      bootstrap_material_verified: true,
      production_bootstrap_proven: false,
      supervisor_key_id: v.key_id,
      evidence_issued_at: v.supervisor_envelope.claims.issued_at,
    },
  });
  assert.equal(receipt.verification_state, 'CONTROLLED_TEST_VECTOR_VERIFIED');
  assert.equal(receipt.client_c5_live_useful_work_verified, false);
  assert.equal(receipt.trusted_supervisor_key_verified, false);
});

test('integrated trust-root re-verification accepts exact LIVE-development evidence only', () => {
  const v = vector();
  const trust = liveDevelopmentTrust(v);
  const receipt = verifyClientC5LiveDevelopmentEvidence({
    ...evidenceArgs(v),
    ...trust,
  });
  assert.equal(receipt.verification_state, 'LIVE_DEVELOPMENT_EVIDENCE_VERIFIED');
  assert.equal(receipt.reason, 'EXACT_SIGNED_LIVE_DEVELOPMENT_EVIDENCE');
  assert.equal(receipt.trusted_supervisor_key_verified, true);
  assert.equal(receipt.live_development_trust_verified, true);
  assert.equal(receipt.production_trust_root_verified, false);
  assert.equal(receipt.client_c5_live_useful_work_verified, true);
  assert.equal(receipt.canonical_c2_promotion_authorized, false);
  assert.equal(receipt.authority_effect, false);
});

test('wrong live-development root pin fails before evidence signature trust', () => {
  const v = vector();
  const trust = liveDevelopmentTrust(v);
  trust.expected_pinned_root_spki_sha256 = { 'root:a': '0'.repeat(64) };
  const receipt = verifyClientC5LiveDevelopmentEvidence({
    ...evidenceArgs(v),
    ...trust,
  });
  assert.equal(receipt.verification_state, 'REJECTED');
  assert.equal(receipt.reason, 'LIVE_DEVELOPMENT_TRUST_BOOTSTRAP_INVALID');
  assert.equal(receipt.client_c5_live_useful_work_verified, false);
});

test('Supervisor key must be ACTIVE in the verified candidate root', () => {
  const v = vector();
  const revoked = trustKeyEntry(v.public_key, {
    key_id: v.key_id,
    role: 'SUPERVISOR_READBACK',
    state: 'REVOKED',
    invalid_since: '2026-10-05T20:00:00Z',
    revoked_at: '2026-10-05T21:00:00Z',
  });
  const trust = liveDevelopmentTrust(v, { supervisorEntry: revoked });
  const receipt = verifyClientC5LiveDevelopmentEvidence({
    ...evidenceArgs(v),
    ...trust,
  });
  assert.equal(receipt.verification_state, 'REJECTED');
  assert.equal(receipt.reason, 'LIVE_DEVELOPMENT_SUPERVISOR_KEY_INVALID');
});

test('untrusted key and modified signature fail closed', () => {
  const v = vector();
  const wrong = crypto.generateKeyPairSync('ed25519');
  const untrusted = verify(v, {
    trusted_supervisor_public_keys: { [v.key_id]: wrong.publicKey },
  });
  assert.equal(untrusted.verification_state, 'REJECTED');
  assert.equal(untrusted.reason, 'client_c5_live_supervisor_signature_invalid');

  const signature = Buffer.from(v.supervisor_envelope.signature, 'base64url');
  signature[0] ^= 1;
  const modified = verify({
    ...v,
    supervisor_envelope: {
      ...v.supervisor_envelope,
      signature: signature.toString('base64url'),
    },
  });
  assert.equal(modified.verification_state, 'REJECTED');
  assert.equal(modified.reason, 'client_c5_live_supervisor_signature_invalid');
});

test('capsule and dispatch authorization drift fail before signature trust', () => {
  const v = vector();
  const badCapsule = structuredClone(v.capsule);
  badCapsule.source_head = 'b'.repeat(40);
  const capsuleReceipt = verify({ ...v, capsule: badCapsule });
  assert.equal(capsuleReceipt.reason, 'CAPSULE_INVALID');

  const dispatchReceipt = verify({
    ...v,
    dispatch_authorization: { ...v.dispatch_authorization, single_flight: false },
  });
  assert.equal(dispatchReceipt.reason, 'DISPATCH_AUTHORIZATION_INVALID');
});

test('submission objective or baseline drift is rejected', () => {
  const v = vector();
  assert.equal(
    verify({
      ...v,
      submission_receipt: { ...v.submission_receipt, goal: v.submission_receipt.goal + ' drift' },
    }).reason,
    'SUBMISSION_BINDING_INVALID',
  );
  assert.equal(
    verify({
      ...v,
      submission_receipt: { ...v.submission_receipt, baseline_sha: 'b'.repeat(40) },
    }).reason,
    'SUBMISSION_BINDING_INVALID',
  );
});

test('artifact bytes are independently rehashed', () => {
  const v = vector();
  const receipt = verify({
    ...v,
    artifact_bytes: Buffer.from(v.artifact_bytes.toString('utf8').replace('42', '43')),
  });
  assert.equal(receipt.reason, 'ARTIFACT_SUBJECT_INVALID');
  assert.equal(receipt.artifact_subject_verified, false);
});

test('provenance, artifact-verification and review receipt drift are independently rejected', () => {
  const v = vector();
  assert.equal(
    verify({ ...v, provenance: { ...v.provenance, network_used: true } }).reason,
    'PROVENANCE_INVALID',
  );
  assert.equal(
    verify({
      ...v,
      artifact_verification_receipt: {
        ...v.artifact_verification_receipt,
        test_and_build_receipts_verified: false,
      },
    }).reason,
    'ARTIFACT_VERIFICATION_RECEIPT_INVALID',
  );
  assert.equal(
    verify({ ...v, review_receipt: { ...v.review_receipt, accepted: false } }).reason,
    'REVIEW_RECEIPT_INVALID',
  );
});

test('useful-work proof digest or exact command binding cannot drift', () => {
  const v = vector();
  const useful = structuredClone(v.useful_work_proof);
  useful.verification.command_contract_sha256 = H64('a');
  assert.equal(verify({ ...v, useful_work_proof: useful }).reason, 'USEFUL_WORK_BINDING_INVALID');
});

test('Supervisor claims cannot be rebound by re-signing different digests', () => {
  const v = vector();
  const claims = { ...v.supervisor_envelope.claims, artifact_sha256: H64('a') };
  const rebound = resign(v, claims);
  const receipt = verify(rebound, {
    trusted_supervisor_public_keys: { [rebound.key_id]: rebound.public_key },
  });
  assert.equal(receipt.reason, 'SUPERVISOR_CLAIMS_INVALID');
});

test('consumer contract requires integrated trust re-verification and no production claim', () => {
  const contract = clientC5LiveEvidenceConsumerContract();
  assert.equal(contract.detached_ed25519_supervisor_signature_required, true);
  assert.equal(contract.live_development_trust_root_reverified_in_consumer, true);
  assert.equal(contract.raw_key_map_cannot_claim_live, true);
  assert.equal(contract.production_trust_root_claim_supported, false);
  assert.equal(contract.controlled_test_vector_cannot_claim_live, true);
  assert.equal(contract.network_required, false);
  assert.equal(contract.provider_credentials_required, false);
  assert.equal(contract.canonical_c2_promotion_authorized, false);
  assert.equal(contract.authority_effect, false);
});

test('stable canonical evidence hashes do not depend on object key order', () => {
  assert.equal(
    sha256ClientC5(stableClientC5Json({ b: 2, a: 1 })),
    sha256ClientC5(stableClientC5Json({ a: 1, b: 2 })),
  );
});
