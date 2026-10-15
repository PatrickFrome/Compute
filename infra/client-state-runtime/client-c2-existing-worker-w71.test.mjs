import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {sealStagingCheckpoint} from './client-serial-loop-staging-w48.mjs';
import {inspectStagingNextLease} from './client-serial-loop-staging-w56.mjs';
import {W71_EXISTING_ENTRYPOINTS,inspectW71GoalAdmission,
  probeW71ExistingC2,inspectW71LiveOnlyThroughW39
} from './client-c2-existing-worker-w71.mjs';

const DENIED = v => {
  assert.equal(v.state,'C2_CAPABILITY_BLOCKED');
  assert.equal(v.authority_effect,false);
  assert.equal(v.permission_to_claim,false);
  assert.equal(v.permission_to_edit,false);
  assert.equal(v.admission_authorized,false);
  assert.equal(v.live_completion_verified,false);
  assert.equal(v.promotion_authorized,false);
  assert.equal(v.automatic_retry_allowed,false);
};
const fields = Object.freeze({authority_effect:false,scheduler_authority:false,
  browser_authority:false,release_authority:false,automatic_retry_allowed:false});
const goal = (workspace_id,point_id,task_id) => ({
  schema:'metaengine.client-v1.goal-submit.v1',
  workspace_id,point_id,task_id,roadmap_id:'metaengine-client-v1',plan_generation:1,
  atomic_plan_and_admission:true,operator_initiated:true,
  task_payload_returned:false,scheduler_identity_returned:false,...fields,
  activation:{schema:'metaengine.meta-orchestrator.plan-state.v1',
    state:'ACTIVE',plan_generation:1,...fields},
  admission:{schema:'metaengine.meta-orchestrator.task-admission.v1',
    point_id,task_id,task_payload_returned:false,scheduler_identity_returned:false,
    ...fields},
});

test('W71 canonical RPC boundaries are actual existing paths, never a new dispatcher',()=>{
  assert.equal(W71_EXISTING_ENTRYPOINTS.admission,'public.client_v1_goal_submit_v1');
  assert.equal(W71_EXISTING_ENTRYPOINTS.claim,'public.devos_fleet_lease_v1');
  assert.equal(W71_EXISTING_ENTRYPOINTS.result,'public.devos_fleet_complete_v1');
  assert.match(W71_EXISTING_ENTRYPOINTS.critic_readback,/W39/);
});

test('W71 admits only shape observation: goal is not authentication, lease or edit authority',()=>{
  const workspace_id=randomUUID(),task_id=randomUUID(),point_id='client.c2.generated';
  const original=goal(workspace_id,point_id,task_id);
  const valid=inspectW71GoalAdmission({admission:original,workspace_id,point_id});
  assert.equal(valid.state,'ADMISSION_SHAPE_ONLY');
  assert.equal(valid.admission_authenticated,false);
  assert.equal(valid.effect_claim_proven,false);
  assert.equal(valid.independent_critic_proven,false);
  assert.equal(valid.permission_to_edit,false);
  for(const spoof of [
    {...original,task_id:randomUUID()},
    {...original,workspace_id:randomUUID()},
    {...original,plan_generation:2},
    {...original,authority_effect:true},
    {...original,automatic_retry_allowed:true},
    {...original,atomic_plan_and_admission:false},
    {...original,scheduler_identity_returned:true},
    {...original,admission:{...original.admission,task_payload_returned:true}},
    {...original,admission:{...original.admission,browser_authority:true}},
    {...original,activation:{...original.activation,state:'READY'}},
    {...original,verified:true,admission:null},
  ]) DENIED(inspectW71GoalAdmission({admission:spoof,workspace_id,point_id}));
  DENIED(inspectW71GoalAdmission({admission:original,workspace_id:'bad',point_id}));
  DENIED(inspectW71GoalAdmission({admission:original,workspace_id,point_id:'../escape'}));
});

test('W71 actual existing DevelopmentPlane worker rejects edit even with apparently valid goal/lease evidence', {
  timeout:45_000,
},async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'metaengine-w56-own-pg17-'));
  const dir=path.join(root,'unique-git');
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try{
    await mkdir(dir);
    const sourceFile=path.join(dir,'calc.mjs');
    await writeFile(sourceFile,'export const sum=(a,b)=>a-b;\n');
    git('init','-q');
    git('add','--','calc.mjs');
    git('-c','user.name=W71 Fixture','-c','user.email=w71@example.invalid',
      'commit','-qm','generated failing source task');
    const head=git('rev-parse','HEAD');
    const workspace_id=randomUUID(),point_id='client.c2.generated';
    const admitted=goal(workspace_id,point_id,randomUUID());
    const before=await readFile(sourceFile,'utf8');
    const check=await probeW71ExistingC2({
      sourceDir:dir,expected_source_sha:head,goal:admitted,
      workspace_id,point_id,owner_epoch:8,
    });
    DENIED(check);
    assert.equal(check.reason,'EXISTING_DEVELOPMENT_WORKER_READ_ONLY');
    assert.equal(check.evidence.worker_capability,'REPO_HEAD_READ');
    assert.equal(check.evidence.worker_head,head);
    assert.equal(check.evidence.submission,'UNTRUSTED_ADMISSION_SHAPE_ONLY');
    assert.equal(check.evidence.claim,'NOT_PERFORMED');
    assert.equal(check.evidence.W39,'OWNER_BOUND_INDEPENDENT_CRITIC_NOT_PROVEN');
    assert.equal(git('rev-parse','HEAD'),head);
    assert.equal(git('status','--porcelain'),'');
    assert.equal(await readFile(sourceFile,'utf8'),before,'no fixture edit attributed to actual worker');
    DENIED(await probeW71ExistingC2({sourceDir:dir,
      expected_source_sha:'f'.repeat(40),owner_epoch:8}));
    const stale=await probeW71ExistingC2({sourceDir:dir,
      expected_source_sha:head,owner_epoch:8,completedCheckpoint:{state:'STAGING_REVIEW_REQUIRED'}});
    DENIED(stale);assert.equal(stale.reason,'CHECKPOINT_OR_EPOCH_STALE');
    const noPredecessor=await probeW71ExistingC2({sourceDir:dir,
      expected_source_sha:head,owner_epoch:8,nextLease:{task_id:randomUUID()}});
    DENIED(noPredecessor);assert.equal(noPredecessor.reason,'PREDECESSOR_MISSING');
    const badAdmission=await probeW71ExistingC2({sourceDir:dir,
      expected_source_sha:head,owner_epoch:8,workspace_id,point_id,
      goal:{...admitted,admission:{...admitted.admission,task_id:randomUUID()}}});
    DENIED(badAdmission);assert.equal(badAdmission.reason,'ADMISSION_INVALID');
    const nonDisposable=await probeW71ExistingC2({
      sourceDir:root,expected_source_sha:head,owner_epoch:8});
    DENIED(nonDisposable);
    assert.equal(nonDisposable.reason,'NON_DISPOSABLE_SOURCE_PATH_FENCED');
    DENIED(await probeW71ExistingC2({sourceDir:dir,expected_source_sha:head,owner_epoch:0}));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('W71 W39 readback stays UNKNOWN without genuine Owner/critic regardless of staged source',async()=>{
  const actual=await inspectW71LiveOnlyThroughW39({
    task_id:randomUUID(),run_id:randomUUID(),owner_epoch:8,
    lease_generation:2,agent_id:'agent_implementer0001',
    source_sha:'a'.repeat(40),claimed_ready:true,verified:true,
  });
  DENIED(actual);
  assert.equal(actual.reason,'AUTHENTIC_OWNER_AND_INDEPENDENT_CRITIC_REQUIRED');
  assert.equal(actual.w39_state,'UNKNOWN');
});

test('W71 W30/W39 staging falsifies stop/lost ACK, duplicate edit, lease transfer, stale artifact+critic and epoch',()=>{
  const workspace_id=randomUUID(),task_id=randomUUID(),next_task_id=randomUUID();
  const lease={schema:'metaengine.client.serial-loop-staging-w48.v1',
    state:'STAGING_LEASE_OBSERVED',origin:'SYNTHETIC/STAGING',
    workspace_id,task_id,agent_id:'agent_implementer0001',
    lease_generation:3,owner_generation:8};
  const effect={effect_id:randomUUID(),operation:'FIXED_SANDBOX_SOURCE_EDIT',
    task_id,lease_generation:3,state:'ACKED',ack_durable:true};
  const artifact={origin:'SYNTHETIC/STAGING',file_sha256:'c'.repeat(64),
    manifest_sha256:'d'.repeat(64),source_head_sha:'b'.repeat(40)};
  const checkpoint=sealStagingCheckpoint({lease,effect,
    source:{repo_scope:'UNIQUE_TEMP_GIT',base_sha:'a'.repeat(40),head_sha:'b'.repeat(40)},
    tests:{before_exit_code:1,after_exit_code:0,build_exit_code:0,working_tree_clean:true},
    artifact,critic:{source:'INDEPENDENT_DISPOSABLE_PROCESS',
      agent_id:'agent_critic000001',verdict:'ACCEPT',
      artifact_sha256:artifact.manifest_sha256,source_head_sha:artifact.source_head_sha},
    ready_at_ms:Date.now()-10000,completed_at_ms:Date.now()-5000});
  assert.equal(checkpoint.state,'STAGING_REVIEW_REQUIRED');
  const pg={backend:'OWN_PG17_DISPOSABLE',origin:'SYNTHETIC/STAGING',
    task_id,lease_generation:3,effect_id:effect.effect_id,
    source_sha:checkpoint.source_sha,artifact_sha256:checkpoint.artifact_sha256,
    checkpoint_sha256:checkpoint.checkpoint_sha256};
  const nextLease={...lease,task_id:next_task_id,agent_id:'agent_implementer0002',
    lease_generation:4};
  const nextPg={backend:'OWN_PG17_DISPOSABLE',origin:'SYNTHETIC/STAGING',
    state:'LEASED_STAGING_ONLY',row_count:1,workspace_id,task_id:next_task_id,
    agent_id:nextLease.agent_id,lease_generation:4,owner_generation:8,
    event_seq:9,after_checkpoint_sha256:checkpoint.checkpoint_sha256};
  const check=(change={})=>inspectStagingNextLease({
    completedCheckpoint:checkpoint,completedPgReadback:pg,completedEffect:effect,
    nextLease,nextPgLeaseReadback:nextPg,...change});
  const stage=check();
  assert.equal(stage.state,'NEXT_LEASE_READBACK_STAGING_ONLY');
  assert.equal(stage.permission_to_edit,false);
  assert.equal(stage.permission_to_claim,false);
  assert.equal(stage.live_completion_verified,false);
  assert.equal(stage.authority_effect,false);
  for(const bad of [
    {completedEffect:{...effect,state:'AMBIGUOUS',ack_durable:false}},
    {completedEffect:{...effect,state:'STOPPED'}},
    {nextLease:{...nextLease,task_id}},
    {nextLease:{...nextLease,agent_id:'agent_other000001'}},
    {nextLease:{...nextLease,owner_generation:9}},
    {nextLease:{...nextLease,lease_generation:5}},
    {nextPgLeaseReadback:{...nextPg,row_count:2}},
    {nextPgLeaseReadback:{...nextPg,event_seq:0}},
    {nextPgLeaseReadback:{...nextPg,after_checkpoint_sha256:'e'.repeat(64)}},
    {completedCheckpoint:{...checkpoint,artifact_sha256:'e'.repeat(64)}},
    {completedCheckpoint:{...checkpoint,critic_digest:'e'.repeat(64)}},
    {completedCheckpoint:{...checkpoint,owner_generation:9}},
  ]){
    const result=check(bad);
    assert.equal(result.state,'UNKNOWN');
    assert.equal(result.permission_to_edit,false);
    assert.equal(result.permission_to_claim,false);
    assert.equal(result.automatic_retry_allowed,false);
    assert.equal(result.authority_effect,false);
  }
  // A caller's "verified" claim on a synthetically observed lease stays STAGING.
  const forged=check({nextLease:{...nextLease,verified:true,permission_to_edit:true}});
  assert.equal(forged.state,'NEXT_LEASE_READBACK_STAGING_ONLY');
  assert.equal(forged.permission_to_edit,false);
});
