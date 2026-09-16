import crypto from 'node:crypto';

import candidateCapsule from './candidate-capsule.cjs';
import verificationSandbox from './verification-sandbox-plan.cjs';
import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_MUTATION_SURFACES } from './rsi-shadow-core.mjs';

const { createCandidateCapsule, verifyCandidateCapsule } = candidateCapsule;
const { createVerificationSandboxPlan, verifyVerificationSandboxPlan } = verificationSandbox;

export const RSI_ISOLATED_CANDIDATE_BUILD_PLAN_SCHEMA = 'metaengine.rsi.isolated-candidate-build-plan.v1';
export const RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA = 'metaengine.rsi.isolated-candidate-materialization.v1';
export const RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA = 'metaengine.rsi.isolated-candidate-handoff.v1';

const SOURCE_SNAPSHOT_SCHEMA = 'metaengine.devos.packaged-source-snapshot.v1';
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_BACKENDS = new Set(['CLOUDFLARE_SANDBOX', 'VERCEL_SANDBOX', 'FIRECRACKER', 'GVISOR', 'KATA']);
const CHANGE_TYPES = new Set(['CREATE', 'MODIFY', 'DELETE']);
const ALLOWED_MUTATION_ROOTS = Object.freeze([
  'apps/metaengine-browser/src/',
  'apps/metaengine-browser/ui/',
]);
const IMMUTABLE_EXACT_PATHS = new Set([
  'apps/metaengine-browser/src/browser-identity-signer-runtime.mjs',
  'apps/metaengine-browser/src/candidate-capsule.cjs',
  'apps/metaengine-browser/src/emergency-maintenance-trust-root.mjs',
  'apps/metaengine-browser/src/owner-safety-gate-registry.mjs',
  'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
  'apps/metaengine-browser/src/rsi-shadow-core.mjs',
  'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
  'apps/metaengine-browser/src/verification-sandbox-backend-binding.cjs',
  'apps/metaengine-browser/src/verification-sandbox-plan.cjs',
  'apps/metaengine-browser/src/verified-download-manager.mjs',
]);
const IMMUTABLE_PREFIXES = Object.freeze([
  '.git/',
  '.github/',
  'apps/metaengine-browser/build/',
  'apps/metaengine-browser/native/browser-guardian-scm/',
  'apps/metaengine-browser/supabase/',
  'apps/metaengine-browser/test/',
  'apps/metaengine-browser/src/browser-guardian-',
  'apps/metaengine-browser/src/developer-emergency-update-',
  'apps/metaengine-browser/src/native-supervisor-',
  'apps/metaengine-browser/src/self-update-',
  'apps/metaengine-browser/src/supervisor-',
]);
const MAX_MUTATED_FILES = 64;
const MAX_MUTATED_BYTES = 4 * 1024 * 1024;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function clip(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function exactSha(value, label) {
  const sha = String(value || '').toLowerCase();
  if (!SHA40_RE.test(sha)) throw new Error(`rsi_candidate_${label}_exact_sha_required`);
  return sha;
}

function exactDigest(value, label) {
  const digest = String(value || '').toLowerCase();
  if (!SHA256_RE.test(digest)) throw new Error(`rsi_candidate_${label}_digest_invalid`);
  return digest;
}

function normalizeRepository(value) {
  const repository = clip(value, 160);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('rsi_candidate_repository_invalid');
  return repository;
}

function normalizePath(value) {
  const raw = String(value || '');
  if (!raw || raw.length > 240 || raw.includes('\\') || raw.startsWith('/') || raw.includes('\0')) throw new Error('rsi_candidate_mutation_path_invalid');
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git')) throw new Error('rsi_candidate_mutation_path_invalid');
  if (!ALLOWED_MUTATION_ROOTS.some((root) => raw.startsWith(root))) throw new Error('rsi_candidate_mutation_root_forbidden');
  if (IMMUTABLE_EXACT_PATHS.has(raw) || IMMUTABLE_PREFIXES.some((prefix) => raw.startsWith(prefix))) throw new Error('rsi_candidate_immutable_path_forbidden');
  return raw;
}

function normalizeMutationManifest(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MUTATED_FILES) throw new Error('rsi_candidate_mutation_manifest_invalid');
  const seen = new Set();
  return value.map((entry) => {
    if (!plainObject(entry)) throw new Error('rsi_candidate_mutation_entry_invalid');
    const path = normalizePath(entry.path);
    if (seen.has(path)) throw new Error('rsi_candidate_mutation_path_duplicate');
    seen.add(path);
    const change = String(entry.change || '').toUpperCase();
    if (!CHANGE_TYPES.has(change)) throw new Error('rsi_candidate_mutation_change_invalid');
    return Object.freeze({ path, change });
  }).sort((a, b) => a.path.localeCompare(b.path) || a.change.localeCompare(b.change));
}

function normalizeComponents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MUTATED_FILES) throw new Error('rsi_candidate_components_invalid');
  const seen = new Set();
  return value.map((entry) => {
    if (!plainObject(entry)) throw new Error('rsi_candidate_component_invalid');
    const path = normalizePath(entry.path);
    if (seen.has(path)) throw new Error('rsi_candidate_component_duplicate');
    seen.add(path);
    const change = String(entry.change || '').toUpperCase();
    if (!CHANGE_TYPES.has(change)) throw new Error('rsi_candidate_component_change_invalid');
    return Object.freeze({ path, change, digest: exactDigest(entry.digest, 'component') });
  }).sort((a, b) => a.path.localeCompare(b.path) || a.change.localeCompare(b.change));
}

function assertZeroAuthority(value, label) {
  for (const flag of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[flag] !== false) throw new Error(`rsi_candidate_${label}_${flag}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_candidate_${label}_automatic_retry_invalid`);
}

function normalizeExperimentPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) throw new Error('rsi_candidate_experiment_plan_invalid');
  assertZeroAuthority(plan, 'experiment');
  if (plan.requires_existing_devos_scheduler !== true || plan.lease_created !== false || plan.agent_assigned !== false || plan.workspace_bound !== false || plan.command_created !== false) {
    throw new Error('rsi_candidate_experiment_prelease_contract_invalid');
  }
  const sourceSha = exactSha(plan.source_sha, 'parent');
  if (plan.task_spec?.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA || plan.task_spec?.rsi?.source_sha !== sourceSha || plan.task_spec?.rsi?.shadow_only !== true) {
    throw new Error('rsi_candidate_experiment_task_contract_invalid');
  }
  const mutationSurface = String(plan.task_spec.rsi.mutation_surface || '').toUpperCase();
  if (!RSI_MUTATION_SURFACES.includes(mutationSurface)) throw new Error('rsi_candidate_mutation_surface_invalid');
  const experimentId = clip(plan.experiment_id, 128);
  const targetBranch = clip(plan.target_branch, 240);
  if (!/^rsi_exp_[0-9a-f]{24}$/.test(experimentId) || !/^work\/rsi\/[a-z0-9-]{1,200}$/.test(targetBranch)) throw new Error('rsi_candidate_experiment_identity_invalid');
  return Object.freeze({ source_sha: sourceSha, mutation_surface: mutationSurface, experiment_id: experimentId, target_branch: targetBranch });
}

function normalizeSourceSnapshot(snapshot, expectedSha) {
  if (!plainObject(snapshot) || snapshot.schema !== SOURCE_SNAPSHOT_SCHEMA) throw new Error('rsi_candidate_source_snapshot_schema_invalid');
  const repository = normalizeRepository(snapshot.repository);
  const head = exactSha(snapshot.head, 'snapshot');
  if (head !== expectedSha) throw new Error('rsi_candidate_source_snapshot_head_mismatch');
  if (snapshot.bounded !== true || snapshot.arbitrary_path_copy !== false || snapshot.process_spawn_used !== false || snapshot.authority_effect !== false) {
    throw new Error('rsi_candidate_source_snapshot_policy_invalid');
  }
  if (!Array.isArray(snapshot.source_files) || snapshot.source_files.length < 1 || snapshot.source_files.length > 64) throw new Error('rsi_candidate_source_snapshot_files_invalid');
  const files = snapshot.source_files.map((entry) => {
    const raw = String(entry || '');
    if (!raw || raw.startsWith('/') || raw.includes('\\') || raw.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')) {
      throw new Error('rsi_candidate_source_snapshot_file_invalid');
    }
    return raw;
  });
  if (Number(snapshot.source_file_count) !== files.length) throw new Error('rsi_candidate_source_snapshot_count_mismatch');
  return Object.freeze({ repository, head, ref: snapshot.ref == null ? null : clip(snapshot.ref, 400), source_files: files });
}

function normalizeBackend(value) {
  if (value == null || String(value).trim() === '') return null;
  const backend = String(value).trim().toUpperCase();
  if (!SAFE_BACKENDS.has(backend)) throw new Error('rsi_candidate_backend_invalid');
  return backend;
}

function buildPlanCore({ experiment, source, sourceSnapshotDigest, mutations, sequence, previousCandidateId, requestedBackend }) {
  return {
    schema: RSI_ISOLATED_CANDIDATE_BUILD_PLAN_SCHEMA,
    version: 1,
    experiment_id: experiment.experiment_id,
    mutation_surface: experiment.mutation_surface,
    source: {
      repository: source.repository,
      parent_sha: experiment.source_sha,
      source_snapshot_digest: sourceSnapshotDigest,
    },
    target_branch: experiment.target_branch,
    sequence,
    previous_candidate_id: previousCandidateId,
    mutation_manifest: mutations,
    workspace_contract: {
      authority: 'EXISTING_DEVOS_ONLY',
      lease_required_before_materialization: true,
      workspace_binding_required: true,
      isolated_workspace_required: true,
      immutable_source_snapshot_required: true,
      host_repository_mount_allowed: false,
      linked_git_worktree_is_security_boundary: false,
      writable_layer_must_be_private: true,
    },
    materialization_contract: {
      candidate_sha_required: true,
      candidate_must_differ_from_parent: true,
      input_manifest_digest_required: true,
      output_manifest_digest_required: true,
      max_mutated_files: MAX_MUTATED_FILES,
      max_mutated_bytes: MAX_MUTATED_BYTES,
      arbitrary_command_field_allowed: false,
    },
    verification_contract: {
      evaluator_root_immutable: true,
      artifact_verification_root_immutable: true,
      one_attempt_effect_semantics_immutable: true,
      sandbox_prepare_required: true,
      network_deny_by_default_required: true,
      requested_backend: requestedBackend,
    },
    lease_created: false,
    workspace_created: false,
    materialization_executed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function prepareRsiIsolatedCandidateBuild({
  experiment_plan,
  source_snapshot,
  mutations,
  sequence = 1,
  previous_candidate_id = null,
  requested_backend = null,
} = {}) {
  const experiment = normalizeExperimentPlan(experiment_plan);
  const source = normalizeSourceSnapshot(source_snapshot, experiment.source_sha);
  const normalizedMutations = normalizeMutationManifest(mutations);
  const normalizedSequence = Number(sequence);
  if (!Number.isSafeInteger(normalizedSequence) || normalizedSequence < 1) throw new Error('rsi_candidate_sequence_invalid');
  const previousCandidateId = previous_candidate_id == null ? null : clip(previous_candidate_id, 96).toLowerCase();
  if (previousCandidateId != null && !/^candidate_sha256_[0-9a-f]{64}$/.test(previousCandidateId)) throw new Error('rsi_candidate_previous_id_invalid');
  const backend = normalizeBackend(requested_backend);
  const sourceSnapshotDigest = sha256(source_snapshot);
  const core = buildPlanCore({ experiment, source, sourceSnapshotDigest, mutations: normalizedMutations, sequence: normalizedSequence, previousCandidateId, requestedBackend: backend });
  const digest = sha256(core);
  return Object.freeze({ ...core, plan_id: `rsi_build_${digest.slice('sha256:'.length)}`, plan_digest: digest });
}

export function verifyRsiIsolatedCandidateBuildPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_ISOLATED_CANDIDATE_BUILD_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_candidate_build_plan_invalid');
  assertZeroAuthority(plan, 'build_plan');
  if (plan.lease_created !== false || plan.workspace_created !== false || plan.materialization_executed !== false) throw new Error('rsi_candidate_build_plan_state_invalid');
  const core = { ...structuredClone(plan) };
  delete core.plan_id;
  delete core.plan_digest;
  const digest = sha256(core);
  if (plan.plan_digest !== digest || plan.plan_id !== `rsi_build_${digest.slice('sha256:'.length)}`) throw new Error('rsi_candidate_build_plan_digest_mismatch');
  normalizeMutationManifest(plan.mutation_manifest);
  exactSha(plan.source?.parent_sha, 'parent');
  exactDigest(plan.source?.source_snapshot_digest, 'source_snapshot');
  if (plan.workspace_contract?.authority !== 'EXISTING_DEVOS_ONLY' || plan.workspace_contract?.host_repository_mount_allowed !== false || plan.workspace_contract?.linked_git_worktree_is_security_boundary !== false || plan.workspace_contract?.writable_layer_must_be_private !== true) {
    throw new Error('rsi_candidate_build_plan_workspace_contract_invalid');
  }
  if (plan.materialization_contract?.arbitrary_command_field_allowed !== false || plan.verification_contract?.network_deny_by_default_required !== true) throw new Error('rsi_candidate_build_plan_policy_invalid');
  return Object.freeze({ schema: 'metaengine.rsi.isolated-candidate-build-plan-verify.v1', ok: true, plan_id: plan.plan_id, plan_digest: plan.plan_digest, execution_authorized: false, promotion_authorized: false, authority_effect: false });
}

function normalizeWorkspaceReceipt(value) {
  if (!plainObject(value)) throw new Error('rsi_candidate_workspace_receipt_invalid');
  const workspaceId = clip(value.workspace_id, 160);
  if (!workspaceId || !/^[A-Za-z0-9_.:-]{3,160}$/.test(workspaceId)) throw new Error('rsi_candidate_workspace_id_invalid');
  if (value.isolated !== true || value.host_repository_mounted !== false || value.linked_git_worktree_exposed !== false || value.source_snapshot_read_only !== true || value.writable_layer_private !== true) {
    throw new Error('rsi_candidate_workspace_isolation_invalid');
  }
  return Object.freeze({
    workspace_id: workspaceId,
    isolated: true,
    host_repository_mounted: false,
    linked_git_worktree_exposed: false,
    source_snapshot_read_only: true,
    writable_layer_private: true,
  });
}

function normalizeMaterializationReceipt(receipt, plan) {
  if (!plainObject(receipt) || receipt.schema !== RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA) throw new Error('rsi_candidate_materialization_schema_invalid');
  assertZeroAuthority(receipt, 'materialization');
  if (receipt.plan_id !== plan.plan_id || receipt.plan_digest !== plan.plan_digest || receipt.experiment_id !== plan.experiment_id) throw new Error('rsi_candidate_materialization_plan_mismatch');
  const parentSha = exactSha(receipt.parent_sha, 'materialization_parent');
  const candidateSha = exactSha(receipt.candidate_sha, 'materialization_candidate');
  if (parentSha !== plan.source.parent_sha) throw new Error('rsi_candidate_materialization_parent_mismatch');
  if (candidateSha === parentSha) throw new Error('rsi_candidate_materialization_noop');
  if (receipt.target_branch !== plan.target_branch) throw new Error('rsi_candidate_materialization_branch_mismatch');
  const workspace = normalizeWorkspaceReceipt(receipt.workspace);
  const inputManifestDigest = exactDigest(receipt.input_manifest_digest, 'input_manifest');
  const outputManifestDigest = exactDigest(receipt.output_manifest_digest, 'output_manifest');
  if (inputManifestDigest !== plan.source.source_snapshot_digest) throw new Error('rsi_candidate_materialization_input_mismatch');
  const components = normalizeComponents(receipt.components);
  const expected = plan.mutation_manifest.map(({ path, change }) => `${path}\0${change}`).sort();
  const actual = components.map(({ path, change }) => `${path}\0${change}`).sort();
  if (expected.length !== actual.length || expected.some((entry, index) => entry !== actual[index])) throw new Error('rsi_candidate_materialization_components_mismatch');
  const materializedBytes = Number(receipt.materialized_bytes);
  if (!Number.isSafeInteger(materializedBytes) || materializedBytes < 0 || materializedBytes > plan.materialization_contract.max_mutated_bytes) throw new Error('rsi_candidate_materialization_bytes_invalid');
  if (Number(receipt.materialized_file_count) !== components.length) throw new Error('rsi_candidate_materialization_file_count_mismatch');
  return Object.freeze({
    schema: RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    experiment_id: plan.experiment_id,
    parent_sha: parentSha,
    candidate_sha: candidateSha,
    target_branch: plan.target_branch,
    workspace,
    input_manifest_digest: inputManifestDigest,
    output_manifest_digest: outputManifestDigest,
    components,
    materialized_file_count: components.length,
    materialized_bytes: materializedBytes,
    materialized_by: 'EXISTING_DEVOS_AUTHORITY',
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function finalizeRsiIsolatedCandidateBuild({ build_plan, materialization_receipt } = {}) {
  verifyRsiIsolatedCandidateBuildPlan(build_plan);
  const materialization = normalizeMaterializationReceipt(materialization_receipt, build_plan);
  const materializationDigest = sha256(materialization);
  const source = {
    repository: normalizeRepository(build_plan.source.repository),
    head: materialization.candidate_sha,
    ref: build_plan.target_branch,
  };
  const capsule = createCandidateCapsule({
    source_head: materialization.candidate_sha,
    sequence: build_plan.sequence,
    previous_candidate_id: build_plan.previous_candidate_id,
    intent: `RSI ${build_plan.mutation_surface} isolated candidate for ${build_plan.experiment_id}`,
    components: materialization.components,
    verification_plan: [
      { id: 'EXACT_SOURCE_IDENTITY', required: true },
      { id: 'WORKSPACE_ISOLATION', required: true },
      { id: 'SECURITY_REGRESSION', required: true },
      { id: 'CONTRACT_TESTS', required: true },
      { id: 'OBJECTIVE_COMPARISON', required: true },
    ],
    evidence: [
      { name: 'RSI_BUILD_PLAN', digest: build_plan.plan_digest },
      { name: 'SOURCE_SNAPSHOT', digest: build_plan.source.source_snapshot_digest },
      { name: 'MATERIALIZATION_RECEIPT', digest: materializationDigest },
      { name: 'OUTPUT_MANIFEST', digest: materialization.output_manifest_digest },
    ],
  }, source);
  const candidateVerification = verifyCandidateCapsule(capsule, source);
  const sandboxPlan = createVerificationSandboxPlan({
    capsule,
    candidate_verification: candidateVerification,
    requested_backend: build_plan.verification_contract.requested_backend,
  });
  const sandboxVerification = verifyVerificationSandboxPlan(sandboxPlan, capsule, candidateVerification);

  const handoffCore = {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: build_plan.experiment_id,
    mutation_surface: build_plan.mutation_surface,
    parent_sha: build_plan.source.parent_sha,
    candidate_sha: materialization.candidate_sha,
    target_branch: build_plan.target_branch,
    build_plan_id: build_plan.plan_id,
    build_plan_digest: build_plan.plan_digest,
    materialization_digest: materializationDigest,
    candidate_capsule: capsule,
    candidate_verification: candidateVerification,
    sandbox_plan: sandboxPlan,
    sandbox_plan_verification: sandboxVerification,
    shadow_archive_proposal: {
      candidate_id: capsule.candidate_id,
      parent_sha: build_plan.source.parent_sha,
      candidate_sha: materialization.candidate_sha,
      mutation_surface: build_plan.mutation_surface,
      hypothesis: `Evaluate isolated RSI experiment ${build_plan.experiment_id}`,
    },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const handoffDigest = sha256(handoffCore);
  return Object.freeze({ ...handoffCore, handoff_digest: handoffDigest });
}
