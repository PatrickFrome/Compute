import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PACKAGE_SCHEMA = 'metaengine.a2-browser-operator.skill-package-identity.v1';
const RECEIPT_SCHEMA = 'metaengine.a2-browser-operator.skill-provenance-receipt.v1';
const MAX_ATTESTATION_BYTES = 1024 * 1024;
const MAX_IDENTITY = 1024;
const MAX_FAILURE_REASON = 128;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanText(value, max, code) {
  if (typeof value !== 'string') throw new Error(code);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(code);
  return text;
}

function cleanUri(value, code) {
  const text = cleanText(value, MAX_IDENTITY, code);
  try {
    const parsed = new URL(text);
    if (!parsed.protocol) throw new Error(code);
  } catch {
    throw new Error(code);
  }
  return text;
}

function cleanDigest(value, code) {
  const text = cleanText(value, 80, code);
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error(code);
  return text;
}

function assertPackageIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('skill_provenance_package_invalid');
  const schema = value.schema;
  const packageManifestDigest = value.package_manifest_digest;
  const semanticSkillFingerprint = value.semantic_skill_fingerprint;
  const authorityEffect = value.authority_effect;
  const executionEligible = value.execution_eligible;
  const scriptExecutionExposed = value.script_execution_exposed;
  if (schema !== PACKAGE_SCHEMA) throw new Error('skill_provenance_package_invalid');
  const packageDigest = cleanDigest(packageManifestDigest, 'skill_provenance_package_digest_invalid');
  const semanticFingerprint = cleanDigest(semanticSkillFingerprint, 'skill_provenance_semantic_fingerprint_invalid');
  if (authorityEffect !== false || executionEligible !== false || scriptExecutionExposed !== false) {
    throw new Error('skill_provenance_package_authority_invalid');
  }
  return Object.freeze({ packageManifestDigest: packageDigest, semanticFingerprint });
}

function snapshotAttestationBytes(value) {
  if (!(value instanceof Uint8Array)) throw new Error('skill_provenance_attestation_bytes_invalid');
  const bytes = Buffer.from(value);
  if (bytes.length < 1 || bytes.length > MAX_ATTESTATION_BYTES) throw new Error('skill_provenance_attestation_size_invalid');
  return bytes;
}

function snapshotVerifierResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('skill_provenance_verifier_result_invalid');
  const subjectDigest = result.subjectDigest;
  const signerIdentity = result.signerIdentity;
  const signerIssuer = result.signerIssuer;
  const cryptographicSignatureVerified = result.cryptographicSignatureVerified;
  const verifierIdentityVerified = result.verifierIdentityVerified;
  const policyPassed = result.policyPassed;
  const transparencyLogVerified = result.transparencyLogVerified;
  const failureReason = result.failureReason;
  return Object.freeze({
    subjectDigest,
    signerIdentity,
    signerIssuer,
    cryptographicSignatureVerified,
    verifierIdentityVerified,
    policyPassed,
    transparencyLogVerified,
    failureReason
  });
}

function normalizeVerifierResult(result) {
  const snapshot = snapshotVerifierResult(result);
  return Object.freeze({
    subjectDigest: snapshot.subjectDigest == null ? null : cleanDigest(snapshot.subjectDigest, 'skill_provenance_verifier_subject_digest_invalid'),
    signerIdentity: snapshot.signerIdentity == null ? null : cleanText(snapshot.signerIdentity, MAX_IDENTITY, 'skill_provenance_signer_identity_invalid'),
    signerIssuer: snapshot.signerIssuer == null ? null : cleanText(snapshot.signerIssuer, MAX_IDENTITY, 'skill_provenance_signer_issuer_invalid'),
    cryptographicSignatureVerified: snapshot.cryptographicSignatureVerified === true,
    verifierIdentityVerified: snapshot.verifierIdentityVerified === true,
    policyPassed: snapshot.policyPassed === true,
    transparencyLogVerified: snapshot.transparencyLogVerified === true ? true : snapshot.transparencyLogVerified === false ? false : null,
    failureReason: snapshot.failureReason == null ? null : cleanText(snapshot.failureReason, MAX_FAILURE_REASON, 'skill_provenance_failure_reason_invalid')
  });
}

function receiptMaterial(receipt) {
  return JSON.stringify({
    schema: receipt.schema,
    verifier_id: receipt.verifier_id,
    policy_uri: receipt.policy_uri,
    policy_digest: receipt.policy_digest,
    expected_signer_identity: receipt.expected_signer_identity,
    expected_signer_issuer: receipt.expected_signer_issuer,
    package_manifest_digest: receipt.package_manifest_digest,
    semantic_skill_fingerprint: receipt.semantic_skill_fingerprint,
    input_attestation_digest: receipt.input_attestation_digest,
    signer_identity: receipt.signer_identity,
    signer_issuer: receipt.signer_issuer,
    cryptographic_signature_verified: receipt.cryptographic_signature_verified,
    verifier_identity_verified: receipt.verifier_identity_verified,
    transparency_log_verified: receipt.transparency_log_verified,
    verification_result: receipt.verification_result,
    failure_reason: receipt.failure_reason,
    verified_at: receipt.verified_at,
    session_bound: receipt.session_bound,
    durable_verification_receipt: receipt.durable_verification_receipt,
    authority_effect: receipt.authority_effect,
    execution_eligible: receipt.execution_eligible,
    script_execution_exposed: receipt.script_execution_exposed
  });
}

function authTag(key, receipt) {
  return `hmac-sha256:${createHmac('sha256', key).update(receiptMaterial(receipt)).digest('hex')}`;
}

function snapshotReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('skill_provenance_receipt_invalid');
  const fields = [
    'schema', 'verifier_id', 'policy_uri', 'policy_digest', 'expected_signer_identity', 'expected_signer_issuer',
    'package_manifest_digest', 'semantic_skill_fingerprint', 'input_attestation_digest', 'signer_identity', 'signer_issuer',
    'cryptographic_signature_verified', 'verifier_identity_verified', 'transparency_log_verified', 'verification_result',
    'failure_reason', 'verified_at', 'session_bound', 'durable_verification_receipt', 'authority_effect',
    'execution_eligible', 'script_execution_exposed', 'receipt_auth_tag'
  ];
  const out = {};
  for (const field of fields) out[field] = receipt[field];
  return Object.freeze(out);
}

export function createSkillProvenanceVerifier({
  verifierId,
  policyUri,
  policyDigest,
  expectedSignerIdentity,
  expectedSignerIssuer,
  verifyAttestation,
  now = () => new Date()
} = {}) {
  const configuredVerifierId = cleanUri(verifierId, 'skill_provenance_verifier_id_invalid');
  const configuredPolicyUri = cleanUri(policyUri, 'skill_provenance_policy_uri_invalid');
  const configuredPolicyDigest = cleanDigest(policyDigest, 'skill_provenance_policy_digest_invalid');
  const configuredSignerIdentity = cleanText(expectedSignerIdentity, MAX_IDENTITY, 'skill_provenance_expected_signer_identity_invalid');
  const configuredSignerIssuer = cleanText(expectedSignerIssuer, MAX_IDENTITY, 'skill_provenance_expected_signer_issuer_invalid');
  if (typeof verifyAttestation !== 'function') throw new Error('skill_provenance_verifier_adapter_invalid');
  if (typeof now !== 'function') throw new Error('skill_provenance_clock_invalid');
  const sessionKey = randomBytes(32);

  async function verifyPackage(packageIdentity, attestationBytesInput) {
    const pkg = assertPackageIdentity(packageIdentity);
    const attestationBytes = snapshotAttestationBytes(attestationBytesInput);
    const inputAttestationDigest = `sha256:${sha256(attestationBytes)}`;
    const verifierInput = Object.freeze({
      package_manifest_digest: pkg.packageManifestDigest,
      semantic_skill_fingerprint: pkg.semanticFingerprint,
      verifier_id: configuredVerifierId,
      policy_uri: configuredPolicyUri,
      policy_digest: configuredPolicyDigest,
      expected_signer_identity: configuredSignerIdentity,
      expected_signer_issuer: configuredSignerIssuer
    });

    let adapterResult;
    let adapterErrored = false;
    try {
      adapterResult = normalizeVerifierResult(await verifyAttestation(verifierInput, Buffer.from(attestationBytes)));
    } catch {
      adapterErrored = true;
      adapterResult = Object.freeze({
        subjectDigest: pkg.packageManifestDigest,
        signerIdentity: null,
        signerIssuer: null,
        cryptographicSignatureVerified: false,
        verifierIdentityVerified: false,
        policyPassed: false,
        transparencyLogVerified: null,
        failureReason: 'VERIFIER_ADAPTER_ERROR'
      });
    }

    const subjectMatches = adapterResult.subjectDigest === pkg.packageManifestDigest;
    const signerIdentityMatches = adapterResult.signerIdentity === configuredSignerIdentity;
    const signerIssuerMatches = adapterResult.signerIssuer === configuredSignerIssuer;
    const signatureVerified = adapterResult.cryptographicSignatureVerified === true;
    const adapterIdentityVerified = adapterResult.verifierIdentityVerified === true;
    const identityVerified = adapterIdentityVerified && signerIdentityMatches && signerIssuerMatches;
    const policyPassed = adapterResult.policyPassed === true;
    const passed = !adapterErrored && subjectMatches && signatureVerified && identityVerified && policyPassed;

    let failureReason = null;
    if (!passed) {
      if (adapterErrored) failureReason = 'VERIFIER_ADAPTER_ERROR';
      else if (!subjectMatches) failureReason = 'SUBJECT_DIGEST_MISMATCH';
      else if (!signatureVerified) failureReason = 'SIGNATURE_NOT_VERIFIED';
      else if (!signerIdentityMatches) failureReason = 'SIGNER_IDENTITY_MISMATCH';
      else if (!signerIssuerMatches) failureReason = 'SIGNER_ISSUER_MISMATCH';
      else if (!adapterIdentityVerified) failureReason = 'VERIFIER_IDENTITY_NOT_VERIFIED';
      else if (!policyPassed) failureReason = adapterResult.failureReason || 'POLICY_NOT_PASSED';
    }

    const clockValue = now();
    const parsedTime = clockValue instanceof Date ? clockValue : new Date(clockValue);
    if (!Number.isFinite(parsedTime.getTime())) throw new Error('skill_provenance_verified_at_invalid');
    const unsigned = Object.freeze({
      schema: RECEIPT_SCHEMA,
      verifier_id: configuredVerifierId,
      policy_uri: configuredPolicyUri,
      policy_digest: configuredPolicyDigest,
      expected_signer_identity: configuredSignerIdentity,
      expected_signer_issuer: configuredSignerIssuer,
      package_manifest_digest: pkg.packageManifestDigest,
      semantic_skill_fingerprint: pkg.semanticFingerprint,
      input_attestation_digest: inputAttestationDigest,
      signer_identity: adapterResult.signerIdentity,
      signer_issuer: adapterResult.signerIssuer,
      cryptographic_signature_verified: signatureVerified,
      verifier_identity_verified: identityVerified,
      transparency_log_verified: adapterResult.transparencyLogVerified,
      verification_result: passed ? 'PASSED' : 'FAILED',
      failure_reason: failureReason,
      verified_at: parsedTime.toISOString(),
      session_bound: true,
      durable_verification_receipt: false,
      authority_effect: false,
      execution_eligible: false,
      script_execution_exposed: false
    });
    return Object.freeze({ ...unsigned, receipt_auth_tag: authTag(sessionKey, unsigned) });
  }

  function assertVerifiedReceipt(receiptInput, packageIdentity) {
    const receipt = snapshotReceipt(receiptInput);
    const pkg = assertPackageIdentity(packageIdentity);
    if (receipt.schema !== RECEIPT_SCHEMA) throw new Error('skill_provenance_receipt_schema_invalid');
    const tag = cleanText(receipt.receipt_auth_tag, 80, 'skill_provenance_receipt_auth_tag_invalid');
    if (!/^hmac-sha256:[0-9a-f]{64}$/.test(tag)) throw new Error('skill_provenance_receipt_auth_tag_invalid');
    const expectedTag = authTag(sessionKey, receipt);
    const actualBuffer = Buffer.from(tag);
    const expectedBuffer = Buffer.from(expectedTag);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error('skill_provenance_receipt_not_from_verifier');
    if (receipt.verification_result !== 'PASSED') throw new Error('skill_provenance_receipt_not_verified');
    if (receipt.package_manifest_digest !== pkg.packageManifestDigest || receipt.semantic_skill_fingerprint !== pkg.semanticFingerprint) {
      throw new Error('skill_provenance_receipt_subject_stale');
    }
    if (receipt.verifier_id !== configuredVerifierId || receipt.policy_uri !== configuredPolicyUri || receipt.policy_digest !== configuredPolicyDigest) {
      throw new Error('skill_provenance_receipt_policy_mismatch');
    }
    if (receipt.expected_signer_identity !== configuredSignerIdentity || receipt.signer_identity !== configuredSignerIdentity) {
      throw new Error('skill_provenance_receipt_signer_identity_mismatch');
    }
    if (receipt.expected_signer_issuer !== configuredSignerIssuer || receipt.signer_issuer !== configuredSignerIssuer) {
      throw new Error('skill_provenance_receipt_signer_issuer_mismatch');
    }
    if (receipt.cryptographic_signature_verified !== true || receipt.verifier_identity_verified !== true) throw new Error('skill_provenance_receipt_checks_invalid');
    if (receipt.session_bound !== true || receipt.durable_verification_receipt !== false) throw new Error('skill_provenance_receipt_scope_invalid');
    if (receipt.authority_effect !== false || receipt.execution_eligible !== false || receipt.script_execution_exposed !== false) {
      throw new Error('skill_provenance_receipt_authority_invalid');
    }
    return receipt;
  }

  return Object.freeze({
    verifier_id: configuredVerifierId,
    policy_uri: configuredPolicyUri,
    policy_digest: configuredPolicyDigest,
    expected_signer_identity: configuredSignerIdentity,
    expected_signer_issuer: configuredSignerIssuer,
    session_bound_receipts: true,
    durable_receipts: false,
    verifyPackage,
    assertVerifiedReceipt
  });
}

export const SKILL_PROVENANCE_LIMITS = Object.freeze({ maxAttestationBytes: MAX_ATTESTATION_BYTES });
