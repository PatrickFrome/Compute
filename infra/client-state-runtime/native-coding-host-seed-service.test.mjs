import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createNativeCodingHostSeedService} from './native-coding-host-seed-service.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const identity=pid=>({pid,created_at:'2026-10-01T00:00:00.000Z',
 process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(Date.parse('2026-10-01T00:00:00.000Z'))*10000n+116444736000000000n}`});

// Real private intent/diagnostic files, generated SQL/identity/ACL observations.
// These tests establish failure semantics, not installed Windows qualification.
async function fixture(t){
 const stateDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'native-seed-diagnostic-'));
 t.after(()=>fs.rm(stateDirectory,{recursive:true,force:true}));
 const device={device_id:randomUUID(),client_id:'generated-client',key_fingerprint_sha256:'a'.repeat(64),admin_grant_epoch:1};
 const profile={profile_id:randomUUID(),...device,device_key_fingerprint_sha256:device.key_fingerprint_sha256,
  user_sid:'S-1-5-21-1',artifact:{installed_exe_sha256:'b'.repeat(64)},postgres:{postmaster:identity(2345)},
  agents:['IMPLEMENTER','CRITIC'].map((role,i)=>({role,provider_id:randomUUID(),worktree:{path:'generated-'+i,base_sha:'c'.repeat(40)},sandbox:{role}})),
  trust_namespace:'LOCAL_OPERATOR_QA',production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 const canonical=json(profile),profileSha=hash(canonical),pins={schema:'metaengine.native-coding.seed-operator.v1',profile_id:profile.profile_id,profile_sha256:profileSha};
 const input={request_id:randomUUID(),objective:'Generated objective kept out of diagnostic data'};
 const directory=path.join(stateDirectory,'native-coding-seed-intents-v1');
 const semanticFile=path.join(directory,'body-'+hash(json({profile_id:pins.profile_id,objective:input.objective}))+'.json');
 const diagnosticFile=path.join(directory,'observation-failed-'+input.request_id+'.json');
 const seen={dispatches:0,scopes:0,profiles:0,observation:null};
 let readScope=async permit=>({host_process:identity(1234),user_sid:profile.user_sid,artifact:profile.artifact,
  postgres:profile.postgres,worktree:permit.worktree,sandbox:permit.sandbox});
 const native=async(...args)=>{seen.scopes++;return readScope(...args);};
 let profileHook=()=>{},verify=async()=>{};
 const sql={unsafe:async query=>{
  if(query==='select current_user::text as current_user,session_user::text as session_user')return[{current_user:'state_owner',session_user:'state_owner'}];
  if(query.includes('native_coding_seed_profile_v1')){seen.profiles++;profileHook();return[{value:{schema:'metaengine.native-coding.seed-profile-readback.v1',profile,canonical_profile:canonical,profile_sha256:profileSha}}];}
  if(query.includes('native_coding_seed_read_v1'))return[{value:null}];
  throw Error('Unexpected generated query');
 },begin:async()=>{seen.dispatches++;throw Error('generated_lost_sql_ack');}};
 const options={sql,stateDirectory,readNativeScope:native,readCurrentDevice:async()=>structuredClone(device),
  readOperator:async()=>({value:structuredClone(pins),sha256:hash(json(pins))}),
  readProtectedJson:async file=>({value:JSON.parse(await fs.readFile(file,'utf8'))}),
  protectStorage:async()=>{},verifyStorage:async(...args)=>verify(...args)};
 const service=await createNativeCodingHostSeedService(options);t.after(()=>service.close());
 return {service,options,profile,pins,input,native,seen,directory,semanticFile,diagnosticFile,sql,
  setScope:value=>{readScope=value;},defaultScope:readScope,setVerify:value=>{verify=value;},setProfileHook:value=>{profileHook=value;},
  diagnostic:async()=>JSON.parse(await fs.readFile(diagnosticFile,'utf8'))};
}

test('durable bounded diagnostic survives restart but never replaces the independent rejection proof',async t=>{
 const f=await fixture(t),error=Object.assign(Error('native_coding_host_seed_observation_window_exceeded'),{cause:'postgres://secret@example/private',stderr:'private stderr'});
 f.setScope(async()=>{throw error;});
 await assert.rejects(f.service.SEED_GOAL(f.input),value=>value===error);
 const diagnostic=await f.diagnostic(),text=json(diagnostic);
 assert.equal(diagnostic.reason,'OBSERVATION_WINDOW_EXCEEDED');assert.equal(diagnostic.request_id,f.input.request_id);
 assert.equal(diagnostic.profile_id,f.pins.profile_id);assert.equal(diagnostic.profile_sha256,f.pins.profile_sha256);
 assert.equal(diagnostic.body_sha256,hash(json(f.input)));assert.ok(Number.isSafeInteger(diagnostic.elapsed_ms)&&diagnostic.elapsed_ms>=0);
 assert.equal(new Date(diagnostic.observed_at).toISOString(),diagnostic.observed_at);
 assert.equal(diagnostic.diagnostic_only,true);assert.equal(diagnostic.rejection_proven,false);assert.equal(diagnostic.readback_required,true);
 assert.equal(diagnostic.automatic_retry_allowed,false);assert.equal(diagnostic.authority_effect,false);assert.equal(diagnostic.production_qualified,false);
 assert.equal(/secret|private stderr|Generated objective|stack|cause|stderr/.test(text),false);
 await assert.rejects(fs.stat(f.semanticFile),{code:'ENOENT'});
 const rejected=await f.service.READ_SEED(f.input);assert.equal(rejected.state,'REJECTED_BEFORE_DISPATCH');
 assert.equal(rejected.rejection.admission_absent,true);assert.equal(rejected.rejection.semantic_fence_absent,true);
 assert.equal(Object.hasOwn(rejected,'diagnostic'),false);
 const reads=f.seen.scopes;assert.deepEqual(await f.service.SEED_GOAL(f.input),rejected);assert.equal(f.seen.scopes,reads);
 const restarted=await createNativeCodingHostSeedService(f.options);t.after(()=>restarted.close());
 assert.deepEqual(await restarted.READ_SEED(f.input),rejected);assert.equal(f.seen.dispatches,0);
 assert.deepEqual(await f.diagnostic(),diagnostic);
});

test('unrecognized errors persist only a fixed generic reason and no arbitrary strings',async t=>{
 const f=await fixture(t);f.setScope(async()=>{throw Error('native_coding_host_seed_observation_window_exceeded /private/token=abc');});
 await assert.rejects(f.service.SEED_GOAL(f.input));
 const diagnostic=await f.diagnostic();assert.equal(diagnostic.reason,'OBSERVATION_FAILED');
 assert.equal(/private|token|abc/.test(json(diagnostic)),false);assert.equal(f.seen.dispatches,0);
});

test('failed diagnostic persistence preserves the original failure and releases only its semantic latch',async t=>{
 const f=await fixture(t),error=Error('generated_observation_failure');
 await fs.mkdir(f.diagnosticFile);f.setScope(async()=>{throw error;});
 await assert.rejects(f.service.SEED_GOAL(f.input),value=>value===error);
 assert.equal((await f.service.READ_SEED(f.input)).state,'REJECTED_BEFORE_DISPATCH');assert.equal(f.seen.dispatches,0);
});

test('a diagnostic exists while the semantic latch is still unresolved and cannot authorize rejection',async t=>{
 const f=await fixture(t),written=deferred(),release=deferred();
 f.setScope(async()=>{throw Error('generated_observation_failure');});
 f.setVerify(async file=>{if(file===f.diagnosticFile){written.resolve();await release.promise;}});
 const pending=f.service.SEED_GOAL(f.input);const outcome=assert.rejects(pending,/generated_observation_failure/);
 await written.promise;
 assert.equal((await f.diagnostic()).rejection_proven,false);
 const unresolved=await f.service.READ_SEED(f.input);assert.equal(unresolved.state,'READBACK_ONLY');assert.equal(unresolved.admission,null);
 release.resolve();await outcome;
 assert.equal((await f.service.READ_SEED(f.input)).state,'REJECTED_BEFORE_DISPATCH');assert.equal(f.seen.dispatches,0);
});

test('a failed semantic unlink leaves the request unknown even beside a completed diagnostic',async t=>{
 const f=await fixture(t),unlink=fs.unlink;
 t.mock.method(fs,'unlink',async file=>{if(file===f.semanticFile)throw Object.assign(Error('generated_unlink_failure'),{code:'EACCES'});return unlink(file);});
 f.setScope(async()=>{throw Error('native_coding_host_seed_physical_scope_changed');});
 await assert.rejects(f.service.SEED_GOAL(f.input),{code:'EACCES'});
 assert.equal((await f.diagnostic()).reason,'PHYSICAL_SCOPE_CHANGED');
 const result=await f.service.READ_SEED(f.input);assert.equal(result.state,'READBACK_ONLY');assert.equal(result.admission,null);
 assert.equal(f.seen.dispatches,0);
});

test('an ambiguous SQL attempt emits no pre-dispatch diagnostic and cannot replay under a new UUID',async t=>{
 const f=await fixture(t);assert.equal((await f.service.SEED_GOAL(f.input)).state,'READBACK_REQUIRED');
 await assert.rejects(fs.stat(f.diagnosticFile),{code:'ENOENT'});
 assert.equal((await f.service.READ_SEED(f.input)).state,'READBACK_ONLY');
 const alias=await f.service.SEED_GOAL({...f.input,request_id:randomUUID()});
 assert.equal(alias.state,'READBACK_REQUIRED');assert.equal(alias.original_request_id,f.input.request_id);assert.equal(f.seen.dispatches,1);
});

test('one native batch receives the complete roster and retains each role validation',async t=>{
 const f=await fixture(t);let batches=0;
 f.native.batch=async(permits,includeSandbox)=>{batches++;assert.equal(includeSandbox,true);
  assert.deepEqual(permits,f.profile.agents.map(agent=>({...f.profile,...agent})));return Promise.all(permits.map(f.defaultScope));};
 assert.equal((await f.service.SEED_GOAL(f.input)).state,'READBACK_REQUIRED');
 assert.equal(batches,1);assert.equal(f.seen.scopes,0);assert.equal(f.seen.dispatches,1);
});

test('malformed or cross-role batch observations fail before SQL with a bounded diagnosis',async t=>{
 for(const mode of ['short','long','object','cross-role']){
  const f=await fixture(t);
  f.native.batch=async permits=>{const values=await Promise.all(permits.map(f.defaultScope));
   if(mode==='short')return values.slice(0,1);if(mode==='long')return [...values,values[0]];if(mode==='object')return {};
   return values.reverse();};
  await assert.rejects(f.service.SEED_GOAL(f.input),/physical_scope_changed/);
  assert.equal((await f.diagnostic()).reason,'PHYSICAL_SCOPE_CHANGED');assert.equal(f.seen.dispatches,0);
 }
});

test('batch observations exceeding the original freshness window remain rejected',async t=>{
 const f=await fixture(t);let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 f.native.batch=async permits=>{clock+=25001;return Promise.all(permits.map(f.defaultScope));};
 await assert.rejects(f.service.SEED_GOAL(f.input),/observation_window_exceeded/);
 assert.equal((await f.diagnostic()).reason,'OBSERVATION_WINDOW_EXCEEDED');assert.equal(f.seen.dispatches,0);
});

test('profile revalidation cannot re-date a stale physical observation',async t=>{
 const f=await fixture(t);let clock=Date.now(),observed=false;t.mock.method(Date,'now',()=>clock);
 f.native.batch=async permits=>{observed=true;return Promise.all(permits.map(f.defaultScope));};
 f.setProfileHook(()=>{if(observed)clock+=25001;});
 await assert.rejects(f.service.SEED_GOAL(f.input),/observation_window_exceeded/);
 assert.equal((await f.diagnostic()).reason,'OBSERVATION_WINDOW_EXCEEDED');assert.equal(f.seen.dispatches,0);
});

test('valid physical observation timestamp remains the beginning of the read, not revalidation completion',async t=>{
 const f=await fixture(t);let clock=Date.now(),observed=false;const started=clock;t.mock.method(Date,'now',()=>clock);
 f.native.batch=async permits=>{clock+=1000;observed=true;return Promise.all(permits.map(f.defaultScope));};
 f.setProfileHook(()=>{if(observed)clock+=1000;});
 f.sql.begin=async(_isolation,run)=>{f.seen.dispatches++;return run({unsafe:async(query,args)=>{
  if(query==='set local synchronous_commit=on')return[];
  if(query==='select current_user::text as current_user,session_user::text as session_user')return[{current_user:'state_owner',session_user:'state_owner'}];
  if(query.includes('native_coding_seed_goal_v1')){f.seen.observation=JSON.parse(args[3]);throw Error('generated_lost_sql_ack');}
  throw Error('Unexpected generated query');
 }});};
 assert.equal((await f.service.SEED_GOAL(f.input)).state,'READBACK_REQUIRED');
 assert.equal(f.seen.observation.observed_at,new Date(started).toISOString());assert.equal(f.seen.dispatches,1);
});

test('closing while a physical batch is pending cannot dispatch its late result',async t=>{
 const f=await fixture(t),started=deferred(),release=deferred();
 f.native.batch=async permits=>{started.resolve();await release.promise;return Promise.all(permits.map(f.defaultScope));};
 const pending=f.service.SEED_GOAL(f.input),outcome=assert.rejects(pending,/native_coding_host_seed_closed/);
 await started.promise;f.service.close();release.resolve();await outcome;
 assert.equal((await f.diagnostic()).reason,'HOST_SERVICE_CLOSED');assert.equal(f.seen.dispatches,0);
 const restarted=await createNativeCodingHostSeedService(f.options);t.after(()=>restarted.close());
 assert.equal((await restarted.READ_SEED(f.input)).state,'REJECTED_BEFORE_DISPATCH');
});

test('cancelled seed request cannot enter profile reads or SQL admission',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();
 const before=f.seen.profiles;
 await assert.rejects(f.service.SEED_GOAL(f.input,{signal:controller.signal}),/request_cancelled/);
 assert.equal(f.seen.profiles,before);assert.equal(f.seen.dispatches,0);
});

test('cancellation during physical observation prevents later SQL admission and preserves rejection readback',async t=>{
 const f=await fixture(t),controller=new AbortController();
 f.setScope(async permit=>{controller.abort();return f.defaultScope(permit);});
 await assert.rejects(f.service.SEED_GOAL(f.input,{signal:controller.signal}),/request_cancelled/);
 assert.equal(f.seen.dispatches,0);
 assert.equal((await f.service.READ_SEED(f.input)).state,'REJECTED_BEFORE_DISPATCH');
});

test('expiry after transaction acquisition cannot dispatch the seed mutation',async t=>{
 const f=await fixture(t),controller=new AbortController();let mutationCalls=0;
 f.sql.begin=async(_options,callback)=>{
  controller.abort();
  return callback({unsafe:async(query,args)=>{
   if(query==='set local synchronous_commit=on')return [];
   if(query.includes('native_coding_seed_goal_v1')){mutationCalls++;throw Error('late mutation forbidden');}
   return f.sql.unsafe(query,args);
  }});
 };
 const result=await f.service.SEED_GOAL(f.input,{signal:controller.signal});
 assert.equal(mutationCalls,0);assert.equal(result.state,'READBACK_REQUIRED');
 assert.equal(result.automatic_retry_allowed,false);
});
