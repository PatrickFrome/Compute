import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
const same=(a,b)=>json(a)===json(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
const fail=reason=>{throw Error('native_coding_host_seed_'+reason);};
const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
// This allowlist deliberately excludes arbitrary exception text, stderr, paths,
// SQL and credentials. A diagnostic is not an admission/rejection receipt.
const observationFailureReasons=new Map([
 ['native_coding_host_seed_observation_window_exceeded','OBSERVATION_WINDOW_EXCEEDED'],
 ['native_coding_host_seed_physical_scope_changed','PHYSICAL_SCOPE_CHANGED'],
 ['native_coding_host_seed_process_identity_invalid','PROCESS_IDENTITY_INVALID'],
 ['native_coding_host_seed_process_birth_invalid','PROCESS_IDENTITY_INVALID'],
 ['native_coding_host_seed_profile_unverified','PROFILE_UNVERIFIED'],
 ['native_coding_seed_profile_unavailable','PROFILE_UNAVAILABLE'],
 ['native_coding_seed_profile_invalid','PROFILE_UNVERIFIED'],
 ['native_coding_seed_profile_scope_invalid','PROFILE_UNVERIFIED'],
 ['native_coding_seed_device_changed','CURRENT_DEVICE_CHANGED'],
 ['native_coding_host_seed_operator_changed','OPERATOR_CHANGED'],
 ['native_coding_host_seed_current_device_changed','CURRENT_DEVICE_CHANGED'],
 ['native_coding_host_seed_closed','HOST_SERVICE_CLOSED'],
 ['native_coding_host_os_postgres_incarnation_unverified','POSTGRES_IDENTITY_UNVERIFIED'],
 ['native_coding_host_os_postgres_changed','POSTGRES_IDENTITY_CHANGED'],
 ['native_coding_host_os_browser_parent_unverified','BROWSER_PARENT_UNVERIFIED'],
 ['native_coding_host_os_installed_artifact_mismatch','INSTALLED_ARTIFACT_MISMATCH'],
 ['native_coding_host_os_image_preparation_invalidated','INSTALLED_IMAGE_CHANGED'],
 ['native_coding_observer_native_process_unavailable','NATIVE_PROCESS_UNAVAILABLE'],
 ['native_coding_observer_private_storage_unverified','PRIVATE_STORAGE_UNVERIFIED'],
]);
function request(value){
 if(!exact(value,['request_id','objective'])||!UUID.test(value.request_id||'')||typeof value.objective!=='string'
  ||value.objective!==value.objective.trim()||!value.objective||[...value.objective].length>480
  ||Buffer.byteLength(value.objective)>1920||value.objective.includes('\0'))fail('request_invalid');
 return structuredClone(value);
}
function processIdentity(p){
 if(!exact(p,['pid','created_at','process_incarnation_id'])||!Number.isSafeInteger(p.pid)||p.pid<1)fail('process_identity_invalid');
 const m=/^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]*)$/.exec(p.process_incarnation_id||'');
 const ms=Date.parse(p.created_at||'');
 if(!m||Number(m[1])!==p.pid||!Number.isFinite(ms)||new Date(ms).toISOString()!==p.created_at
  ||(BigInt(m[2])-116444736000000000n)/10000n!==BigInt(ms))fail('process_birth_invalid');
}
export async function readNativeCodingSeedOperator(stateDirectory){
 const result=await readNativeCodingProtectedJson(path.join(stateDirectory,'native-coding-seed-operator-v1.json'));
 const v=result.value;
 if(!exact(v,['schema','profile_id','profile_sha256'])||v.schema!=='metaengine.native-coding.seed-operator.v1'
  ||!UUID.test(v.profile_id||'')||!HASH.test(v.profile_sha256||''))fail('operator_invalid');
 return result;
}
async function durable(file,value){
 const h=await fs.open(file,'wx',0o600);try{await h.writeFile(json(value)+'\n');await h.sync();}finally{await h.close();}
}

/** Private Host only. The UI supplies a UUID/objective, never profile, identity,
 * DSN, path, permit, SQL or an evidence object. All readers are private bindings.
 * Missing operator/profile is an inactive capability, never implicit consent. */
export async function createNativeCodingHostSeedService({sql,stateDirectory,readNativeScope,readCurrentDevice,
 readOperator=readNativeCodingSeedOperator,readProtectedJson=readNativeCodingProtectedJson,
 protectStorage=protectOwnerOnlyWindowsDirectory,verifyStorage=verifyOwnerOnlyWindowsStorage}={}){
 if(!path.isAbsolute(stateDirectory||'')||typeof sql?.unsafe!=='function'||typeof sql?.begin!=='function'
  ||![readNativeScope,readCurrentDevice,readOperator,readProtectedJson,protectStorage,verifyStorage].every(f=>typeof f==='function'))fail('private_dependencies_required');
 let closed=false;
 const open=()=>{if(closed)fail('closed');};
 async function owner(db=sql){open();const rows=await db.unsafe('select current_user::text as current_user,session_user::text as session_user');
  if(rows.length!==1||rows[0].current_user!=='state_owner'||rows[0].session_user!=='state_owner')fail('state_owner_required');}
 await owner();
 const operator=await readOperator(stateDirectory),pins=operator.value;
 if(!exact(pins,['schema','profile_id','profile_sha256'])||pins.schema!=='metaengine.native-coding.seed-operator.v1'
  ||!UUID.test(pins.profile_id||'')||!HASH.test(pins.profile_sha256||''))fail('operator_invalid');
 // Cold immutable-byte qualification belongs to private capability startup,
 // before any signed request or physical-observation freshness window.
 await readNativeScope.prepare?.();
 const directory=path.join(stateDirectory,'native-coding-seed-intents-v1');
 await fs.mkdir(directory,{recursive:true,mode:0o700});await protectStorage(directory);await verifyStorage(directory,{operation:'VERIFY_DIRECTORY'});
 async function unchanged(){open();const now=await readOperator(stateDirectory);
  if(now.sha256!==operator.sha256||!same(now.value,pins))fail('operator_changed');}
 async function profile(active){
  await owner();await unchanged();
  const rows=await sql.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1::uuid,$2::boolean) as value',[pins.profile_id,active]);
  const value=rows[0]?.value,p=value?.profile;
  if(rows.length!==1||value.schema!=='metaengine.native-coding.seed-profile-readback.v1'||value.profile_sha256!==pins.profile_sha256
   ||typeof value.canonical_profile!=='string'||digest(value.canonical_profile)!==pins.profile_sha256
   ||!same(JSON.parse(value.canonical_profile),p)||p.profile_id!==pins.profile_id||p.trust_namespace!=='LOCAL_OPERATOR_QA'
   ||p.production_qualified!==false||p.automatic_retry_allowed!==false||p.authority_effect!==false
   ||!Array.isArray(p.agents)||p.agents.length<2)fail('profile_unverified');
  await currentDevice(p);
  await unchanged();return p;
 }
 async function currentDevice(p){
  const device=await readCurrentDevice();
  if(!exact(device,['device_id','client_id','key_fingerprint_sha256','admin_grant_epoch'])
   ||device.device_id!==p.device_id||device.client_id!==p.client_id||device.key_fingerprint_sha256!==p.device_key_fingerprint_sha256
   ||device.admin_grant_epoch!==p.admin_grant_epoch)fail('current_device_changed');
 }
 function readback(value,input){
  if(value===null)return null;
  const r=value?.receipt;
  if(value?.schema!=='metaengine.native-coding.seed-readback.v1'||value.profile_id!==pins.profile_id
   ||value.request_id!==input.request_id||!same(value.body,input)||JSON.parse(value.canonical_body_text||'null')===null
   ||!same(JSON.parse(value.canonical_body_text),input)||digest(value.canonical_body_text)!==value.body_sha256
   ||typeof value.canonical_receipt!=='string'||digest(value.canonical_receipt)!==value.receipt_sha256
   ||!same(JSON.parse(value.canonical_receipt),r)||r?.schema!=='metaengine.native-coding.goal-admission.v1'||r.state!=='ADMITTED'
   ||r.request_id!==input.request_id||r.objective!==input.objective||r.profile_id!==pins.profile_id||r.profile_sha256!==pins.profile_sha256
   ||![r.workspace_id,r.project_id,r.root_task_id,r.goal_id].every(x=>UUID.test(x||''))
   ||![r.goal_sha256,r.task_spec_sha256].every(x=>HASH.test(x||''))||!Array.isArray(r.permit_ids)||r.permit_ids.length<2
   ||r.permit_ids.some(x=>!UUID.test(x||''))||['physical_execution_proven','global_actuation_granted','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>r[k]!==false)
   ||value.readback_only!==true||value.physical_effect_replayed!==false||value.authority_effect!==false)fail('readback_unverified');
  return structuredClone(value);
 }
 async function read(input){
  await profile(false);
  const rows=await sql.unsafe('select destruktion_meta.native_coding_seed_read_v1($1::uuid,$2::uuid) as value',[pins.profile_id,input.request_id]);
  if(rows.length!==1)fail('readback_unavailable');return readback(rows[0].value,input);
 }
 async function readSeedResult(input){
  const admission=await read(input);
  if(admission)return {state:'READBACK_ONLY',admission,...flags};
  const intent=await saved(path.join(directory,input.request_id+'.json'));
  if(!intent)return {state:'READBACK_ONLY',admission:null,...flags};
  if(intent.schema!=='metaengine.native-coding.seed-intent.v1'||intent.profile_id!==pins.profile_id
   ||intent.profile_sha256!==pins.profile_sha256||!same(intent.body,input)||intent.body_sha256!==digest(json(input)))fail('intent_changed');
  const semanticFile=path.join(directory,'body-'+digest(json({profile_id:pins.profile_id,objective:input.objective}))+'.json');
  if(await saved(semanticFile))return {state:'READBACK_ONLY',admission:null,...flags};
  // The intent is fsynced after its semantic fence. That fence is removed
  // only after a committed admission, or before SQL dispatch on observation
  // failure. Read PG again AFTER observing absence: a racing committed seed
  // must be returned as admitted, never mislabelled as a rejected request.
  const after=await read(input);
  if(after)return {state:'READBACK_ONLY',admission:after,...flags};
  if(await saved(semanticFile))return {state:'READBACK_ONLY',admission:null,...flags};
  await unchanged();
  const rejection={schema:'metaengine.native-coding.seed-rejection.v1',state:'REJECTED_BEFORE_DISPATCH',
   ...input,profile_id:pins.profile_id,profile_sha256:pins.profile_sha256,body_sha256:intent.body_sha256,
   admission_absent:true,semantic_fence_absent:true,automatic_retry_allowed:false,authority_effect:false};
  const rejectionFile=path.join(directory,'rejected-'+input.request_id+'.json');
  try{await durable(rejectionFile,rejection);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!same(await saved(rejectionFile),rejection))fail('rejection_changed');
  return {state:'REJECTED_BEFORE_DISPATCH',admission:null,rejection,...flags};
 }
 async function observation(p){
  let common=null;const agents=[],started=Date.now();
  // Protected roster has no count ceiling; only verified identities are admitted.
  let observations;
  if(typeof readNativeScope.batch==='function'){
   // The native scope implementation shares only fresh common observations
   // inside this invocation. Each returned role remains independently checked.
   observations=await readNativeScope.batch(p.agents.map(a=>({...p,...a})),true);
  }else{
   observations=new Array(p.agents.length);let cursor=0;
   await Promise.all(Array.from({length:Math.min(4,p.agents.length)},async()=>{
    while(cursor<p.agents.length){const i=cursor++,a=p.agents[i];observations[i]=await readNativeScope({...p,...a},true);}
   }));
  }
  if(!Array.isArray(observations)||observations.length!==p.agents.length)fail('physical_scope_changed');
  for(let i=0;i<p.agents.length;i++){
   const a=p.agents[i],actual=observations[i];
   if(!actual||!same(actual.artifact,p.artifact)||!same(actual.postgres,p.postgres)||actual.user_sid!==p.user_sid
    ||!same(actual.worktree,a.worktree)||!same(actual.sandbox,a.sandbox))fail('physical_scope_changed');
   processIdentity(actual.host_process);processIdentity(actual.postgres.postmaster);
   const now={host_process:actual.host_process,user_sid:actual.user_sid,artifact:actual.artifact,postgres:actual.postgres};
   if(common&&!same(common,now))fail('physical_scope_changed');common=now;
   agents.push({provider_id:a.provider_id,worktree:actual.worktree,sandbox:actual.sandbox});
  }
  if(Date.now()-started>25000)fail('observation_window_exceeded');
  await profile(true);
  // Profile/ACL revalidation consumes freshness too. Do not re-date physical
  // observations after those reads or let a slow revalidation admit stale data.
  if(Date.now()-started>25000)fail('observation_window_exceeded');
  return {schema:'metaengine.native-coding.seed-observation.v1',profile_id:pins.profile_id,profile_sha256:pins.profile_sha256,
   observed_at:new Date(started).toISOString(),...common,agents,installed_execution_proven:false,...flags};
 }
 async function saved(file){try{return(await readProtectedJson(file,{maximumBytes:16384})).value;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function seed(raw){
  const input=request(raw);await profile(false);
  const file=path.join(directory,input.request_id+'.json');
  const prior=await saved(file);
  if(prior){
   if(prior.schema!=='metaengine.native-coding.seed-intent.v1'||prior.profile_id!==pins.profile_id||!same(prior.body,input))fail('request_collision');
   return readSeedResult(input);
  }
  const p=await profile(true);
  const semantic=digest(json({profile_id:pins.profile_id,objective:input.objective}));
  const semanticFile=path.join(directory,'body-'+semantic+'.json');
  const unresolved=await saved(semanticFile);
  if(unresolved){
   if(unresolved.schema!=='metaengine.native-coding.seed-body-fence.v1'||unresolved.profile_id!==pins.profile_id
    ||unresolved.objective!==input.objective||!UUID.test(unresolved.request_id||''))fail('body_fence_invalid');
   const original={request_id:unresolved.request_id,objective:input.objective};
   return {state:'READBACK_REQUIRED',original_request_id:original.request_id,admission:await read(original),...flags};
  }
  await durable(semanticFile,{schema:'metaengine.native-coding.seed-body-fence.v1',profile_id:pins.profile_id,...input});
  await verifyStorage(semanticFile,{operation:'VERIFY_FILE'});
  await durable(file,{schema:'metaengine.native-coding.seed-intent.v1',profile_id:pins.profile_id,profile_sha256:pins.profile_sha256,body:input,
   body_sha256:digest(json(input)),created_at:new Date().toISOString(),...flags});
  await verifyStorage(file,{operation:'VERIFY_FILE'});
  // Cold native ACL verification precedes the physical freshness window.
  // A failure here proves no SQL write was dispatched; retain the request
  // journal for readonly reconciliation and release only its semantic latch.
  let observed;const observationStarted=Date.now();
  try{observed=await observation(p);}catch(error){
   // Write diagnostic data before releasing the semantic latch. A crash or
   // failed unlink can therefore leave a diagnostic beside an UNKNOWN fence:
   // only READ_SEED's independent DB/fence checks can prove rejection. Missing
   // diagnostics never turn a known pre-dispatch failure into a permanent fence.
   try{
    const diagnosticFile=path.join(directory,'observation-failed-'+input.request_id+'.json');
    await durable(diagnosticFile,{schema:'metaengine.native-coding.seed-observation-failure.v1',
     request_id:input.request_id,profile_id:pins.profile_id,profile_sha256:pins.profile_sha256,body_sha256:digest(json(input)),
     reason:observationFailureReasons.get(error?.message)||'OBSERVATION_FAILED',
     elapsed_ms:Math.max(0,Math.min(86400000,Math.trunc(Date.now()-observationStarted))),observed_at:new Date().toISOString(),
     diagnostic_only:true,rejection_proven:false,readback_required:true,...flags});
    await verifyStorage(diagnosticFile,{operation:'VERIFY_FILE'});
   }catch{}
   await fs.unlink(semanticFile);throw error;
  }
  try{
   await unchanged();
   const value=await sql.begin('isolation level serializable',async tx=>{
    await tx.unsafe('set local synchronous_commit=on');await owner(tx);
    await currentDevice(p);await unchanged();
    const text=json(observed),rows=await tx.unsafe('select destruktion_meta.native_coding_seed_goal_v1($1::uuid,$2::uuid,$3::text,$4::text::jsonb,$4::text,$5::text) as value',
     [pins.profile_id,input.request_id,input.objective,text,digest(text)]);
    if(rows.length!==1)fail('admission_ack_missing');return readback(rows[0].value,input);
   });
   // A durable exact receipt makes the semantic UNKNOWN fence unnecessary.
   await fs.unlink(semanticFile);return {state:'ADMITTED',admission:value,...flags};
  }catch{
   // No second write, including after a lost transaction COMMIT acknowledgement.
   let admission=null;try{admission=await read(input);}catch{}
   return {state:admission?'READBACK_ONLY':'READBACK_REQUIRED',admission,...flags};
  }
 }
 return Object.freeze({SEED_GOAL:seed,READ_SEED:async raw=>readSeedResult(request(raw)),
  async LIST_SEEDS(raw={}){
   if(!exact(raw,['after_seq','limit'])||!Number.isSafeInteger(raw.after_seq)||raw.after_seq<0||!Number.isSafeInteger(raw.limit)||raw.limit<1||raw.limit>16)fail('page_invalid');
   await profile(false);const rows=await sql.unsafe('select destruktion_meta.native_coding_seed_list_v1($1::uuid,$2::bigint,$3::integer) as value',[pins.profile_id,raw.after_seq,raw.limit]);
   const v=rows[0]?.value;if(rows.length!==1||v?.schema!=='metaengine.native-coding.seed-catalog.v1'||!Array.isArray(v.entries)
    ||v.entries.length>raw.limit||Buffer.byteLength(json(v))>65536||v.authority_effect!==false||v.automatic_retry_allowed!==false)fail('catalog_invalid');return v;
  },close(){closed=true;}});
}
