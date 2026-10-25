import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {createNativeCodingGitCommitter} from './native-coding-git-commit.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalSha256 as digest} from './native-coding-task-context.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
const execute=promisify(childProcess.execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const gitExecutable=process.env.METAENGINE_GIT_TEST_EXECUTABLE||(process.platform==='win32'?'C:/Program Files/Git/mingw64/bin/git.exe':'/usr/bin/git');
const gitDigest=hash(await fs.readFile(gitExecutable));
const exists=file=>fs.lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});

async function fixture(t,{attributes=null}={}){
  const parent=await fs.realpath(os.tmpdir()),temporary=await fs.mkdtemp(path.join(parent,'native-coding-commit-'));
  t.after(async()=>{
    const actual=await fs.realpath(temporary),relative=path.relative(parent,actual);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('native-coding-commit-'));
    await fs.rm(actual,{recursive:true,force:false});
  });
  const repo=path.join(temporary,'repository'),root=path.join(temporary,'worker'),journalRoot=path.join(temporary,'protected-journal');
  await fs.mkdir(repo);const env={SystemRoot:process.env.SystemRoot,PATH:path.dirname(gitExecutable),GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
  const git=async(args,{cwd=root,encoding='utf8'}={})=>(await execute(gitExecutable,['-c','core.fsmonitor=false','-C',cwd,...args],
    {env,encoding,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})).stdout;
  await git(['init','--quiet','--initial-branch=main'],{cwd:repo});
  for(const [key,value] of [['user.name','Generated fixture'],['user.email','fixture@example.invalid'],['core.autocrlf','false'],['core.filemode','false']])await git(['config',key,value],{cwd:repo});
  for(const [name,bytes] of [['edit.txt','before\n'],['delete.txt','delete\n'],['stable.txt','stable\n']])await fs.writeFile(path.join(repo,name),bytes);
  await git(['add','--all'],{cwd:repo});await git(['commit','--quiet','-m','Generated baseline'],{cwd:repo});
  await git(['worktree','add','--quiet','-b','reviewed-checkpoint',root],{cwd:repo});await git(['worktree','lock',root],{cwd:repo});
  await fs.writeFile(path.join(root,'edit.txt'),'staged-but-not-reviewed\n');await git(['add','--','edit.txt']);
  await fs.writeFile(path.join(root,'edit.txt'),'exact reviewed bytes\n');await fs.unlink(path.join(root,'delete.txt'));
  await fs.writeFile(path.join(root,'new.bin'),Buffer.from([0,255,3,10]));
  if(attributes!==null)await fs.writeFile(path.join(root,'.gitattributes'),attributes);
  const read=()=>readNativeCodingGitProof(root,{env,gitExecutable}),proof=await read();
  const gitDir=path.resolve((await git(['rev-parse','--absolute-git-dir'])).trim()),commonDir=path.resolve(root,(await git(['rev-parse','--git-common-dir'])).trim());
  const rootIdentity=await readDirectoryIdentity(root),query={project_id:randomUUID(),checkpoint_id:randomUUID()};
  const checkpoint={schema:'metaengine.native-coding.checkpoint.v1',trust_namespace:'LOCAL_OPERATOR_QA',project_id:query.project_id,
    checkpoint_id:query.checkpoint_id,workspace_id:randomUUID(),source_head:proof.head,root_identity_sha256:rootIdentity,
    git_artifact_sha256:proof.artifact_sha256,worktree:{path:root,root_identity_sha256:rootIdentity,base_sha:proof.head},
    verified_at:'2026-10-25T04:00:00.000Z',production_qualified:false,authority_effect:false,automatic_retry_allowed:false,successor_admitted:false};
  query.checkpoint_sha256=digest(checkpoint);
  const context={schema:'metaengine.native-coding.git-commit-context.v1',state:'CHECKPOINTED_PENDING_COMMIT',checkpoint,
    checkpoint_sha256:query.checkpoint_sha256,reviewed_git:proof,managed_worktree:{path:root,root_identity_sha256:rootIdentity,
      branch_ref:'refs/heads/reviewed-checkpoint',git_dir_identity_sha256:await readDirectoryIdentity(gitDir),
      common_dir_identity_sha256:await readDirectoryIdentity(commonDir)}};
  // These tests qualify real Git effects and aliases. Their small storage
  // adapter is not Windows ACL attestation; the production default uses the
  // existing native Owner-only DACL verifier, never a worker-provided adapter.
  const make=()=>createNativeCodingGitCommitter({gitExecutable,expectedGitExecutableSha256:gitDigest,journalRoot,
    readCheckpoint:async selectors=>{assert.deepEqual(selectors,query);return structuredClone(context);},
    protectStorage:async directory=>fs.chmod(directory,0o700),verifyStorage:async directory=>{
      assert.equal((await fs.lstat(directory)).isSymbolicLink(),false);
    }});
  return {temporary,repo,root,journalRoot,gitDir,commonDir,query,context,proof,git,read,make};
}

test('real locked Git worktree commits exact reviewed working bytes and leaves a clean writer base without hooks',async t=>{
  const f=await fixture(t),marker=path.join(f.temporary,'HOOK_EXECUTED');
  // Real own-PG jsonb returns these keys in a different order. The protected
  // artifact digest keeps the original producer encoding across that roundtrip.
  f.context.reviewed_git.changed_files=f.context.reviewed_git.changed_files.map(file=>
    ({bytes:file.bytes,path:file.path,sha256:file.sha256,status:file.status}));
  const hooks=path.join(f.commonDir,'hostile-hooks');await fs.mkdir(hooks);
  for(const name of ['pre-commit','post-commit','reference-transaction']){
    await fs.writeFile(path.join(hooks,name),`#!/bin/sh\necho forbidden > '${marker.replaceAll('\\','/')}'\nexit 91\n`,{mode:0o755});
  }
  await f.git(['config','core.hooksPath',hooks]);await f.git(['config','commit.gpgSign','true']);
  const result=await f.make().COMMIT_CHECKPOINT(f.query);
  assert.equal(result.state,'COMMITTED',JSON.stringify(result));assert.equal(result.authority_effect,false);assert.equal(result.successor_admitted,false);
  assert.equal(result.previous_head,f.proof.head);assert.notEqual(result.head,f.proof.head);assert.equal(result.index_clean,true);
  assert.equal((await f.read()).clean,true);assert.equal((await f.read()).head,result.head);
  assert.equal(await f.git(['show',result.head+':edit.txt']),'exact reviewed bytes\n');
  assert.deepEqual(await f.git(['cat-file','blob',result.head+':new.bin'],{encoding:'buffer'}),Buffer.from([0,255,3,10]));
  await assert.rejects(f.git(['cat-file','-e',result.head+':delete.txt']));
  assert.equal(await fs.readFile(path.join(f.root,'edit.txt'),'utf8'),'exact reviewed bytes\n');
  assert.equal(await exists(marker),false);assert.equal(await exists(path.join(f.gitDir,'index.lock')),false);
  assert.equal((await f.git(['rev-list','--count','HEAD'])).trim(),'2');
  await fs.writeFile(path.join(f.gitDir,'index.lock'),'foreign lock',{flag:'wx'});
  assert.equal((await f.make().READ_COMMIT(f.query)).state,'COMMITTED_INDEX_PENDING');
  assert.equal((await f.make().RECONCILE_COMMIT(f.query)).state,'READBACK_REQUIRED');
  assert.equal(await fs.readFile(path.join(f.gitDir,'index.lock'),'utf8'),'foreign lock');
});

test('lost update-ref ACK survives a fresh Host object and never dispatches a second commit/ref',async t=>{
  const f=await fixture(t),original=childProcess.spawn;let updates=0;
  childProcess.spawn=(executable,args,options)=>{
    const child=original(executable,args,options);
    if(args.includes('update-ref')){
      updates++;const once=child.once.bind(child);
      child.once=(event,fn)=>once(event,event==='close'?(code,signal)=>fn(code===0?73:code,signal):fn);
    }return child;
  };syncBuiltinESMExports();
  let attempt;
  try{attempt=await f.make().COMMIT_CHECKPOINT(f.query);}finally{childProcess.spawn=original;syncBuiltinESMExports();}
  assert.equal(attempt.state,'READBACK_REQUIRED');assert.equal(updates,1);
  const restarted=f.make(),readback=await restarted.READ_COMMIT(f.query);
  assert.equal(readback.state,'COMMITTED_INDEX_PENDING');
  assert.equal((await restarted.COMMIT_CHECKPOINT(f.query)).state,'COMMITTED_INDEX_PENDING');
  const receipt=await restarted.RECONCILE_COMMIT(f.query);assert.equal(receipt.state,'COMMITTED');
  assert.equal((await f.make().COMMIT_CHECKPOINT(f.query)).head,receipt.head);
  assert.equal((await f.read()).clean,true);assert.equal((await f.git(['rev-list','--count','HEAD'])).trim(),'2');
  assert.equal(await exists(path.join(f.gitDir,'index.lock')),false);
});

test('lost completion receipt after the ref and index change is reconciled without another ref effect',async t=>{
  const f=await fixture(t),original=fs.open;let blocked=false;
  fs.open=async(file,...args)=>{
    if(String(file).endsWith(path.sep+'completed.json')&&!blocked){blocked=true;throw Error('GENERATED_RECEIPT_FAILURE');}
    return original(file,...args);
  };
  let attempt;try{attempt=await f.make().COMMIT_CHECKPOINT(f.query);}finally{fs.open=original;}
  assert.equal(attempt.state,'READBACK_REQUIRED');assert.equal((await f.read()).clean,true);
  const fresh=f.make();assert.equal((await fresh.READ_COMMIT(f.query)).state,'COMMITTED_RECEIPT_PENDING');
  assert.equal((await fresh.RECONCILE_COMMIT(f.query)).state,'COMMITTED');
  assert.equal((await f.git(['rev-list','--count','HEAD'])).trim(),'2');
});

test('changed reviewed bytes, unlocked worktrees, forged paths and changed physical Git identity refuse dispatch',async t=>{
  for(const mutation of ['bytes','unlock','git-identity']){
    const f=await fixture(t);
    if(mutation==='bytes')await fs.writeFile(path.join(f.root,'edit.txt'),'unreviewed alteration\n');
    if(mutation==='unlock')await f.git(['worktree','unlock',f.root]);
    if(mutation==='git-identity')f.context.managed_worktree.git_dir_identity_sha256='f'.repeat(64);
    await assert.rejects(f.make().COMMIT_CHECKPOINT(f.query),/native_coding_git_commit_/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.proof.head);assert.equal(await exists(path.join(f.gitDir,'index.lock')),false);
  }
  const f=await fixture(t);
  await assert.rejects(f.make().COMMIT_CHECKPOINT({...f.query,worktree_path:f.root}),/selectors_invalid/);
  f.context.checkpoint.goal_sha256='e'.repeat(64);
  await assert.rejects(f.make().COMMIT_CHECKPOINT(f.query),/checkpoint_binding_invalid/);
});

test('configured filters cannot execute and an active worker attribute filter is rejected before intent',async t=>{
  const f=await fixture(t,{attributes:'* filter=hostile\n'}),marker=path.join(f.temporary,'FILTER_EXECUTED');
  const filter=path.join(f.temporary,'filter.cjs');await fs.writeFile(filter,"require('fs').writeFileSync(process.argv[2],'forbidden');process.stdin.pipe(process.stdout);");
  await f.git(['config','filter.hostile.clean',`"${process.execPath}" "${filter}" "${marker}"`]);
  await f.git(['config','filter.hostile.required','true']);
  await assert.rejects(f.make().COMMIT_CHECKPOINT(f.query),/active_filter_forbidden/);
  assert.equal(await exists(marker),false);assert.equal(await exists(path.join(f.gitDir,'index.lock')),false);
  assert.equal(await exists(path.join(f.journalRoot,f.query.checkpoint_sha256,'intent.json')),false);
});

test('a ref changed away after lost ACK remains ambiguous and is never automatically replayed',async t=>{
  const f=await fixture(t),original=childProcess.spawn;
  childProcess.spawn=(executable,args,options)=>{
    const child=original(executable,args,options);
    if(args.includes('update-ref')){const once=child.once.bind(child);child.once=(event,fn)=>once(event,event==='close'?(code,signal)=>fn(code===0?74:code,signal):fn);}
    return child;
  };syncBuiltinESMExports();
  try{assert.equal((await f.make().COMMIT_CHECKPOINT(f.query)).state,'READBACK_REQUIRED');}
  finally{childProcess.spawn=original;syncBuiltinESMExports();}
  const newHead=(await f.git(['rev-parse','HEAD'])).trim();assert.notEqual(newHead,f.proof.head);
  await f.git(['update-ref','refs/heads/reviewed-checkpoint',f.proof.head,newHead]);
  const fresh=f.make();assert.equal((await fresh.READ_COMMIT(f.query)).state,'AMBIGUOUS');
  assert.equal((await fresh.COMMIT_CHECKPOINT(f.query)).state,'AMBIGUOUS');
  assert.equal((await fresh.RECONCILE_COMMIT(f.query)).state,'AMBIGUOUS');
  assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.proof.head);
});
