import crypto from 'node:crypto';
import path from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_RE = /^tab_[a-z0-9-]{8,80}$/;
const TARGET_RE = /^[a-z0-9][a-z0-9:._-]{2,159}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const REPO_ID_RE = /^[a-z0-9][a-z0-9:._/-]{2,159}$/i;
const BRANCH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{3,200}$/;

function nonEmpty(value, name, max = 240) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max) throw new Error(`workspace_${name}_invalid`);
  return out;
}

function positiveInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`workspace_${name}_invalid`);
  return out;
}

function uuid(value, name) {
  const out = nonEmpty(value, name, 64).toLowerCase();
  if (!UUID_RE.test(out)) throw new Error(`workspace_${name}_invalid`);
  return out;
}

function sha(value, name = 'base_sha') {
  const out = nonEmpty(value, name, 40).toLowerCase();
  if (!SHA_RE.test(out)) throw new Error(`workspace_${name}_invalid`);
  return out;
}

function resolveTrustedRoot(value, name) {
  const raw = nonEmpty(value, name, 4096);
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) throw new Error(`workspace_${name}_invalid`);
  return resolved;
}

function assertManagedChild(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('workspace_path_escape');
  }
}

function safePathToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizeMutationClaimBinding(input = {}) {
  const claimClass = nonEmpty(input.claim_class, 'claim_class', 32).toUpperCase();
  if (claimClass !== 'MUTATING') throw new Error('workspace_claim_class_not_mutating');

  const taskId = uuid(input.task_id, 'task_id');
  const coordinationWorkspaceId = uuid(input.coordination_workspace_id, 'coordination_workspace_id');
  const agentId = nonEmpty(input.agent_id, 'agent_id', 80).toLowerCase();
  const tabId = nonEmpty(input.tab_id, 'tab_id', 96).toLowerCase();
  const targetId = nonEmpty(input.target_id, 'target_id', 160).toLowerCase();
  const pointId = nonEmpty(input.point_id, 'point_id', 128).toLowerCase();
  const branchName = nonEmpty(input.branch_name, 'branch_name', 200);

  if (!AGENT_RE.test(agentId)) throw new Error('workspace_agent_id_invalid');
  if (!TAB_RE.test(tabId)) throw new Error('workspace_tab_id_invalid');
  if (!TARGET_RE.test(targetId)) throw new Error('workspace_target_id_invalid');
  if (!POINT_RE.test(pointId)) throw new Error('workspace_point_id_invalid');
  if (!BRANCH_RE.test(branchName)) throw new Error('workspace_branch_name_invalid');

  return Object.freeze({
    coordination_workspace_id: coordinationWorkspaceId,
    task_id: taskId,
    claim_id: positiveInt(input.claim_id, 'claim_id'),
    point_id: pointId,
    claim_class: claimClass,
    base_sha: sha(input.base_sha),
    branch_name: branchName,
    agent_id: agentId,
    tab_id: tabId,
    target_id: targetId,
    agent_generation_epoch: positiveInt(input.agent_generation_epoch, 'agent_generation_epoch'),
    lease_generation: positiveInt(input.lease_generation, 'lease_generation'),
    lease_expires_at: nonEmpty(input.lease_expires_at, 'lease_expires_at', 96),
  });
}

export function createWorkspaceReservation({
  claim,
  trusted_repo,
  workspace_root,
  workspace_id = crypto.randomUUID(),
  worktree_id = crypto.randomUUID(),
  workspace_generation = 1,
} = {}) {
  const binding = normalizeMutationClaimBinding(claim);
  const repoId = nonEmpty(trusted_repo?.repo_id, 'repo_id', 160);
  if (!REPO_ID_RE.test(repoId)) throw new Error('workspace_repo_id_invalid');
  const repoRoot = resolveTrustedRoot(trusted_repo?.repo_root, 'repo_root');
  const managedRoot = resolveTrustedRoot(workspace_root, 'managed_root');
  const normalizedWorkspaceId = uuid(workspace_id, 'workspace_id');
  const normalizedWorktreeId = uuid(worktree_id, 'worktree_id');
  const generation = positiveInt(workspace_generation, 'generation');

  const leaf = [safePathToken(binding.agent_id), safePathToken(binding.task_id), `l${binding.lease_generation}`].join('--');
  const worktreePath = path.resolve(managedRoot, leaf);
  assertManagedChild(managedRoot, worktreePath);

  return Object.freeze({
    schema: 'metaengine.devos.workspace-binding.v1',
    state: 'RESERVED',
    workspace_id: normalizedWorkspaceId,
    workspace_generation: generation,
    worktree_id: normalizedWorktreeId,
    coordination_workspace_id: binding.coordination_workspace_id,
    task_id: binding.task_id,
    claim_id: binding.claim_id,
    point_id: binding.point_id,
    claim_class: binding.claim_class,
    repo_id: repoId,
    repo_root: repoRoot,
    managed_root: managedRoot,
    worktree_path: worktreePath,
    base_sha: binding.base_sha,
    branch_name: binding.branch_name,
    agent_id: binding.agent_id,
    tab_id: binding.tab_id,
    target_id: binding.target_id,
    agent_generation_epoch: binding.agent_generation_epoch,
    lease_generation: binding.lease_generation,
    lease_expires_at: binding.lease_expires_at,
    ambiguity_code: null,
    dirty_hold: false,
    automatic_retry_allowed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}

export function planWorkspaceMaterialization(reservation, { branch_exists = false } = {}) {
  if (reservation?.schema !== 'metaengine.devos.workspace-binding.v1' || reservation.state !== 'RESERVED') {
    throw new Error('workspace_materialize_state_invalid');
  }
  if (branch_exists) throw new Error('workspace_branch_preexists_requires_rehydrate');
  assertManagedChild(reservation.managed_root, reservation.worktree_path);

  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-plan.v1',
    effect: 'WORKTREE_CREATE',
    executable: 'git',
    argv: Object.freeze([
      'worktree', 'add', '-b', reservation.branch_name,
      reservation.worktree_path, reservation.base_sha,
    ]),
    cwd: reservation.repo_root,
    shell: false,
    expected_initial_head_sha: reservation.base_sha,
    workspace_id: reservation.workspace_id,
    workspace_generation: reservation.workspace_generation,
    task_id: reservation.task_id,
    lease_generation: reservation.lease_generation,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function recordWorkspaceMaterializationReadback(reservation, readback = {}) {
  if (reservation?.schema !== 'metaengine.devos.workspace-binding.v1' || reservation.state !== 'RESERVED') {
    throw new Error('workspace_materialize_readback_state_invalid');
  }
  const effectState = nonEmpty(readback.effect_state, 'effect_state', 48).toUpperCase();

  if (effectState === 'NO_EFFECT') {
    return Object.freeze({ ...reservation, state: 'RESERVED', ambiguity_code: null, automatic_retry_allowed: false });
  }

  if (effectState !== 'PROVEN') {
    return Object.freeze({
      ...reservation,
      state: 'FROZEN',
      ambiguity_code: 'MATERIALIZATION_EFFECT_AMBIGUOUS',
      automatic_retry_allowed: false,
    });
  }

  const observedHead = sha(readback.initial_head_sha, 'initial_head_sha');
  if (observedHead !== reservation.base_sha) {
    return Object.freeze({
      ...reservation,
      state: 'FROZEN',
      ambiguity_code: 'INITIAL_HEAD_MISMATCH',
      observed_head_sha: observedHead,
      automatic_retry_allowed: false,
    });
  }

  const observedPath = path.resolve(nonEmpty(readback.worktree_realpath, 'worktree_realpath', 4096));
  if (observedPath !== path.resolve(reservation.worktree_path)) {
    return Object.freeze({
      ...reservation,
      state: 'FROZEN',
      ambiguity_code: 'WORKTREE_REALPATH_MISMATCH',
      observed_head_sha: observedHead,
      automatic_retry_allowed: false,
    });
  }
  assertManagedChild(reservation.managed_root, observedPath);

  return Object.freeze({
    ...reservation,
    state: 'READY',
    initial_head_sha: observedHead,
    last_verified_head_sha: observedHead,
    worktree_realpath: observedPath,
    ambiguity_code: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function freezeWorkspace(binding, ambiguityCode = 'EXPLICIT_FREEZE') {
  if (binding?.schema !== 'metaengine.devos.workspace-binding.v1') throw new Error('workspace_binding_invalid');
  if (binding.state === 'RETIRED') throw new Error('workspace_freeze_state_invalid');
  return Object.freeze({
    ...binding,
    state: 'FROZEN',
    ambiguity_code: nonEmpty(ambiguityCode, 'ambiguity_code', 96).toUpperCase(),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function planWorkspaceRetirement(binding, {
  durable_reference_count = 0,
  dirty = false,
  branch_ambiguous = false,
} = {}) {
  if (binding?.schema !== 'metaengine.devos.workspace-binding.v1' || binding.state !== 'READY') {
    throw new Error('workspace_retire_state_invalid');
  }
  if (!Number.isSafeInteger(Number(durable_reference_count)) || Number(durable_reference_count) < 0) {
    throw new Error('workspace_reference_count_invalid');
  }
  if (Number(durable_reference_count) > 0) throw new Error('workspace_cleanup_referenced');
  if (dirty || binding.dirty_hold) throw new Error('workspace_cleanup_dirty');
  if (branch_ambiguous || binding.ambiguity_code) throw new Error('workspace_cleanup_ambiguous');
  assertManagedChild(binding.managed_root, binding.worktree_path);

  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-plan.v1',
    effect: 'WORKTREE_REMOVE',
    executable: 'git',
    argv: Object.freeze(['worktree', 'remove', binding.worktree_path]),
    cwd: binding.repo_root,
    shell: false,
    delete_branch: false,
    workspace_id: binding.workspace_id,
    workspace_generation: binding.workspace_generation,
    task_id: binding.task_id,
    lease_generation: binding.lease_generation,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
