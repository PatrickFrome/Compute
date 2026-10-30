import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {SupervisorDeviceIdentity} from '../src/supervisor-device-identity.mjs';
import {prepareNativeWorkspaceFromStage} from '../src/native-coding-workspace-preparation.mjs';
import {validateNativeCodingDeviceRequest} from '../src/native-coding-device-request.mjs';
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-preparation-caller-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});
 await identity.ensure();await identity.bindDevice(randomUUID());const input={preparation_id:randomUUID(),configuration_sha256:'a'.repeat(64)};
 const calls=[],binding={instance_id:randomUUID(),host_pid:123};let state='NOT_STARTED',fail=false,alter=null;
 const result=()=>({schema:'metaengine.native-coding.workspace-preparation-readback.v1',...input,state,preparation_grant_epoch:1,
  current_grant_valid:true,owner_incarnation_verified:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
 const capability={snapshot:()=>binding,readWorkspacePreparation:async request=>{validateNativeCodingDeviceRequest(request,'READ_WORKSPACE_PREPARATION_V1');calls.push('READ');const value=result();alter?.(value);return value;},
  prepareWorkspace:async request=>{validateNativeCodingDeviceRequest(request,'PREPARE_WORKSPACE_V1');calls.push('PREPARE');state='UNKNOWN';if(fail)throw Error('ACK_LOST');state='PREPARED';return result();}};
 const options={stateDirectory:directory,identity,capability,verifyStorage:async()=>({owner_dacl_verified:true}),readStage:async()=>({input})};
 return{options,calls,input,setState:v=>{state=v;},fail:()=>{fail=true;},alter:v=>{alter=v;}};
}
test('absent stage does not sign, prepare or inspect the catalog',async t=>{
 const f=await fixture(t);f.options.readStage=async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});};
 assert.equal(await prepareNativeWorkspaceFromStage(f.options),null);assert.deepEqual(f.calls,[]);
});
test('real signed main preparatory caller executes once and thereafter reads exact preparation',async t=>{
 const f=await fixture(t);assert.equal((await prepareNativeWorkspaceFromStage(f.options)).state,'PREPARED');
 assert.equal((await prepareNativeWorkspaceFromStage(f.options)).state,'PREPARED');assert.deepEqual(f.calls,['READ','PREPARE','READ']);
});
test('unknown lost reply never leads main to replay preparation on another mount',async t=>{
 const f=await fixture(t);f.fail();await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/ACK_LOST/);
 await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/outcome_unknown/);assert.deepEqual(f.calls,['READ','PREPARE','READ']);
});
test('malformed, stale-scope or execution-authority readback blocks preparation',async t=>{
 for(const change of [v=>{v.configuration_sha256='b'.repeat(64);},v=>{v.current_grant_valid=false;},v=>{v.owner_incarnation_verified=true;},v=>{v.execution_ready=true;},v=>{v.preparation_grant_epoch=0;},v=>{v.production_qualified=true;},v=>{v.extra=true;}]){
  const f=await fixture(t);f.alter(change);await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/readback_invalid/);assert.deepEqual(f.calls,['READ']);
 }
});
test('closed main lifetime and malformed stage stop before any request',async t=>{
 const f=await fixture(t);f.options.assertOpen=()=>{throw Error('closed');};await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/closed/);assert.deepEqual(f.calls,[]);
 f.options.assertOpen=()=>{};f.options.readStage=async()=>{throw Error('stage_invalid');};await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/stage_invalid/);assert.deepEqual(f.calls,[]);
});


test('retained main dispatch intent forbids replay even when next Host says NOT_STARTED',async t=>{
 const f=await fixture(t);f.fail();await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/ACK_LOST/);
 f.setState('NOT_STARTED');await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/outcome_unknown/);
 assert.deepEqual(f.calls,['READ','PREPARE','READ']);
});


test('removing opted-in stage cannot clear an unknown dispatch hold',async t=>{
 const f=await fixture(t);f.fail();await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/ACK_LOST/);
 f.options.readStage=async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});};
 await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/stage_missing_with_retained_state/);
 assert.deepEqual(f.calls,['READ','PREPARE']);
});


test('missing stage with retained Host-only intent or receipt is blocked without signing',async t=>{
 for(const name of ['native-coding-workspace-preparation-intent-v1.json','native-coding-workspace-preparation-receipt-v1.json']){
  const f=await fixture(t);await fs.writeFile(path.join(f.options.stateDirectory,name),'partial unknown file');
  f.options.readStage=async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});};
  await assert.rejects(prepareNativeWorkspaceFromStage(f.options),/stage_missing_with_retained_state/);assert.deepEqual(f.calls,[]);
 }
});
