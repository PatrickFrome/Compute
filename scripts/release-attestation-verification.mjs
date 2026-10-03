#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROOF_SCHEMA = 'metaengine.browser.release-attestation-verification.v1';
const QUALIFICATION_PREDICATE = 'https://metaengine.dev/attestations/browser-release-qualification/v1';
const CYCLONEDX_PREDICATE = 'https://cyclonedx.org/bom';
const SLSA_PREDICATE = 'https://slsa.dev/provenance/v1';
const PACKAGE_BUILD_TYPE = 'https://actions.github.io/buildtypes/workflow/v1';
const PACKAGE_SOURCE_REF = 'refs/heads/physical/build-slsa-provenance-v1';
const PACKAGE_BUILDER_WORKFLOW = 'PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml';
const PACKAGE_BUILDER_ID = `https://github.com/${PACKAGE_BUILDER_WORKFLOW}@${PACKAGE_SOURCE_REF}`;
const PACKAGE_WORKFLOW_PATH = '.github/workflows/browser-windows-package-smoke.yml';
const REPOSITORY_URI = 'https://github.com/PatrickFrome/Compute';
const REPOSITORY_ID = '1341371143';
const REPOSITORY_OWNER_ID = '20597814';
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const REQUIRED_WORKFLOWS = Object.freeze([
  'Browser Windows Package Smoke',
  'Browser Windows Installed Chat Qualification',
  'METAENGINE Browser Final Runtime Activation V1',
  'METAENGINE Browser Windows Autonomous Soak V1',
  'METAENGINE Browser Self Update E2E',
  'METAENGINE Browser Shell V1',
  'METAENGINE Browser Critical Audit V1',
  'METAENGINE Browser Shell-First Dirty Profile V1',
  'METAENGINE Browser Host Resilience Login Start V1',
  'Browser Workspace Reincarnation V1',
]);

function fail(code) { throw new Error(code); }

function readJson(filePath, code) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail(code);
  }
  return value;
}

function required(value, code) {
  const text = String(value ?? '').trim();
  if (!text) fail(code);
  return text;
}

function exactSha256(value, code) {
  const text = required(value, code).toLowerCase();
  if (!SHA256.test(text)) fail(code);
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function verifiedStatement(document, code) {
  if (!Array.isArray(document) || document.length !== 1) fail(code + '_cardinality_invalid');
  const statement = document[0]?.verificationResult?.statement;
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) fail(code + '_statement_missing');
  return statement;
}

function fileName(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function verifySubject(statement, expectedName, expectedSha, code) {
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  if (subjects.length !== 1) fail(code + '_subject_cardinality_invalid');
  const row = subjects[0];
  if (fileName(row?.name) !== expectedName) fail(code + '_subject_name_mismatch');
  if (String(row?.digest?.sha256 || '').toLowerCase() !== expectedSha) fail(code + '_subject_digest_mismatch');
}

function verifyQualificationPredicate(predicate, expectedName, expectedSha) {
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) fail('release_attestation_predicate_invalid');
  if (predicate.schema !== 'metaengine.browser.release-qualification-attestation.v1') fail('release_attestation_predicate_schema_invalid');
  if (required(predicate.repository, 'release_attestation_repository_missing') !== 'PatrickFrome/Compute') fail('release_attestation_repository_mismatch');
  const sourceHead = required(predicate.source_head, 'release_attestation_source_head_missing').toLowerCase();
  if (!SHA40.test(sourceHead)) fail('release_attestation_source_head_invalid');
  const packageVersion = required(predicate.package_version, 'release_attestation_package_version_missing');
  if (fileName(predicate.installer_name) !== expectedName) fail('release_attestation_installer_name_mismatch');
  if (exactSha256(predicate.installer_sha256, 'release_attestation_installer_sha_invalid') !== expectedSha) fail('release_attestation_installer_sha_mismatch');
  exactSha256(predicate.build_identity_sha256, 'release_attestation_build_identity_sha_invalid');
  exactSha256(predicate.dependency_resolution_sha256, 'release_attestation_dependency_resolution_sha_invalid');
  exactSha256(predicate.package_lock_sha256, 'release_attestation_package_lock_sha_invalid');
  exactSha256(predicate.composed_sbom_raw_sha256, 'release_attestation_composed_sbom_raw_sha_invalid');
  exactSha256(predicate.composed_sbom_semantic_inventory_sha256, 'release_attestation_composed_sbom_semantic_sha_invalid');
  if (predicate.composed_sbom_aggregate !== 'incomplete') fail('release_attestation_composed_aggregate_invalid');
  if (predicate.producer_workflow !== 'browser-windows-package-smoke.yml') fail('release_attestation_producer_workflow_invalid');
  for (const key of ['producer_run_id', 'producer_run_number', 'producer_run_attempt']) {
    if (!Number.isSafeInteger(Number(predicate[key])) || Number(predicate[key]) <= 0) fail('release_attestation_' + key + '_invalid');
  }
  const rows = Array.isArray(predicate.qualification_workflows) ? predicate.qualification_workflows : [];
  if (rows.length !== REQUIRED_WORKFLOWS.length) fail('release_attestation_qualification_matrix_cardinality_invalid');
  const byName = new Map();
  for (const row of rows) {
    const name = required(row?.name, 'release_attestation_qualification_name_invalid');
    if (byName.has(name)) fail('release_attestation_qualification_duplicate');
    if (!Number.isSafeInteger(Number(row?.run_id)) || Number(row.run_id) <= 0) fail('release_attestation_qualification_run_id_invalid');
    if (!Number.isSafeInteger(Number(row?.run_number)) || Number(row.run_number) <= 0) fail('release_attestation_qualification_run_number_invalid');
    if (!Number.isSafeInteger(Number(row?.run_attempt)) || Number(row.run_attempt) <= 0) fail('release_attestation_qualification_run_attempt_invalid');
    if (row?.conclusion !== 'success') fail('release_attestation_qualification_not_success');
    byName.set(name, row);
  }
  if (REQUIRED_WORKFLOWS.some((name) => !byName.has(name))) fail('release_attestation_required_qualification_missing');
  const producer = byName.get('Browser Windows Package Smoke');
  if (Number(producer.run_id) !== Number(predicate.producer_run_id)
      || Number(producer.run_number) !== Number(predicate.producer_run_number)
      || Number(producer.run_attempt) !== Number(predicate.producer_run_attempt)) {
    fail('release_attestation_producer_matrix_binding_mismatch');
  }
  if (predicate.physical_qualification_terminal_green !== true) fail('release_attestation_terminal_green_missing');
  if (predicate.slsa_provenance_verified !== true) fail('release_attestation_slsa_provenance_missing');
  if (predicate.slsa_builder_trusted !== true) fail('release_attestation_slsa_builder_untrusted');
  if (required(predicate.slsa_builder_id, 'release_attestation_slsa_builder_id_missing') !== PACKAGE_BUILDER_ID) {
    fail('release_attestation_slsa_builder_id_mismatch');
  }
  if (required(predicate.slsa_predicate_type, 'release_attestation_slsa_predicate_type_missing') !== SLSA_PREDICATE) {
    fail('release_attestation_slsa_predicate_type_mismatch');
  }
  const expectedVerifierId = `github-slsa-package-smoke:${Number(predicate.producer_run_id)}:${Number(predicate.producer_run_attempt)}`;
  if (required(predicate.slsa_verifier_id, 'release_attestation_slsa_verifier_id_missing') !== expectedVerifierId) {
    fail('release_attestation_slsa_verifier_id_mismatch');
  }
  if (!Number.isSafeInteger(Number(predicate.slsa_evidence_artifact_id)) || Number(predicate.slsa_evidence_artifact_id) <= 0) {
    fail('release_attestation_slsa_artifact_id_invalid');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(required(predicate.slsa_evidence_artifact_digest, 'release_attestation_slsa_artifact_digest_missing'))) {
    fail('release_attestation_slsa_artifact_digest_invalid');
  }
  exactSha256(predicate.slsa_provenance_evidence_sha256, 'release_attestation_slsa_evidence_sha_invalid');
  exactSha256(predicate.slsa_verification_material_sha256, 'release_attestation_slsa_verification_material_sha_invalid');
  if (predicate.automatic_promotion !== false
      || predicate.promotion_authorized !== false
      || predicate.authority_effect !== false) {
    fail('release_attestation_authority_drift');
  }
  return { sourceHead, packageVersion };
}

function verifySlsaProvenance(slsaVerification, qualificationPredicate, expectedName, expectedSha) {
  if (!Array.isArray(slsaVerification) || slsaVerification.length !== 1) fail('release_slsa_verification_cardinality_invalid');
  const verificationResult = slsaVerification[0]?.verificationResult;
  if (!verificationResult || typeof verificationResult !== 'object') fail('release_slsa_verification_result_missing');
  const statement = verificationResult.statement;
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) fail('release_slsa_statement_missing');
  if (statement.predicateType !== SLSA_PREDICATE) fail('release_slsa_predicate_type_mismatch');
  verifySubject(statement, expectedName, expectedSha, 'release_slsa');

  const sourceHead = required(qualificationPredicate.source_head, 'release_slsa_source_head_missing').toLowerCase();
  const producerRunId = Number(qualificationPredicate.producer_run_id);
  const producerRunAttempt = Number(qualificationPredicate.producer_run_attempt);
  const buildDefinition = statement.predicate?.buildDefinition;
  const runDetails = statement.predicate?.runDetails;
  if (!buildDefinition || !runDetails) fail('release_slsa_predicate_shape_invalid');
  if (buildDefinition.buildType !== PACKAGE_BUILD_TYPE) fail('release_slsa_build_type_mismatch');

  const workflow = buildDefinition.externalParameters?.workflow;
  if (workflow?.repository !== REPOSITORY_URI
      || workflow?.path !== PACKAGE_WORKFLOW_PATH
      || workflow?.ref !== PACKAGE_SOURCE_REF) {
    fail('release_slsa_workflow_binding_mismatch');
  }

  const github = buildDefinition.internalParameters?.github;
  if (github?.event_name !== 'push'
      || String(github?.repository_id || '') !== REPOSITORY_ID
      || String(github?.repository_owner_id || '') !== REPOSITORY_OWNER_ID
      || github?.runner_environment !== 'github-hosted') {
    fail('release_slsa_internal_parameters_mismatch');
  }

  const dependencies = Array.isArray(buildDefinition.resolvedDependencies) ? buildDefinition.resolvedDependencies : [];
  if (dependencies.length !== 1) fail('release_slsa_resolved_dependency_cardinality_invalid');
  const dependency = dependencies[0];
  if (dependency?.uri !== `git+https://github.com/PatrickFrome/Compute@${PACKAGE_SOURCE_REF}`
      || String(dependency?.digest?.gitCommit || '').toLowerCase() !== sourceHead) {
    fail('release_slsa_resolved_dependency_mismatch');
  }

  if (runDetails.builder?.id !== PACKAGE_BUILDER_ID) fail('release_slsa_builder_id_mismatch');
  const expectedInvocation = `https://github.com/PatrickFrome/Compute/actions/runs/${producerRunId}/attempts/${producerRunAttempt}`;
  if (runDetails.metadata?.invocationId !== expectedInvocation) fail('release_slsa_invocation_id_mismatch');

  const cert = verificationResult.signature?.certificate;
  if (!cert || typeof cert !== 'object') fail('release_slsa_certificate_missing');
  if (cert.buildSignerURI !== PACKAGE_BUILDER_ID
      || cert.githubWorkflowSHA !== sourceHead
      || cert.sourceRepositoryDigest !== sourceHead
      || cert.sourceRepositoryRef !== PACKAGE_SOURCE_REF
      || cert.runnerEnvironment !== 'github-hosted'
      || cert.runInvocationURI !== expectedInvocation) {
    fail('release_slsa_certificate_binding_mismatch');
  }
  if (verificationResult.verifiedIdentity?.runnerEnvironment !== 'github-hosted') {
    fail('release_slsa_verified_identity_runner_invalid');
  }

  return statement;
}

function verifyCycloneDx(sbom, expectedSha) {
  if (!sbom || typeof sbom !== 'object' || Array.isArray(sbom)) fail('release_attestation_sbom_invalid');
  if (sbom.bomFormat !== 'CycloneDX') fail('release_attestation_sbom_format_invalid');
  if (String(sbom.specVersion || '') !== '1.5') fail('release_attestation_sbom_spec_invalid');
  const root = sbom.metadata?.component;
  if (!root || typeof root !== 'object') fail('release_attestation_sbom_root_missing');
  const rootSha = (Array.isArray(root.hashes) ? root.hashes : [])
    .find((row) => String(row?.alg || '').toUpperCase() === 'SHA-256')?.content;
  if (String(rootSha || '').toLowerCase() !== expectedSha) fail('release_attestation_sbom_root_sha_mismatch');
  const compositions = Array.isArray(sbom.compositions) ? sbom.compositions : [];
  if (compositions.length !== 1 || compositions[0]?.aggregate !== 'incomplete') fail('release_attestation_sbom_composition_invalid');
}

export function verifyReleaseAttestationEvidence({
  qualificationVerification,
  sbomVerification,
  slsaVerification,
  predicate,
  sbom,
  trustedRootBytes,
  expectedInstallerName,
  expectedInstallerSha256,
  signerWorkflow,
  signerSourceSha,
  signerSourceRef,
  githubCliVersion,
} = {}) {
  const expectedName = required(expectedInstallerName, 'release_attestation_expected_installer_name_missing');
  const expectedSha = exactSha256(expectedInstallerSha256, 'release_attestation_expected_installer_sha_invalid');
  const workflow = required(signerWorkflow, 'release_attestation_signer_workflow_missing');
  const signerSha = required(signerSourceSha, 'release_attestation_signer_source_sha_missing').toLowerCase();
  if (!SHA40.test(signerSha)) fail('release_attestation_signer_source_sha_invalid');
  const signerRef = required(signerSourceRef, 'release_attestation_signer_source_ref_missing');
  const cliVersion = required(githubCliVersion, 'release_attestation_gh_cli_version_missing');

  const qualificationStatement = verifiedStatement(qualificationVerification, 'release_qualification_verification');
  if (qualificationStatement.predicateType !== QUALIFICATION_PREDICATE) fail('release_qualification_predicate_type_mismatch');
  verifySubject(qualificationStatement, expectedName, expectedSha, 'release_qualification');
  const identity = verifyQualificationPredicate(predicate, expectedName, expectedSha);
  if (canonicalJson(qualificationStatement.predicate) !== canonicalJson(predicate)) {
    fail('release_qualification_verified_predicate_drift');
  }

  const sbomStatement = verifiedStatement(sbomVerification, 'release_sbom_verification');
  if (sbomStatement.predicateType !== CYCLONEDX_PREDICATE) fail('release_sbom_predicate_type_mismatch');
  verifySubject(sbomStatement, expectedName, expectedSha, 'release_sbom');
  verifyCycloneDx(sbom, expectedSha);
  if (canonicalJson(sbomStatement.predicate) !== canonicalJson(sbom)) {
    fail('release_sbom_verified_predicate_drift');
  }

  const slsaStatement = verifySlsaProvenance(slsaVerification, predicate, expectedName, expectedSha);

  const rootBytes = Buffer.from(trustedRootBytes || []);
  if (rootBytes.length <= 0 || rootBytes.length > 4 * 1024 * 1024) fail('release_attestation_trusted_root_invalid');

  return {
    schema: PROOF_SCHEMA,
    repository: 'PatrickFrome/Compute',
    source_head: identity.sourceHead,
    package_version: identity.packageVersion,
    installer_name: expectedName,
    installer_sha256: expectedSha,
    signer_workflow: workflow,
    signer_source_sha: signerSha,
    signer_source_ref: signerRef,
    github_cli_version: cliVersion,
    trusted_root_sha256: sha256(rootBytes),
    qualification_predicate_type: QUALIFICATION_PREDICATE,
    qualification_statement_sha256: sha256(Buffer.from(canonicalJson(qualificationStatement), 'utf8')),
    qualification_predicate_sha256: sha256(Buffer.from(canonicalJson(predicate), 'utf8')),
    sbom_predicate_type: CYCLONEDX_PREDICATE,
    sbom_statement_sha256: sha256(Buffer.from(canonicalJson(sbomStatement), 'utf8')),
    sbom_sha256: sha256(Buffer.from(canonicalJson(sbom), 'utf8')),
    slsa_predicate_type: SLSA_PREDICATE,
    slsa_statement_sha256: sha256(Buffer.from(canonicalJson(slsaStatement), 'utf8')),
    slsa_cryptographic_verification: true,
    slsa_builder_trusted: true,
    cryptographic_verification: true,
    signer_identity_verified: true,
    semantic_binding_verified: true,
    trusted_root_snapshot_bound: true,
    self_hosted_runner_denied: true,
    automatic_promotion: false,
    promotion_authorized: false,
    release_published: false,
    authority_effect: false,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const trustedRootPath = required(a['trusted-root'], 'release_attestation_trusted_root_path_missing');
  let trustedRootBytes;
  try { trustedRootBytes = fs.readFileSync(trustedRootPath); }
  catch { fail('release_attestation_trusted_root_unreadable'); }

  const result = verifyReleaseAttestationEvidence({
    qualificationVerification: readJson(a['qualification-verification'], 'release_qualification_verification_unreadable'),
    sbomVerification: readJson(a['sbom-verification'], 'release_sbom_verification_unreadable'),
    slsaVerification: readJson(a['slsa-verification'], 'release_slsa_verification_unreadable'),
    predicate: readJson(a.predicate, 'release_attestation_predicate_unreadable'),
    sbom: readJson(a.sbom, 'release_attestation_sbom_unreadable'),
    trustedRootBytes,
    expectedInstallerName: a['expected-installer-name'],
    expectedInstallerSha256: a['expected-installer-sha256'],
    signerWorkflow: a['signer-workflow'],
    signerSourceSha: a['signer-source-sha'],
    signerSourceRef: a['signer-source-ref'],
    githubCliVersion: a['gh-cli-version'],
  });

  const output = JSON.stringify(result, null, 2) + '\n';
  if (a.out) fs.writeFileSync(path.resolve(String(a.out)), output, 'utf8');
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.release-attestation-verification-error.v1',
      code: String(error?.message || error).split(':')[0],
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export {
  PROOF_SCHEMA,
  QUALIFICATION_PREDICATE,
  CYCLONEDX_PREDICATE,
  SLSA_PREDICATE,
  PACKAGE_BUILDER_ID,
  PACKAGE_SOURCE_REF,
  REQUIRED_WORKFLOWS,
  canonicalJson,
  verifySlsaProvenance,
};
