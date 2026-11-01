// Generated authority/ledger fixtures. No claim of PG or Windows qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {prepareNativeRepository} from './native-coding-repository-preparation.mjs';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {planNativeRepositoryPreparation,assertNativeRepositoryPreparationGitPlan} from '../../apps/metaengine-browser/src/native-coding-repository-preparation-plan.mjs';
function fixture(){
 const workspace_id=randomUUID(),operation_id=randomUUID(),host_instance_id=randomUUID(),custody_id=randomUUID();
 const actor={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),admin_grant_epoch:1};
 const repository={coordination_workspace_id:workspace_id,device_id:actor.device_id,client_id:actor.client_id,admin_grant_epoch:1,repo_id:'fixture:repo',repo_root:path.join(os.tmpdir(),'preparation-repo'),managed_root:path.join(os.tmpdir(),'preparation-managed')};
 const source={head:'b'.repeat(40),artifact_sha256:'c'.repeat(64)},choices={worktree:'CREATE_LOCKED_OPERATION_WORKTREE',branch:'CREATE_OPERATION_BRANCH'};
 const input={operation_id,workspace_id,repository_scope_sha256:sha(repository),repo_root_identity_sha256:'d'.repeat(64),managed_root_identity_sha256:'e'.repeat(64),preparation:{schema:'metaengine.native-coding.repository-preparation.v1',source,choices}};
 const signedAt=new Date().toISOString();
 const request={schema:'metaengine.native-coding.repository-preparation-binding.v1',operation_id,custody_id,workspace_id,actor,repository,
  repository_scope_sha256:input.repository_scope_sha256,repo_root_identity_sha256:input.repo_root_identity_sha256,managed_root_identity_sha256:input.managed_root_identity_sha256,source,choices,
  original_request:{schema:'metaengine.native-coding.setup-original-request.v1',action:'BEGIN_NATIVE_SETUP_V1',requestId:randomUUID(),requestDigest:'f'.repeat(64),bodyDigest:sha({host_instance_id,host_pid:process.pid,operation:'BEGIN_NATIVE_SETUP_V1',input}),signedAt,deadlineAt:Date.parse(signedAt)+30000,hostInstanceId:host_instance_id,hostPid:process.pid},postgres:{fixture:true},host_instance_id,host_pid:process.pid};
 let row=null,creates=0,reads=0,lose=null,failed=null;
 const abort=new AbortController();
 const scope={preparationBinding:request,signal:abort.signal,revalidatePreparation:async()=>request,
  async recordPreparationEffect(action,value={}){
   if(action==='RESERVE'){
    if(row)return{binding:request,effect:structuredClone(row),created:false};
    row={operation_id,custody_id,binding:structuredClone(request),state:'RESERVED',readback:null,reason:null};
   }
   if(action==='TERMINAL')Object.assign(row,structuredClone(value));
   if(lose===action){lose=null;throw Error('lost_'+action);}
   return{binding:request,effect:structuredClone(row),created:action==='RESERVE'};
  }};
 const executePlan=async plan=>{
  assertNativeRepositoryPreparationGitPlan(plan);
  if(plan.effect==='REPOSITORY_PREPARE_LOCKED'){creates++;if(failed)throw Error(failed);return{code:0,stdout:'',stderr:''};}
  reads++;return{code:0,stdout:`worktree ${plan.worktree_path}\0HEAD ${source.head}\0branch refs/heads/${plan.branch_name}\0locked METAENGINE:setup:${operation_id}:custody:${custody_id}\0\0`,stderr:''};
 };
 return{scope,request,source,executePlan,abort,lose:v=>{lose=v;},fail:v=>{failed=v;},get row(){return row;},get creates(){return creates;},get reads(){return reads;}};
}
test('ADMIN preparation uses one reserved mutation and retains exact readback without a task lease',async()=>{
 const f=fixture();const result=await prepareNativeRepository(f);assert.equal(result.state,'PROVEN');assert.equal(f.creates,1);assert.equal(f.reads,1);
 await prepareNativeRepository(f);assert.equal(f.creates,1);assert.equal(f.reads,1);assert.equal(f.row.state,'PROVEN');assert.equal(result.authority_effect,false);
});
test('lost RESERVE acknowledgement never executes or replays the mutation',async()=>{
 const f=fixture();f.lose('RESERVE');await assert.rejects(prepareNativeRepository(f),/lost_RESERVE/);assert.equal(f.creates,0);assert.equal(f.row.state,'RESERVED');
 await assert.rejects(prepareNativeRepository(f),/effect_ambiguous/);assert.equal(f.creates,0);
});
test('lost terminal acknowledgement recovers exact original receipt without another Git create',async()=>{
 const f=fixture();f.lose('TERMINAL');assert.equal((await prepareNativeRepository(f)).state,'PROVEN');assert.equal(f.creates,1);
});
test('partial effect remains AMBIGUOUS and never automatically retries',async()=>{
 const f=fixture();f.fail('lost_native_result');await assert.rejects(prepareNativeRepository(f),/effect_ambiguous/);assert.equal(f.row.state,'AMBIGUOUS');
 await assert.rejects(prepareNativeRepository(f),/effect_ambiguous/);assert.equal(f.creates,1);
});
test('foreign scope, changed source, expired authority and cancellation cannot reserve or mutate',async()=>{
 for(const change of ['scope','source','expired','cancelled']){
  const f=fixture();if(change==='scope')f.request=structuredClone(f.request);if(change==='source')f.source={...f.source,head:'0'.repeat(40)};
  if(change==='expired')f.request.original_request.deadlineAt=1;if(change==='cancelled')f.abort.abort();
  await assert.rejects(prepareNativeRepository(f));assert.equal(f.creates,0);assert.equal(f.row,null);
 }
});
test('late changed admission after reservation leaves AMBIGUOUS without mutation',async()=>{
 const f=fixture();let n=0;f.scope.revalidatePreparation=async()=>{if(++n===2)throw Error('authority_changed');return f.request;};
 await assert.rejects(prepareNativeRepository(f),/effect_ambiguous/);assert.equal(f.creates,0);assert.equal(f.row.state,'AMBIGUOUS');
});
test('retained PROVEN receipt cannot be swapped to a different original binding',async()=>{
 const f=fixture();await prepareNativeRepository(f);f.row.readback.preparation_binding_sha256='0'.repeat(64);
 await assert.rejects(prepareNativeRepository(f),/retained_readback_changed/);assert.equal(f.creates,1);
});
test('fixed preparation plans refuse command, argv, path and branch substitutions',()=>{
 const f=fixture(),plan=planNativeRepositoryPreparation(f.request);
 for(const fields of [{executable:'sh'},{argv:['status']},{worktree_path:path.join(os.tmpdir(),'elsewhere')},{branch_name:'main'},{shell:true},{authority_effect:true}])assert.throws(()=>assertNativeRepositoryPreparationGitPlan({...plan,...fields}));
});

test('retained readback rejects foreign schemas and added readiness fields',async()=>{
 for(const change of [{schema:'claimed-proof-v2'},{ready:true}]){
  const f=fixture();await prepareNativeRepository(f);Object.assign(f.row.readback,change);
  await assert.rejects(prepareNativeRepository(f),/retained_readback_changed/);assert.equal(f.creates,1);
 }
});
