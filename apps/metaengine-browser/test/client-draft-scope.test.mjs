import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {readClientDraftScope} from '../src/client-draft-scope.mjs';
import {nativeCodingCanonicalJson as canonical} from '../src/native-coding-task-context.mjs';
const start=1793358000000;
function fixture(){
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),enrolled:true};
 const repo={coordination_workspace_id:randomUUID(),repo_id:'fixture:repo',repo_root:'/private/repo',managed_root:'/private/worktrees'};
 let wall=start,mono=10,reads=0,requests=0;const options={identity:{snapshot:()=>device},now:()=>wall,monotonicNow:()=>mono,dispatchedAt:start,dispatchedMonotonic:10,
  readRepository:async()=>{reads++;return repo;},readVerifiedRoute:async()=>{requests++;return{retained_intent:false,scope_resolved:true,authority_effect:false};}};
 return{device,repo,options,read:()=>readClientDraftScope(options),time:(w,m)=>{wall=w;mono=m;},counts:()=>({reads,requests})};
}
test('draft namespace is opaque, domain-separated, workspace-only and does not assert human login or execution readiness',async()=>{
 const f=fixture(),v=await f.read();assert.equal(v.state,'READY');assert.equal(v.observed_at,new Date(start).toISOString());assert.equal(v.expires_at,new Date(start+5000).toISOString());
 assert.deepEqual(Object.keys(v).sort(),['schema','state','scope','observed_at','expires_at','authority_effect','automatic_retry_allowed'].sort());
 const {enrolled,...principal}=f.device;assert.equal(v.scope.principal_id,createHash('sha256').update('metaengine.client.draft-principal.v1\0').update(canonical(principal)).digest('hex'));
 assert.deepEqual(v.scope,{principal_kind:'ENROLLED_NATIVE_DEVICE',principal_id:v.scope.principal_id,workspace_id:f.repo.coordination_workspace_id,project_id:null});
 for(const privateValue of [f.device.device_id,f.device.client_id,f.device.key_fingerprint_sha256,f.repo.repo_root])assert.ok(!JSON.stringify(v).includes(privateValue));
});
test('retained native setup HOLD does not invalidate a freshly verified presentation namespace',async()=>{
 const f=fixture();f.options.readVerifiedRoute=async()=>({retained_intent:true,scope_resolved:true,authority_effect:false});assert.equal((await f.read()).state,'READY');
});
for(const variant of ['missing','unloaded','unenrolled','bad-id','bad-key'])test(`${variant} identity has no scope or read/sign/credential side effects`,async()=>{
 const f=fixture();if(variant==='missing')f.options.identity=null;else if(variant==='unloaded')f.options.identity.snapshot=()=>null;else if(variant==='unenrolled')f.device.enrolled=false;else if(variant==='bad-id')f.device.device_id='invented';else f.device.key_fingerprint_sha256='unknown';
 const v=await f.read();assert.equal(v.state,'UNKNOWN');assert.equal(v.scope,null);assert.equal(v.expires_at,null);assert.deepEqual(f.counts(),{reads:0,requests:0});
});
for(const key of ['device_id','client_id','key_fingerprint_sha256','enrolled'])test(`identity ${key} change while awaiting read cannot restore old namespace`,async()=>{
 const f=fixture();f.options.readVerifiedRoute=async()=>{f.device[key]=key==='enrolled'?false:key.endsWith('sha256')?'b'.repeat(64):randomUUID();return{retained_intent:false,scope_resolved:true,authority_effect:false};};assert.equal((await f.read()).scope,null);
});
for(const cause of ['revoked','malformed','wrong-workspace','host-change','missing-config','config-change'])test(`${cause} yields redacted UNKNOWN, never old scope`,async()=>{
 const f=fixture();let changed=false;
 if(cause==='missing-config')f.options.readRepository=async()=>null;
 else if(cause==='config-change'){let n=0;f.options.readRepository=async()=>++n===1?f.repo:{...f.repo,coordination_workspace_id:randomUUID()};}
 else if(cause==='host-change'){f.options.assertOpen=()=>{if(changed)throw Error('host changed');};f.options.readVerifiedRoute=async()=>{changed=true;return{retained_intent:false,scope_resolved:true,authority_effect:false};};}
 else f.options.readVerifiedRoute=async()=>{if(cause==='revoked')throw Error('SENTINEL_PRIVATE_GRANT_DETAIL');return cause==='malformed'?{authority_effect:true}:{scope_resolved:false,retained_intent:false,authority_effect:false};};
 const v=await f.read();assert.equal(v.state,'UNKNOWN');assert.equal(v.scope,null);assert.equal(v.expires_at,null);assert.ok(!JSON.stringify(v).includes('SENTINEL'));
});
for(const [label,wall,mono] of [['wall deadline',start+5000,11],['monotonic deadline',start+1,5010],['wall rollback',start-1,11],['monotonic rollback',start+1,9]])test(`${label} cannot renew freshness at response receipt`,async()=>{
 const f=fixture();f.options.readVerifiedRoute=async()=>{f.time(wall,mono);return{retained_intent:false,scope_resolved:true,authority_effect:false};};const v=await f.read();assert.equal(v.state,'UNKNOWN');assert.equal(v.observed_at,new Date(start).toISOString());
});
test('late held read is joined, not declared cancelled or physically complete by UI freshness expiry',async()=>{
 const f=fixture();let release;f.options.readVerifiedRoute=()=>new Promise(r=>{release=r;});let done=false;
 const pending=f.read().then(v=>{done=true;return v;});await new Promise(r=>setImmediate(r));f.time(start+6000,6010);assert.equal(done,false);
 release({retained_intent:false,scope_resolved:true,authority_effect:false});assert.equal((await pending).state,'UNKNOWN');
});
test('actual preload exposes zero-arg draftScope only to the primary renderer and never accepts a selector',async()=>{
 const source=await fs.readFile(new URL('../src/preload-shell.cjs',import.meta.url),'utf8');
 for(const primary of [true,false]){
  const exposed={},calls=[];vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(k,v)=>{exposed[k]=v;}},ipcRenderer:{on(){},invoke:(...args)=>{calls.push(args);return Promise.resolve({});}}};},
   location:{protocol:primary?'http:':'https:',hostname:'127.0.0.1',port:'8137'},process:{env:{}}});
  if(!primary){assert.equal(exposed.metaengineClient,undefined);continue;}
  assert.equal(typeof exposed.metaengineClient.draftScope,'function');await exposed.metaengineClient.draftScope();assert.deepEqual(calls,[['metaengine:client:draft-scope']]);
  for(const argument of [undefined,null,{},'workspace',false])assert.throws(()=>exposed.metaengineClient.draftScope(argument),/params_forbidden/);assert.equal(calls.length,1);
  // Behavior check for the earlier Phase1A inline-closure contract mismatch:
  // named extraction must retain exact action/argument/arity, not hide a broad IPC API.
  assert.equal(exposed.metaengineClient.activatePreparedGoal.length,1);const requestId=randomUUID();
  await exposed.metaengineClient.activatePreparedGoal(requestId,{ignored_extra:'cannot become authority'});
  assert.deepEqual(calls[1],['metaengine:client:activate-prepared-goal',requestId]);
 }
});
test('actual Main draft-scope handler applies sender fence before zero-arg dispatch',async()=>{
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),begin=source.indexOf("ipcMain.handle('metaengine:client:draft-scope'"),end=source.indexOf("ipcMain.handle('metaengine:client:goal-submission-mode'",begin);
 let handler,calls=0;const trusted={};vm.runInNewContext(source.slice(begin,end),{ipcMain:{handle:(name,body)=>{assert.equal(name,'metaengine:client:draft-scope');handler=body;}},assertShellSender:event=>{if(event!==trusted)throw Error('untrusted sender');},readCurrentClientDraftScope:()=>{calls++;return{state:'UNKNOWN'};}});
 await assert.rejects(handler({}),/untrusted/);await assert.rejects(handler(trusted,undefined),/params_forbidden/);assert.equal(calls,0);await handler(trusted);assert.equal(calls,1);
});

test('actual Main activation handler keeps sender and extra-argument refusal after named preload extraction',async()=>{
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),begin=source.indexOf("ipcMain.handle('metaengine:client:activate-prepared-goal'"),end=source.indexOf("ipcMain.handle('metaengine:client:draft-scope'",begin);
 let handler;const calls=[],trusted={};vm.runInNewContext(source.slice(begin,end),{ipcMain:{handle:(_name,body)=>{handler=body;}},assertShellSender:event=>{if(event!==trusted)throw Error('untrusted');},activatePreparedClientGoal:requestId=>{calls.push(requestId);return{};}});
 await assert.rejects(handler({},randomUUID()),/untrusted/);await assert.rejects(handler(trusted,randomUUID(),{}),/extra_args/);assert.equal(calls.length,0);
 const id=randomUUID();await handler(trusted,id);assert.deepEqual(calls,[id]);
});
