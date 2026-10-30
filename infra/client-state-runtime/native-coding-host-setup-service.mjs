import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {NATIVE_SETUP_ACTIONS,validateNativeSetupInput,validateNativeSetupRoots} from '../../apps/metaengine-browser/src/native-coding-setup-contract.mjs';
import {readAgentResourceAdmission} from '../../apps/metaengine-browser/src/agent-resource-admission.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {runNativePhysicalSettlementScope,markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
const fail=reason=>{throw Error('native_setup_'+reason);};
const same=(a,b)=>json(a)===json(b);
const selectors=input=>({operation_id:input.operation_id,workspace_id:input.workspace_id});
// Native Host-only constructor. runJob is intentionally UNBOUND in production
// Phase3A. Private fixture callbacks exercise custody, never grant readiness.
export function createNativeCodingHostSetupService({sql,hostInstanceId,hostPid,pgDataDirectory,postgresIdentity,postgresContinuity,
 readRootIdentity=readDirectoryIdentity,readAdmission=readAgentResourceAdmission,readCapacityEvidence=null,runJob=null}={}){
 if(typeof sql?.begin!=='function'||typeof sql?.unsafe!=='function'||!path.isAbsolute(pgDataDirectory||'')
  ||postgresContinuity?.schema!=='metaengine.client-state.postgres-continuity.v1'||!Number.isSafeInteger(postgresIdentity?.pid)||postgresIdentity.pid<1||!Number.isFinite(Date.parse(postgresIdentity.started_at))
  ||readCapacityEvidence!==null&&typeof readCapacityEvidence!=='function'||![readRootIdentity,readAdmission].every(f=>typeof f==='function')||runJob!==null&&typeof runJob!=='function')fail('dependencies_required');
 const verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId,hostPid}),context=createNativeCodingAuthenticatedRequestContext({verifier});
 let closed=false,custodyRevision=0;const jobs=new Map(),invocations=new Set(),reservations=new Set();
 const open=request=>{if(closed)fail('closed');assertNativeCodingHostRequestOpen(request);};
 async function repository(tx,actor,workspace){
  const role=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
  if(role.length!==1||role[0].current_user!=='state_owner'||role[0].session_user!=='state_owner')fail('state_owner_required');
  await tx.unsafe('select destruktion_meta.project_device_grant_h205f22($1::uuid,$2::text,$3::bigint)',[actor.device_id,actor.client_id,actor.admin_grant_epoch]);
  const rows=await tx.unsafe(`select r.coordination_workspace_id,r.device_id,r.client_id,r.admin_grant_epoch,r.repo_id,r.repo_root,r.managed_root
   from public.compute_fabric_a2_managed_project_repository_h205f22 r
   join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=r.device_id and d.client_id=r.client_id
   join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p on p.token_hash=d.enrollment_pairing_token_hash
   where r.coordination_workspace_id=$1::uuid and r.device_id=$2::uuid and r.client_id=$3::text
   and r.admin_grant_epoch=$4::bigint and d.key_fingerprint_sha256=$5::text and p.active for share of r,d,p`,
   [workspace,actor.device_id,actor.client_id,actor.admin_grant_epoch,actor.key_fingerprint_sha256]);
  if(rows.length!==1)fail('repository_denied');const row={...rows[0],admin_grant_epoch:Number(rows[0].admin_grant_epoch)};
  validateNativeSetupRoots(row.repo_root,row.managed_root);
  return row;
 }
 async function readPostgres(tx){
   const pg=await tx.unsafe(`select current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
    (select system_identifier::text from pg_control_system()) as system_identifier,inet_server_port() as port,
    pg_postmaster_start_time() as started_at,to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at_us`);
   if(pg.length!==1||pg[0].version<170000||pg[0].version>=180000||path.resolve(pg[0].data_directory)!==pgDataDirectory
    ||new Date(pg[0].started_at).getTime()!==new Date(postgresIdentity.started_at).getTime()||pg[0].system_identifier!==postgresIdentity.system_identifier||pg[0].port!==postgresIdentity.port)fail('postgres_changed');
   return {...pg[0],started_at:new Date(pg[0].started_at).toISOString()};
 }
 async function verifyPostgres(pg){
  const proof=await runtimeRecoveryPostgresProof({identity:{...pg,pid:postgresIdentity.pid},pgDataDirectory});
  if(!same(proof,postgresContinuity))fail('postgres_changed');return proof;
 }
 async function discover(actor,input,request){
  open(request);
  const snapshot=()=>sql.begin('isolation level serializable',async tx=>({repo:await repository(tx,actor,input.workspace_id),pg:await readPostgres(tx)}));
  const first=await snapshot();open(request);
  const before=await verifyPostgres(first.pg);open(request);
  // These are actual canonical filesystem identities, not caller/random digests.
  const repoIdentity=await readRootIdentity(first.repo.repo_root),managedIdentity=await readRootIdentity(first.repo.managed_root),pgIdentity=await readRootIdentity(pgDataDirectory);open(request);
  const second=await snapshot();open(request);
  const after=await verifyPostgres(second.pg);open(request);
  if(!same(second,first)||!same(before,after))fail('repository_or_postgres_changed');const current=second.repo;
  return {schema:'metaengine.native-coding.setup-discovery.v1',workspace_id:input.workspace_id,repository:current,
   repository_scope_sha256:sha(current),repo_root_identity_sha256:repoIdentity,managed_root_identity_sha256:managedIdentity,
   postgres:{system_identifier:first.pg.system_identifier,version:first.pg.version,data_directory_identity_sha256:pgIdentity,postmaster:{pid:before.pid,started_at:before.started_at,started_at_us:first.pg.started_at_us,pid_file_sha256:before.postmaster_pid_sha256}},
   host_instance_id:hostInstanceId,host_pid:hostPid,capabilities:{discovery:true,operation_readback:true,materialization:false},
   required_inputs:['EXPLICIT_CLI_HOME_CHOICES','CLI_AUTHENTICATION','GENUINE_SANDBOX_EVIDENCE'],
   prepared:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 }
 async function readRoute(actor,input,request){
  open(request);
  const observed=await sql.begin('isolation level serializable',async tx=>{
   let repo=null;if(input.workspace_id!==null)repo=await repository(tx,actor,input.workspace_id);
   else{
    const role=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
    if(role.length!==1||role[0].current_user!=='state_owner'||role[0].session_user!=='state_owner')fail('state_owner_required');
    await tx.unsafe('select destruktion_meta.project_device_grant_h205f22($1::uuid,$2::text,$3::bigint)',[actor.device_id,actor.client_id,actor.admin_grant_epoch]);
    const key=await tx.unsafe(`select d.key_fingerprint_sha256 from public.compute_fabric_a2_browser_device_h205f22 d
     join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p on p.token_hash=d.enrollment_pairing_token_hash
     where d.device_id=$1::uuid and d.client_id=$2::text and p.active for share of d,p`,[actor.device_id,actor.client_id]);
    if(key.length!==1||key[0].key_fingerprint_sha256!==actor.key_fingerprint_sha256)fail('device_changed');
   }
   // Historical key/grant/Host identity is deliberately NOT a filter: rotation
   // cannot erase an ambiguous native choice or confer its previous authority.
   const [row]=await tx.unsafe(`select exists(select 1 from destruktion_meta.native_coding_setup_operation_h205f22
    where intent#>>'{actor,device_id}'=$1::text and intent#>>'{actor,client_id}'=$2::text
    and ($3::uuid is null or intent->>'workspace_id'=$3::text)) as retained`,[actor.device_id,actor.client_id,input.workspace_id]);
   open(request);
   return {pg:await readPostgres(tx),value:{schema:'metaengine.native-coding.setup-route.v1',workspace_id:input.workspace_id,repository_scope_sha256:repo?sha(repo):null,...actor,
    host_instance_id:hostInstanceId,host_pid:hostPid,retained_intent:row.retained,scope_resolved:input.workspace_id!==null||!row.retained,
    prepared:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false}};
  });
  open(request);await verifyPostgres(observed.pg);open(request);
  const after=await sql.begin('isolation level serializable',readPostgres);await verifyPostgres(after);open(request);
  if(!same(after,observed.pg))fail('postgres_changed');return observed.value;
 }
 async function transition(action,actor,input,value={},request){
  if(request)open(request);
  let capacity=null,ceiling=null;
  if(readCapacityEvidence&&action==='BEGIN'){
   capacity=await readCapacityEvidence({actor,request});if(request)open(request);
   const admission=readAdmission();
   if(admission?.physical_start_allowed!==true||!Number.isSafeInteger(admission.physical_parallelism)||admission.physical_parallelism<1)fail('physical_admission_hold');
   ceiling=admission.physical_parallelism;
  }
  return sql.begin('isolation level serializable',async tx=>{
   if(request)open(request);
   if(action!=='READ')await tx.unsafe('set local synchronous_commit=on');
   const rows=readCapacityEvidence
    ?await tx.unsafe('select destruktion_meta.native_coding_setup_operation_v2($1::text,$2::text::jsonb,$3::text::jsonb,$4::text::jsonb,$5::text::jsonb,$6::bigint) as value',
      [action,json(actor),json(input),json(value),json(capacity),ceiling])
    :await tx.unsafe('select destruktion_meta.native_coding_setup_operation_v1($1::text,$2::text::jsonb,$3::text::jsonb,$4::text::jsonb) as value',
      [action,json(actor),json(input),json(value)]);
   if(rows.length!==1)fail('readback_invalid');if(request){open(request);tx.addCommitGuard?.(()=>open(request));}
   return rows[0].value;
  });
 }
 function project(row,input){
  let state=row?.state||'NOT_STARTED',reason=row?.reason||null;
  const owned=row&&jobs.get(row.operation_id),sameHost=row?.intent?.host_instance_id===hostInstanceId&&row?.intent?.host_pid===hostPid;
  if(row&&['INTENT','RUNNING','CANCEL_REQUESTED'].includes(state)&&(!sameHost||!owned?.work||owned.custodyId!==row.custody_id)){
   state='HOLD';reason=sameHost?'CUSTODY_UNCONFIRMED':'HOST_CHANGED';
  }
  if(owned?.finished&&!owned.physicalConfirmed){state='HOLD';reason='CLEANUP_UNCONFIRMED';}
  return {schema:'metaengine.native-coding.setup-operation.v1',...selectors(input),state,reason,
   cancellation_requested:row?.state==='CANCEL_REQUESTED'||row?.reason==='CANCELLED',
   cleanup_state:owned&&!owned.physicalConfirmed?'HOLD':row?.cleanup_state||'DRAINED',materialization_available:false,
   materialization_outcome:row?.reason==='MATERIALIZATION_UNAVAILABLE'?'NOT_STARTED':'UNKNOWN',
   prepared:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 }
 async function begin(actor,input,request){
  const observation=await discover(actor,input,request);
  for(const key of ['repository_scope_sha256','repo_root_identity_sha256','managed_root_identity_sha256'])if(input[key]!==observation[key])fail('discovery_changed');
  // A duplicate is READ only, regardless of a missing registry/generation.
  const before=await transition('READ',actor,selectors(input),{},request);
  if(before.operation){
   if(Object.keys(input).some(k=>before.operation.intent[k]!==input[k]))fail('operation_conflict');
   return project(before.operation,input);
  }
  const admission=readAdmission();if(admission?.schema!=='metaengine.agent-resource-admission.v1'||admission.physical_start_allowed!==true
   ||!Number.isSafeInteger(admission.physical_parallelism)||jobs.size+reservations.size>=admission.physical_parallelism)fail('physical_admission_hold');
  const reservation={};reservations.add(reservation);try{
  const intent={...input,actor,repository:observation.repository,postgres:observation.postgres,host_instance_id:hostInstanceId,host_pid:hostPid};
  const created=await transition('BEGIN',actor,intent,{},request);
  if(!created.created)return project(created.operation,input);
  // Durable ledger precedes registration; any crash in this gap leaves INTENT
  // forever read-only/HOLD, never a replayable job. Register BEFORE CLAIM/ACK.
  open(request);const row={operationId:input.operation_id,custodyId:randomUUID(),actor,input,observation,
   abort:new AbortController(),work:null,physicalConfirmed:true};jobs.set(input.operation_id,row);custodyRevision++;
  let claimed;
  try{claimed=await transition('CLAIM',actor,selectors(input),{custody_id:row.custodyId,host_instance_id:hostInstanceId,host_pid:hostPid},request);}
  catch(error){jobs.delete(input.operation_id);custodyRevision++;throw error;} // no job has started; durable ambiguity is retained.
  try{open(request);}catch(error){jobs.delete(input.operation_id);custodyRevision++;throw error;}
  const scope=runNativePhysicalSettlementScope(async()=>{
   const revalidate=async()=>{
    if(closed||row.abort.signal.aborted)fail('cancelled');
    const fresh=await discover(actor,input);if(!same(fresh.repository,observation.repository)||!same(fresh.postgres,observation.postgres)
     ||fresh.repo_root_identity_sha256!==input.repo_root_identity_sha256||fresh.managed_root_identity_sha256!==input.managed_root_identity_sha256)fail('scope_changed');
    const durable=await transition('READ',actor,selectors(input));
    if(durable.operation?.state!=='RUNNING'||durable.operation.custody_id!==row.custodyId){row.abort.abort();fail('cancelled_or_custody_changed');}
    if(closed||row.abort.signal.aborted)fail('cancelled');
   };
   let result={cleanup_confirmed:true,reason:'MATERIALIZATION_UNAVAILABLE'};
   if(runJob){await revalidate();row.physicalConfirmed=false;result=await runJob(Object.freeze({signal:row.abort.signal,revalidate,observation:structuredClone(observation)}));}
   if(scope.unconfirmed())fail('job_cleanup_unconfirmed');
   if(result?.cleanup_confirmed!==true||!['MATERIALIZATION_UNAVAILABLE','EVIDENCE_REQUIRED'].includes(result.reason))fail('job_cleanup_unconfirmed');
   row.physicalConfirmed=true;
   await transition('TERMINAL',actor,selectors(input),{custody_id:row.custodyId,state:row.abort.signal.aborted?'STOPPED':'HOLD',
    reason:row.abort.signal.aborted?'CANCELLED':result.reason,cleanup_state:'DRAINED'});
  });
  custodyRevision++;row.work=scope.promise.catch(()=>{}).finally(()=>{row.finished=true;if(scope.unconfirmed())row.physicalConfirmed=false;if(row.physicalConfirmed)jobs.delete(input.operation_id);custodyRevision++;});
  // There is no production materializer in 3A; do not even briefly advertise
  // it as running/prepared. Fixture cold jobs return only lifecycle acceptance.
  if(!runJob){await row.work;return project((await transition('READ',actor,selectors(input),{},request)).operation,input);}
  return project(claimed.operation,input);
  }finally{reservations.delete(reservation);}
 }
 async function handle(action,actor,input,request){
  open(request);
  if(action==='READ_NATIVE_SETUP_ROUTE_V1')return readRoute(actor,input,request);
  if(action==='DISCOVER_NATIVE_SETUP_V1')return discover(actor,input,request);
  if(action==='BEGIN_NATIVE_SETUP_V1')return begin(actor,input,request);
  const value=await transition(action==='CANCEL_NATIVE_SETUP_V1'?'CANCEL':'READ',actor,input,{},request);
  if(action==='CANCEL_NATIVE_SETUP_V1'||value.operation?.state==='CANCEL_REQUESTED')jobs.get(input.operation_id)?.abort.abort();
  if(value.operation){const fresh=await discover(actor,input,request);if(!same(fresh.postgres,value.operation.intent.postgres))return {...project(value.operation,input),state:'HOLD',reason:'POSTGRES_CHANGED'};}
  return project(value.operation,input);
 }
 const operations=Object.freeze(Object.fromEntries(NATIVE_SETUP_ACTIONS.map(action=>[action,(packet,request)=>{
  const work=Promise.resolve().then(()=>{open(request);return context.run(action,packet,async input=>handle(action,await context.readCurrentDevice(),validateNativeSetupInput(action,input),request));});
  invocations.add(work);const done=()=>invocations.delete(work);work.then(done,done);return work;
 }])));
 function close(){if(!closed)custodyRevision++;closed=true;for(const row of jobs.values())row.abort.abort();context.close();verifier.close();}
 async function drain(){
  while(invocations.size)await Promise.allSettled([...invocations]);
  await Promise.allSettled([...jobs.values()].map(row=>row.work));
  if([...jobs.values()].some(row=>!row.physicalConfirmed))throw markNativePhysicalSettlementUnconfirmed(Error('native_setup_job_cleanup_unconfirmed'));
 }
 return Object.freeze({operations,close,drain,
  // Host-private custody projection, never an IPC action or caller proof. No
  // terminal row is resolved here; cleanup/readback evidence is separate.
  readCapacityCustody:()=>Object.freeze({closed,revision:custodyRevision,jobs:[...jobs.values()].map(row=>({
   operation_id:row.operationId,custody_id:row.custodyId,device_id:row.actor.device_id,client_id:row.actor.client_id,
   admin_grant_epoch:row.actor.admin_grant_epoch,active:!!row.work&&!row.finished}))}),
  snapshot:()=>Object.freeze({active_jobs:jobs.size,pending_handoffs:reservations.size,active_requests:invocations.size,closed,authority_effect:false})});
}
