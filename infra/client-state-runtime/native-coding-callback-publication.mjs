import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {nativeCapacityPostgresBirth} from './native-coding-host-capacity.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {nativePhysicalSettlementUnconfirmed,markNativePhysicalSettlementUnconfirmed,runNativePhysicalSettlementScope} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {NATIVE_CALLBACK_PUBLICATION_ACTION,validateNativeCallbackPublicationIntent} from '../../apps/metaengine-browser/src/native-coding-publication-handoff-contract.mjs';
const fail=reason=>{throw Error('native_callback_publication_'+reason);},same=(a,b)=>json(a)===json(b);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const birth=/^pid:([1-9][0-9]*):created_100ns:[1-9][0-9]{16,18}$/;
const ownerKeys=['owner_id','device_id','project_id','pid','created_at','process_incarnation_id','epoch','generation','source_sha','device_key_fingerprint_sha256'];
async function joinedPhysical(physical){
 let value;try{value=await physical.promise;}catch(error){throw physical.unconfirmed()?markNativePhysicalSettlementUnconfirmed(error):error;}
 if(physical.unconfirmed())throw markNativePhysicalSettlementUnconfirmed(Error('native_callback_publication_physical_hold'));return value;
}
const candidate=value=>Object.freeze({state:'ANCHORED_SOURCE_CANDIDATE',publication:structuredClone(value),
 phase1b_settlement:'UNBOUND',ack_delivery:'UNCONFIRMED',send_capability:false,all_effects_cleanup:'UNCONFIRMED',automatic_retry_allowed:false,authority_effect:false});
// Private producer only. The default Host does not mount publication IPC or
// serialize reservation custody; there is no caller-selected path. The default Host
// has NO W74 read-only Owner reader: it stays HOLD rather than accepting epoch
// JSON as that evidence. Fixture suppliers cannot qualify the default gate.
export function createNativeCodingCallbackPublication({sql,scoped,owner,open:authorityOpen,identity,readCallbackPrefix,readPublicationHost,readOwnerControl=null}={}){
 identity=identity?structuredClone(identity):null;
 let reservations=new WeakMap(),handoffs=new WeakMap(),closed=false;
 const dependencies=()=>{if(!identity||!UUID.test(identity.hostInstanceId||'')||!Number.isSafeInteger(identity.hostPid)||identity.hostPid<1
  ||!identity.postgresIdentity||![readCallbackPrefix,readPublicationHost].every(x=>typeof x==='function'))fail('composition_unbound');
  if(typeof readOwnerControl!=='function')fail('owner_custody_unbound');};
 const open=request=>{authorityOpen();if(closed)fail('closed');assertNativeCodingHostRequestOpen(request);
  if(!request||request.instanceId!==identity?.hostInstanceId||request.hostPid!==identity?.hostPid||!UUID.test(request.requestId||''))fail('request_scope_changed');};
 const fresh=value=>{const row=reservations.get(value);if(!row)fail('fresh_reservation_required');return row;};
 async function snapshot(tx,row,request){
  open(request);await owner(tx);
  const {c,native}=await scoped(tx,row.scope),p=c.permit,host=await readPublicationHost(request);open(request);
  const [pg]=await tx.unsafe(`select (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
   to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at,
   current_setting('fsync') as fsync,current_setting('full_page_writes') as full_page_writes`);
  const startup=identity.postgresIdentity;
  if(!pg||pg.fsync!=='on'||pg.full_page_writes!=='on'||pg.system_identifier!==startup.system_identifier
   ||pg.started_at!==nativeCapacityPostgresBirth(startup.started_at)||native.postgres.postmaster.pid!==startup.pid
   ||native.postgres.system_identifier!==pg.system_identifier||!HASH.test(native.postgres.data_directory_identity_sha256||'')
   ||host.pid!==identity.hostPid||Number(birth.exec(host.process_incarnation_id||'')?.[1])!==host.pid
   ||Number(birth.exec(native.postgres.postmaster.process_incarnation_id||'')?.[1])!==startup.pid)fail('lineage_changed');
  const current=await readOwnerControl({permit:p,scope:row.scope,tx,request});open(request);
  const o=current?.owner,control=current?.control;
  if(o?.schema!=='metaengine.host.owner-incarnation.v1'||o.source!=='LOCAL_HOST_OWNER'||o.authority_effect!==false
   ||o.fixture_classification!=null||o.staging===true||o.synthetic===true||o.untrusted===true||o.created_at!==native.host_process.created_at
   ||o.owner_id!==c.device.client_id||o.device_id!==c.device.device_id||o.project_id!==p.project_id
   ||o.epoch!==p.owner_epoch||o.device_key_fingerprint_sha256!==c.device.key_fingerprint_sha256
   ||o.source_sha!==p.artifact.source_sha||o.process_incarnation_id!==native.host_process.process_incarnation_id||o.pid!==native.host_process.pid
   ||!Number.isSafeInteger(o.generation)||o.generation<1||!Number.isFinite(Date.parse(o.observed_at))||Date.parse(o.observed_at)<Date.now()-30000||Date.parse(o.observed_at)>Date.now()+5000
   ||control?.refill_enabled!==true||control?.supervisor_admission_enabled!==true||control.owner_stop===true||control.state==='STOPPED')fail('owner_control_changed');
  return {c,native,host,pg_identity:{system_identifier:pg.system_identifier,started_at:pg.started_at,pid:startup.pid,
    process_incarnation_id:native.postgres.postmaster.process_incarnation_id,data_directory_identity_sha256:native.postgres.data_directory_identity_sha256},
   owner_sha256:sha(Object.fromEntries(ownerKeys.map(k=>[k,o[k]])))};
 }
 const stable=s=>({permit:s.c.permit,device:s.c.device,native:s.native,host:s.host,pg_identity:s.pg_identity,owner_sha256:s.owner_sha256});
 async function observe(tx,row,request,intent=null,publicationCursor=null){
  const before=await snapshot(tx,row,request),p=before.c.permit;
  const prefix=await readCallbackPrefix({scope:row.scope,permit:p,expected:row.expected?.cursor??null,intent,publicationCursor,request});open(request);
  if(intent&&(prefix.intent_sha256!==sha(intent)||prefix.dispatch_fenced||!Number.isSafeInteger(prefix.intent_sequence)
    ||publicationCursor&&prefix.intent_sequence>=publicationCursor.record_count))fail('intent_unpublished');
  const lease={task_id:row.scope.task_id,agent_id:row.scope.agent_id,base_sha:p.worktree.base_sha,
   lease_generation:row.scope.lease_generation,agent_generation_epoch:row.scope.agent_generation_epoch,role:p.role};
  const binding={run_id:prefix.run_id,workspace_id:p.workspace_id,project_id:p.project_id,task_id:row.scope.task_id,
   lease_generation:row.scope.lease_generation,agent_id:row.scope.agent_id,agent_generation_epoch:row.scope.agent_generation_epoch,provider_id:p.provider_id,role:p.role};
  const attempt=prefix.attempt;
  if(attempt?.schema!=='metaengine.codex-cli.run-receipt.v1'||attempt.state!=='RESERVED'||attempt.provider!=='CODEX_CLI'
   ||attempt.trust_namespace!=='LOCAL_OPERATOR_QA'||attempt.run_id!==prefix.run_id||attempt.permit_id!==p.permit_id
   ||attempt.workspace_id!==p.workspace_id||attempt.project_id!==p.project_id||attempt.owner_epoch!==p.owner_epoch||attempt.user_sid!==p.user_sid
   ||attempt.prompt_sha256!==before.c.value.prompt_sha256||attempt.executable_sha256!==p.artifact.cli_executable_sha256
   ||attempt.worktree_path!==p.worktree.path||Object.entries(lease).some(([k,v])=>attempt[k]!==v)
   ||attempt.automatic_retry_allowed!==false||attempt.authority_effect!==false||prefix.attempt_sha256!==sha(attempt))fail('attempt_changed');
  if(prefix.lease_binding_sha256!==sha(lease)||prefix.bound_binding_sha256!==sha(binding)
   ||prefix.host_instance_id!==identity.hostInstanceId||prefix.host_pid!==identity.hostPid)fail('prefix_binding_changed');
  const after=await snapshot(tx,row,request);if(!same(stable(before),stable(after)))fail('observation_changed');
  const root={run_id:prefix.run_id,scope:row.scope,permit_id:p.permit_id,permit_sha256:sha(p),device_id:p.device_id,
   client_id:before.c.device.client_id,admin_grant_epoch:before.c.device.admin_grant_epoch,key_sha256:before.c.device.key_fingerprint_sha256,
   owner_epoch:p.owner_epoch,owner_sha256:before.owner_sha256,host_instance_id:identity.hostInstanceId,host_pid:identity.hostPid,
   host_birth:before.host.process_incarnation_id,main_birth:before.native.host_process.process_incarnation_id,pg_identity:before.pg_identity,
   prefix_identity_sha256:prefix.prefix_identity_sha256,attempt_sha256:prefix.attempt_sha256,header_sha256:prefix.header_sha256,bound_sha256:prefix.bound_sha256,
   lease_binding_sha256:prefix.lease_binding_sha256,reserve_request_id:row.origin.requestId,
   prompt_sha256:before.c.value.prompt_sha256,base_sha:p.worktree.base_sha,role:p.role};
  if(row.expected&&!same(row.expected.root,root))fail('root_changed');
  return {root,prefix,snapshot:stable(after)};
 }
 // The only permitted change not made by this publisher is the existing
 // signed ATTEMPTED transition's one-time job association. Root/cursor remain
 // exact; this is publication metadata, never a settlement/send capability.
 async function associated(tx,row,expected,current){
  if(same(current,expected))return expected;
  if(!expected||expected.job_sha256!==null||!current||!same(current.root,expected.root)||!same(current.cursor,expected.cursor)||!HASH.test(current.job_sha256||''))fail('association_changed');
  const [registered]=await tx.unsafe(`select j.job_envelope,j.canonical_job_envelope,j.job_envelope_sha256,e.job_proof_sha256
   from destruktion_meta.native_coding_job_registration_h205f22 j join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation)
   where j.task_id=$1::uuid and j.lease_generation=$2::bigint and e.reservation_id=$3::uuid and e.state='ATTEMPTED'`,
   [row.scope.task_id,row.scope.lease_generation,row.scope.reservation_id]);
  const job=registered?.job_envelope,p=job?.payload,r=current.root;
  if(!job||registered.canonical_job_envelope!==json(job)||registered.job_envelope_sha256!==sha(job)
   ||registered.job_proof_sha256!==current.job_sha256||registered.job_envelope_sha256!==current.job_sha256
   ||p.run_id!==r.run_id||p.permit_id!==r.permit_id||p.prompt_sha256!==r.prompt_sha256||p.role!==r.role
   ||p.worktree?.base_sha!==r.base_sha||p.host_process?.process_incarnation_id!==r.main_birth||p.owner_epoch!==r.owner_epoch||p.device_id!==r.device_id)fail('association_changed');
  return current;
 }
 async function stored(tx,row){const [result]=await tx.unsafe('select destruktion_meta.native_coding_callback_publication_read_v1($1::uuid,$2::bigint,$3::uuid) as value',
  [row.scope.task_id,row.scope.lease_generation,row.scope.reservation_id]);if(!result)fail('readback_hold');return result.value;}
 async function intentJob(tx,row,value,intent){
  if(!intent)return;
  const [registered]=await tx.unsafe(`select j.job_envelope,j.canonical_job_envelope,j.job_envelope_sha256,e.job_proof_sha256
   from destruktion_meta.native_coding_job_registration_h205f22 j join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation)
   where j.task_id=$1::uuid and j.lease_generation=$2::bigint and e.reservation_id=$3::uuid and e.state='ATTEMPTED'`,
   [row.scope.task_id,row.scope.lease_generation,row.scope.reservation_id]);
  const job=registered?.job_envelope,p=job?.payload;
  if(!job||!HASH.test(value?.job_sha256||'')||registered.canonical_job_envelope!==json(job)
   ||registered.job_envelope_sha256!==sha(job)||registered.job_envelope_sha256!==value.job_sha256||registered.job_proof_sha256!==value.job_sha256
   ||p?.run_id!==value.root.run_id||p.permit_id!==value.root.permit_id
   ||Object.entries(intent.binding).some(([key,v])=>p[key]!==v)
   ||sha({job_id:p.job_id,pid:p.worker_process?.pid,process_incarnation_id:p.worker_process?.process_incarnation_id,
    executable_sha256:p.artifact?.cli_executable_sha256})!==intent.job_binding_sha256)fail('intent_job_changed');
 }
 // A short independent transaction observes COMMITTED bytes; never infer it
 // from the write callback result or manufacture physical settlement from it.
 async function readback(row,request,value,intent=null){
  const physical=runNativePhysicalSettlementScope(()=>sql.begin('isolation level serializable',async tx=>{
   const observation=await observe(tx,row,request,intent,intent?value.cursor:null);
   const current=await stored(tx,row);
   if(!value||!current||!same(current.root,value.root)||!same(current.cursor,value.cursor))fail('readback_hold');
   value=await associated(tx,row,value,current);
   if(!same(observation.root,value.root)||(!intent&&(observation.prefix.record_count!==value.cursor.record_count||observation.prefix.head_sha256!==value.cursor.head_sha256)))fail('readback_hold');
   await intentJob(tx,row,value,intent);
   const after=await snapshot(tx,row,request);if(!same(observation.snapshot,stable(after)))fail('readback_lineage_changed');open(request);return candidate(value);
  }));
  return joinedPhysical(physical);
 }
 const custody={
  // Called ONLY by actual RESERVE, after its original write transaction resolves.
  // No exposed flag or null-column inference; WeakMap key is the exact object.
  retainReservation(value,request){
   if(value?.state!=='RESERVED'||!request)return;
   try{open(request);}catch{return;}
   if(request.action!=='RESERVE_EXECUTION'||reservations.has(value))return;
   reservations.set(value,{scope:structuredClone(value.scope),origin:request,expected:null,intended:null,busy:false,held:false});
  },
  async publish(value,request,intent=null){
   const row=fresh(value);dependencies();open(request);
   if(row.held||row.busy||!row.expected&&request!==row.origin)fail('custody_hold');
   row.busy=true;
   try{
    const physical=runNativePhysicalSettlementScope(()=>sql.begin('isolation level serializable',async tx=>{
     await owner(tx);await tx.unsafe('set local synchronous_commit=on');
     const observation=await observe(tx,row,request,intent),p=observation.prefix;
     const expected=await associated(tx,row,row.expected,await stored(tx,row));
     await intentJob(tx,row,expected,intent);
     if(row.expected&&p.record_count<=row.expected.cursor.record_count)fail('no_new_prefix');
     const next={schema:'metaengine.native-coding.callback-publication.v1',root:observation.root,
      cursor:{revision:row.expected?row.expected.cursor.revision+1:0,record_count:p.record_count,intent_count:p.intent_count,head_sha256:p.head_sha256,dispatch_fenced:p.dispatch_fenced},
      job_sha256:expected?.job_sha256??null};
     row.intended=structuredClone(next);
     const [result]=await tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1::uuid,$2::bigint,$3::uuid,$4::text::jsonb,$5::text::jsonb) as value',
      [row.scope.task_id,row.scope.lease_generation,row.scope.reservation_id,expected===null?null:json(expected),json(next)]);
     if(!same(result?.value,next))fail('write_readback_mismatch');
     const after=await snapshot(tx,row,request);if(!same(observation.snapshot,stable(after)))fail('write_lineage_changed');open(request);return next;
    }));
    const committed=await joinedPhysical(physical);
    open(request);row.expected=structuredClone(committed);return await readback(row,request,committed,intent);
   }catch(error){row.held=true;const safe=Object.assign(Error('native_callback_publication_unknown_readback_required'),{effect_outcome:'UNKNOWN',automatic_retry_allowed:false});
    throw nativePhysicalSettlementUnconfirmed(error)?markNativePhysicalSettlementUnconfirmed(safe):safe;
   }finally{row.busy=false;}
  },
  async read(value,request){const row=fresh(value);dependencies();open(request);if(row.busy)fail('custody_hold');row.busy=true;
   // Even an exact lost-COMMIT read cannot clear held or mint a send capability.
   try{const result=await readback(row,request,row.intended??row.expected);return Object.freeze({...result,state:'READBACK_ONLY',prior_outcome:row.held?'UNKNOWN':'COMMITTED'});}
   catch(error){row.held=true;const safe=Object.assign(Error('native_callback_publication_readback_hold'),{automatic_retry_allowed:false,readback_only:true});
    throw nativePhysicalSettlementUnconfirmed(error)?markNativePhysicalSettlementUnconfirmed(safe):safe;}finally{row.busy=false;}},
  status(){return {state:'HOLD',reason:typeof readOwnerControl!=='function'?'OWNER_CUSTODY_UNBOUND':'PHASE1B_HANDOFF_UNBOUND',send_capability:false};},
  handoff(value){
   // The actual fresh RESERVED object is required. This factory does not
   // initialize an anchor, look up legacy rows or deserialize reservation rights.
   const row=fresh(value);
   return Object.freeze({
    async publish(input,request){
     dependencies();open(request);const intent=structuredClone(validateNativeCallbackPublicationIntent(input));
     if(request.action!==NATIVE_CALLBACK_PUBLICATION_ACTION||!row.expected||row.held||intent.binding.run_id!==row.expected.root.run_id)fail('handoff_unbound');
     const result=await custody.publish(value,request,intent);
     // An opaque in-process identity, retained by the existing IPC ticket only.
     // The correlated wire ACK is not this identity and cannot be readopted.
     const capability=Object.freeze({});handoffs.set(capability,{row,intent,publication:result.publication,used:false});return capability;
    },
    async recheck(capability,request){
     const bound=handoffs.get(capability);
     if(!bound||bound.row!==row||bound.used)fail('handoff_unbound');bound.used=true;
     dependencies();open(request);
     if(request.action!=='AGENT_OPERATION'||request.requestId!==bound.intent.request_id||request.requestDigest!==bound.intent.request_sha256
      ||row.held||row.busy)fail('handoff_hold');
     row.busy=true;
     try{
      const physical=runNativePhysicalSettlementScope(()=>sql.begin('isolation level serializable',async tx=>{
       const observed=await observe(tx,row,request,bound.intent,bound.publication.cursor);
       const current=await associated(tx,row,row.expected,await stored(tx,row));
       if(!same(observed.root,bound.publication.root)||!same(current.root,bound.publication.root)
        ||current.cursor.revision<bound.publication.cursor.revision)fail('handoff_anchor_changed');
       await intentJob(tx,row,current,bound.intent);
       const after=await snapshot(tx,row,request);if(!same(observed.snapshot,stable(after)))fail('handoff_lineage_changed');open(request);
      }));
      await joinedPhysical(physical);open(request);
     }catch(error){row.held=true;const safe=Error('native_callback_publication_handoff_hold');
      throw nativePhysicalSettlementUnconfirmed(error)?markNativePhysicalSettlementUnconfirmed(safe):safe;
     }finally{row.busy=false;}
    },
   });
  },
  close(){closed=true;reservations=new WeakMap();handoffs=new WeakMap();},
 };
 return Object.freeze({retainReservation:custody.retainReservation,close:custody.close,
  api:Object.freeze({publish:(value,request)=>custody.publish(value,request),read:custody.read,handoff:custody.handoff,status:custody.status})});
}
