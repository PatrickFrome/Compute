import {performance} from 'node:perf_hooks';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {nativeCapacityPrincipal,validateNativeCapacityReadInput,validateNativeCapacityCensus,NATIVE_CAPACITY_TTL_MS,NATIVE_CAPACITY_CENSUS_SCHEMA} from '../../apps/metaengine-browser/src/native-coding-capacity-contract.mjs';
const fail=why=>{throw Error('native_capacity_host_'+why);};
const same=(a,b)=>json(a)===json(b);
const HASH=/^[a-f0-9]{64}$/;
// psql's startup JSON preserves all six PostgreSQL fractional digits. Date
// converts only the whole second/timezone; it never truncates identity precision.
export function nativeCapacityPostgresBirth(value){
 const m=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m||!Number.isFinite(Date.parse(m[1]+m[3])))fail('postgres_birth_invalid');
 return new Date(Date.parse(m[1]+m[3])).toISOString().slice(0,19)+'.'+(m[2]||'').padEnd(6,'0')+'Z';
}
// Default Host composition supplies its existing OS reader and setup registry.
// This service observes custody; it cannot allocate work or mark any SQL row
// physically resolved. In particular PROTECTED_RESULT_VERIFIED is NOT a joined
// helper/request/digest terminal witness under the current receipt contract.
export function createNativeCodingHostCapacity({sql,hostInstanceId,hostPid,postgresIdentity,readNativeScope,readSetupCustody,
 now=Date.now,monotonic=()=>performance.now()}={}){
 if(!postgresIdentity?.system_identifier||!Number.isSafeInteger(postgresIdentity.pid)||postgresIdentity.pid<1||typeof sql?.begin!=='function'||typeof sql?.unsafe!=='function'||![readNativeScope,readSetupCustody,now,monotonic].every(x=>typeof x==='function'))fail('dependencies_required');
 const startup=structuredClone(postgresIdentity),startedAt=nativeCapacityPostgresBirth(startup.started_at);let physicalScope=null;
 const verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId,hostPid,now});
 const context=createNativeCodingAuthenticatedRequestContext({verifier,now});
 let closed=false,generation=0,collecting=false,reason='RECOVERY_REQUIRED';const invocations=new Set(),observations=new Map();
 const open=request=>{if(closed)fail('closed');assertNativeCodingHostRequestOpen(request);};
 async function snapshot(actor,custody){
  return sql.begin('isolation level serializable',async tx=>{
   const role=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
   if(role.length!==1||role[0].current_user!=='state_owner'||role[0].session_user!=='state_owner')fail('owner_required');
   await tx.unsafe('select destruktion_meta.project_device_grant_h205f22($1::uuid,$2::text,$3::bigint)',[actor.device_id,actor.client_id,actor.admin_grant_epoch]);
   const device=await tx.unsafe(`select d.key_fingerprint_sha256,d.admin_grant_epoch from public.compute_fabric_a2_browser_device_h205f22 d
    join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p on p.token_hash=d.enrollment_pairing_token_hash
    where d.device_id=$1::uuid and d.client_id=$2::text and p.active`,[actor.device_id,actor.client_id]);
   if(device.length!==1||device[0].key_fingerprint_sha256!==actor.key_fingerprint_sha256||Number(device[0].admin_grant_epoch)!==actor.admin_grant_epoch)fail('identity_changed');
   const [pg]=await tx.unsafe(`select (select system_identifier::text from pg_control_system()) as system_identifier,
    to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at_us`);
   if(pg?.system_identifier!==startup.system_identifier||pg.started_at_us!==startedAt)fail('postgres_incarnation_changed');
   // Whole-device digest is computed inside one SQL snapshot. Wire/memory is
   // bounded by the live physical custody set, NOT logical/history row count.
   const [aggregate]=await tx.unsafe(`select count(*)::text as row_count,
    encode(extensions.digest(convert_to(coalesce(jsonb_agg(r order by r->>'kind',r->>'key'),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') as rows_sha256,
    coalesce(jsonb_agg(r order by r->>'key') filter(where r->>'kind'='SETUP' and r->>'key'=any($3::text[])),'[]'::jsonb) as owned_setup_candidates
    from destruktion_meta.native_coding_capacity_rows_v1($1::uuid,$2::text) r`,[actor.device_id,actor.client_id,custody.jobs.map(x=>x.operation_id)]);
   if(!aggregate||!Number.isSafeInteger(Number(aggregate.row_count))||Number(aggregate.row_count)<0
    ||!HASH.test(aggregate.rows_sha256||'')||!Array.isArray(aggregate.owned_setup_candidates))fail('census_incomplete');
   return {pg,...aggregate};
  });
 }
 async function collect(actor,input,request){
  open(request);if(collecting)fail('collection_inflight');collecting=true;
  const wall=now(),mono=monotonic(),id=++generation;
  const fresh=()=>{open(request);if(now()<wall||monotonic()<mono||now()-wall>=NATIVE_CAPACITY_TTL_MS||monotonic()-mono>=NATIVE_CAPACITY_TTL_MS)fail('collection_expired');};
  try{
   const custody=structuredClone(readSetupCustody());
   if(!custody||custody.closed!==false||!Array.isArray(custody.jobs)||!Number.isSafeInteger(custody.revision))fail('setup_custody_unavailable');
   const first=await snapshot(actor,custody);fresh();
   const native=structuredClone(await readNativeScope(null,false,sql,request));fresh();
   if(!/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(native?.host_process?.process_incarnation_id||'')
    ||native?.postgres?.postmaster?.pid!==startup.pid
    ||!/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(native?.postgres?.postmaster?.process_incarnation_id||'')
    ||!HASH.test(native?.postgres?.data_directory_identity_sha256||'')||native.postgres.system_identifier!==first.pg.system_identifier
    // Identity is exact startup SQL microseconds + PID + full retained native
    // birth/root tuple. This tolerance is ONLY a cross-clock sanity check.
    ||Math.abs(Date.parse(native.postgres.postmaster?.created_at)-Date.parse(first.pg.started_at_us))>1000
    ||!Number.isFinite(Date.parse(native.postgres.postmaster?.created_at)))fail('physical_scope_unverified');
   if(physicalScope&&!same(native,physicalScope))fail('physical_incarnation_changed');
   const ownedSetup=first.owned_setup_candidates.filter(r=>r.kind==='SETUP'&&custody.jobs.some(j=>j.operation_id===r.key&&j.custody_id===r.custody_id
    &&j.device_id===actor.device_id&&j.client_id===actor.client_id&&j.admin_grant_epoch===actor.admin_grant_epoch&&j.active===true))
    .map(r=>({operation_id:r.key,custody_id:r.custody_id,durable_sha256:r.durable_sha256}));
   const evidence={schema:'metaengine.native-coding.capacity-evidence.v1',host_instance_id:hostInstanceId,host_pid:hostPid,
    device_key_fingerprint_sha256:actor.key_fingerprint_sha256,admin_grant_epoch:actor.admin_grant_epoch,
    main_incarnation:native.host_process.process_incarnation_id,postgres_scope_sha256:sha({postgres:native.postgres,started_at_us:first.pg.started_at_us}),
    postgres_system_identifier:first.pg.system_identifier,postgres_started_at_us:first.pg.started_at_us,generation:id,
    observed_at:new Date(wall).toISOString(),expires_at:new Date(wall+NATIVE_CAPACITY_TTL_MS).toISOString(),
    owned_tasks:input.owned_tasks,owned_setup:ownedSetup,resolved:[]};
   if(Buffer.byteLength(json(evidence))>250000)fail('evidence_budget');
   const afterNative=await readNativeScope(null,false,sql,request);fresh();
   const second=await snapshot(actor,custody);fresh();
   if(!same(first,second)||!same(native,afterNative)||!same(custody,readSetupCustody()))fail('collection_changed');
   const counted=await sql.begin('isolation level serializable',async tx=>{
    const values=await tx.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1::uuid,$2::text,$3::bigint,$4::text::jsonb) as value',
     [actor.device_id,actor.client_id,actor.admin_grant_epoch,json(evidence)]);
    if(values.length!==1)fail('census_missing');return values[0].value;
   });fresh();
   // A claim/terminal/cancel can commit during the final count. Join another
   // short snapshot rather than certify an earlier physical row observation.
   const final=await snapshot(actor,custody);fresh();
   if(!same(final,first)||!same(custody,readSetupCustody()))fail('collection_changed');
   const finalNative=await readNativeScope(null,false,sql,request);fresh();
   if(!same(native,finalNative)||!same(custody,readSetupCustody()))fail('physical_scope_changed_during_count');
   if(counted.counts.task_slots+counted.counts.setup_slots!==Number(first.row_count))fail('census_incomplete');
   const complete=true;
   const value=validateNativeCapacityCensus({schema:NATIVE_CAPACITY_CENSUS_SCHEMA,host_instance_id:hostInstanceId,host_pid:hostPid,
    principal_sha256:nativeCapacityPrincipal(actor),
    postgres_scope_sha256:evidence.postgres_scope_sha256,generation:id,owned_tasks_sha256:sha(input.owned_tasks),
    observed_at:evidence.observed_at,expires_at:evidence.expires_at,census_sha256:counted.census_sha256,complete,
    state:complete&&counted.counts.unresolved_slots===0?'CURRENT':'HOLD',counts:counted.counts,automatic_retry_allowed:false,authority_effect:false},
    {ownedTasks:input.owned_tasks,now:now()});
   reason=value.counts.unresolved_slots?'HISTORICAL_SETTLEMENT_UNVERIFIED':!complete?'INCOMPLETE_CENSUS':null;
   for(const [key,row] of observations)if(now()>=row.expires||monotonic()-row.mono>=NATIVE_CAPACITY_TTL_MS)observations.delete(key);
   if(observations.size>=128)fail('observation_budget');
   physicalScope=native;observations.set(id,{actor:structuredClone(actor),value,evidence,expires:wall+NATIVE_CAPACITY_TTL_MS,mono,custody});
   return structuredClone(value);
  }catch(error){reason='CENSUS_UNCONFIRMED';throw error;}finally{collecting=false;}
 }
 const retain=work=>{invocations.add(work);const done=()=>invocations.delete(work);work.then(done,done);return work;};
 const operations=Object.freeze({READ_NATIVE_CAPACITY_V1(packet,request){
  const work=Promise.resolve().then(()=>{open(request);return context.run('READ_NATIVE_CAPACITY_V1',packet,async input=>collect(await context.readCurrentDevice(),validateNativeCapacityReadInput(input),request));});
  return retain(work);
 }});
 return Object.freeze({operations,
  // Only the fixed private heartbeat service calls this. A wire generation or
  // digest can select an extant observation, never reconstruct physical proof.
  readPublicationEvidence({actor,census,host_process,postgres}={}){return retain(Promise.resolve().then(async()=>{
   open();const row=observations.get(census?.generation);
   if(!row||!same(row.actor,actor)||!same(row.value,census)||now()<Date.parse(row.value.observed_at)
    ||now()>=row.expires||monotonic()<row.mono||monotonic()-row.mono>=NATIVE_CAPACITY_TTL_MS)fail('publication_observation_unavailable');
   const native=await readNativeScope(null,false,sql);open();
   if(!same(native,physicalScope)||!same(native.host_process,host_process)||!same(native.postgres,postgres)||!same(row.custody,readSetupCustody())||now()>=row.expires
    ||now()<Date.parse(row.value.observed_at)||monotonic()<row.mono||monotonic()-row.mono>=NATIVE_CAPACITY_TTL_MS||observations.get(census.generation)!==row)fail('publication_scope_changed');
   return structuredClone(row.evidence);
  }));},
  // Authenticated setup service only. Never borrow Main's previous selector
  // set or accept caller evidence; a new whole-device census is required.
  readSetupAdmission({actor,request}={}){return retain(Promise.resolve().then(async()=>{
   const census=await collect(actor,{owned_tasks:[]},request);open(request);
   const row=observations.get(census.generation);
   if(!row||!same(row.actor,actor)||!same(row.value,census)||!same(row.custody,readSetupCustody()))fail('setup_observation_unavailable');
   return structuredClone(row.evidence);
  }));},
  close(){closed=true;observations.clear();context.close();verifier.close();},
  async drain(){while(invocations.size)await Promise.allSettled([...invocations]);},
  snapshot:()=>Object.freeze({closed,collecting,generation,retained_observations:observations.size,reason,authority_effect:false}),
 });
}
