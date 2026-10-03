import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CYCLONEDX_PREDICATE,
  PACKAGE_BUILDER_ID,
  PACKAGE_SOURCE_REF,
  PROOF_SCHEMA,
  QUALIFICATION_PREDICATE,
  REQUIRED_WORKFLOWS,
  SLSA_PREDICATE,
  verifyReleaseAttestationEvidence,
} from '../scripts/release-attestation-verification.mjs';

const INSTALLER = 'METAENGINE-Browser-Test-Setup-0.7.0-dev.37006000001.1-x64.exe';
const INSTALLER_SHA = '6'.repeat(64);
const SOURCE = 'a'.repeat(40);
const SIGNER_SHA = 'b'.repeat(40);

function predicate() {
  const rows = REQUIRED_WORKFLOWS.map((name, index) => ({
    name,
    run_id: 1000 + index,
    run_number: 2000 + index,
    run_attempt: 1,
    conclusion: 'success',
  }));
  rows[0] = { ...rows[0], run_id: 4444, run_number: 5555, run_attempt: 1 };
  return {
    schema: 'metaengine.browser.release-qualification-attestation.v1',
    repository: 'PatrickFrome/Compute',
    source_head: SOURCE,
    package_version: '0.7.0-dev.37006000001.1',
    installer_name: INSTALLER,
    installer_sha256: INSTALLER_SHA,
    build_identity_sha256: '1'.repeat(64),
    dependency_resolution_sha256: '2'.repeat(64),
    package_lock_sha256: '3'.repeat(64),
    composed_sbom_raw_sha256: '4'.repeat(64),
    composed_sbom_semantic_inventory_sha256: '5'.repeat(64),
    composed_sbom_aggregate: 'incomplete',
    producer_workflow: 'browser-windows-package-smoke.yml',
    producer_run_id: 4444,
    producer_run_number: 5555,
    producer_run_attempt: 1,
    qualification_workflows: rows,
    physical_qualification_terminal_green: true,
    slsa_provenance_verified: true,
    slsa_builder_trusted: true,
    slsa_builder_id: PACKAGE_BUILDER_ID,
    slsa_predicate_type: SLSA_PREDICATE,
    slsa_verifier_id: 'github-slsa-package-smoke:4444:1',
    slsa_evidence_artifact_id: 7777,
    slsa_evidence_artifact_digest: 'sha256:' + '7'.repeat(64),
    slsa_provenance_evidence_sha256: '8'.repeat(64),
    automatic_promotion: false,
    promotion_authorized: false,
    authority_effect: false,
  };
}

function sbom() {
  return {
    '$schema': 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'METAENGINE Browser',
        version: '0.7.0-dev.37006000001.1',
        hashes: [{ alg: 'SHA-256', content: INSTALLER_SHA }],
      },
    },
    components: [],
    dependencies: [],
    compositions: [{ aggregate: 'incomplete', assemblies: [] }],
  };
}

function verified(predicateType, value, digest = INSTALLER_SHA) {
  return [{
    attestation: { fixture: true },
    verificationResult: {
      statement: {
        _type: 'https://in-toto.io/Statement/v1',
        subject: [{ name: INSTALLER, digest: { sha256: digest } }],
        predicateType,
        predicate: structuredClone(value),
      },
    },
  }];
}

function slsaVerified(p = predicate(), overrides = {}) {
  const sourceHead = p.source_head;
  const runId = p.producer_run_id;
  const runAttempt = p.producer_run_attempt;
  const invocationId = `https://github.com/PatrickFrome/Compute/actions/runs/${runId}/attempts/${runAttempt}`;
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: INSTALLER, digest: { sha256: INSTALLER_SHA } }],
    predicateType: SLSA_PREDICATE,
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            repository: 'https://github.com/PatrickFrome/Compute',
            path: '.github/workflows/browser-windows-package-smoke.yml',
            ref: PACKAGE_SOURCE_REF,
          },
        },
        internalParameters: {
          github: {
            event_name: 'push',
            repository_id: '1341371143',
            repository_owner_id: '20597814',
            runner_environment: 'github-hosted',
          },
        },
        resolvedDependencies: [{
          uri: `git+https://github.com/PatrickFrome/Compute@${PACKAGE_SOURCE_REF}`,
          digest: { gitCommit: sourceHead },
        }],
      },
      runDetails: {
        builder: { id: PACKAGE_BUILDER_ID },
        metadata: { invocationId },
      },
    },
  };
  return [{
    attestation: { fixture: true },
    verificationResult: {
      signature: {
        certificate: {
          buildSignerURI: PACKAGE_BUILDER_ID,
          githubWorkflowSHA: sourceHead,
          sourceRepositoryDigest: sourceHead,
          sourceRepositoryRef: PACKAGE_SOURCE_REF,
          runnerEnvironment: 'github-hosted',
          runInvocationURI: invocationId,
        },
      },
      verifiedIdentity: { runnerEnvironment: 'github-hosted' },
      statement: Object.assign(statement, overrides.statement || {}),
    },
  }];
}

function input(overrides = {}) {
  const p = predicate();
  const s = sbom();
  return {
    qualificationVerification: verified(QUALIFICATION_PREDICATE, p),
    sbomVerification: verified(CYCLONEDX_PREDICATE, s),
    slsaVerification: slsaVerified(p),
    predicate: p,
    sbom: s,
    trustedRootBytes: Buffer.from('trusted-root-fixture\n'),
    expectedInstallerName: INSTALLER,
    expectedInstallerSha256: INSTALLER_SHA,
    signerWorkflow: 'PatrickFrome/Compute/.github/workflows/browser-release-attestation-v1.yml',
    signerSourceSha: SIGNER_SHA,
    signerSourceRef: 'refs/heads/work/build-release-attestation-verification-v1',
    githubCliVersion: 'gh version fixture',
    ...overrides,
  };
}

test('verified CLI statements become a zero-authority release-attestation verification proof', () => {
  const out = verifyReleaseAttestationEvidence(input());
  assert.equal(out.schema, PROOF_SCHEMA);
  assert.equal(out.source_head, SOURCE);
  assert.equal(out.installer_sha256, INSTALLER_SHA);
  assert.equal(out.cryptographic_verification, true);
  assert.equal(out.signer_identity_verified, true);
  assert.equal(out.semantic_binding_verified, true);
  assert.equal(out.trusted_root_snapshot_bound, true);
  assert.equal(out.self_hosted_runner_denied, true);
  assert.equal(out.slsa_cryptographic_verification, true);
  assert.equal(out.slsa_builder_trusted, true);
  assert.equal(out.slsa_predicate_type, SLSA_PREDICATE);
  assert.match(out.slsa_statement_sha256, /^[a-f0-9]{64}$/);
  assert.equal(out.automatic_promotion, false);
  assert.equal(out.promotion_authorized, false);
  assert.equal(out.release_published, false);
  assert.equal(out.authority_effect, false);
  assert.match(out.trusted_root_sha256, /^[a-f0-9]{64}$/);
});

test('subject digest drift fails closed', () => {
  const value = input();
  value.qualificationVerification = verified(QUALIFICATION_PREDICATE, value.predicate, 'f'.repeat(64));
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_qualification_subject_digest_mismatch/);
});

test('verified custom predicate must byte-semantically match the producer predicate', () => {
  const value = input();
  value.qualificationVerification[0].verificationResult.statement.predicate.source_head = 'c'.repeat(40);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_qualification_verified_predicate_drift/);
});

test('qualification matrix may not omit a required physical workflow', () => {
  const value = input();
  value.predicate.qualification_workflows.pop();
  value.qualificationVerification = verified(QUALIFICATION_PREDICATE, value.predicate);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_attestation_qualification_matrix_cardinality_invalid/);
});

test('release authority flags fail closed even when the statement is otherwise verified', () => {
  const value = input();
  value.predicate.promotion_authorized = true;
  value.qualificationVerification = verified(QUALIFICATION_PREDICATE, value.predicate);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_attestation_authority_drift/);
});

test('CycloneDX predicate must retain exact installer root binding and incomplete composition', () => {
  const value = input();
  value.sbom.metadata.component.hashes[0].content = 'e'.repeat(64);
  value.sbomVerification = verified(CYCLONEDX_PREDICATE, value.sbom);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_attestation_sbom_root_sha_mismatch/);
});

test('CycloneDX attestation predicate type is exact', () => {
  const value = input();
  value.sbomVerification = verified('https://example.invalid/bom', value.sbom);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_sbom_predicate_type_mismatch/);
});

test('trusted-root snapshot is mandatory and bounded', () => {
  assert.throws(
    () => verifyReleaseAttestationEvidence(input({ trustedRootBytes: Buffer.alloc(0) })),
    /release_attestation_trusted_root_invalid/,
  );
});


test('SLSA builder identity drift fails closed', () => {
  const value = input();
  value.slsaVerification[0].verificationResult.statement.predicate.runDetails.builder.id = 'https://example.invalid/builder';
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_slsa_builder_id_mismatch/);
});

test('SLSA source dependency drift fails closed', () => {
  const value = input();
  value.slsaVerification[0].verificationResult.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'c'.repeat(40);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_slsa_resolved_dependency_mismatch/);
});

test('SLSA invocation must bind the exact Package Smoke run and attempt', () => {
  const value = input();
  value.slsaVerification[0].verificationResult.statement.predicate.runDetails.metadata.invocationId =
    'https://github.com/PatrickFrome/Compute/actions/runs/9999/attempts/1';
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_slsa_invocation_id_mismatch/);
});

test('signed release predicate must retain the producer SLSA evidence binding', () => {
  const value = input();
  value.predicate.slsa_evidence_artifact_digest = 'sha256:' + 'f'.repeat(64);
  value.qualificationVerification = verified(QUALIFICATION_PREDICATE, value.predicate);
  const out = verifyReleaseAttestationEvidence(value);
  assert.equal(out.slsa_cryptographic_verification, true);

  value.predicate.slsa_builder_id = 'https://example.invalid/builder';
  value.qualificationVerification = verified(QUALIFICATION_PREDICATE, value.predicate);
  assert.throws(() => verifyReleaseAttestationEvidence(value), /release_attestation_slsa_builder_id_mismatch/);
});
