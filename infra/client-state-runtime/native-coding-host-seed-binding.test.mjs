import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {NATIVE_CODING_DEVICE_PATHS,signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
import {createNativeCodingHostSeedService} from './native-coding-host-seed-service.mjs';
import {createNativeCodingHostSeedBinding} from './native-coding-host-seed-binding.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const hash=value=>createHash('sha256').update(value).digest('hex');
const catalog={schema:'metaengine.native-coding.seed-catalog.v1',entries:[],has_more:false,authority_effect:false,automatic_retry_allowed:false};

// Real enrolled-identity signatures and the real request verifier/context;
// generated DB grants, storage ACLs and seed operations do not qualify Windows.
async function fixture(t,{createService}={}){
 const stateDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'native-seed-binding-'));
 const identity=new SupervisorDeviceIdentity({statePath:path.join(stateDirectory,'test-identity.json'),secureStorage:{
  isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
 t.after(()=>fs.rm(stateDirectory,{recursive:true,force:true}));
 await identity.ensure();await identity.bindDevice(randomUUID());
 const s=identity.snapshot(),host={instance_id:randomUUID(),host_pid:23456};
 const device={device_id:s.device_id,client_id:s.client_id,profile:s.profile,public_jwk:s.public_jwk,
  key_fingerprint_sha256:s.key_fingerprint_sha256,admin_grant_epoch:'3',admitted:true};
 const seen={created:0,serviceClosed:0,verifierClosed:0,contextClosed:0,calls:[],deviceQueries:0};
 let clock=null,lookup=async query=>{
  if(query.includes('from public.compute_fabric_a2_browser_device_h205f22')){seen.deviceQueries++;return[structuredClone(device)];}
  if(query==='select current_user::text as current_user,session_user::text as session_user')return[{current_user:'state_owner',session_user:'state_owner'}];
  throw Error('Unexpected fixture query');
 };
 const sql={unsafe:(...args)=>lookup(...args),begin:async()=>{throw Error('Fixture must not dispatch a SQL write');}};
 const fakeService=options=>Object.freeze({...Object.fromEntries(['SEED_GOAL','READ_SEED','LIST_SEEDS'].map(action=>[action,async input=>{
  const current=await options.readCurrentDevice();assert.equal(current.device_id,device.device_id);
  seen.calls.push({action,input:structuredClone(input)});return structuredClone(catalog);
 }])),close(){seen.serviceClosed++;}});
 const binding=createNativeCodingHostSeedBinding({sql,stateDirectory,readNativeScope:async()=>{},hostInstanceId:host.instance_id,hostPid:host.host_pid,
  createService:async options=>{seen.created++;return createService?createService(options,fakeService):fakeService(options);},
  createVerifier:options=>{const verifier=createNativeCodingDeviceRequestVerifier({...options,now:()=>clock??Date.now()});
   return{verify:request=>verifier.verify(request),close(){seen.verifierClosed++;verifier.close();}};},
  createContext:options=>{const context=createNativeCodingAuthenticatedRequestContext({...options,now:()=>clock??Date.now()});
   return{run:(...args)=>context.run(...args),readCurrentDevice:context.readCurrentDevice,close(){seen.contextClosed++;context.close();}};}});
 t.after(()=>binding.close());
 return{binding,seen,device,sql,stateDirectory,host,identity,setClock:value=>{clock=value;},setLookup:value=>{lookup=value;},
  async request(operation='LIST_SEEDS',timestamp){
   const input=operation==='LIST_SEEDS'?{after_seq:0,limit:1}:{request_id:randomUUID(),objective:'A generated reviewed task'};
   const request=await signNativeCodingDeviceRequest({identity,binding:host,operation,input});
   if(timestamp!==undefined)request.headers=await identity.deviceHeaders('POST',NATIVE_CODING_DEVICE_PATHS[operation],json(request.body),
    {timestamp:new Date(timestamp).toISOString()});
   return request;
  }};
}

test('profile published after startup is discovered readonly without dispatching a goal',async t=>{
 let published=false;
 const f=await fixture(t,{createService:(options,service)=>{if(!published)throw Object.assign(Error('missing profile'),{code:'ENOENT'});return service(options);}});
 await assert.rejects(f.binding.prepare(),{code:'ENOENT'});
 assert.equal(f.seen.created,1);assert.equal(f.seen.calls.length,0);
 published=true;
 assert.deepEqual(await f.binding.operations.LIST_SEEDS(await f.request()),catalog);
 assert.equal(f.seen.created,2);assert.deepEqual(f.seen.calls.map(row=>row.action),['LIST_SEEDS']);
 assert.deepEqual(Object.keys(f.binding.operations).sort(),['LIST_SEEDS','READ_SEED','SEED_GOAL','close']);
});

test('concurrent readonly discovery shares one creation and authenticates each packet separately',async t=>{
 const ready=deferred();let make;
 const f=await fixture(t,{createService:(options,service)=>{make=()=>service(options);return ready.promise;}});
 const a=f.binding.operations.LIST_SEEDS(await f.request()),b=f.binding.operations.READ_SEED(await f.request('READ_SEED'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.seen.created,1);assert.equal(f.seen.deviceQueries,0);
 ready.resolve(make());await Promise.all([a,b]);
 assert.equal(f.seen.deviceQueries,2);assert.deepEqual(f.seen.calls.map(row=>row.action).sort(),['LIST_SEEDS','READ_SEED']);
});

test('SEED_GOAL neither starts cold setup nor retries an existing write after a lost result',async t=>{
 let effects=0;
 const f=await fixture(t,{createService:(options,service)=>({...service(options),SEED_GOAL:async()=>{effects++;throw Error('lost result');}})});
 const request=await f.request('SEED_GOAL');
 await assert.rejects(f.binding.operations.SEED_GOAL(request),/binding_not_ready/);
 assert.equal(f.seen.created,0);assert.equal(effects,0);
 await f.binding.prepare();
 await assert.rejects(f.binding.operations.SEED_GOAL(request),/lost result/);
 await assert.rejects(f.binding.operations.SEED_GOAL(request),/nonce_reused/);
 assert.equal(effects,1);assert.equal(f.seen.created,1);
});

test('closing during preparation fences the late service and releases all private request bindings',async t=>{
 const ready=deferred();let make;
 const f=await fixture(t,{createService:(options,service)=>{make=()=>service(options);return ready.promise;}});
 const request=await f.request(),pending=f.binding.operations.LIST_SEEDS(request);
 await new Promise(resolve=>setImmediate(resolve));f.binding.close();ready.resolve(make());
 await assert.rejects(pending,/binding_closed/);
 assert.equal(f.seen.serviceClosed,1);assert.equal(f.seen.verifierClosed,1);assert.equal(f.seen.contextClosed,1);
 assert.equal(f.seen.deviceQueries,0);assert.equal(f.seen.calls.length,0);
 assert.throws(()=>f.binding.prepare(),/binding_closed/);
 await assert.rejects(f.binding.operations.LIST_SEEDS(await f.request()),/binding_closed/);
 f.binding.close();assert.equal(f.seen.verifierClosed,1);
});

test('a failed pending preparation cannot revive a closed Host binding',async t=>{
 const ready=deferred();const f=await fixture(t,{createService:()=>ready.promise});
 const pending=f.binding.operations.READ_SEED(await f.request('READ_SEED'));
 await new Promise(resolve=>setImmediate(resolve));f.binding.close();ready.reject(Error('invalid profile'));
 await assert.rejects(pending,/invalid profile/);
 await assert.rejects(f.binding.operations.READ_SEED(await f.request('READ_SEED')),/binding_closed/);
 assert.equal(f.seen.created,1);assert.equal(f.seen.calls.length,0);assert.equal(f.seen.contextClosed,1);
});

test('closing an active invocation suppresses its late response without replaying the operation',async t=>{
 const ready=deferred();let effects=0;
 const f=await fixture(t,{createService:(options,service)=>({...service(options),SEED_GOAL:async()=>{effects++;return ready.promise;}})});
 await f.binding.prepare();const pending=f.binding.operations.SEED_GOAL(await f.request('SEED_GOAL'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(effects,1);
 f.binding.close();ready.resolve({state:'ADMITTED'});
 await assert.rejects(pending,/binding_closed/);
 assert.equal(effects,1);assert.equal(f.seen.serviceClosed,1);assert.equal(f.seen.contextClosed,1);
});

test('cold preparation does not extend cryptographic freshness and readonly refresh needs a new signature',async t=>{
 let f,expiry;
 f=await fixture(t,{createService:(options,service)=>{f.setClock(expiry);return service(options);}});
 const old=await f.request(),timestamp=Date.parse(old.headers['x-a2-device-timestamp']);expiry=timestamp+30001;
 await assert.rejects(f.binding.operations.LIST_SEEDS(old),/timestamp_invalid/);
 assert.equal(f.seen.created,1);assert.equal(f.seen.calls.length,0);assert.equal(f.seen.deviceQueries,0);
 assert.deepEqual(await f.binding.operations.LIST_SEEDS(await f.request('LIST_SEEDS',expiry)),catalog);
 assert.equal(f.seen.created,1);assert.equal(f.seen.calls.length,1);
});

test('malformed packets cannot prepare a service and prepared service still requires actual signature and current ADMIN',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.binding.operations.LIST_SEEDS({body:{},headers:{}}),/binding_invalid/);
 assert.equal(f.seen.created,0);
 await f.binding.prepare();const forged=await f.request();forged.headers['x-a2-device-signature']='a'.repeat(86);
 await assert.rejects(f.binding.operations.LIST_SEEDS(forged),/signature_invalid/);
 f.device.admitted=false;await assert.rejects(f.binding.operations.LIST_SEEDS(await f.request()),/current_device_unavailable/);
 assert.equal(f.seen.calls.length,0);
});

test('real seed service retries a corrected initial profile but never replaces mounted protected pins',async t=>{
 let operator=null;
 const f=await fixture(t,{createService:options=>createNativeCodingHostSeedService({...options,
  readOperator:async()=>{if(!operator)throw Object.assign(Error('missing profile'),{code:'ENOENT'});return structuredClone(operator);},
  protectStorage:async()=>{},verifyStorage:async()=>({fixture:true,windows_acl_qualified:false})})});
 const profile={profile_id:randomUUID(),device_id:f.device.device_id,client_id:f.device.client_id,
  device_key_fingerprint_sha256:f.device.key_fingerprint_sha256,admin_grant_epoch:3,
  trust_namespace:'LOCAL_OPERATOR_QA',agents:[{},{}],production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 const canonical=json(profile),profileSha=hash(canonical);
 f.setLookup(async query=>{
  if(query.includes('from public.compute_fabric_a2_browser_device_h205f22'))return[structuredClone(f.device)];
  if(query==='select current_user::text as current_user,session_user::text as session_user')return[{current_user:'state_owner',session_user:'state_owner'}];
  if(query.includes('native_coding_seed_profile_v1'))return[{value:{schema:'metaengine.native-coding.seed-profile-readback.v1',profile,
   canonical_profile:canonical,profile_sha256:profileSha}}];
  if(query.includes('native_coding_seed_list_v1'))return[{value:catalog}];
  throw Error('Unexpected fixture query');
 });
 await assert.rejects(f.binding.prepare(),{code:'ENOENT'});
 operator={value:{schema:'invalid-profile'},sha256:hash('invalid-profile')};
 await assert.rejects(f.binding.operations.LIST_SEEDS(await f.request()),/operator_invalid/);
 const value={schema:'metaengine.native-coding.seed-operator.v1',profile_id:profile.profile_id,profile_sha256:profileSha};
 operator={value,sha256:hash(json(value))};
 assert.deepEqual(await f.binding.operations.LIST_SEEDS(await f.request()),{...catalog,coordination_mode:'CLI_LED'});
 assert.equal(f.seen.created,3);
 operator={value:{...value,profile_id:randomUUID()},sha256:hash('changed-operator')};
 await assert.rejects(f.binding.operations.LIST_SEEDS(await f.request()),/operator_changed/);
 assert.equal(f.seen.created,3);
});

test('private IPC cancellation context reaches the authenticated seed operation unchanged',async t=>{
 let received;
 const f=await fixture(t,{createService:(options,service)=>({...service(options),SEED_GOAL:async(_input,context)=>{received=context;return {state:'READBACK_REQUIRED'};}})});
 await f.binding.prepare();const controller=new AbortController();
 const context=Object.freeze({signal:controller.signal,deadlineAt:Date.now()+30000});
 await f.binding.operations.SEED_GOAL(await f.request('SEED_GOAL'),context);
 assert.equal(received,context);
});

test('already cancelled invocation never calls the authenticated seed operation',async t=>{
 const f=await fixture(t);await f.binding.prepare();const controller=new AbortController();controller.abort();
 await assert.rejects(f.binding.operations.SEED_GOAL(await f.request('SEED_GOAL'),{signal:controller.signal}),/request_cancelled/);
 assert.equal(f.seen.calls.length,0);
});

test('cancellation after a seed effect suppresses the late response without replay',async t=>{
 const ready=deferred(),entered=deferred();let effects=0;
 const f=await fixture(t,{createService:(options,service)=>({...service(options),SEED_GOAL:async()=>{effects++;entered.resolve();return ready.promise;}})});
 await f.binding.prepare();const controller=new AbortController(),packet=await f.request('SEED_GOAL');
 const pending=f.binding.operations.SEED_GOAL(packet,{signal:controller.signal});await entered.promise;controller.abort();ready.resolve({state:'ADMITTED'});
 await assert.rejects(pending,/request_cancelled/);assert.equal(effects,1);
 await assert.rejects(f.binding.operations.SEED_GOAL(packet),/nonce_reused/);assert.equal(effects,1);
});
test('deadline expiring during catalog read suppresses stale readiness',async t=>{
 const ready=deferred(),entered=deferred();
 const f=await fixture(t,{createService:(options,service)=>({...service(options),LIST_SEEDS:async()=>{entered.resolve();return ready.promise;}})});
 const context={deadlineAt:Date.now()+30000};const pending=f.binding.operations.LIST_SEEDS(await f.request(),context);
 await entered.promise;context.deadlineAt=Date.now()-1;ready.resolve(catalog);await assert.rejects(pending,/request_deadline_exceeded/);
});
