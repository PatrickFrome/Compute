import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import childProcess,{execFile} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeCodingHostCommitService} from './native-coding-host-commit-service.mjs';
import {readNativeCodingGitCommitOperator,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE} from './native-coding-git-commit-operator.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitExecutable=process.env.METAENGINE_GIT_TEST_EXECUTABLE||(process.platform==='win32'?'C:/Program Files/Git/mingw64/bin/git.exe':'/usr/bin/git');

// Real disposable Git effects; SQL/native/ACL values are deliberately injected
// generated fixtures. This is NOT real-PG, Windows ACL or installed Host proof.
async function fixture(t,{ack='normal'}={}){
  const parent=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(parent,'native-host-commit-'));
  t.after(async()=>{const real=await fs.realpath(directory),relative=path.relative(parent,real);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(real).startsWith('native-host-commit-'));
    await fs.rm(real,{recursive:true,force:false});});
  const repository=path.join(directory,'repository'),root=path.join(directory,'writer'),stateDirectory=path.join(directory,'protected-state');
  await fs.mkdir(repository);await fs.mkdir(stateDirectory);
  const env={SystemRoot:process.env.SystemRoot,PATH:path.dirname(gitExecutable),GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'};
  const git=async(args,cwd=root)=>(await execute(gitExecutable,['-c','core.fsmonitor=false','-C',cwd,...args],{env,windowsHide:true,timeout:30000})).stdout.trim();
  await git(['init','--quiet','--initial-branch=main'],repository);
  for(const [key,value] of [['user.name','Generated test'],['user.email','qa@example.invalid'],['core.autocrlf','false']])await git(['config',key,value],repository);
  await fs.writeFile(path.join(repository,'review.txt'),'before\n');await git(['add','--all'],repository);await git(['commit','--quiet','-m','Baseline'],repository);
  await git(['worktree','add','--quiet','-b','reviewed-task',root],repository);await git(['worktree','lock',root],repository);
  await fs.writeFile(path.join(root,'review.txt'),'actual reviewed final bytes\n');
  const proof=await readNativeCodingGitProof(root,{env,gitExecutable}),identity=await readDirectoryIdentity(root);
  const gitDir=path.resolve(await git(['rev-parse','--absolute-git-dir'])),commonDir=path.resolve(root,await git(['rev-parse','--git-common-dir']));
  const project_id=randomUUID(),workspace_id=randomUUID(),checkpoint_id=randomUUID(),writer_task_id=randomUUID(),critic_task_id=randomUUID();
  const artifact={installed_exe_sha256:'1'.repeat(64),installed_asar_sha256:'2'.repeat(64),runtime_bundle_sha256:'3'.repeat(64),source_sha:'4'.repeat(40),cli_executable_sha256:'5'.repeat(64)};
  const postgres={system_identifier:'12345678901234567',data_directory_identity_sha256:'6'.repeat(64),postmaster:{pid:5001,created_at:'2026-10-25T00:00:00.000Z',process_incarnation_id:'generated-pg'}};
  const worktree={path:root,root_identity_sha256:identity,base_sha:proof.head};
  const p={schema:'metaengine.native-coding.operator-permit.v1',trust_namespace:'LOCAL_OPERATOR_QA',permit_id:randomUUID(),workspace_id,project_id,
    role:'IMPLEMENTER',goal_id:randomUUID(),goal_sha256:'7'.repeat(64),owner_epoch:1,user_sid:'generated-test-sid',worktree,artifact,postgres,
    revoked:false,expires_at:new Date(Date.now()+3600000).toISOString()};
  const cp={...structuredClone(p),permit_id:randomUUID(),role:'CRITIC'};
  function receipt(role,taskId,permit){return {schema:'metaengine.codex-cli.run-receipt.v1',state:'RESULT_READY',project_id,workspace_id,
    task_id:taskId,lease_generation:1,permit_id:permit.permit_id,role,run_id:randomUUID(),result_sha256:(role==='IMPLEMENTER'?'8':'9').repeat(64),git_after:proof};}
  const writer=receipt('IMPLEMENTER',writer_task_id,p),critic=receipt('CRITIC',critic_task_id,cp);
  const checkpoint={schema:'metaengine.native-coding.checkpoint.v1',trust_namespace:'LOCAL_OPERATOR_QA',checkpoint_id,project_id,workspace_id,
    goal_id:p.goal_id,goal_sha256:p.goal_sha256,owner_epoch:p.owner_epoch,writer_task_id,writer_lease_generation:1,critic_task_id,critic_lease_generation:1,
    writer_run_id:writer.run_id,critic_run_id:critic.run_id,writer_receipt_sha256:sha(writer),critic_receipt_sha256:sha(critic),result_sha256:writer.result_sha256,
    git_artifact_sha256:proof.artifact_sha256,source_head:proof.head,root_identity_sha256:identity,artifact,postgres,worktree,
    writer_execution_scope:{task_id:writer_task_id},critic_execution_scope:{task_id:critic_task_id},verified_at:new Date(Date.now()-1000).toISOString(),
    production_qualified:false,automatic_retry_allowed:false,successor_admitted:false,authority_effect:false};
  const query={project_id,checkpoint_sha256:sha(checkpoint)},record={...checkpoint,checkpoint,canonical_checkpoint:json(checkpoint),checkpoint_sha256:sha(checkpoint)};
  const registration=(r,permit)=>({task_id:r.task_id,lease_generation:1,permit_id:permit.permit_id,run_id:r.run_id,job_envelope:{generated:true},
    result_receipt:r,canonical_result_receipt:json(r),result_receipt_sha256:sha(r)});
  const bundle={checkpoint_record:record,writer_registration:registration(writer,p),critic_registration:registration(critic,cp),
    permit_record:{permit:p,revoked_at:null},critic_permit_record:{permit:cp,revoked_at:null},
    writer_execution:{task_id:writer_task_id,lease_generation:1,state:'CHECKPOINTED',checkpoint_sha256:query.checkpoint_sha256},
    critic_execution:{task_id:critic_task_id,lease_generation:1,state:'CHECKPOINTED',checkpoint_sha256:query.checkpoint_sha256},
    writer_task:{task_id:writer_task_id,lease_generation:1,state:'COMPLETED'},critic_task:{task_id:critic_task_id,lease_generation:1,state:'COMPLETED'},
    fence:{state:'CHECKPOINTED_PENDING_COMMIT',checkpoint_sha256:query.checkpoint_sha256,project_id,workspace_id,root_identity_sha256:identity,writer_task_id,writer_lease_generation:1},
    project:{project_id,workspace_id,state:'ACTIVE'},device_valid:true,root_idle:true};
  const operator={schema:'metaengine.native-coding.git-commit-operator.v1',registry_id:randomUUID(),generation:1,git_executable:path.resolve(gitExecutable),
    git_executable_sha256:hash(await fs.readFile(gitExecutable)),journal_root:path.join(directory,'protected-journal'),
    bindings:[{project_id,workspace_id,path:root,root_identity_sha256:identity,branch_ref:'refs/heads/reviewed-task',
      git_dir_identity_sha256:await readDirectoryIdentity(gitDir),common_dir_identity_sha256:await readDirectoryIdentity(commonDir)}],
    model_paths_allowed:false,production_qualified:false,authority_effect:false};
  // Keep executable path canonical without changing the imported test constant.
  operator.git_executable=path.resolve(gitExecutable);
  const operatorFile=path.join(stateDirectory,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE);
  await fs.writeFile(operatorFile,JSON.stringify(operator));
  const readProtectedJson=async file=>{const stat=await fs.lstat(file);assert.equal(stat.isFile(),true);assert.equal(stat.nlink,1);
    const bytes=await fs.readFile(file);return {value:JSON.parse(bytes),sha256:hash(bytes)};};
  let stored=null,finishCalls=0,role='state_owner',loseAck=ack==='lost';
  const sql={unsafe:async(text,values=[])=>{
    if(text.startsWith('select current_user'))return[{current_user:role,session_user:role}];
    if(text.startsWith('select to_jsonb(k) as checkpoint_record\n'))return[{checkpoint_record:structuredClone(record)}];
    if(text.startsWith('select to_jsonb(k) as checkpoint_record,'))return[structuredClone(bundle)];
    if(text.includes('native_coding_read_commit_v1'))return[{value:structuredClone(stored)}];
    if(text.includes('native_coding_commit_gate_v1'))return[{value:{schema:'metaengine.native-coding.commit-gate.v1',checkpoint_id,
      checkpoint_sha256:query.checkpoint_sha256,project_id,workspace_id,root_identity_sha256:identity,
      writer_permit_id:p.permit_id,critic_permit_id:cp.permit_id,admitted:true,authority_effect:false}}];
    if(text==='set local synchronous_commit=on')return[];
    if(text.includes('native_coding_finish_checkpoint_v1')){
      finishCalls++;if(ack==='never-dispatched')throw Error('GENERATED_UNKNOWN_BEFORE_EFFECT');
      const receipt=JSON.parse(values[1]);assert.equal(values[0],checkpoint_id);assert.equal(values[2],sha(receipt));
      stored={schema:'metaengine.native-coding.commit-checkpoint.v1',project_id,checkpoint_id,checkpoint_sha256:query.checkpoint_sha256,
        state:'COMMITTED_NO_SUCCESSOR',commit_receipt_sha256:sha(receipt),receipt,canonical_receipt:json(receipt),
        previous_head:receipt.previous_head,head:receipt.head,tree:receipt.tree,next_writer_permit_id:randomUUID(),next_critic_permit_id:randomUUID(),
        successor_task_id:null,successor_admitted:false,root_fence_released:true,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
      return[{value:structuredClone(stored)}];
    }throw Error('GENERATED_UNEXPECTED_QUERY');
  },begin:async(_isolation,operation)=>{await operation(sql);if(loseAck){loseAck=false;throw Error('GENERATED_ACK_LOST_AFTER_COMMIT');}}};
  const make=()=>createNativeCodingHostCommitService({sql,stateDirectory,
    readNativeScope:async(_permit,includeSandbox)=>{assert.equal(includeSandbox,false);return{artifact,postgres,user_sid:p.user_sid,
      host_process:{pid:9999,process_incarnation_id:'generated-current-host'},worktree:{...worktree,base_sha:await git(['rev-parse','HEAD'])}};},
    readProtectedReceipt:async()=>structuredClone(writer),readProtectedJson,
    readOperator:directory=>readNativeCodingGitCommitOperator(directory,{readProtectedJson}),
    protectStorage:async directory=>fs.chmod(directory,0o700),verifyStorage:async()=>({owner_dacl_verified:false})});
  return {directory,root,git,proof,checkpoint,query,record,bundle,operator,operatorFile,make,sql,get finishCalls(){return finishCalls;},
    get stored(){return stored;},setRole:value=>{role=value;}};
}

test('private Host service joins real Git reviewed checkpoint to canonical SQL receipt/readback with selector-only input',async t=>{
  const f=await fixture(t);
  // A protected writer's historical starting base may predate the reviewed
  // checkpoint head. The independent critic/checkpoint pins the current head;
  // a service must not replace it with the old writer permit's base.
  f.bundle.permit_record.permit.worktree={...f.bundle.permit_record.permit.worktree,base_sha:'a'.repeat(40)};
  const service=await f.make(),answer=await service.FINISH_CHECKPOINT(f.query);
  assert.equal(answer.state,'COMMITTED_NO_SUCCESSOR');assert.equal(answer.authority_effect,false);assert.equal(f.finishCalls,1);
  assert.equal(answer.commit.receipt.working_tree_preserved,true);assert.equal(answer.commit.receipt.index_clean,true);
  assert.equal(await fs.readFile(path.join(f.root,'review.txt'),'utf8'),'actual reviewed final bytes\n');
  assert.equal(await f.git(['status','--porcelain']),'');assert.equal(await f.git(['rev-list','--count','HEAD']),'2');
  const restarted=await f.make();assert.deepEqual(await restarted.READ_FINISH_CHECKPOINT(f.query),answer);
  assert.deepEqual(await restarted.FINISH_CHECKPOINT(f.query),answer);assert.equal(f.finishCalls,1);
  f.stored.canonical_receipt+=' ';
  await assert.rejects(restarted.READ_FINISH_CHECKPOINT(f.query),/sql_commit_record_unverified/);assert.equal(f.finishCalls,1);
});

test('SQL commit ACK loss is resolved by independent readback and never repeats the finalization effect',async t=>{
  const f=await fixture(t,{ack:'lost'}),service=await f.make();
  const answer=await service.FINISH_CHECKPOINT(f.query);assert.equal(answer.state,'COMMITTED_NO_SUCCESSOR');
  assert.equal((await (await f.make()).FINISH_CHECKPOINT(f.query)).commit.head,answer.commit.head);assert.equal(f.finishCalls,1);
});

test('Git ref ACK loss blocks SQL until exact physical readback, with no second ref dispatch',async t=>{
  const f=await fixture(t),service=await f.make(),original=childProcess.spawn;let refCalls=0;
  childProcess.spawn=(executable,args,options)=>{const child=original(executable,args,options);
    if(args.includes('update-ref')){refCalls++;const once=child.once.bind(child);
      child.once=(event,callback)=>once(event,event==='close'?(code,signal)=>callback(code===0?77:code,signal):callback);}
    return child;};syncBuiltinESMExports();
  try{assert.equal((await service.FINISH_CHECKPOINT(f.query)).state,'GIT_READBACK_REQUIRED');}
  finally{childProcess.spawn=original;syncBuiltinESMExports();}
  assert.equal(f.finishCalls,0);assert.equal(refCalls,1);
  assert.equal((await (await f.make()).FINISH_CHECKPOINT(f.query)).state,'COMMITTED_NO_SUCCESSOR');
  assert.equal(f.finishCalls,1);assert.equal(await f.git(['rev-list','--count','HEAD']),'2');
});

test('a durable SQL intent with no commit readback remains unknown across restart and does not retry',async t=>{
  const f=await fixture(t,{ack:'never-dispatched'}),service=await f.make();
  assert.equal((await service.FINISH_CHECKPOINT(f.query)).state,'SQL_FINALIZE_UNKNOWN');assert.equal(f.finishCalls,1);
  const restarted=await f.make();assert.equal((await restarted.FINISH_CHECKPOINT(f.query)).state,'SQL_FINALIZE_UNKNOWN');
  assert.equal((await restarted.READ_FINISH_CHECKPOINT(f.query)).state,'SQL_FINALIZE_UNKNOWN');assert.equal(f.finishCalls,1);
  assert.equal(await f.git(['rev-list','--count','HEAD']),'2');
});

test('caller paths/receipts, changed canonical checkpoint, revoked critic and active root claims refuse before Git',async t=>{
  const f=await fixture(t),service=await f.make();
  await assert.rejects(service.FINISH_CHECKPOINT({...f.query,path:f.root}),/selectors_invalid/);
  await assert.rejects(service.FINISH_CHECKPOINT({...f.query,receipt:{state:'COMMITTED'}}),/selectors_invalid/);
  f.record.canonical_checkpoint+=' ';
  await assert.rejects(service.FINISH_CHECKPOINT(f.query),/checkpoint_unverified/);f.record.canonical_checkpoint=json(f.checkpoint);
  f.bundle.critic_permit_record.revoked_at=new Date().toISOString();
  await assert.rejects(service.FINISH_CHECKPOINT(f.query),/critic_permit_unavailable/);f.bundle.critic_permit_record.revoked_at=null;
  f.bundle.root_idle=false;await assert.rejects(service.FINISH_CHECKPOINT(f.query),/pending_checkpoint_unavailable/);f.bundle.root_idle=true;
  assert.equal(await f.git(['rev-parse','HEAD']),f.proof.head);assert.equal(f.finishCalls,0);
  f.setRole('service_role');await assert.rejects(service.READ_FINISH_CHECKPOINT(f.query),/state_owner_required/);
});

test('protected operator generation/content changes cannot silently select another branch or repository',async t=>{
  const f=await fixture(t),service=await f.make();f.operator.bindings[0].branch_ref='refs/heads/other';
  await fs.writeFile(f.operatorFile,JSON.stringify(f.operator));
  await assert.rejects(service.FINISH_CHECKPOINT(f.query),/operator_changed/);
  assert.equal(await f.git(['rev-parse','HEAD']),f.proof.head);assert.equal(f.finishCalls,0);
});
