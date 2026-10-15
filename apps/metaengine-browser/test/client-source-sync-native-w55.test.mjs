import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClientSourceSyncNativeServiceW55, createFixedGithubRefReaderW55 } from '../src/client-source-sync-native-w55.mjs';
import { createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';
import { samePhysicalWorkspacePath } from '../src/workspace-git-hardening.mjs';

const NOW = Date.parse('2026-10-15T01:00:00.000Z');
const ISO = new Date(NOW).toISOString();
const REPO = 'PatrickFrome/Compute';
const BRANCH = 'work/w55-disposable';
const UUID_WORK = '11111111-1111-4111-8111-111111111111';
const UUID_TASK = '22222222-2222-4222-8222-222222222222';
const UUID_COORD = '33333333-3333-4333-8333-333333333333';
const AUTH = { state: 'CONNECTED', repository: REPO, authenticated: true,
  repository_access_verified: true, checked_at: ISO, authority_effect: false };
const credential = {token: 'synthetic_test_token_do_not_use_123456789', source: 'SECURE_STORAGE'};
const git = (cwd, ...argv) => execFileSync('git', argv,
  {cwd, encoding:'utf8', windowsHide:true, maxBuffer:65536, stdio:['ignore','pipe','pipe']}).trim();

function sourceBinding(repo, work, dir, sha) {
  return {schema:'metaengine.devos.workspace-binding.v1',state:'READY',
    workspace_id:UUID_WORK, workspace_generation:2, coordination_workspace_id:UUID_COORD,
    task_id:UUID_TASK, claim_id:7, repo_id:REPO, repo_root:repo, managed_root:dir,
    worktree_path:work, worktree_realpath:work, base_sha:sha, last_verified_head_sha:sha,
    branch_name:BRANCH, agent_id:'agent_12345678', tab_id:'tab_44444444-4444-4444-8444-444444444444',
    target_id:'webcontents:9', agent_generation_epoch:3, lease_generation:4,
    lease_expires_at:new Date(NOW + 360000).toISOString(), lease_current:true, updated_at:ISO,
    ambiguity_code:null, dirty_hold:false, automatic_retry_allowed:false, page_data_authority:false,
    authority_effect:false };
}
function snapshot(binding) {
  const row = {...binding, scheduler_authority:false, browser_actuation_authority:false};
  for (const key of ['repo_root','managed_root','worktree_path','worktree_realpath']) delete row[key];
  return {schema:'metaengine.browser.workspace-binding-observer.v1',state:'AVAILABLE',
    observed_at:ISO,coordination_workspace_id:UUID_COORD,bindings:[row],
    filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,
    automatic_retry_allowed:false,authority_effect:false};
}
function fakeGithub(head, overrides = {}) {
  const seen = [];
  const options = {
    now:()=>NOW, userDataPath:path.resolve(tmpdir()), safeStorage:{isEncryptionAvailable:()=>false},
    githubConnection: {snapshot:()=>AUTH,connect:async()=>({...AUTH, ...overrides.auth})},
    readCredential:async()=>Object.hasOwn(overrides,'credential') ? overrides.credential : credential,
    fetchImpl:async(url, opts) => {
      seen.push({url,opts});
      if (overrides.fetchThrows) throw Error('private token secret');
      return {ok:true,status:200,text:async()=>JSON.stringify(overrides.body ?? {
        ref:'refs/heads/'+BRANCH, object:{type:'commit',sha:head}})};
    },
  };
  return { options, seen };
}

test('fixed real GitHub refs client rejects arbitrary ref/URL and uses no cache or redirect', async () => {
  const {options,seen} = fakeGithub('a'.repeat(40));
  const read = createFixedGithubRefReaderW55(options);
  for (const ref of ['refs/heads/../../evil','refs/tags/evil','refs/heads/a%2Fb',
    'refs/heads/evil?token=abc','refs/heads/a.lock','refs/heads/x//y']) {
    assert.equal(await read({repository:REPO,ref}), null);
  }
  assert.equal(await read({repository:'Other/Repo',ref:'refs/heads/'+BRANCH}),null);
  assert.equal(seen.length,0);
  const got = await read({repository:REPO,ref:'refs/heads/'+BRANCH});
  assert.equal(got.provider,'GITHUB_REFS_API');
  assert.equal(got.cached,false);
  assert.equal(got.head_sha,'a'.repeat(40));
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'https://api.github.com/repos/PatrickFrome/Compute/git/ref/heads/work/w55-disposable');
  assert.equal(seen[0].opts.cache,'no-store');
  assert.equal(seen[0].opts.redirect,'error');
  assert.equal(seen[0].opts.method,'GET');
  assert.equal(seen[0].opts.headers.authorization,'Bearer '+credential.token);
  assert.equal(JSON.stringify(got).includes(credential.token),false);
});
test('GitHub stale auth, missing secret, mismatch, noncommit, network failure all remain UNKNOWN', async () => {
  const cases = [
    {auth:{checked_at:new Date(NOW-60000).toISOString()}},
    {auth:{repository:'Other/Repo'}},
    {auth:{state:'BLOCKED'}},
    {credential:null},
    {fetchThrows:true},
    {body:{ref:'refs/heads/'+BRANCH,object:{type:'tag',sha:'a'.repeat(40)}}},
    {body:{ref:'refs/heads/work/other',object:{type:'commit',sha:'a'.repeat(40)}}},
  ];
  for (const overrides of cases) {
    const {options}=fakeGithub('a'.repeat(40),overrides);
    assert.equal(await createFixedGithubRefReaderW55(options)({repository:REPO,ref:'refs/heads/'+BRANCH}),null);
  }
});
test('absent verified Owner and unavailable native managed provider cannot be bypassed by fixtures', async () => {
  const {options}=fakeGithub('a'.repeat(40));
  const s = createClientSourceSyncNativeServiceW55({...options,
    nativeSupervisorClient:{snapshot:()=>({workspace_bindings:{state:'AVAILABLE'}})},
    managedProjectHost:{readSourceSyncGit:async()=>({stdout:''})}});
  assert.equal((await s.read()).state,'UNKNOWN');
  assert.equal((await s.read()).reason,'TRUSTED_READERS_UNBOUND');
  const noNative = createClientSourceSyncNativeServiceW55({...options,
    readVerifiedOwnerBinding:async()=>({state:'READY'})});
  assert.equal((await noNative.read()).state,'UNKNOWN');
});
test('existing shell-free managed Git runner + native binding + current GitHub API: clean, dirty, moved remote', async t => {
  const dir=mkdtempSync(path.join(tmpdir(),'metaengine-w55-fixture-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const repo=path.join(dir,'repo'), work=path.join(dir,'work');
  mkdirSync(repo);
  git(repo,'init','-q');
  git(repo,'config','user.name','W55 Fixture');
  git(repo,'config','user.email','w55@example.invalid');
  writeFileSync(path.join(repo,'README.md'),'generated\n');
  git(repo,'add','README.md');git(repo,'commit','-qm','generated root');
  const sha=git(repo,'rev-parse','HEAD');
  git(repo,'remote','add','origin','https://github.com/PatrickFrome/Compute.git');
  const lock='METAENGINE:'+UUID_WORK+':task:'+UUID_TASK+':lease:4';
  git(repo,'worktree','add','--lock','--reason',lock,'-b',BRANCH,work,sha);
  git(repo,'update-ref','refs/remotes/origin/'+BRANCH,sha);
  git(work,'branch','--set-upstream-to','origin/'+BRANCH);
  const binding=sourceBinding(repo,work,dir,sha);
  const gitRunner=createShellFreeGitExecutor({timeoutMs:10000});
  let ownerReads=0, nativeReads=0, githubHead=sha;
  const {options,seen}=fakeGithub(sha);
  options.fetchImpl=async(url,opts)=>{
    seen.push({url,opts});
    return {ok:true,status:200,text:async()=>JSON.stringify({
      ref:'refs/heads/'+BRANCH,object:{type:'commit',sha:githubHead}})};
  };
  const service=createClientSourceSyncNativeServiceW55({...options,
    readVerifiedOwnerBinding:async()=>{ownerReads++;return binding;},
    nativeSupervisorClient:{snapshot:()=>{nativeReads++;return {workspace_bindings:snapshot(binding)};}},
    managedProjectHost:{readSourceSyncGit:plan=>gitRunner.execute(plan)},
  });
  const clean=await service.read();
  assert.equal(clean.state,'SYNCED_SOURCE',clean.reason);
  assert.equal(clean.current_source_sha,sha);
  assert.match(clean.witness_sha256,/^[a-f0-9]{64}$/);
  assert.ok(ownerReads>=2 && nativeReads>=2 && seen.length===1);
  assert.equal(clean.installed_healthy,false);
  assert.equal(clean.authority_effect,false);
  writeFileSync(path.join(work,'untracked-new.mjs'),'export default 1;\n');
  assert.equal((await service.read()).reason,'WORKTREE_DIRTY_TRACKED_OR_UNTRACKED');
  rmSync(path.join(work,'untracked-new.mjs'));
  githubHead='b'.repeat(40);
  const changed=await service.read();
  assert.equal(changed.state,'UNSYNCED');
  assert.equal(changed.reason,'LOCAL_HEAD_OR_BRANCH_DIVERGED');
  githubHead=sha;
  git(work,'config','branch.'+BRANCH+'.merge','refs/heads/work/other');
  assert.equal((await service.read()).reason,'UPSTREAM_MISSING_OR_ALTERNATE');
});
test('managed Git runner denies injected argv and arbitrary command effects', async () => {
  const runner=createShellFreeGitExecutor();
  for (const argv of [['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none','--exec=sh'],
    ['-c','core.fsmonitor=/evil','status'],['fetch','origin'],['reset','--hard']]) {
    await assert.rejects(()=>runner.execute({schema:'metaengine.devos.workspace-git-plan.v1',
      effect:'WORKTREE_STATUS_READ',executable:'git',argv,cwd:path.resolve(tmpdir()),
      shell:false,workspace_id:UUID_WORK,task_id:UUID_TASK,lease_generation:4,
      automatic_retry_allowed:false,authority_effect:false}),/managed_project_git_plan_invalid/);
  }
});
test('Windows drive/path casing allowed without accepting different managed path', () => {
  const p=path.resolve(tmpdir(),'w55-generated');
  if (process.platform === 'win32') {
    assert.equal(samePhysicalWorkspacePath(p,p.toUpperCase()),true);
    assert.equal(samePhysicalWorkspacePath(p,p+'-other'),false);
  } else {
    assert.equal(samePhysicalWorkspacePath(p,p.toUpperCase()),false);
  }
});
