// W50: source-only, read-only preflight. This module is not an IPC route,
// scheduler, owner attestor, executable runner, or GitHub HTTP client.
// Every reader must be injected by the existing trusted native Owner/source
// layer. In particular, never bind these readers to page/model/renderer JSON.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { normalizeWorkspaceBindingSnapshot } from './workspace-binding-observer.mjs';
import { planWorkspaceInventory, verifyWorkspaceInventory, parseWorktreePorcelainZ, samePhysicalWorkspacePath } from './workspace-git-hardening.mjs';

export const CLIENT_SOURCE_SYNC_W50_SCHEMA = 'metaengine.client.source-sync-w50.v1';
export const CLIENT_SOURCE_SYNC_W50_PARENT = '2e9018d14cfe55256ddc5a94693ff0a288b90318';
export const CLIENT_SOURCE_SYNC_W50_W39_INSPECTED = 'ee39b256e2b54f5dfddf4bff021977c0185fb744';
const REPO = 'PatrickFrome/Compute';
const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{3,200}$/;
const MAX_AGE_MS = 30_000;
const FLAGS = Object.freeze({
  classification: 'SOURCE', source_observation_only: true,
  installed_healthy: false, installed_active: false, live_authority_proven: false,
  owner_accepted: false, promotion_authorized: false, automatic_retry_allowed: false,
  scheduler_authority: false, browser_actuation_authority: false, authority_effect: false,
});
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fresh = (value, now) => validTime(value) && Date.parse(value) <= now + 2_000 && now - Date.parse(value) <= MAX_AGE_MS;
const hasSha = value => typeof value === 'string' && SHA.test(value);
const good = value => Number.isSafeInteger(value) && value > 0;
const cleanOutput = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 65536;
const same = (a, b) => String(a ?? '') === String(b ?? '');
const fail = (state, reason) => Object.freeze({
  schema: CLIENT_SOURCE_SYNC_W50_SCHEMA, state, reason, witness_sha256: null,
  repository: REPO, current_source_sha: null, ...FLAGS,
});
function planFixedGit(binding, kind) {
  const commands = {
    STATUS: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
    UPSTREAM: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    ORIGIN: ['remote', 'get-url', 'origin'],
  };
  if (!Object.hasOwn(commands, kind)) throw new Error('source_sync_git_kind_invalid');
  return Object.freeze({
    schema: 'metaengine.devos.workspace-git-plan.v1',
    effect: 'WORKTREE_' + kind + '_READ', executable: 'git',
    argv: Object.freeze(commands[kind]), cwd: binding.worktree_path,
    shell: false, workspace_id: binding.workspace_id,
    workspace_generation: binding.workspace_generation, task_id: binding.task_id,
    lease_generation: binding.lease_generation, automatic_retry_allowed: false, authority_effect: false,
  });
}
function remoteMatches(text) {
  if (!cleanOutput(text) || /[\r\n\0]/.test(text.trim())) return false;
  const value = text.trim();
  // Never echo remote URLs; credentials, ports, query parameters and alternate
  // hosts remain UNKNOWN even if a cached origin ref happens to match.
  if (value === 'git@github.com:PatrickFrome/Compute.git') return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'github.com'
      && !u.username && !u.password && !u.port && !u.search && !u.hash
      && (u.pathname === '/PatrickFrome/Compute.git' || u.pathname === '/PatrickFrome/Compute');
  } catch { return false; }
}
function actualSnapshot(raw, now) {
  if (!raw || !fresh(raw.observed_at, now) || raw.authority_effect !== false) return null;
  const input = raw.schema === 'metaengine.browser.workspace-binding-observer.v1'
    ? { ...raw, schema: 'metaengine.devos.workspace-binding-snapshot.v1' } : raw;
  return normalizeWorkspaceBindingSnapshot(input);
}
function boundRow(binding, raw, now) {
  const obs = actualSnapshot(raw, now);
  if (!obs || obs.state !== 'AVAILABLE' || obs.coordination_workspace_id !== binding.coordination_workspace_id) return null;
  const matches = obs.bindings.filter(v => v.workspace_id === binding.workspace_id);
  if (matches.length !== 1 || obs.bindings.some((v, i) => obs.bindings.findIndex(w => w.workspace_id === v.workspace_id) !== i)) return null;
  const row = matches[0];
  const keys = ['workspace_id', 'workspace_generation', 'coordination_workspace_id',
    'task_id', 'claim_id', 'lease_generation', 'agent_id', 'agent_generation_epoch',
    'repo_id', 'base_sha', 'branch_name', 'last_verified_head_sha'];
  if (keys.some(k => !same(row[k], binding[k]))) return null;
  if (row.state !== 'READY' || row.lease_current !== true || row.dirty_hold !== false
      || row.ambiguity_code != null || Date.parse(row.lease_expires_at) <= now
      || row.authority_effect !== false || row.automatic_retry_allowed !== false) return null;
  return row;
}
function trustedShape(binding) {
  if (binding?.schema !== 'metaengine.devos.workspace-binding.v1'
      || binding.state !== 'READY' || binding.authority_effect !== false
      || binding.automatic_retry_allowed !== false || binding.dirty_hold !== false
      || binding.ambiguity_code != null || binding.repo_id !== REPO
      || !BRANCH.test(binding.branch_name) || !hasSha(binding.base_sha)
      || !hasSha(binding.last_verified_head_sha)
      || !good(binding.workspace_generation) || !good(binding.claim_id)
      || !good(binding.lease_generation) || !good(binding.agent_generation_epoch)
      || !validTime(binding.lease_expires_at)) return false;
  if (typeof binding.repo_root !== 'string' || !path.isAbsolute(binding.repo_root)
      || typeof binding.managed_root !== 'string' || !path.isAbsolute(binding.managed_root)
      || typeof binding.worktree_path !== 'string' || !path.isAbsolute(binding.worktree_path)
      || typeof binding.worktree_realpath !== 'string'
      || !samePhysicalWorkspacePath(binding.worktree_realpath, binding.worktree_path)) return false;
  const relative = path.relative(binding.managed_root, binding.worktree_path);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep)
      || path.isAbsolute(relative)) return false;
  return true;
}
function sameTrusted(a, b) {
  return trustedShape(b) && ['workspace_id', 'workspace_generation', 'coordination_workspace_id',
    'task_id', 'claim_id', 'lease_generation', 'agent_id', 'agent_generation_epoch',
    'repo_id', 'repo_root', 'managed_root', 'worktree_path', 'worktree_realpath', 'base_sha',
    'branch_name', 'last_verified_head_sha', 'lease_expires_at', 'updated_at']
    .every(k => same(a[k], b[k]));
}
function inventoryHead(binding, stdout) {
  if (!cleanOutput(stdout)) return null;
  try {
    const records = parseWorktreePorcelainZ(stdout);
    const matches = records.filter(r => samePhysicalWorkspacePath(r.worktree, binding.worktree_path));
    if (matches.length !== 1 || matches[0].detached || matches[0].prunable || !matches[0].locked) return null;
    return SHA.test(String(matches[0].HEAD || '')) ? matches[0].HEAD : null;
  } catch { return null; }
}

/** Observational only. Arguments are trusted read-only service closures, not
 * caller-supplied git path/URL/endpoint or a page-provided verified flag. */
export async function readClientSourceSyncPreflightW50({
  readTrustedBinding, readWorkspaceSnapshot, readGit, readGitHubHead, now = Date.now,
} = {}) {
  if ([readTrustedBinding, readWorkspaceSnapshot, readGit, readGitHubHead, now]
    .some(fn => typeof fn !== 'function')) return fail('UNKNOWN', 'TRUSTED_READERS_UNBOUND');
  try {
    const binding = await readTrustedBinding();
    const start = now();
    if (!trustedShape(binding) || Date.parse(binding.lease_expires_at) <= start)
      return fail('UNKNOWN', 'TRUSTED_WORKSPACE_UNBOUND');
    const first = await readWorkspaceSnapshot();
    if (!boundRow(binding, first, start)) return fail('UNKNOWN', 'WORKSPACE_OBSERVATION_UNBOUND');
    const plan = planWorkspaceInventory(binding);
    const before = await readGit(plan);
    const headBefore = inventoryHead(binding, before);
    if (!headBefore) return fail('UNSYNCED', 'WORKTREE_MISSING_DETACHED_OR_UNLOCKED');
    const status1 = await readGit(planFixedGit(binding, 'STATUS'));
    if (!cleanOutput(status1)) return fail('UNKNOWN', 'GIT_STATUS_UNAVAILABLE');
    if (status1.length) return fail('UNSYNCED', 'WORKTREE_DIRTY_TRACKED_OR_UNTRACKED');
    let upstream;
    try { upstream = await readGit(planFixedGit(binding, 'UPSTREAM')); }
    catch { return fail('UNKNOWN', 'UPSTREAM_MISSING_OR_ALTERNATE'); }
    if (!cleanOutput(upstream) || upstream.trim() !== 'origin/' + binding.branch_name)
      return fail('UNKNOWN', 'UPSTREAM_MISSING_OR_ALTERNATE');
    let origin;
    try { origin = await readGit(planFixedGit(binding, 'ORIGIN')); }
    catch { return fail('UNKNOWN', 'REPOSITORY_ORIGIN_UNTRUSTED'); }
    if (!remoteMatches(origin)) return fail('UNKNOWN', 'REPOSITORY_ORIGIN_UNTRUSTED');
    // Source-of-truth read via fixed GitHub repository ref reader, not origin/*
    // refs and never a Git fetch. A positive cached observation is forbidden.
    const remote = await readGitHubHead({ repository: REPO, ref: 'refs/heads/' + binding.branch_name });
    if (!remote || remote.repository !== REPO || remote.ref !== 'refs/heads/' + binding.branch_name
        || remote.provider !== 'GITHUB_REFS_API' || remote.cached !== false
        || !hasSha(remote.head_sha) || !fresh(remote.observed_at, now()))
      return fail('UNKNOWN', 'GITHUB_CURRENT_HEAD_UNPROVEN');
    const status2 = await readGit(planFixedGit(binding, 'STATUS'));
    const after = await readGit(plan);
    const nextBinding = await readTrustedBinding();
    const nextSnapshot = await readWorkspaceSnapshot();
    const end = now();
    if (!sameTrusted(binding, nextBinding) || !boundRow(nextBinding, nextSnapshot, end))
      return fail('UNKNOWN', 'WORKSPACE_BINDING_CHANGED_DURING_READ');
    if (!cleanOutput(status2)) return fail('UNKNOWN', 'GIT_STATUS_UNAVAILABLE');
    if (status2.length) return fail('UNSYNCED', 'WORKTREE_DIRTY_DURING_READ');
    const headAfter = inventoryHead(binding, after);
    if (!headAfter || headBefore !== headAfter) return fail('UNSYNCED', 'HEAD_MOVED_DURING_READ');
    try {
      verifyWorkspaceInventory(binding, before, { expected_head_sha: remote.head_sha });
      verifyWorkspaceInventory(binding, after, { expected_head_sha: remote.head_sha });
    } catch { return fail('UNSYNCED', 'LOCAL_HEAD_OR_BRANCH_DIVERGED'); }
    if (binding.last_verified_head_sha !== remote.head_sha)
      return fail('UNSYNCED', 'WORKSPACE_VERIFIED_HEAD_STALE');
    const witness = Object.freeze({
      schema: CLIENT_SOURCE_SYNC_W50_SCHEMA, state: 'SYNCED_SOURCE',
      repository: REPO, branch_ref: 'refs/heads/' + binding.branch_name,
      current_source_sha: remote.head_sha,
      workspace_id: binding.workspace_id, workspace_generation: binding.workspace_generation,
      coordination_workspace_id: binding.coordination_workspace_id,
      task_id: binding.task_id, claim_id: binding.claim_id,
      lease_generation: binding.lease_generation,
      remote_observed_at: remote.observed_at, observed_at: new Date(end).toISOString(),
      parent_source_sha: CLIENT_SOURCE_SYNC_W50_PARENT,
      inspected_w39_sha: CLIENT_SOURCE_SYNC_W50_W39_INSPECTED,
      github_current_ref_not_cached: true, tracked_untracked_clean_twice: true,
      head_stable_across_readback: true, ...FLAGS,
    });
    return Object.freeze({ ...witness,
      witness_sha256: createHash('sha256').update(JSON.stringify(witness)).digest('hex'),
    });
  } catch {
    // Deliberately never reflect native Git errors, URLs, path names or tokens.
    return fail('UNKNOWN', 'TRUSTED_SOURCE_READBACK_FAILED');
  }
}
