import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSkillPackageIdentity } from '../skill-package-identity-v1.mjs';
import { createSkillProvenanceVerifier, SKILL_PROVENANCE_LIMITS } from '../skill-provenance-receipt-v1.mjs';

const POLICY_DIGEST = `sha256:${'c'.repeat(64)}`;
const SIGNER = 'https://github.com/PatrickFrome/Compute/.github/workflows/release-skill.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';

function file(path, content, executable = false) {
  return { path, bytes: Buffer.from(content, 'utf8'), executable, type: 'file' };
}

function packageIdentity() {
  return compileSkillPackageIdentity('verified-skill', [
    file('SKILL.md', '---\nname: verified-skill\ndescription: Verify provenance receipts.\n---\n## Workflow\n\nRead only.\n'),
    file('references/REF.md', 'reference')
  ]);
}

function verifier(overrides = {}) {
  return createSkillProvenanceVerifier({
    verifierId: 'https://metaengine.local/verifiers/sigstore-v1',
    policyUri: 'https://metaengine.local/policies/skill-release-v1',
    policyDigest: POLICY_DIGEST,
    expectedSignerIdentity: SIGNER,
    expectedSignerIssuer: ISSUER,
    now: () => new Date('2026-08-28T17:05:00.000Z'),
    verifyAttestation: async (input) => ({
      subjectDigest: input.package_manifest_digest,
      signerIdentity: SIGNER,
      signerIssuer: ISSUER,
      cryptographicSignatureVerified: true,
      verifierIdentityVerified: true,
      policyPassed: true,
      transparencyLogVerified: true,
      failureReason: null
    }),
    ...overrides
  });
}

test('trusted verifier produces session-bound PASSED receipt for exact subject, signer, issuer and policy', async () => {
  const pkg = packageIdentity();
  const engine = verifier();
  const receipt = await engine.verifyPackage(pkg, Buffer.from('signed-attestation'));
  assert.equal(receipt.verification_result, 'PASSED');
  assert.equal(receipt.failure_reason, null);
  assert.equal(receipt.package_manifest_digest, pkg.package_manifest_digest);
  assert.equal(receipt.semantic_skill_fingerprint, pkg.semantic_skill_fingerprint);
  assert.equal(receipt.signer_identity, SIGNER);
  assert.equal(receipt.signer_issuer, ISSUER);
  assert.equal(receipt.expected_signer_identity, SIGNER);
  assert.equal(receipt.expected_signer_issuer, ISSUER);
  assert.equal(receipt.cryptographic_signature_verified, true);
  assert.equal(receipt.verifier_identity_verified, true);
  assert.equal(receipt.session_bound, true);
  assert.equal(receipt.durable_verification_receipt, false);
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.execution_eligible, false);
  assert.equal(receipt.script_execution_exposed, false);
  assert.match(receipt.receipt_auth_tag, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.deepEqual(engine.assertVerifiedReceipt(receipt, pkg), receipt);
});

test('adapter cannot self-select a different signer even when it claims identity verification', async () => {
  const pkg = packageIdentity();
  const engine = verifier({
    verifyAttestation: async (input) => ({
      subjectDigest: input.package_manifest_digest,
      signerIdentity: 'https://attacker.example/workflow',
      signerIssuer: ISSUER,
      cryptographicSignatureVerified: true,
      verifierIdentityVerified: true,
      policyPassed: true,
      transparencyLogVerified: true
    })
  });
  const receipt = await engine.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(receipt.verification_result, 'FAILED');
  assert.equal(receipt.failure_reason, 'SIGNER_IDENTITY_MISMATCH');
  assert.equal(receipt.verifier_identity_verified, false);
  assert.throws(() => engine.assertVerifiedReceipt(receipt, pkg), /skill_provenance_receipt_not_verified/);
});

test('adapter cannot self-select a different issuer even when every boolean is true', async () => {
  const pkg = packageIdentity();
  const engine = verifier({
    verifyAttestation: async (input) => ({
      subjectDigest: input.package_manifest_digest,
      signerIdentity: SIGNER,
      signerIssuer: 'https://attacker-issuer.example',
      cryptographicSignatureVerified: true,
      verifierIdentityVerified: true,
      policyPassed: true,
      transparencyLogVerified: true
    })
  });
  const receipt = await engine.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(receipt.verification_result, 'FAILED');
  assert.equal(receipt.failure_reason, 'SIGNER_ISSUER_MISMATCH');
  assert.equal(receipt.verifier_identity_verified, false);
});

test('subject mismatch fails even when signature, identity and policy adapter flags are true', async () => {
  const pkg = packageIdentity();
  const engine = verifier({
    verifyAttestation: async () => ({
      subjectDigest: `sha256:${'d'.repeat(64)}`,
      signerIdentity: SIGNER,
      signerIssuer: ISSUER,
      cryptographicSignatureVerified: true,
      verifierIdentityVerified: true,
      policyPassed: true,
      transparencyLogVerified: true
    })
  });
  const receipt = await engine.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(receipt.verification_result, 'FAILED');
  assert.equal(receipt.failure_reason, 'SUBJECT_DIGEST_MISMATCH');
});

test('forged or mutated receipt JSON cannot become verified by setting booleans', async () => {
  const pkg = packageIdentity();
  const engine = verifier();
  const receipt = await engine.verifyPackage(pkg, Buffer.from('attestation'));
  const forged = { ...receipt, signer_identity: 'https://attacker.example', verification_result: 'PASSED', verifier_identity_verified: true };
  assert.throws(() => engine.assertVerifiedReceipt(forged, pkg), /skill_provenance_receipt_not_from_verifier/);
});

test('receipt from another verifier session is rejected even with identical policy and signer configuration', async () => {
  const pkg = packageIdentity();
  const first = verifier();
  const second = verifier();
  const receipt = await first.verifyPackage(pkg, Buffer.from('attestation'));
  assert.throws(() => second.assertVerifiedReceipt(receipt, pkg), /skill_provenance_receipt_not_from_verifier/);
});

test('attestation bytes are copied before async verification and caller mutation cannot change verifier input', async () => {
  const pkg = packageIdentity();
  const bytes = Buffer.from('original-attestation');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let observed = null;
  const engine = verifier({
    verifyAttestation: async (input, attestationBytes) => {
      await gate;
      observed = Buffer.from(attestationBytes).toString('utf8');
      return {
        subjectDigest: input.package_manifest_digest,
        signerIdentity: SIGNER,
        signerIssuer: ISSUER,
        cryptographicSignatureVerified: true,
        verifierIdentityVerified: true,
        policyPassed: true,
        transparencyLogVerified: true
      };
    }
  });
  const pending = engine.verifyPackage(pkg, bytes);
  bytes.fill(0x78);
  release();
  const receipt = await pending;
  assert.equal(observed, 'original-attestation');
  assert.equal(receipt.verification_result, 'PASSED');
});

test('verifier adapter result fields are snapshotted exactly once', async () => {
  const pkg = packageIdentity();
  const reads = { subject: 0, identity: 0, issuer: 0, signature: 0, verifier: 0, policy: 0, log: 0, reason: 0 };
  const engine = verifier({
    verifyAttestation: async (input) => ({
      get subjectDigest() { reads.subject += 1; return reads.subject === 1 ? input.package_manifest_digest : `sha256:${'e'.repeat(64)}`; },
      get signerIdentity() { reads.identity += 1; return reads.identity === 1 ? SIGNER : 'https://attacker.example'; },
      get signerIssuer() { reads.issuer += 1; return reads.issuer === 1 ? ISSUER : 'https://issuer.example'; },
      get cryptographicSignatureVerified() { reads.signature += 1; return true; },
      get verifierIdentityVerified() { reads.verifier += 1; return true; },
      get policyPassed() { reads.policy += 1; return true; },
      get transparencyLogVerified() { reads.log += 1; return true; },
      get failureReason() { reads.reason += 1; return null; }
    })
  });
  const receipt = await engine.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(receipt.verification_result, 'PASSED');
  assert.deepEqual(reads, { subject: 1, identity: 1, issuer: 1, signature: 1, verifier: 1, policy: 1, log: 1, reason: 1 });
});

test('verifier adapter exception or malformed output becomes typed FAILED receipt', async () => {
  const pkg = packageIdentity();
  const throwing = verifier({ verifyAttestation: async () => { throw new Error('offline'); } });
  const thrownReceipt = await throwing.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(thrownReceipt.verification_result, 'FAILED');
  assert.equal(thrownReceipt.failure_reason, 'VERIFIER_ADAPTER_ERROR');

  const malformed = verifier({
    verifyAttestation: async (input) => ({
      subjectDigest: input.package_manifest_digest,
      signerIdentity: 'bad\u0000identity',
      signerIssuer: ISSUER,
      cryptographicSignatureVerified: true,
      verifierIdentityVerified: true,
      policyPassed: true
    })
  });
  const malformedReceipt = await malformed.verifyPackage(pkg, Buffer.from('attestation'));
  assert.equal(malformedReceipt.verification_result, 'FAILED');
  assert.equal(malformedReceipt.failure_reason, 'VERIFIER_ADAPTER_ERROR');
  assert.equal(malformedReceipt.authority_effect, false);
});

test('attestation byte budget is a hard limit', async () => {
  const pkg = packageIdentity();
  const engine = verifier();
  await assert.rejects(() => engine.verifyPackage(pkg, Buffer.alloc(SKILL_PROVENANCE_LIMITS.maxAttestationBytes + 1)), /skill_provenance_attestation_size_invalid/);
});
