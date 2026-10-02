'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const BUILD_IDENTITY_SCHEMA = 'metaengine.browser.build-identity.v2';
const DEPENDENCY_RESOLUTION_SCHEMA = 'metaengine.browser.dependency-resolution.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGITS = /^[0-9]+$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256String(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requiredString(value, code) {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}

function requiredSha256(value, code) {
  const text = requiredString(value, code).toLowerCase();
  if (!SHA256.test(text)) throw new Error(code);
  return text;
}

function requiredPositiveInt(value, code) {
  const text = String(value ?? '').trim();
  if (!DIGITS.test(text)) throw new Error(code);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(code);
  return number;
}

function normalizeSourceHead(value) {
  const head = requiredString(value, 'build_identity_source_head_invalid').toLowerCase();
  if (!SHA40.test(head)) throw new Error('build_identity_source_head_invalid');
  return head;
}

function buildIdentityPayload(input = {}) {
  const repository = requiredString(input.repository, 'build_identity_repository_invalid');
  if (!repository.includes('/')) throw new Error('build_identity_repository_invalid');
  const repositoryId = requiredString(input.repository_id ?? input.repositoryId, 'build_identity_repository_id_invalid');
  if (!DIGITS.test(repositoryId)) throw new Error('build_identity_repository_id_invalid');
  const workflow = requiredString(input.workflow, 'build_identity_workflow_invalid');
  const packageVersion = requiredString(input.package_version ?? input.packageVersion, 'build_identity_package_version_invalid');
  const platform = requiredString(input.platform, 'build_identity_platform_invalid');
  const arch = requiredString(input.arch, 'build_identity_arch_invalid');
  const builderVersion = requiredString(
    input.electron_builder_version ?? input.electronBuilderVersion,
    'build_identity_builder_version_invalid',
  );
  const nodeVersion = requiredString(input.node_version ?? input.nodeVersion, 'build_identity_node_version_invalid');
  return Object.freeze({
    schema: BUILD_IDENTITY_SCHEMA,
    repository,
    repository_id: repositoryId,
    source_head: normalizeSourceHead(input.source_head ?? input.sourceHead),
    workflow,
    run_id: (() => {
      const runId = requiredString(input.run_id ?? input.runId, 'build_identity_run_id_invalid');
      if (!DIGITS.test(runId)) throw new Error('build_identity_run_id_invalid');
      return runId;
    })(),
    run_attempt: requiredPositiveInt(input.run_attempt ?? input.runAttempt, 'build_identity_run_attempt_invalid'),
    package_version: packageVersion,
    platform,
    arch,
    builder_config_sha256: requiredSha256(
      input.builder_config_sha256 ?? input.builderConfigSha256,
      'build_identity_builder_config_sha256_invalid',
    ),
    dependency_resolution_sha256: requiredSha256(
      input.dependency_resolution_sha256 ?? input.dependencyResolutionSha256,
      'build_identity_dependency_resolution_sha256_invalid',
    ),
    electron_builder_version: builderVersion,
    node_version: nodeVersion,
  });
}

function createBuildIdentity(input = {}) {
  const payload = buildIdentityPayload(input);
  const buildIdentitySha256 = sha256String(canonicalJson(payload));
  return Object.freeze({
    ...payload,
    build_identity_sha256: buildIdentitySha256,
    authority_effect: false,
  });
}

function validateBuildIdentity(value, expected = {}) {
  if (!value || value.schema !== BUILD_IDENTITY_SCHEMA) {
    throw new Error('build_identity_schema_invalid');
  }
  if (value.authority_effect !== false) throw new Error('build_identity_authority_invalid');
  const exact = createBuildIdentity(value);
  if (String(value.build_identity_sha256 || '').toLowerCase() !== exact.build_identity_sha256) {
    throw new Error('build_identity_digest_invalid');
  }
  const checks = {
    repository: expected.repository,
    repository_id: expected.repository_id ?? expected.repositoryId,
    source_head: expected.source_head ?? expected.sourceHead,
    workflow: expected.workflow,
    run_id: expected.run_id ?? expected.runId,
    run_attempt: expected.run_attempt ?? expected.runAttempt,
    package_version: expected.package_version ?? expected.packageVersion,
    platform: expected.platform,
    arch: expected.arch,
    builder_config_sha256: expected.builder_config_sha256 ?? expected.builderConfigSha256,
    dependency_resolution_sha256: expected.dependency_resolution_sha256 ?? expected.dependencyResolutionSha256,
    electron_builder_version: expected.electron_builder_version ?? expected.electronBuilderVersion,
    node_version: expected.node_version ?? expected.nodeVersion,
  };
  for (const [field, expectedValue] of Object.entries(checks)) {
    if (expectedValue === undefined || expectedValue === null) continue;
    const actual = field === 'run_attempt' ? Number(exact[field]) : String(exact[field]);
    const wanted = field === 'run_attempt' ? Number(expectedValue) : String(expectedValue);
    if (actual !== wanted) throw new Error(`build_identity_${field}_mismatch`);
  }
  return exact;
}

function validateDependencyTree(tree, expectedName = null) {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    throw new Error('dependency_resolution_tree_invalid');
  }
  const name = requiredString(tree.name, 'dependency_resolution_tree_name_invalid');
  const version = requiredString(tree.version, 'dependency_resolution_tree_version_invalid');
  if (expectedName !== null && name !== expectedName) {
    throw new Error('dependency_resolution_tree_key_mismatch');
  }
  if (!tree.dependencies || typeof tree.dependencies !== 'object' || Array.isArray(tree.dependencies)) {
    throw new Error('dependency_resolution_tree_dependencies_invalid');
  }
  let count = 0;
  for (const [childName, child] of Object.entries(tree.dependencies)) {
    count += 1 + validateDependencyTree(child, childName);
  }
  return Object.freeze({ name, version, count });
}

function dependencyPayloadFromProof(value) {
  if (!value || value.schema !== DEPENDENCY_RESOLUTION_SCHEMA) {
    throw new Error('dependency_resolution_schema_invalid');
  }
  if (value.authority_effect !== false) throw new Error('dependency_resolution_authority_invalid');
  if (!value.tree || typeof value.tree !== 'object' || Array.isArray(value.tree)) {
    throw new Error('dependency_resolution_tree_invalid');
  }
  const dependencyCount = Number(value.dependency_count);
  if (!Number.isSafeInteger(dependencyCount) || dependencyCount < 0) {
    throw new Error('dependency_resolution_count_invalid');
  }
  const rootName = requiredString(value.root_name, 'dependency_resolution_root_name_invalid');
  const rootVersion = requiredString(value.root_version, 'dependency_resolution_root_version_invalid');
  const tree = canonicalize(value.tree);
  const validatedTree = validateDependencyTree(tree);
  if (validatedTree.name !== rootName || validatedTree.version !== rootVersion) {
    throw new Error('dependency_resolution_root_tree_mismatch');
  }
  if (validatedTree.count !== dependencyCount) {
    throw new Error('dependency_resolution_count_mismatch');
  }
  return Object.freeze({
    schema: DEPENDENCY_RESOLUTION_SCHEMA,
    root_name: rootName,
    root_version: rootVersion,
    node_version: requiredString(value.node_version, 'dependency_resolution_node_version_invalid'),
    npm_version: requiredString(value.npm_version, 'dependency_resolution_npm_version_invalid'),
    dependency_count: dependencyCount,
    tree,
  });
}

function validateDependencyResolutionProof(value) {
  const payload = dependencyPayloadFromProof(value);
  const digest = sha256String(canonicalJson(payload));
  if (String(value.dependency_resolution_sha256 || '').toLowerCase() !== digest) {
    throw new Error('dependency_resolution_digest_invalid');
  }
  return Object.freeze({
    ...payload,
    dependency_resolution_sha256: digest,
    authority_effect: false,
  });
}

function loadDependencyResolutionProof(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('dependency_resolution_proof_unreadable');
  }
  return validateDependencyResolutionProof(parsed);
}

module.exports = Object.freeze({
  BUILD_IDENTITY_SCHEMA,
  DEPENDENCY_RESOLUTION_SCHEMA,
  canonicalize,
  canonicalJson,
  sha256String,
  sha256File,
  createBuildIdentity,
  validateBuildIdentity,
  validateDependencyResolutionProof,
  validateDependencyTree,
  loadDependencyResolutionProof,
});
