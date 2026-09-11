import path from 'node:path';
import { planWorkspaceMaterialization, planWorkspaceRetirement } from './workspace-manager.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function assertBinding(binding) {
  if (binding?.schema !== 'metaengine.devos.workspace-binding.v1') throw new Error('workspace_git_binding_invalid');
  if (!binding.workspace_id || !binding.task_id || !binding.worktree_path || !binding.repo_root || !binding.branch_name) {
    throw new Error('workspace_git_binding_incomplete');
  }
}

function lockReason(binding) {
  return `METAENGINE:${binding.workspace_id}:task:${binding.task_id}:lease:${binding.lease_generation}`;
}

export function planLockedWorkspaceMaterialization(binding, options = {}) {
  assertBinding(binding);
  const base = planWorkspaceMaterialization(binding, options);
  return Object.freeze({
    ...base,
    effect: 'WORKTREE_CREATE_LOCKED',
    argv: Object.freeze([
      'worktree', 'add', '--lock', '--reason', lockReason(binding),
      ...base.argv.slice(2),
    ]),
    lock_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function planWorkspaceInventory(binding) {
  assertBinding(binding);
  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-plan.v1',
    effect: 'WORKTREE_INVENTORY_READ',
    executable: 'git',
    argv: Object.freeze(['worktree', 'list', '--porcelain', '-z']),
    cwd: binding.repo_root,
    shell: false,
    workspace_id: binding.workspace_id,
    workspace_generation: binding.workspace_generation,
    task_id: binding.task_id,
    lease_generation: binding.lease_generation,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function parseWorktreePorcelainZ(stdout = '') {
  const records = [];
  let current = null;
  for (const token of String(stdout).split('\0')) {
    if (!token) {
      if (current) records.push(Object.freeze(current));
      current = null;
      continue;
    }
    const space = token.indexOf(' ');
    const label = space < 0 ? token : token.slice(0, space);
    const value = space < 0 ? true : token.slice(space + 1);
    if (label === 'worktree') {
      if (current) records.push(Object.freeze(current));
      current = { worktree: value };
      continue;
    }
    if (!current) throw new Error('workspace_git_porcelain_record_invalid');
    current[label] = value;
  }
  if (current) records.push(Object.freeze(current));
  return Object.freeze(records);
}

export function verifyWorkspaceInventory(binding, stdout, {
  expected_head_sha = binding?.initial_head_sha || binding?.base_sha,
  require_locked = true,
} = {}) {
  assertBinding(binding);
  const expectedHead = String(expected_head_sha || '').toLowerCase();
  if (!SHA_RE.test(expectedHead)) throw new Error('workspace_git_expected_head_invalid');
  const expectedPath = path.resolve(binding.worktree_path);
  const records = parseWorktreePorcelainZ(stdout);
  const matches = records.filter((record) => record.worktree && path.resolve(String(record.worktree)) === expectedPath);
  if (matches.length !== 1) throw new Error(matches.length ? 'workspace_git_inventory_path_ambiguous' : 'workspace_git_inventory_path_missing');
  const record = matches[0];
  if (record.prunable) throw new Error('workspace_git_inventory_prunable');
  if (record.detached) throw new Error('workspace_git_inventory_detached');
  if (String(record.HEAD || '').toLowerCase() !== expectedHead) throw new Error('workspace_git_inventory_head_mismatch');
  if (String(record.branch || '') !== `refs/heads/${binding.branch_name}`) throw new Error('workspace_git_inventory_branch_mismatch');
  if (require_locked && !record.locked) throw new Error('workspace_git_inventory_not_locked');
  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-inventory-proof.v1',
    workspace_id: binding.workspace_id,
    workspace_generation: binding.workspace_generation,
    task_id: binding.task_id,
    lease_generation: binding.lease_generation,
    worktree_path: expectedPath,
    head_sha: expectedHead,
    branch_ref: `refs/heads/${binding.branch_name}`,
    locked: Boolean(record.locked),
    prunable: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function planLockedWorkspaceRetirement(binding, guards = {}) {
  assertBinding(binding);
  const remove = planWorkspaceRetirement(binding, guards);
  const unlock = Object.freeze({
    schema: 'metaengine.devos.workspace-git-plan.v1',
    effect: 'WORKTREE_UNLOCK',
    executable: 'git',
    argv: Object.freeze(['worktree', 'unlock', binding.worktree_path]),
    cwd: binding.repo_root,
    shell: false,
    workspace_id: binding.workspace_id,
    workspace_generation: binding.workspace_generation,
    task_id: binding.task_id,
    lease_generation: binding.lease_generation,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-sequence.v1',
    effect: 'WORKTREE_UNLOCK_AND_REMOVE',
    steps: Object.freeze([unlock, remove]),
    same_executor_lease_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
