import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readNativeCodingGitProof} from '../../src/native-coding-git-proof.mjs';
import {createNativeCodingProjectCommitObserver} from '../../src/native-coding-project-commits.mjs';
import {readDirectoryIdentity} from '../../../../infra/client-state-runtime/native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson} from '../../src/native-coding-task-context.mjs';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonicalHash=value=>hash(nativeCodingCanonicalJson(value));
export const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export async function writeNewJson(file,value){
  const handle=await fs.open(file,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
}
export const BROKEN_SOURCE='export function invoiceTotal(lines) { return lines.reduce((total, line) => total + line.unitCents, 0); }\n';
export const FIXED_SOURCE='export function invoiceTotal(lines) { return lines.reduce((total, line) => total + line.quantity * line.unitCents, 0); }\n';
const execute=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
const processFile=path.join(here,'project-continuation-process.mjs');
const criticFile=path.join(here,'project-continuation-critic.mjs');
const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
export const CONTINUATION_CONTRACT_FILES=Object.freeze([
  'apps/metaengine-browser/test/autonomous-project-host.test.mjs',
  'apps/metaengine-browser/test/autonomous-project-task-runtime.test.mjs',
  'apps/metaengine-browser/test/autonomous-project-continuation-contract.test.mjs',
  'apps/metaengine-browser/test/client-native-coding-goal.test.mjs',
  'infra/client-state-runtime/native-coding-checkpoint-verifier.test.mjs',
  'infra/client-state-runtime/native-coding-host-commit-service.test.mjs',
  'apps/metaengine-browser/test/native-coding-project-commits.test.mjs',
  'apps/metaengine-browser/test/rsi-verified-skill-dispatch.test.mjs',
]);

export function fixtureSnapshot(m){
  const task=m.lease;
  return {schema:'metaengine.devos.project-snapshot.v1',found:true,project_id:m.project_id,root_task_id:task.task_id,
    request_id:m.request_id,state:'ACTIVE',goal:m.objective,last_seq:1,total_tasks:1,tasks:[task],selected_task:task,
    immediate_children:[],proposals:[],policy:{},task_cursor:{after_seq:0,next_seq:1,has_more:false},authority_effect:false};
}
export function fixtureNativeResult(m,input){
  if(m.reject_before_dispatch)return {state:'REJECTED_BEFORE_DISPATCH',admission:null,rejection:{
    schema:'metaengine.native-coding.seed-rejection.v1',state:'REJECTED_BEFORE_DISPATCH',...input,
    profile_id:m.profile_id,profile_sha256:m.profile_sha256,
    body_sha256:hash(JSON.stringify({objective:input.objective,request_id:input.request_id})),
    admission_absent:true,semantic_fence_absent:true,automatic_retry_allowed:false,authority_effect:false},...flags};
  const receipt={schema:'metaengine.native-coding.goal-admission.v1',state:'ADMITTED',...input,
    profile_id:m.profile_id,profile_sha256:m.profile_sha256,workspace_id:m.workspace_id,project_id:m.project_id,
    root_task_id:m.lease.task_id,goal_id:m.goal_id,goal_sha256:m.goal_sha256,task_spec_sha256:m.task_spec_sha256,
    permit_ids:m.fixture_permit_ids,logical_policy:{max_depth:2,max_tasks:4,max_children:2},
    physical_execution_proven:false,global_actuation_granted:false,...flags};
  const body=JSON.stringify(input),canonical=JSON.stringify(receipt);
  return {state:'READBACK_ONLY',admission:{schema:'metaengine.native-coding.seed-readback.v1',profile_id:m.profile_id,
    request_id:input.request_id,body:input,canonical_body_text:body,body_sha256:hash(body),receipt,
    canonical_receipt:canonical,receipt_sha256:hash(canonical),readback_only:true,physical_effect_replayed:false,authority_effect:false},...flags};
}
function childEnvironment(directory){
  const env={PATH:process.env.PATH,TMPDIR:directory,TMP:directory,TEMP:directory,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',
    GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'};
  for(const key of ['SystemRoot','SYSTEMROOT','WINDIR'])if(process.env[key])env[key]=process.env[key];
  return env;
}
export async function resolveFixtureGit(){
  const explicit=process.env.METAENGINE_GIT_TEST_EXECUTABLE;
  const candidates=explicit?[explicit]:(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,process.platform==='win32'?'git.exe':'git'));
  for(const file of candidates){try{const real=await fs.realpath(file);if((await fs.stat(real)).isFile())return real;}catch{}}
  throw Error('continuation_acceptance_git_prerequisite_missing');
}
async function child(args,directory,expected=0){
  let result;
  try{result={...await execute(process.execPath,args,{cwd:directory,env:childEnvironment(directory),timeout:45000,maxBuffer:2*1024*1024}),code:0};}
  catch(error){if(!Number.isInteger(error.code))throw error;result={code:error.code,stdout:error.stdout||'',stderr:error.stderr||''};}
  assert.equal(result.code,expected,`child exit ${result.code}; stderr: ${result.stderr.slice(-4000)}`);
  return result;
}
const rows=async file=>(await fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})).trim().split('\n').filter(Boolean).map(JSON.parse);
async function runMode(mode,directory,expected=0){
  const value=await child([processFile,mode,directory],directory,expected);
  if(expected!==0)return {exit_code:value.code};
  assert.ok(value.stdout.trim(),'continuation child emitted no JSON; subprocess execution must be available');
  return JSON.parse(value.stdout);
}
async function critic(m,directory,expected=0,{taskId=m.critic_task_id}={}){
  const target=path.join(m.worktree,'invoice.mjs');
  const binding={request_id:m.request_id,goal_id:m.goal_id,goal_sha256:m.goal_sha256,project_id:m.project_id,
    workspace_id:m.workspace_id,task_id:taskId,role:'CRITIC',subject_task_id:m.lease.task_id,
    subject_run_id:m.writer_run_id,subject_artifact_sha256:hash(expected===1?BROKEN_SOURCE:FIXED_SOURCE)};
  const value=await child(['--permission',`--allow-fs-read=${criticFile}`,`--allow-fs-read=${m.worktree}`,
    criticFile,target,JSON.stringify(binding)],directory,expected);
  assert.ok(value.stdout.trim(),'critic emitted no JSON; subprocess execution and Node permission model must be available');
  const receipt=JSON.parse(value.stdout);assert.deepEqual(receipt.binding,binding);
  assert.equal(receipt.schema,'metaengine.continuation.fixture-critic.v1');assert.equal(receipt.evidence_class,'CONTROLLED_SOURCE_FIXTURE');
  assert.equal(receipt.write_denied,true);assert.equal(receipt.approved_capsule,false);assert.equal(receipt.evaluator_credit,false);
  assert.equal(receipt.authority_effect,false);
  assert.notEqual(receipt.run_id,m.writer_run_id);assert.equal(receipt.artifact_sha256,binding.subject_artifact_sha256);
  return receipt;
}
async function seedFixture(directory,gitExecutable,{reject=false}={}){
  await fs.mkdir(directory,{mode:0o700});
  const repository=path.join(directory,'repository'),worktree=path.join(directory,'writer');await fs.mkdir(repository);
  const env=childEnvironment(directory);
  const git=async(args,cwd=worktree)=>(await execute(gitExecutable,['-c','core.fsmonitor=false','-C',cwd,...args],
    {env,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024})).stdout.trim();
  await git(['init','--quiet','--initial-branch=fixture-base'],repository);
  for(const [key,value] of [['user.name','Generated continuation fixture'],['user.email','continuation@example.invalid'],
    ['core.autocrlf','false'],['core.filemode','false']])await git(['config',key,value],repository);
  await fs.writeFile(path.join(repository,'invoice.mjs'),BROKEN_SOURCE);
  await git(['add','invoice.mjs'],repository);await git(['-c','commit.gpgSign=false','commit','--quiet','-m','Generated invoice baseline'],repository);
  await git(['worktree','add','--quiet','-b','fixture-reviewed',worktree],repository);await git(['worktree','lock',worktree],repository);
  const task_id=randomUUID(),objective='Repair invoice total so integer unit prices are multiplied by quantity; independently check the result.';
  const m={schema:'metaengine.continuation.fixture-manifest.v1',evidence_class:'CONTROLLED_SOURCE_FIXTURE',
    request_id:randomUUID(),goal_id:randomUUID(),project_id:randomUUID(),workspace_id:randomUUID(),profile_id:randomUUID(),
    profile_sha256:hash('generated-profile-with-no-native-authority'),goal_sha256:hash(objective),
    task_spec_sha256:canonicalHash({objective}),fixture_permit_ids:[randomUUID(),randomUUID()],objective,
    lease:{task_id,root_task_id:task_id,parent_task_id:null,agent_id:'agent_continuation-writer',claim_id:1,lease_generation:1,
      depth:0,role:'IMPLEMENTER',claim_class:'MUTATING',state:'RUNNING'},
    writer_run_id:randomUUID(),critic_task_id:randomUUID(),successor_task_id:randomUUID(),worktree,
    reject_before_dispatch:reject,git_executable:gitExecutable,git_executable_sha256:hash(await fs.readFile(gitExecutable)),...flags};
  await writeNewJson(path.join(directory,'manifest.json'),m);
  return {m,git,env};
}

// This composes real source modules with controlled admission/SQL substitutes.
// The result may qualify source/fixture behavior only. No Host receipt below is
// registered in an installed runtime or treated as a capsule approval.
export async function runContinuationSourceFixture({directory,onCheck=async()=>{}}){
  const gitExecutable=await resolveFixtureGit(),completed=[];
  async function record(name,evidence){const row={name,status:'PASS',evidence};completed.push(row);await onCheck(row);}
  const useful=path.join(directory,'useful');
  const {m,git,env}=await seedFixture(useful,gitExecutable);
  const rejectedBefore=await critic(m,useful,1);assert.equal(rejectedBefore.accepted,false);
  await record('independent_critic_detects_original_defect',{pid:rejectedBefore.pid,checks:rejectedBefore.checks,
    artifact_sha256:rejectedBefore.artifact_sha256,write_denied:rejectedBefore.write_denied});
  const admitted=await runMode('goal',useful);assert.equal(admitted.goal_id,m.goal_id);
  const restoredGoal=await runMode('goal-restart',useful);assert.equal(restoredGoal.request_id,m.request_id);
  assert.deepEqual((await rows(path.join(useful,'goal-requests.jsonl'))).map(r=>r.operation),['SEED_GOAL','READ_SEED']);
  await record('goal_request_durable_restart_without_reseed',{request_id:m.request_id,goal_id:m.goal_id,
    initial_process:admitted.process_id,restarted_process:restoredGoal.process_id,seed_calls:1,fixture_admission_only:true});
  const writer=await runMode('worker',useful);assert.equal(writer.state,'NEW');
  const review=await critic(m,useful);assert.equal(review.accepted,true);assert.notEqual(review.pid,writer.process_id);
  assert.equal(review.subject_run_id,m.writer_run_id);assert.equal(review.artifact_sha256,writer.artifact_sha256);
  await writeNewJson(path.join(useful,'critic-result.json'),review);
  const writerRestart=await runMode('worker-restart',useful);assert.equal(writerRestart.state,'RESOLVED');
  assert.equal((await rows(path.join(useful,'worker-effects.jsonl'))).length,1);
  await record('useful_worker_and_independent_readonly_critic',{request_id:m.request_id,goal_id:m.goal_id,project_id:m.project_id,
    worker_task_id:m.lease.task_id,worker_run_id:m.writer_run_id,worker_pid:writer.process_id,
    critic_task_id:review.binding.task_id,critic_run_id:review.run_id,critic_pid:review.pid,critic_binding_sha256:canonicalHash(review.binding),
    artifact_sha256:review.artifact_sha256,checks:review.checks,write_denied:review.write_denied,worker_effects:1,
    approved_capsule:false,evaluator_credit:false});
  const turn=await runMode('turn',useful),turnRestart=await runMode('turn-restart',useful);
  assert.equal(turn.state,'DELIVERED');assert.equal(turnRestart.state,'ALREADY_DELIVERED');
  assert.equal(turn.checkpoint.state,'CONFIRMED');assert.deepEqual(turn.checkpoint,turnRestart.checkpoint);
  assert.equal((await rows(path.join(useful,'turn-effects.jsonl'))).length,1);
  await record('conversation_checkpoint_survives_process_restart',{checkpoint:turn.checkpoint,turn_effects:1,
    initial_process:turn.process_id,restarted_process:turnRestart.process_id});

  const proof=await readNativeCodingGitProof(m.worktree,{env,gitExecutable});
  const rootIdentity=await readDirectoryIdentity(m.worktree),gitDir=path.resolve(await git(['rev-parse','--absolute-git-dir'])),
    commonDir=path.resolve(m.worktree,await git(['rev-parse','--git-common-dir']));
  const checkpoint={schema:'metaengine.native-coding.checkpoint.v1',trust_namespace:'LOCAL_OPERATOR_QA',
    evidence_class:'CONTROLLED_SOURCE_FIXTURE',native_independent_proof:false,
    checkpoint_id:randomUUID(),workspace_id:m.workspace_id,project_id:m.project_id,goal_id:m.goal_id,goal_sha256:m.goal_sha256,
    writer_task_id:m.lease.task_id,writer_lease_generation:1,writer_run_id:m.writer_run_id,
    critic_task_id:review.binding.task_id,critic_lease_generation:1,critic_run_id:review.run_id,
    result_sha256:writer.artifact_sha256,critic_receipt_sha256:canonicalHash(review),source_head:proof.head,
    root_identity_sha256:rootIdentity,git_artifact_sha256:proof.artifact_sha256,
    worktree:{path:m.worktree,root_identity_sha256:rootIdentity,base_sha:proof.head},verified_at:new Date().toISOString(),
    successor_admitted:false,...flags};
  const context={schema:'metaengine.native-coding.git-commit-context.v1',state:'CHECKPOINTED_PENDING_COMMIT',
    checkpoint,checkpoint_sha256:canonicalHash(checkpoint),reviewed_git:proof,
    managed_worktree:{path:m.worktree,root_identity_sha256:rootIdentity,branch_ref:'refs/heads/fixture-reviewed',
      git_dir_identity_sha256:await readDirectoryIdentity(gitDir),common_dir_identity_sha256:await readDirectoryIdentity(commonDir)}};
  await writeNewJson(path.join(useful,'checkpoint-context.json'),context);
  const committed=await runMode('commit',useful);assert.equal(committed.state,'COMMITTED');
  await writeNewJson(path.join(useful,'commit-result.json'),committed);
  const commitRestart=await runMode('commit-restart',useful);assert.deepEqual(commitRestart.receipt,committed.receipt);
  assert.equal(await git(['rev-list','--count','HEAD']),'2');assert.equal(await git(['status','--porcelain']),'');
  assert.equal((await rows(path.join(useful,'git-effects.jsonl'))).length,1);
  await record('host_git_commit_cas_and_restart_without_ref_replay',{checkpoint_id:checkpoint.checkpoint_id,
    checkpoint_sha256:context.checkpoint_sha256,head:committed.receipt.head,tree:committed.receipt.tree,
    ref_dispatches:1,total_commits:2,fixture_checkpoint_only:true,sql_finalization_proven:false});

  // This is a real gap boundary: completed Git alone does not authorize a
  // successor. The existing observer must retain readback/HOLD, never repeat CAS.
  let finishCalls=0;
  const selector={project_id:m.project_id,checkpoint_id:checkpoint.checkpoint_id,checkpoint_sha256:context.checkpoint_sha256,
    writer_task_id:m.lease.task_id,writer_lease_generation:1,critic_task_id:m.critic_task_id,critic_lease_generation:1};
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{
    readFinishCheckpoint:async()=>({schema:'metaengine.native-coding.host-commit-service.v1',project_id:m.project_id,
      checkpoint_id:checkpoint.checkpoint_id,checkpoint_sha256:context.checkpoint_sha256,state:'PENDING_COMMIT',
      git_readback:committed.receipt,successor_admitted:false,...flags}),
    finishCheckpoint:async()=>{finishCalls++;throw Error('MUST_NOT_DISPATCH');},
  }});
  observer.observe([selector]);await observer.drain();assert.equal(observer.snapshot().readback_required,1);
  assert.equal(observer.snapshot().successors_observed,0);assert.equal(finishCalls,0);observer.close();
  await record('git_complete_before_sql_intent_retains_hold',{state:'HOLD',successor_admitted:false,
    finish_checkpoint_dispatches:0,ref_dispatches:1,autonomous_reconciliation_proven:false});

  // Deliberately separate controlled queue fixture; it is NOT a native SQL
  // successor authorized by the above unfinished native transaction.
  const successor=await runMode('successor',useful),successorRestart=await runMode('successor-restart',useful);
  assert.equal(successor.state,'COMPLETED');assert.deepEqual(successor.receipt,successorRestart.receipt);
  assert.equal(successor.receipt.children[0].task_id,m.successor_task_id);
  assert.equal((await rows(path.join(useful,'spawn-requests.jsonl'))).length,1);
  const conflict=await runMode('successor-conflict',useful);assert.equal(conflict.state,'HOLD');
  assert.equal((await rows(path.join(useful,'spawn-requests.jsonl'))).length,1);
  const successorReview=await critic(m,useful,0,{taskId:successor.receipt.children[0].task_id});
  assert.equal(successorReview.artifact_sha256,review.artifact_sha256);assert.equal(successorReview.binding.task_id,m.successor_task_id);
  await writeNewJson(path.join(useful,'successor-critic-result.json'),successorReview);
  await record('controlled_successor_deduplication_conflict_and_readonly_continuation',{successor_task_id:m.successor_task_id,
    parent_task_id:m.lease.task_id,request_id:successor.receipt.request_id,queue_effects:1,duplicate_replayed:false,
    conflict_state:'HOLD',successor_run_id:successorReview.run_id,successor_binding_sha256:canonicalHash(successorReview.binding),
    artifact_sha256:successorReview.artifact_sha256,native_successor_proven:false});

  for(const [label,mode,exit,effects] of [['before_effect','worker-before-effect',73,0],['after_effect_before_receipt','worker-after-effect',74,1]]){
    const control=path.join(directory,label),{m:controlManifest}=await seedFixture(control,gitExecutable);
    await runMode(mode,control,exit);
    const beforeCount=(await rows(path.join(control,'worker-effects.jsonl'))).length;
    const beforeHash=hash(await fs.readFile(path.join(controlManifest.worktree,'invoice.mjs')));
    assert.equal(beforeCount,effects);assert.equal(beforeHash,hash(effects?FIXED_SOURCE:BROKEN_SOURCE));
    const restarted=await runMode('worker-restart',control);
    const afterCount=(await rows(path.join(control,'worker-effects.jsonl'))).length;
    const afterHash=hash(await fs.readFile(path.join(controlManifest.worktree,'invoice.mjs')));
    assert.equal(restarted.state,'HOLD');assert.equal(afterCount,beforeCount);assert.equal(afterHash,beforeHash);
    assert.equal(restarted.artifact_sha256,afterHash);
    await record(`process_crash_${label}_holds_without_replay`,{crash_exit_code:exit,state:restarted.state,
      effects_before_restart:beforeCount,effects_after_restart:afterCount,
      artifact_before_restart_sha256:beforeHash,artifact_after_restart_sha256:afterHash,automatic_retry_allowed:false});
  }
  const rejection=path.join(directory,'rejection');await seedFixture(rejection,gitExecutable,{reject:true});
  assert.equal((await runMode('goal',rejection)).state,'FAILED');assert.equal((await runMode('goal-restart',rejection)).state,'FAILED');
  assert.deepEqual((await rows(path.join(rejection,'goal-requests.jsonl'))).map(row=>row.operation),['SEED_GOAL']);
  assert.equal((await rows(path.join(rejection,'worker-effects.jsonl'))).length,0);
  await record('rejected_before_dispatch_is_terminal_after_restart',{seed_calls:1,read_seed_calls:0,worker_effects:0,state:'FAILED'});
  return {checks:completed,useful_result:{path:path.relative(directory,path.join(m.worktree,'invoice.mjs')).replaceAll('\\','/'),
    artifact_sha256:review.artifact_sha256,head:committed.receipt.head,checkpoint_sha256:context.checkpoint_sha256},
    bindings:{request_id:m.request_id,goal_id:m.goal_id,project_id:m.project_id,worker_task_id:m.lease.task_id,
      worker_run_id:m.writer_run_id,critic_task_id:m.critic_task_id,critic_run_id:review.run_id,
      checkpoint_id:checkpoint.checkpoint_id,fixture_successor_task_id:m.successor_task_id},
    native_end_to_end_proven:false,installed_physical_proven:false};
}

export async function runContinuationContractSuites({directory,repositoryRoot}){
  const files=CONTINUATION_CONTRACT_FILES;
  const git=await resolveFixtureGit();
  let result;
  try{result={...await execute(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','--test-concurrency=1',...files],
    {cwd:repositoryRoot,env:{...childEnvironment(directory),METAENGINE_GIT_TEST_EXECUTABLE:git},timeout:120000,maxBuffer:8*1024*1024}),code:0};}
  catch(error){if(!Number.isInteger(error.code))throw error;result={code:error.code,stdout:error.stdout||'',stderr:error.stderr||''};}
  const log=result.stdout+result.stderr;await fs.writeFile(path.join(directory,'contracts.tap'),log,{flag:'wx',mode:0o600});
  const count=label=>Number(new RegExp(`^# ${label} (\\d+)$`,'m').exec(result.stdout)?.[1]??NaN);
  const summary={files,exit_code:result.code,tests:count('tests'),pass:count('pass'),fail:count('fail'),
    skipped:count('skipped'),todo:count('todo'),cancelled:count('cancelled'),tap_sha256:hash(log)};
  assert.equal(result.code,0,`contract suites failed; inspect ${path.join(directory,'contracts.tap')}`);
  assert.ok(summary.pass>0);assert.equal(summary.fail,0);assert.equal(summary.skipped,0);assert.equal(summary.todo,0);
  assert.equal(summary.cancelled,0);assert.equal(summary.tests,summary.pass);
  return summary;
}
