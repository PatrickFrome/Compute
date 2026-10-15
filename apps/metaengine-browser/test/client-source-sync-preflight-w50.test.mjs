import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { readClientSourceSyncPreflightW50 as preflight, CLIENT_SOURCE_SYNC_W50_PARENT } from '../src/client-source-sync-preflight-w50.mjs';

const AT = Date.parse('2026-10-15T01:00:00.000Z');
const ISO = new Date(AT).toISOString();
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const W = '11111111-1111-4111-8111-111111111111';
const C = '33333333-3333-4333-8333-333333333333';
const T = '22222222-2222-4222-8222-222222222222';
const ROOT = path.resolve(os.tmpdir(), 'w50-generated-repo');
const WORKTREE = path.resolve(os.tmpdir(), 'w50-generated-repo', 'owned-worktree');
const REPO = 'PatrickFrome/Compute';
const branch = 'work/w50-example';
const nativeBinding = () => ({
  schema: 'metaengine.devos.workspace-binding.v1', state: 'READY',
  workspace_id: W, workspace_generation: 2, coordination_workspace_id: C,
  task_id: T, claim_id: 7, point_id: 'point-01', repo_id: REPO,
  repo_root: ROOT, managed_root: ROOT, worktree_path: WORKTREE, worktree_realpath: WORKTREE,
  base_sha: SHA, last_verified_head_sha: SHA, branch_name: branch,
  agent_id: 'agent_12345678', tab_id: 'tab_44444444-4444-4444-8444-444444444444',
  target_id: 'webcontents:9', agent_generation_epoch: 3, lease_generation: 4,
  lease_expires_at: new Date(AT + 360000).toISOString(), lease_current: true,
  updated_at: ISO, ambiguity_code: null, dirty_hold: false,
  automatic_retry_allowed: false, page_data_authority: false, authority_effect: false,
});
const snapshot = (b = nativeBinding()) => ({
  schema: 'metaengine.devos.workspace-binding-snapshot.v1', state: 'AVAILABLE',
  observed_at: ISO, coordination_workspace_id: C, bindings: [{
    ...b, lease_current: true,
  }],
  filesystem_paths_exposed: false, scheduler_authority: false,
  browser_actuation_authority: false, automatic_retry_allowed: false, authority_effect: false,
});
// The existing native observer forbids these private path fields in its
// transport. The test projection deliberately strips them, not the guard.
function safeSnapshot(b = nativeBinding()) {
  const raw = snapshot(b);
  raw.bindings[0].scheduler_authority = false;
  raw.bindings[0].browser_actuation_authority = false;
  for (const key of ['repo_root','worktree_path','worktree_realpath','managed_root']) delete raw.bindings[0][key];
  return raw;
}
function inventory(head = SHA, { detached = false, branchRef = branch, locked = true } = {}) {
  return 'worktree ' + WORKTREE + '\0HEAD ' + head + '\0'
    + (detached ? 'detached\0' : 'branch refs/heads/' + branchRef + '\0')
    + (locked ? 'locked W50-EXACT\0' : '') + '\0';
}
function fixture(custom = {}) {
  const b = custom.binding ?? nativeBinding();
  const calls = [];
  let inventoryCount = 0, statusCount = 0, bindCount = 0, snapshotCount = 0;
  const f = {
    now: () => AT,
    readTrustedBinding: async () => (++bindCount === 2 && custom.afterBinding) ? custom.afterBinding : b,
    readWorkspaceSnapshot: async () => (++snapshotCount === 2 && custom.afterSnapshot)
      ? custom.afterSnapshot : (custom.snapshot ?? safeSnapshot(b)),
    readGit: async plan => {
      calls.push({effect: plan.effect, argv: plan.argv, cwd: plan.cwd, shell: plan.shell});
      assert.equal(plan.shell, false);
      assert.equal(plan.executable, 'git');
      assert.equal(plan.authority_effect, false);
      if (plan.effect === 'WORKTREE_INVENTORY_READ') {
        inventoryCount++;
        return inventoryCount === 2 ? (custom.afterInventory ?? custom.inventory ?? inventory()) : (custom.inventory ?? inventory());
      }
      if (plan.effect === 'WORKTREE_STATUS_READ') {
        statusCount++;
        return statusCount === 2 ? (custom.afterStatus ?? custom.status ?? '') : (custom.status ?? '');
      }
      if (plan.effect === 'WORKTREE_UPSTREAM_READ') return custom.upstream ?? 'origin/' + branch + '\n';
      if (plan.effect === 'WORKTREE_ORIGIN_READ') return custom.origin ?? 'https://github.com/PatrickFrome/Compute.git\n';
      throw Error('unexpected effect');
    },
    readGitHubHead: async args => {
      calls.push({ github: args });
      if (custom.githubThrows) throw Error('PRIVATE_TOKEN_DO_NOT_SHOW');
      return Object.hasOwn(custom, 'github') ? custom.github : {
        repository: REPO, ref: 'refs/heads/' + branch, provider: 'GITHUB_REFS_API',
        cached: false, head_sha: SHA, observed_at: ISO,
      };
    },
  };
  return {f, calls};
}
async function check(custom = {}) {
  const {f, calls} = fixture(custom);
  return {result: await preflight(f), calls};
}
test('clean exact current source produces bounded digest witness, never installed/effect authority', async () => {
  const {result, calls} = await check();
  assert.equal(result.state, 'SYNCED_SOURCE');
  assert.equal(result.current_source_sha, SHA);
  assert.equal(result.parent_source_sha, CLIENT_SOURCE_SYNC_W50_PARENT);
  assert.match(result.witness_sha256, /^[a-f0-9]{64}$/);
  for (const k of ['installed_healthy','installed_active','authority_effect','promotion_authorized','owner_accepted','live_authority_proven','automatic_retry_allowed']) assert.equal(result[k], false);
  assert.equal(result.classification, 'SOURCE');
  assert.deepEqual(calls.filter(c => c.github).map(c => c.github),
    [{ repository: REPO, ref: 'refs/heads/' + branch }]);
  assert.deepEqual(calls.filter(c => c.effect).map(c => c.effect), [
    'WORKTREE_INVENTORY_READ','WORKTREE_STATUS_READ','WORKTREE_UPSTREAM_READ',
    'WORKTREE_ORIGIN_READ','WORKTREE_STATUS_READ','WORKTREE_INVENTORY_READ']);
  assert.ok(calls.filter(c => c.effect).every(c => c.cwd === ROOT || c.cwd === WORKTREE));
  assert.equal(result.witness_sha256, (await check()).result.witness_sha256);
  assert.equal(JSON.stringify(result).includes(WORKTREE), false);
});
test('Windows Git canonical path casing is not a different physical worktree', async () => {
  const upper = inventory().replace(WORKTREE, WORKTREE.toUpperCase());
  const { result } = await check({ inventory: upper });
  if (process.platform === 'win32') {
    assert.equal(result.state, 'SYNCED_SOURCE', result.reason);
  } else {
    assert.equal(result.state, 'UNSYNCED');
    assert.equal(result.reason, 'WORKTREE_MISSING_DETACHED_OR_UNLOCKED');
  }
});

test('never issue Git or GitHub reads without complete trusted native binding', async () => {
  const f = fixture().f;
  delete f.readTrustedBinding;
  assert.equal((await preflight(f)).reason, 'TRUSTED_READERS_UNBOUND');
  const row = await check({binding: {...nativeBinding(), repo_id: 'Other/Repo'}});
  assert.equal(row.result.reason, 'TRUSTED_WORKSPACE_UNBOUND');
  assert.equal(row.calls.length, 0);
});
const rejected = [
  ['dirty tracked or untracked worktree',{status:' M src/change.mjs\0'}, 'UNSYNCED','WORKTREE_DIRTY_TRACKED_OR_UNTRACKED'],
  ['new untracked source',{status:'?? src/new.mjs\0'}, 'UNSYNCED','WORKTREE_DIRTY_TRACKED_OR_UNTRACKED'],
  ['dirty after remote read',{afterStatus:'?? late-file.mjs\0'}, 'UNSYNCED','WORKTREE_DIRTY_DURING_READ'],
  ['detached HEAD',{inventory:inventory(SHA,{detached:true})}, 'UNSYNCED','WORKTREE_MISSING_DETACHED_OR_UNLOCKED'],
  ['unlocked worktree',{inventory:inventory(SHA,{locked:false})}, 'UNSYNCED','WORKTREE_MISSING_DETACHED_OR_UNLOCKED'],
  ['branch alias',{inventory:inventory(SHA,{branchRef:'work/alias'})}, 'UNSYNCED','LOCAL_HEAD_OR_BRANCH_DIVERGED'],
  ['remote moved, cached origin still matching',{github:{repository:REPO,ref:'refs/heads/'+branch,provider:'GITHUB_REFS_API',cached:false,head_sha:OTHER,observed_at:ISO}},'UNSYNCED','LOCAL_HEAD_OR_BRANCH_DIVERGED'],
  ['head moved during read',{afterInventory:inventory(OTHER)}, 'UNSYNCED','HEAD_MOVED_DURING_READ'],
  ['missing upstream',{upstream:''},'UNKNOWN','UPSTREAM_MISSING_OR_ALTERNATE'],
  ['upstream points at another branch',{upstream:'origin/main\n'},'UNKNOWN','UPSTREAM_MISSING_OR_ALTERNATE'],
  ['credential-bearing remote URL',{origin:'https://secret:password@github.com/PatrickFrome/Compute.git'},'UNKNOWN','REPOSITORY_ORIGIN_UNTRUSTED'],
  ['wrong repo origin',{origin:'https://github.com/attacker/Compute.git'},'UNKNOWN','REPOSITORY_ORIGIN_UNTRUSTED'],
  ['remote URL with token query',{origin:'https://github.com/PatrickFrome/Compute.git?access_token=abc'},'UNKNOWN','REPOSITORY_ORIGIN_UNTRUSTED'],
  ['GitHub current ref inaccessible',{githubThrows:true},'UNKNOWN','TRUSTED_SOURCE_READBACK_FAILED'],
  ['GitHub missing branch',{github:null},'UNKNOWN','GITHUB_CURRENT_HEAD_UNPROVEN'],
  ['cached GitHub observation',{github:{repository:REPO,ref:'refs/heads/'+branch,provider:'GITHUB_REFS_API',cached:true,head_sha:SHA,observed_at:ISO}},'UNKNOWN','GITHUB_CURRENT_HEAD_UNPROVEN'],
  ['stale GitHub read',{github:{repository:REPO,ref:'refs/heads/'+branch,provider:'GITHUB_REFS_API',cached:false,head_sha:SHA,observed_at:new Date(AT-180000).toISOString()}},'UNKNOWN','GITHUB_CURRENT_HEAD_UNPROVEN'],
  ['remote wrong ref',{github:{repository:REPO,ref:'refs/heads/main',provider:'GITHUB_REFS_API',cached:false,head_sha:SHA,observed_at:ISO}},'UNKNOWN','GITHUB_CURRENT_HEAD_UNPROVEN'],
  ['workspace changed generation',{afterBinding:{...nativeBinding(),workspace_generation:3}},'UNKNOWN','WORKSPACE_BINDING_CHANGED_DURING_READ'],
  ['workspace verified head stale',{binding:{...nativeBinding(), last_verified_head_sha:OTHER}},'UNSYNCED','WORKSPACE_VERIFIED_HEAD_STALE'],
  ['invalid observation timestamp',{snapshot:{...safeSnapshot(),observed_at:'2020-01-01T00:00:00Z'}},'UNKNOWN','WORKSPACE_OBSERVATION_UNBOUND'],
  ['forged page proof',{snapshot:{...safeSnapshot(),verified:true,bindings:[{...safeSnapshot().bindings[0],authority_effect:true}]}},'UNKNOWN','WORKSPACE_OBSERVATION_UNBOUND'],
  ['binding ambiguity',{snapshot:{...safeSnapshot(),bindings:[safeSnapshot().bindings[0],safeSnapshot().bindings[0]]}},'UNKNOWN','WORKSPACE_OBSERVATION_UNBOUND'],
];
for (const [title, input, expectedState, expectedReason] of rejected) test(title, async () => {
  const {result} = await check(input);
  assert.equal(result.state, expectedState);
  assert.equal(result.reason, expectedReason);
  assert.equal(result.witness_sha256, null);
  assert.equal(result.authority_effect, false);
  assert.equal(result.installed_active, false);
  assert.equal(result.installed_healthy, false);
});
test('failures do not leak credential-bearing native errors or arbitrary worktree paths', async () => {
  const {result} = await check({githubThrows:true, origin:'git@github.com:PatrickFrome/Compute.git'});
  assert.equal(result.state, 'UNKNOWN');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
  assert.ok(!JSON.stringify(result).includes(WORKTREE));
});
test('failed trusted observation forbids invoking GitHub', async () => {
  const {result,calls} = await check({snapshot:{...safeSnapshot(),observed_at:'1970-01-01T00:00:00Z'}});
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(calls.length, 0);
});

test('disposable actual Git worktree and current-ref adapter: clean, untracked, then moved source', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(path.join(tmpdir(), 'metaengine-w50-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repo = path.join(dir, 'repo');
  const work = path.join(dir, 'work');
  mkdirSync(repo);
  const git = (cwd, ...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Source Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(repo, 'README.md'), 'generated W50 fixture\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-qm', 'Generated source root');
  const sha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/PatrickFrome/Compute.git');
  git(repo, 'worktree', 'add', '--lock', '-b', branch, work, sha);
  git(repo, 'update-ref', 'refs/remotes/origin/' + branch, sha);
  git(work, 'branch', '--set-upstream-to', 'origin/' + branch);
  const binding = {
    ...nativeBinding(), repo_root: repo, managed_root: dir, worktree_path: work,
    worktree_realpath: work, base_sha: sha, last_verified_head_sha: sha,
  };
  const read = () => preflight({
    now: () => AT,
    readTrustedBinding: async () => binding,
    readWorkspaceSnapshot: async () => safeSnapshot(binding),
    readGit: async plan => {
      assert.equal(plan.shell, false);
      assert.equal(plan.executable, 'git');
      assert.ok(plan.cwd === repo || plan.cwd === work);
      return execFileSync('git', plan.argv, {
        cwd: plan.cwd, encoding: 'utf8', windowsHide: true,
        maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
    readGitHubHead: async ({repository, ref}) => {
      assert.equal(repository, REPO);
      assert.equal(ref, 'refs/heads/' + branch);
      return {repository, ref, provider:'GITHUB_REFS_API', cached:false,
        head_sha: sha, observed_at: ISO};
    },
  });
  const success = await read();
  assert.equal(success.state, 'SYNCED_SOURCE', `real git preflight: ${success.state}/${success.reason}`);
  assert.equal(success.current_source_sha, sha);
  writeFileSync(path.join(work, 'untracked-source.mjs'), 'export const x = 1;\n');
  assert.equal((await read()).reason, 'WORKTREE_DIRTY_TRACKED_OR_UNTRACKED');
  rmSync(path.join(work, 'untracked-source.mjs'));
  writeFileSync(path.join(work, 'README.md'), 'changed tracked bytes\n');
  git(work, 'add', 'README.md');
  git(work, 'commit', '-qm', 'moved fixture head');
  const moved = await read();
  assert.equal(moved.state, 'UNSYNCED');
  assert.equal(moved.reason, 'LOCAL_HEAD_OR_BRANCH_DIVERGED');
});
