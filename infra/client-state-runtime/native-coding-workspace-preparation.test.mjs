import {generatedStage} from './test/native-workspace-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeWorkspacePreparation} from './native-coding-workspace-preparation.mjs';
import {readNativeWorkspaceStage,NATIVE_WORKSPACE_STAGE,validateNativeWorkspaceStage} from '../../apps/metaengine-browser/src/native-coding-workspace-preparation.mjs';
const h=n=>String(n).repeat(64),sha=n=>String(n).repeat(40);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(t){
 // Canonicalize only this freshly generated fixture root, never production inputs.
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workspace-preparation-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const c=generatedStage();await fs.writeFile(path.join(directory,NATIVE_WORKSPACE_STAGE),JSON.stringify(c));
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:h(8),admin_grant_epoch:3};
 const row={coordination_workspace_id:c.workspace_id,device_id:device.device_id,client_id:device.client_id,admin_grant_epoch:'3',repo_id:c.repo_id,repo_root:c.repo_root,managed_root:c.managed_root};
 const seen={sql:[],observations:0,transactions:0,prepared:0};let grant=true,rootChanged=false,observeWait=null,failObservation=false,afterTransaction=null,failColdTransaction=false;
 const sql={begin:async(mode,fn)=>{assert.equal(mode,'isolation level serializable');seen.transactions++;const value=await fn({unsafe:async(query)=>{
  seen.sql.push(query);if(failColdTransaction&&seen.prepared>0)throw Error('transaction_closed_after_cold_prepare');
  if(query==='select 1 as preparation_transaction_alive')return[{preparation_transaction_alive:1}];
  if(query.startsWith('set local '))return[];
  if(query.startsWith('select current_user'))return[{current_user:'state_owner',session_user:'state_owner'}];
  if(query.includes('project_device_grant')){if(!grant)throw Error('PROJECT_DEVICE_GRANT_REVOKED');return[];}
  if(query.includes('for share of d,p'))return grant?[{key_fingerprint_sha256:device.key_fingerprint_sha256}]:[];
  if(query.includes('managed_project_repository'))return[structuredClone(row)];throw Error('unexpected SQL');
 }});if(afterTransaction)await afterTransaction();return value;}};
 const verifyStorage=async()=>({owner_dacl_verified:true});
 const roots=async file=>file===c.repo_root?(rootChanged?h(9):c.repo_root_identity_sha256):file===c.managed_root?c.managed_root_identity_sha256:h(1);
 const readNativeScope=async permit=>{assert.ok(seen.prepared>=1,'cold scope must be explicitly prepared without seed operator');seen.observations++;if(observeWait)await observeWait;if(failObservation)throw Error('observation lost');
  return{artifact:c.artifact,postgres:c.postgres,user_sid:c.user_sid,worktree:permit.worktree,sandbox:permit.sandbox,host_process:c.postgres.postmaster};};
 readNativeScope.prepare=async()=>{seen.prepared++;};
 const make=()=>createNativeWorkspacePreparation({transaction:sql.begin,stateDirectory:directory,readCurrentDevice:async()=>structuredClone(device),readNativeScope,verifyStorage,readRootIdentity:roots});
 const service=make();t.after(()=>service.close());
 const input=(await readNativeWorkspaceStage(directory,{verifyStorage})).input;
 return{directory,c,device,row,seen,service,input,make,setGrant:v=>{grant=v;},changeRoot:()=>{rootChanged=true;},wait:v=>{observeWait=v;},failObserve:()=>{failObservation=true;},afterTx:v=>{afterTransaction=v;},failColdTransaction:()=>{failColdTransaction=true;}};
}
test('stage rejects authority fields, malformed roster, wrong roots and expired configuration',()=>{
 for(const change of [v=>{v.owner_epoch=3;},v=>{v.device_id=randomUUID();},v=>{v.preparation_grant_epoch=3;},v=>{v.agents[1].role='IMPLEMENTER';},
  v=>{v.agents[0].worktree.path='C:\\unapproved';},v=>{v.artifact.source_sha='bad';},v=>{v.expires_at=new Date(0).toISOString();}]){
  const c=generatedStage();change(c);assert.throws(()=>validateNativeWorkspaceStage(c));
 }
});
test('authorized preparation persists once, has no SQL mutation or execution authority; restart reads same immutable identity',async t=>{
 const f=await fixture(t);
 assert.equal((await f.service.READ_WORKSPACE_PREPARATION_V1(f.input)).state,'NOT_STARTED');assert.equal(f.seen.prepared,0);
 const result=await f.service.PREPARE_WORKSPACE_V1(f.input);
 assert.equal(result.state,'PREPARED');assert.equal(result.preparation_grant_epoch,3);assert.equal(result.owner_incarnation_verified,false);assert.equal(result.execution_ready,false);
 assert.equal(f.seen.observations,2);
 const intent=await fs.readFile(path.join(f.directory,'native-coding-workspace-preparation-intent-v1.json'),'utf8');
 assert.equal(JSON.parse(intent).preparation_grant_epoch,3);assert.equal(Object.hasOwn(JSON.parse(intent),'owner_epoch'),false);
 const restart=f.make();t.after(()=>restart.close());assert.deepEqual(await restart.PREPARE_WORKSPACE_V1(f.input),result);assert.equal(f.seen.observations,2);
 assert.ok(f.seen.sql.every(q=>q.startsWith('select ')||q.startsWith('set local ')));assert.ok(f.seen.sql.some(q=>q.includes('for share of d,p')));
 assert.deepEqual((await fs.readdir(f.directory)).sort(),[NATIVE_WORKSPACE_STAGE,'native-coding-workspace-preparation-intent-v1.json','native-coding-workspace-preparation-receipt-v1.json'].sort());
});
test('revoked grant, missing exact repository epoch and changed root fail before intent',async t=>{
 for(const change of [f=>f.setGrant(false),f=>{f.row.admin_grant_epoch='2';},f=>{f.row.repo_root='C:\\elsewhere';},f=>f.changeRoot()]){
  const f=await fixture(t);change(f);await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input));assert.deepEqual(await fs.readdir(f.directory),[NATIVE_WORKSPACE_STAGE]);
 }
});
test('unknown observation never auto-retries, including after service restart',async t=>{
 const f=await fixture(t);f.failObserve();await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input),/observation lost/);
 const count=f.seen.observations;assert.equal((await f.service.PREPARE_WORKSPACE_V1(f.input)).state,'UNKNOWN');
 const restart=f.make();t.after(()=>restart.close());assert.equal((await restart.READ_WORKSPACE_PREPARATION_V1(f.input)).state,'UNKNOWN');assert.equal(f.seen.observations,count);
});
test('lost transaction acknowledgement recovers preparation by reads, never a second effect',async t=>{
 const f=await fixture(t);f.afterTx(()=>{throw Error('ack lost');});await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input),/ack lost/);
 f.afterTx(null);assert.equal((await f.service.READ_WORKSPACE_PREPARATION_V1(f.input)).state,'PREPARED');assert.equal(f.seen.observations,2);
});
test('current grant and immutable scope remain mandatory for stored preparation',async t=>{
 const f=await fixture(t);await f.service.PREPARE_WORKSPACE_V1(f.input);
 f.setGrant(false);await assert.rejects(f.service.READ_WORKSPACE_PREPARATION_V1(f.input),/REVOKED/);
 f.setGrant(true);f.device.admin_grant_epoch=4;f.row.admin_grant_epoch='4';await assert.rejects(f.service.READ_WORKSPACE_PREPARATION_V1(f.input),/intent_conflict/);
});
test('cancellation and close during joined physical reads leave retained unknown intent without publication',async t=>{
 for(const close of [false,true]){
  const f=await fixture(t),gate=deferred(),abort=new AbortController();f.wait(gate.promise);
  const pending=f.service.PREPARE_WORKSPACE_V1(f.input,{signal:abort.signal});
  while(!f.seen.observations)await new Promise(r=>setImmediate(r));
  if(close)f.service.close();else abort.abort();gate.resolve();await assert.rejects(pending);
  assert.equal((await fs.readdir(f.directory)).includes('native-coding-workspace-preparation-receipt-v1.json'),false);
 }
});
test('changed staged config and receipt corruption cannot authorize replay',async t=>{
 const f=await fixture(t);await f.service.PREPARE_WORKSPACE_V1(f.input);
 await fs.writeFile(path.join(f.directory,'native-coding-workspace-preparation-receipt-v1.json'),'{}');
 await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input),/receipt_invalid/);
 f.c.repo_id='changed:repo';await fs.writeFile(path.join(f.directory,NATIVE_WORKSPACE_STAGE),JSON.stringify(f.c));
 await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input),/stage_changed/);assert.equal(f.seen.observations,2);
});


test('concurrent preparations cannot duplicate the retained physical preparation effect',async t=>{
 const f=await fixture(t);const values=await Promise.allSettled([f.service.PREPARE_WORKSPACE_V1(f.input),f.service.PREPARE_WORKSPACE_V1(f.input)]);
 assert.ok(values.some(v=>v.status==='fulfilled'&&v.value.state==='PREPARED'));
 assert.equal(f.seen.observations,2);assert.equal((await f.service.READ_WORKSPACE_PREPARATION_V1(f.input)).state,'PREPARED');
});


test('server transaction dying during cold preparation prevents new Host intent or receipt',async t=>{
 const f=await fixture(t);f.failColdTransaction();await assert.rejects(f.service.PREPARE_WORKSPACE_V1(f.input),/transaction_closed_after_cold_prepare/);
 assert.equal(f.seen.prepared,1);assert.equal(f.seen.observations,0);assert.deepEqual(await fs.readdir(f.directory),[NATIVE_WORKSPACE_STAGE]);
});
