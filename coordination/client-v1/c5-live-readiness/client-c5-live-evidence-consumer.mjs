import crypto from 'node:crypto';

import { normalizeClientUsefulWorkProof } from '../../../apps/metaengine-browser/src/client-useful-work-proof.mjs';
import {
  clientC5LiveReadinessMatchesSubmission,
  clientC5LiveReadinessMatchesUsefulWork,
  normalizeClientC5LiveDispatchAuthorization,
  normalizeClientC5LiveReadinessCapsule,
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

export const CLIENT_C5_LIVE_SUPERVISOR_READBACK_SCHEMA = 'metaengine.client-v1.c5-live-supervisor-readback.v1';
export const CLIENT_C5_LIVE_SUPERVISOR_ENVELOPE_SCHEMA = 'metaengine.client-v1.c5-live-supervisor-envelope.v1';
export const CLIENT_C5_LIVE_PROVENANCE_SCHEMA = 'metaengine.client-v1.c5-live-artifact-provenance.v1';
export const CLIENT_C5_LIVE_ARTIFACT_VERIFICATION_SCHEMA = 'metaengine.client-v1.c5-live-artifact-verification.v1';
export const CLIENT_C5_LIVE_REVIEW_SCHEMA = 'metaengine.client-v1.c5-live-artifact-review.v1';
export const CLIENT_C5_LIVE_INDEPENDENT_RECEIPT_SCHEMA = 'metaengine.client-v1.c5-live-independent-verification.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ED25519_SIGNATURE_BASE64URL_RE = /^[A-Za-z0-9_-]{86}$/;
const LIVE_TRUST_ROOT_KIND = 'PINNED_SUPERVISOR';
const CONTROLLED_TRUST_ROOT_KIND = 'CONTROLLED_TEST_VECTOR';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const digest = (value) => typeof value === 'string' && SHA256_RE.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function exactKeys(value, keys) {
  const row = object(value);
  if (!row) return false;
  const actual = Object.keys(row);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function canonicalDigest(value) {
  return sha256ClientC5(stableClientC5Json(value));
}

function fail(reason, extra = {}) {
  return Object.freeze({
    schema: CLIENT_C5_LIVE_INDEPENDENT_RECEIPT_SCHEMA,
    verification_state: 'REJECTED',
    reason,
    signed_supervisor_readback_verified: false,
    trusted_supervisor_key_verified: false,
    exact_capsule_binding_verified: false,
    exact_dispatch_authorization_verified: false,
    exact_submission_binding_verified: false,
    exact_execution_binding_verified: false,
    exact_useful_work_binding_verified: false,
    artifact_subject_verified: false,
    provenance_verified: false,
    artifact_verification_receipt_verified: false,
    independent_review_verified: false,
    independent_verifier: true,
    client_c5_live_useful_work_verified: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function normalizeProvenance(value, capsule) {
  const keys = [
    'schema', 'capsule_sha256', 'source_head', 'repository_identity_sha256', 'checkout_sha',
    'patch_sha256', 'changed_file_manifest_sha256', 'command_contract_sha256', 'artifact_sha256',
    'artifact_bytes', 'isolated_workspace', 'host_repository_mounted', 'host_git_directory_mounted',
    'linked_git_worktree_exposed', 'network_used', 'authority_effect',
  ];
  const row = object(value);
  if (
    !exactKeys(row, keys)
    || row.schema !== CLIENT_C5_LIVE_PROVENANCE_SCHEMA
    || row.capsule_sha256 !== capsule.capsule_sha256
    || row.source_head !== capsule.source_head
    || row.repository_identity_sha256 !== capsule.repository_identity_sha256
    || row.checkout_sha !== capsule.source_head
    || row.patch_sha256 !== capsule.canonical_patch_sha256
    || row.changed_file_manifest_sha256 !== capsule.changed_file_manifest_sha256
    || row.command_contract_sha256 !== capsule.command_contract_sha256
    || row.artifact_sha256 !== capsule.expected_artifact_sha256
    || row.artifact_bytes !== capsule.expected_artifact_bytes
    || row.isolated_workspace !== true
    || row.host_repository_mounted !== false
    || row.host_git_directory_mounted !== false
    || row.linked_git_worktree_exposed !== false
    || row.network_used !== false
    || row.authority_effect !== false
  ) throw new Error('client_c5_live_provenance_invalid');
  return Object.freeze(structuredClone(row));
}

function normalizeArtifactVerification(value, capsule, provenanceSha256) {
  const keys = [
    'schema', 'capsule_sha256', 'source_head', 'artifact_sha256', 'artifact_bytes',
    'provenance_sha256', 'subject_digest_verified', 'provenance_verified',
    'test_and_build_receipts_verified', 'independent_verifier', 'authority_effect',
  ];
  const row = object(value);
  if (
    !exactKeys(row, keys)
    || row.schema !== CLIENT_C5_LIVE_ARTIFACT_VERIFICATION_SCHEMA
    || row.capsule_sha256 !== capsule.capsule_sha256
    || row.source_head !== capsule.source_head
    || row.artifact_sha256 !== capsule.expected_artifact_sha256
    || row.artifact_bytes !== capsule.expected_artifact_bytes
    || row.provenance_sha256 !== provenanceSha256
    || row.subject_digest_verified !== true
    || row.provenance_verified !== true
    || row.test_and_build_receipts_verified !== true
    || row.independent_verifier !== true
    || row.authority_effect !== false
  ) throw new Error('client_c5_live_artifact_verification_invalid');
  return Object.freeze(structuredClone(row));
}

function normalizeReview(value, capsule, artifactVerificationSha256) {
  const keys = [
    'schema', 'capsule_sha256', 'source_head', 'artifact_sha256',
    'artifact_verification_receipt_sha256', 'independent_reviewer', 'accepted',
    'canonical_c2_promotion_authorized', 'authority_effect',
  ];
  const row = object(value);
  if (
    !exactKeys(row, keys)
    || row.schema !== CLIENT_C5_LIVE_REVIEW_SCHEMA
    || row.capsule_sha256 !== capsule.capsule_sha256
    || row.source_head !== capsule.source_head
    || row.artifact_sha256 !== capsule.expected_artifact_sha256
    || row.artifact_verification_receipt_sha256 !== artifactVerificationSha256
    || row.independent_reviewer !== true
    || row.accepted !== true
    || row.canonical_c2_promotion_authorized !== false
    || row.authority_effect !== false
  ) throw new Error('client_c5_live_review_invalid');
  return Object.freeze(structuredClone(row));
}

function normalizeSupervisorClaims(value, expected) {
  const keys = [
    'schema', 'capsule_sha256', 'source_head', 'dispatch_authorization_sha256',
    'submission_receipt_sha256', 'execution_proof_sha256', 'useful_work_proof_sha256',
    'provenance_sha256', 'artifact_verification_receipt_sha256', 'review_receipt_sha256',
    'artifact_sha256', 'artifact_bytes', 'request_id', 'workspace_id', 'task_id',
    'result_sha256', 'claim_sha256', 'conversation_url_sha256', 'issued_at',
  ];
  const row = object(value);
  if (
    !exactKeys(row, keys)
    || row.schema !== CLIENT_C5_LIVE_SUPERVISOR_READBACK_SCHEMA
    || row.capsule_sha256 !== expected.capsule_sha256
    || row.source_head !== expected.source_head
    || row.dispatch_authorization_sha256 !== expected.dispatch_authorization_sha256
    || row.submission_receipt_sha256 !== expected.submission_receipt_sha256
    || row.execution_proof_sha256 !== expected.execution_proof_sha256
    || row.useful_work_proof_sha256 !== expected.useful_work_proof_sha256
    || row.provenance_sha256 !== expected.provenance_sha256
    || row.artifact_verification_receipt_sha256 !== expected.artifact_verification_receipt_sha256
    || row.review_receipt_sha256 !== expected.review_receipt_sha256
    || row.artifact_sha256 !== expected.artifact_sha256
    || row.artifact_bytes !== expected.artifact_bytes
    || row.request_id !== expected.request_id
    || row.workspace_id !== expected.workspace_id
    || row.task_id !== expected.task_id
    || row.result_sha256 !== expected.result_sha256
    || row.claim_sha256 !== expected.claim_sha256
    || row.conversation_url_sha256 !== expected.conversation_url_sha256
    || typeof row.issued_at !== 'string'
    || !UTC_RE.test(row.issued_at)
    || !Number.isFinite(Date.parse(row.issued_at))
  ) throw new Error('client_c5_live_supervisor_claims_invalid');
  return Object.freeze(structuredClone(row));
}

function verifySupervisorEnvelope(envelope, claims, trustedPublicKeys) {
  const keys = ['schema', 'alg', 'key_id', 'claims', 'signature'];
  if (
    !exactKeys(envelope, keys)
    || envelope.schema !== CLIENT_C5_LIVE_SUPERVISOR_ENVELOPE_SCHEMA
    || envelope.alg !== 'EdDSA'
    || !SAFE_KEY_ID_RE.test(String(envelope.key_id || ''))
    || envelope.claims !== claims
    || typeof envelope.signature !== 'string'
    || !ED25519_SIGNATURE_BASE64URL_RE.test(envelope.signature)
  ) return { ok: false, reason: 'client_c5_live_supervisor_envelope_invalid' };

  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature) {
    return { ok: false, reason: 'client_c5_live_supervisor_signature_encoding_invalid' };
  }
  const key = trustedPublicKeys
    && Object.hasOwn(trustedPublicKeys, envelope.key_id)
    && trustedPublicKeys[envelope.key_id];
  if (!key) return { ok: false, reason: 'client_c5_live_supervisor_key_untrusted' };

  try {
    const verified = crypto.verify(
      null,
      Buffer.from(stableClientC5Json(claims), 'utf8'),
      key,
      signature,
    );
    return verified
      ? { ok: true, key_id: envelope.key_id }
      : { ok: false, reason: 'client_c5_live_supervisor_signature_invalid' };
  } catch {
    return { ok: false, reason: 'client_c5_live_supervisor_signature_verification_error' };
  }
}

export function clientC5LiveSupervisorSigningBytes(claims) {
  return Buffer.from(stableClientC5Json(claims), 'utf8');
}

export function clientC5LiveSupervisorEnvelopeDigest(envelope) {
  return canonicalDigest({
    schema: envelope?.schema,
    alg: envelope?.alg,
    key_id: envelope?.key_id,
    claims: envelope?.claims,
    signature: envelope?.signature,
  });
}

export function verifyClientC5LiveEvidence({
  capsule: capsuleValue,
  dispatch_authorization: dispatchAuthorizationValue,
  submission_receipt: submissionReceipt,
  execution_proof: executionProof,
  useful_work_proof: usefulWorkProof,
  artifact_bytes: artifactBytesValue,
  provenance: provenanceValue,
  artifact_verification_receipt: artifactVerificationValue,
  review_receipt: reviewValue,
  supervisor_envelope: supervisorEnvelope,
  trusted_supervisor_public_keys = {},
  trust_root_kind = LIVE_TRUST_ROOT_KIND,
} = {}) {
  let capsule;
  let dispatchAuthorization;
  let usefulWork;
  let provenance;
  let artifactVerification;
  let review;

  try {
    capsule = normalizeClientC5LiveReadinessCapsule(capsuleValue);
  } catch {
    return fail('CAPSULE_INVALID');
  }

  try {
    dispatchAuthorization = normalizeClientC5LiveDispatchAuthorization(
      dispatchAuthorizationValue,
      capsule,
    );
  } catch {
    return fail('DISPATCH_AUTHORIZATION_INVALID', {
      exact_capsule_binding_verified: true,
    });
  }

  if (!clientC5LiveReadinessMatchesSubmission(capsule, submissionReceipt)) {
    return fail('SUBMISSION_BINDING_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
    });
  }

  if (!clientC5LiveReadinessMatchesUsefulWork(capsule, usefulWorkProof, executionProof)) {
    return fail('USEFUL_WORK_BINDING_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
    });
  }

  try {
    usefulWork = normalizeClientUsefulWorkProof(usefulWorkProof, executionProof);
  } catch {
    return fail('USEFUL_WORK_PROOF_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
    });
  }

  const artifactBytes = Buffer.isBuffer(artifactBytesValue)
    ? artifactBytesValue
    : Buffer.from(artifactBytesValue ?? '');
  const artifactSha256 = sha256ClientC5(artifactBytes);
  if (
    artifactBytes.length !== capsule.expected_artifact_bytes
    || artifactSha256 !== capsule.expected_artifact_sha256
    || artifactSha256 !== usefulWork.artifact.artifact_sha256
    || artifactSha256 !== usefulWork.artifact.artifact_subject_sha256
  ) {
    return fail('ARTIFACT_SUBJECT_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
    });
  }

  try {
    provenance = normalizeProvenance(provenanceValue, capsule);
  } catch {
    return fail('PROVENANCE_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
    });
  }

  const provenanceSha256 = canonicalDigest(provenance);
  if (provenanceSha256 !== usefulWork.artifact.provenance_sha256) {
    return fail('PROVENANCE_DIGEST_MISMATCH', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
    });
  }

  try {
    artifactVerification = normalizeArtifactVerification(
      artifactVerificationValue,
      capsule,
      provenanceSha256,
    );
  } catch {
    return fail('ARTIFACT_VERIFICATION_RECEIPT_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
    });
  }

  const artifactVerificationSha256 = canonicalDigest(artifactVerification);
  if (artifactVerificationSha256 !== usefulWork.artifact.verification_receipt_sha256) {
    return fail('ARTIFACT_VERIFICATION_RECEIPT_DIGEST_MISMATCH', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
    });
  }

  try {
    review = normalizeReview(reviewValue, capsule, artifactVerificationSha256);
  } catch {
    return fail('REVIEW_RECEIPT_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
    });
  }

  const reviewSha256 = canonicalDigest(review);
  if (
    reviewSha256 !== usefulWork.review.review_receipt_sha256
    || review.artifact_sha256 !== usefulWork.review.accepted_artifact_sha256
  ) {
    return fail('REVIEW_RECEIPT_DIGEST_MISMATCH', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
    });
  }

  const execution = object(executionProof);
  const expectedClaims = {
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
    request_id: usefulWork.request_id,
    workspace_id: usefulWork.workspace_id,
    task_id: usefulWork.task_id,
    result_sha256: usefulWork.result_sha256,
    claim_sha256: usefulWork.claim_sha256,
    conversation_url_sha256: usefulWork.conversation_url_sha256,
  };

  if (
    !execution
    || execution.request_id !== expectedClaims.request_id
    || execution.workspace_id !== expectedClaims.workspace_id
    || execution.task_id !== expectedClaims.task_id
  ) {
    return fail('EXECUTION_IDENTITY_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
      independent_review_verified: true,
    });
  }

  let claims;
  try {
    claims = normalizeSupervisorClaims(supervisorEnvelope?.claims, expectedClaims);
  } catch {
    return fail('SUPERVISOR_CLAIMS_INVALID', {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
      independent_review_verified: true,
    });
  }

  const signature = verifySupervisorEnvelope(
    supervisorEnvelope,
    supervisorEnvelope?.claims,
    trusted_supervisor_public_keys,
  );
  if (!signature.ok) {
    return fail(signature.reason, {
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
      independent_review_verified: true,
    });
  }

  const trustRootKind = String(trust_root_kind || '');
  if (![LIVE_TRUST_ROOT_KIND, CONTROLLED_TRUST_ROOT_KIND].includes(trustRootKind)) {
    return fail('TRUST_ROOT_KIND_INVALID', {
      signed_supervisor_readback_verified: true,
      exact_capsule_binding_verified: true,
      exact_dispatch_authorization_verified: true,
      exact_submission_binding_verified: true,
      exact_execution_binding_verified: true,
      exact_useful_work_binding_verified: true,
      artifact_subject_verified: true,
      provenance_verified: true,
      artifact_verification_receipt_verified: true,
      independent_review_verified: true,
    });
  }

  const liveAccepted = trustRootKind === LIVE_TRUST_ROOT_KIND;
  return Object.freeze({
    schema: CLIENT_C5_LIVE_INDEPENDENT_RECEIPT_SCHEMA,
    verification_state: liveAccepted ? 'LIVE_EVIDENCE_VERIFIED' : 'CONTROLLED_TEST_VECTOR_VERIFIED',
    reason: liveAccepted ? 'EXACT_SIGNED_LIVE_EVIDENCE' : 'STRUCTURAL_CRYPTOGRAPHIC_TEST_ONLY',
    capsule_sha256: capsule.capsule_sha256,
    source_head: capsule.source_head,
    supervisor_key_id: signature.key_id,
    supervisor_envelope_sha256: clientC5LiveSupervisorEnvelopeDigest(supervisorEnvelope),
    dispatch_authorization_sha256: expectedClaims.dispatch_authorization_sha256,
    submission_receipt_sha256: expectedClaims.submission_receipt_sha256,
    execution_proof_sha256: expectedClaims.execution_proof_sha256,
    useful_work_proof_sha256: expectedClaims.useful_work_proof_sha256,
    provenance_sha256: expectedClaims.provenance_sha256,
    artifact_verification_receipt_sha256: expectedClaims.artifact_verification_receipt_sha256,
    review_receipt_sha256: expectedClaims.review_receipt_sha256,
    artifact_sha256: expectedClaims.artifact_sha256,
    artifact_bytes: expectedClaims.artifact_bytes,
    request_id: expectedClaims.request_id,
    workspace_id: expectedClaims.workspace_id,
    task_id: expectedClaims.task_id,
    result_sha256: expectedClaims.result_sha256,
    claim_sha256: expectedClaims.claim_sha256,
    conversation_url_sha256: expectedClaims.conversation_url_sha256,
    supervisor_issued_at: claims.issued_at,
    signed_supervisor_readback_verified: true,
    trusted_supervisor_key_verified: liveAccepted,
    exact_capsule_binding_verified: true,
    exact_dispatch_authorization_verified: true,
    exact_submission_binding_verified: true,
    exact_execution_binding_verified: true,
    exact_useful_work_binding_verified: true,
    artifact_subject_verified: true,
    provenance_verified: true,
    artifact_verification_receipt_verified: true,
    independent_review_verified: true,
    independent_verifier: true,
    client_c5_live_useful_work_verified: liveAccepted,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

export function clientC5LiveEvidenceConsumerContract() {
  return Object.freeze({
    schema: CLIENT_C5_LIVE_INDEPENDENT_RECEIPT_SCHEMA,
    detached_ed25519_supervisor_signature_required: true,
    trusted_key_id_required: true,
    pinned_supervisor_trust_root_required_for_live_acceptance: true,
    controlled_test_vector_cannot_claim_live: true,
    exact_capsule_binding_required: true,
    exact_dispatch_authorization_required: true,
    exact_submission_binding_required: true,
    exact_execution_binding_required: true,
    exact_useful_work_binding_required: true,
    artifact_bytes_rehashed: true,
    provenance_rehashed: true,
    artifact_verification_receipt_rehashed: true,
    independent_review_receipt_rehashed: true,
    independent_verifier: true,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    network_required: false,
    provider_credentials_required: false,
    authority_effect: false,
  });
}
