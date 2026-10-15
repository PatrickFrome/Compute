import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
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
