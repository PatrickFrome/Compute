#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SCHEMA = 'metaengine.browser-fabric.provenance-evidence.v1';
const PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';
const BUILD_TYPE = 'https://actions.github.io/buildtypes/workflow/v1';
const DEFAULT_REPOSITORY = 'PatrickFrome/Compute';
const DEFAULT_WORKFLOW_PATH = '.github/workflows/browser-windows-package-smoke.yml';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

function fail(code) {
  throw new Error(code);
}

function required(value, code) {
  const text = String(value ?? '').trim();
  if (!text) fail(code);
  return text;
}

function exactSha40(value, code) {
  const text = required(value, code).toLowerCase();
  if (!SHA40.test(text)) fail(code);
  return text;
}

function exactSha256(value, code) {
  const text = required(value, code).toLowerCase();
  if (!SHA256.test(text)) fail(code);
  return text;
}

function positiveIntegerString(value, code) {
  const text = required(value, code);
  if (!POSITIVE_INTEGER.test(text)) fail(code);
  return text;
}

function verifiedStatement(document) {
  if (!Array.isArray(document) || document.length !== 1) {
    fail('browser_slsa_verification_cardinality_invalid');
  }
  const statement = document[0]?.verificationResult?.statement;
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
    fail('browser_slsa_verified_statement_missing');
  }
  return statement;
}

function fileName(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function exactObject(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function exactUrl(value, expected, code) {
  if (required(value, code) !== expected) fail(code);
}

function exactIsoPastOrPresent(value, nowMs) {
  const text = required(value, 'browser_slsa_verified_at_missing');
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || parsed > nowMs) fail('browser_slsa_verified_at_invalid');
  return text;
}

export function verifyBrowserSlsaProvenance({
  verification,
  expectedSourceSha,
  expectedSourceRef,
  expectedInstallerName,
  expectedInstallerSha256,
  expectedRunId,
  expectedRunAttempt,
  expectedRepository = DEFAULT_REPOSITORY,
  expectedWorkflowPath = DEFAULT_WORKFLOW_PATH,
  verifiedAt = new Date().toISOString(),
  verifierId = null,
  now = new Date(),
} = {}) {
  const sourceSha = exactSha40(expectedSourceSha, 'browser_slsa_expected_source_sha_invalid');
  const sourceRef = required(expectedSourceRef, 'browser_slsa_expected_source_ref_missing');
  if (!sourceRef.startsWith('refs/heads/')) fail('browser_slsa_source_ref_not_branch');
  if (sourceRef.startsWith('refs/pull/')) fail('browser_slsa_pull_request_ref_forbidden');

  const installerName = required(expectedInstallerName, 'browser_slsa_expected_installer_name_missing');
  if (fileName(installerName) !== installerName) fail('browser_slsa_expected_installer_name_invalid');
  const installerSha = exactSha256(expectedInstallerSha256, 'browser_slsa_expected_installer_sha_invalid');
  const runId = positiveIntegerString(expectedRunId, 'browser_slsa_expected_run_id_invalid');
  const runAttempt = positiveIntegerString(expectedRunAttempt, 'browser_slsa_expected_run_attempt_invalid');
  const repository = required(expectedRepository, 'browser_slsa_expected_repository_missing');
  const workflowPath = required(expectedWorkflowPath, 'browser_slsa_expected_workflow_path_missing');
  if (!workflowPath.startsWith('.github/workflows/') || !workflowPath.endsWith('.yml')) {
    fail('browser_slsa_expected_workflow_path_invalid');
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) fail('browser_slsa_now_invalid');
  const evidenceTime = exactIsoPastOrPresent(verifiedAt, nowMs);

  const statement = verifiedStatement(verification);
  if (statement.predicateType !== PREDICATE_TYPE) fail('browser_slsa_predicate_type_mismatch');

  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  if (subjects.length !== 1) fail('browser_slsa_subject_cardinality_invalid');
  const subject = subjects[0];
  if (fileName(subject?.name) !== installerName) fail('browser_slsa_subject_name_mismatch');
  if (String(subject?.digest?.sha256 || '').toLowerCase() !== installerSha) {
    fail('browser_slsa_subject_digest_mismatch');
  }

  const predicate = exactObject(
    statement.predicate,
    ['buildDefinition', 'runDetails'],
    'browser_slsa_predicate_shape_invalid',
  );
  const buildDefinition = exactObject(
    predicate.buildDefinition,
    ['buildType', 'externalParameters', 'internalParameters', 'resolvedDependencies'],
    'browser_slsa_build_definition_shape_invalid',
  );
  if (buildDefinition.buildType !== BUILD_TYPE) fail('browser_slsa_build_type_mismatch');

  const externalParameters = exactObject(
    buildDefinition.externalParameters,
    ['workflow'],
    'browser_slsa_external_parameters_shape_invalid',
  );
  const workflow = exactObject(
    externalParameters.workflow,
    ['path', 'ref', 'repository'],
    'browser_slsa_workflow_shape_invalid',
  );
  const repositoryUrl = `https://github.com/${repository}`;
  exactUrl(workflow.repository, repositoryUrl, 'browser_slsa_workflow_repository_mismatch');
  if (workflow.path !== workflowPath) fail('browser_slsa_workflow_path_mismatch');
  if (workflow.ref !== sourceRef) fail('browser_slsa_workflow_ref_mismatch');

  const internalParameters = exactObject(
    buildDefinition.internalParameters,
    ['github'],
    'browser_slsa_internal_parameters_shape_invalid',
  );
  const github = exactObject(
    internalParameters.github,
    ['event_name', 'repository_id', 'repository_owner_id', 'runner_environment'],
    'browser_slsa_github_parameters_shape_invalid',
  );
  if (github.event_name !== 'push') fail('browser_slsa_event_not_push');
  if (github.runner_environment !== 'github-hosted') fail('browser_slsa_runner_not_github_hosted');
  if (!POSITIVE_INTEGER.test(String(github.repository_id || ''))) fail('browser_slsa_repository_id_invalid');
  if (!POSITIVE_INTEGER.test(String(github.repository_owner_id || ''))) fail('browser_slsa_repository_owner_id_invalid');

  const dependencies = Array.isArray(buildDefinition.resolvedDependencies)
    ? buildDefinition.resolvedDependencies
    : [];
  if (dependencies.length !== 1) fail('browser_slsa_resolved_dependency_cardinality_invalid');
  const dependency = exactObject(
    dependencies[0],
    ['uri', 'digest'],
    'browser_slsa_resolved_dependency_shape_invalid',
  );
  exactUrl(
    dependency.uri,
    `git+${repositoryUrl}@${sourceRef}`,
    'browser_slsa_resolved_dependency_uri_mismatch',
  );
  const dependencyDigest = exactObject(
    dependency.digest,
    ['gitCommit'],
    'browser_slsa_resolved_dependency_digest_shape_invalid',
  );
  if (String(dependencyDigest.gitCommit || '').toLowerCase() !== sourceSha) {
    fail('browser_slsa_source_sha_mismatch');
  }

  const runDetails = exactObject(
    predicate.runDetails,
    ['builder', 'metadata'],
    'browser_slsa_run_details_shape_invalid',
  );
  const builder = exactObject(
    runDetails.builder,
    ['id'],
    'browser_slsa_builder_shape_invalid',
  );
  const expectedBuilderId = `${repositoryUrl}/${workflowPath}@${sourceRef}`;
  if (builder.id !== expectedBuilderId) fail('browser_slsa_builder_id_mismatch');

  const metadata = exactObject(
    runDetails.metadata,
    ['invocationId'],
    'browser_slsa_metadata_shape_invalid',
  );
  const expectedInvocationId = `${repositoryUrl}/actions/runs/${runId}/attempts/${runAttempt}`;
  if (metadata.invocationId !== expectedInvocationId) fail('browser_slsa_invocation_id_mismatch');

  const id = verifierId == null
    ? `github-slsa:${runId}:${runAttempt}`
    : required(verifierId, 'browser_slsa_verifier_id_missing');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/.test(id)) fail('browser_slsa_verifier_id_invalid');

  return Object.freeze({
    schema: EVIDENCE_SCHEMA,
    verifier_id: id,
    verified_at: evidenceTime,
    verified: true,
    builder_trusted: true,
    builder_id: expectedBuilderId,
    source_sha: sourceSha,
    subject_name: installerName,
    subject_sha256: installerSha,
    predicate_type: PREDICATE_TYPE,
    authority_effect: false,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail(code);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const verificationPath = required(args.verification, 'browser_slsa_verification_path_missing');
  const output = verifyBrowserSlsaProvenance({
    verification: readJson(verificationPath, 'browser_slsa_verification_unreadable'),
    expectedSourceSha: args['expected-source-sha'],
    expectedSourceRef: args['expected-source-ref'],
    expectedInstallerName: args['expected-installer-name'],
    expectedInstallerSha256: args['expected-installer-sha256'],
    expectedRunId: args['expected-run-id'],
    expectedRunAttempt: args['expected-run-attempt'],
    expectedRepository: args['expected-repository'] || DEFAULT_REPOSITORY,
    expectedWorkflowPath: args['expected-workflow-path'] || DEFAULT_WORKFLOW_PATH,
    verifiedAt: args['verified-at'] || new Date().toISOString(),
    verifierId: args['verifier-id'] || null,
  });
  const text = JSON.stringify(output, null, 2) + '\n';
  if (args.out) fs.writeFileSync(path.resolve(String(args.out)), text, 'utf8');
  process.stdout.write(JSON.stringify(output) + '\n');
}

if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser-fabric.provenance-verification-error.v1',
      code: String(error?.message || error).split(':')[0],
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export {
  BUILD_TYPE,
  DEFAULT_REPOSITORY,
  DEFAULT_WORKFLOW_PATH,
  EVIDENCE_SCHEMA,
  PREDICATE_TYPE,
};
