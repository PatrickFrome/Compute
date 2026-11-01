import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {nativeCapacityPostgresBirth} from './native-coding-host-capacity.mjs';
import {nativeCodingHostSettlement,validateNativeCodingHostSettlement,markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {validateCodexCliJoinedSettlement,validateCodexCliLocalOutputDrain,codexCliProcessIdentity} from '../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import {consumeNativeSetupJobDrain} from './native-coding-setup-job-drain.mjs';
const fail=why=>{throw Error('native_physical_custody_'+why);};
const same=(a,b)=>json(a)===json(b),HASH=/^[a-f0-9]{64}$/;
const tracked=new Set(['RESERVE_EXECUTION','ADVANCE_EXECUTION','AGENT_OPERATION','BEGIN_NATIVE_SETUP_V1']);
const binding=r=>({instance_id:r.frame.instance_id,host_pid:r.frame.host_pid,request_id:r.frame.request_id,
 action:r.frame.action,request_sha256:r.request_sha256});
function requestRecord(row){
 const r=row?.request;
 if(r?.schema!=='metaengine.native-coding.physical-request.v1'||sha(r.frame)!==r.request_sha256
  ||r.host?.pid!==r.frame.host_pid||r.host.instance_id!==r.frame.instance_id
  ||!r.host.process_incarnation_id?.startsWith(`pid:${r.host.pid}:created_100ns:`)
  ||!HASH.test(r.postgres?.data_directory_identity_sha256||'')||!r.postgres.system_identifier)fail('request_invalid');
 codexCliProcessIdentity({pid:r.host.pid,created_at:r.host.created_at,process_incarnation_id:r.host.process_incarnation_id});
 if(row.terminal){if(validateNativeCodingHostSettlement(row.terminal,binding(r))!=='SETTLED')fail('terminal_hold');}
 return r;
}
const settled=row=>{const r=requestRecord(row);if(!row.terminal)fail('terminal_missing');return r;};
function setupLineage(s,r){
 const pg=s?.intent?.postgres;
 if(pg?.system_identifier!==r.postgres.system_identifier||pg.data_directory_identity_sha256!==r.postgres.data_directory_identity_sha256
  ||pg.postmaster?.pid!==r.postgres.pid||pg.postmaster.started_at_us!==r.postgres.started_at)fail('setup_postgres_lineage');
}
function lineage(r,root){
 if(r.frame.instance_id!==root.host_instance_id||r.frame.host_pid!==root.host_pid||r.host.process_incarnation_id!==root.host_birth
  ||r.main_birth!==root.main_birth||!same(r.postgres,root.pg_identity))fail('request_lineage_changed');
}
// Read-only source graph audit. Its returned hash is not a native/Owner
// full-scope qualification capability and cannot authorize historical release.
// Reverse inclusion detects omitted dispatch within the recorded graph.
export function verifyNativePhysicalTask({closure,publication,job,receipt,journal,requests,reserve,permit}={}){
 const c=closure,r=publication?.root;
 if(c?.schema!=='metaengine.native-coding.physical-task-closure.v1'||!r||!same(c.publication,publication)
  ||!same(c.receipt,receipt)||!same(c.journal,journal)||c.automatic_retry_allowed!==false||c.authority_effect!==false
  ||!permit||sha(permit)!==r.permit_sha256||publication.job_sha256!==sha(job)||job.payload?.run_id!==r.run_id||job.payload?.permit_id!==r.permit_id
  ||job.payload?.host_process?.process_incarnation_id!==r.main_birth||job.payload?.prompt_sha256!==r.prompt_sha256
  ||job.payload?.role!==r.role||job.payload?.worktree?.base_sha!==r.base_sha)fail('task_binding_changed');
 if(permit.permit_id!==r.permit_id||permit.device_id!==r.device_id||permit.device_key_fingerprint_sha256!==r.key_sha256
  ||permit.workspace_id!==r.scope.workspace_id||permit.project_id!==job.payload.project_id||permit.provider_id!==job.payload.provider_id
  ||permit.agent_id!==r.scope.agent_id||permit.agent_generation_epoch!==r.scope.agent_generation_epoch
  ||permit.role!==r.role||permit.owner_epoch!==r.owner_epoch||permit.worktree?.base_sha!==r.base_sha
  ||job.payload.device_id!==r.device_id||job.issuer_key_fingerprint_sha256!==r.key_sha256
  ||job.payload.device_key_fingerprint_sha256!==r.key_sha256)fail('task_principal_changed');
 const original=settled(reserve);lineage(original,r);
 if(original.frame.action!=='RESERVE_EXECUTION'||original.frame.request_id!==r.reserve_request_id
  ||original.request_sha256!==c.reserve_request_sha256||!same({...original.frame.payload.scope,reservation_id:r.scope.reservation_id},r.scope))fail('reserve_changed');
 validateCodexCliJoinedSettlement(receipt.physical_settlement,{proof:receipt.process});validateCodexCliLocalOutputDrain(receipt);
 if(receipt.run_id!==r.run_id||receipt.permit_id!==r.permit_id||receipt.task_id!==r.scope.task_id
  ||receipt.lease_generation!==r.scope.lease_generation||receipt.prompt_sha256!==r.prompt_sha256
  ||receipt.workspace_id!==r.scope.workspace_id||receipt.project_id!==job.payload.project_id
  ||receipt.agent_id!==r.scope.agent_id||receipt.agent_generation_epoch!==r.scope.agent_generation_epoch
  ||receipt.base_sha!==r.base_sha||receipt.owner_epoch!==r.owner_epoch||receipt.executable_sha256!==job.payload.artifact?.cli_executable_sha256
  ||receipt.process?.launch?.run_id!==r.run_id||receipt.process.launch.binding_sha256!==r.lease_binding_sha256
  ||receipt.process.launch.prompt_sha256!==r.prompt_sha256
  ||receipt.pid!==job.payload.worker_process?.pid||receipt.process_incarnation_id!==job.payload.worker_process?.process_incarnation_id
  ||receipt.process?.job_id!==job.payload.job_id||receipt.role!==r.role)fail('helper_binding_changed');
 if(!Array.isArray(journal?.records)||journal.projection?.state!=='SCOPED_REQUESTS_JOINED'
  ||journal.projection.dispatch_fenced!==true||journal.projection.callbacks_joined!==true
  ||journal.prefix_identity_sha256!==r.prefix_identity_sha256||journal.attempt_sha256!==r.attempt_sha256)fail('journal_incomplete');
 const runBinding={run_id:r.run_id,workspace_id:r.scope.workspace_id,project_id:job.payload.project_id,task_id:r.scope.task_id,
  lease_generation:r.scope.lease_generation,agent_id:r.scope.agent_id,agent_generation_epoch:r.scope.agent_generation_epoch,
  provider_id:job.payload.provider_id,role:r.role};
 const workerBinding={job_id:job.payload.job_id,pid:job.payload.worker_process?.pid,
  process_incarnation_id:job.payload.worker_process?.process_incarnation_id,executable_sha256:job.payload.artifact?.cli_executable_sha256};
 const dispatched=new Map();for(const row of requests){const q=settled(row);lineage(q,r);
  if(q.frame.action!=='AGENT_OPERATION'||!same(q.frame.payload.binding,runBinding)||!same(q.frame.payload.job_binding,workerBinding)||dispatched.has(q.frame.request_id))fail('dispatch_changed');
  dispatched.set(q.frame.request_id,row);}
 let head='0'.repeat(64),anchor=false,fenced=false,joined=false,candidate=false;const intents=new Map(),active=new Map();
 for(let sequence=0;sequence<journal.records.length;sequence++){
  const record=journal.records[sequence],e=record.event;
  if(record.schema!=='metaengine.native-coding.run-callback-record.v1'||record.sequence!==sequence||record.previous_sha256!==head||candidate)fail('journal_chain');
  head=sha(record);if(sequence+1===publication.cursor.record_count){if(head!==publication.cursor.head_sha256)fail('journal_anchor');anchor=true;}
  if(sequence===0){if(e.kind!=='HEADER'||e.run_id!==r.run_id||e.lease_binding_sha256!==r.lease_binding_sha256||sha(e)!==r.header_sha256)fail('journal_header');continue;}
  if(sequence===1){if(e.kind!=='BOUND'||e.binding_sha256!==sha({run_id:r.run_id,workspace_id:r.scope.workspace_id,project_id:job.payload.project_id,
    task_id:r.scope.task_id,lease_generation:r.scope.lease_generation,agent_id:r.scope.agent_id,agent_generation_epoch:r.scope.agent_generation_epoch,
    provider_id:job.payload.provider_id,role:r.role})||e.instance_id!==r.host_instance_id||e.host_pid!==r.host_pid||head!==r.bound_sha256)fail('journal_bound');continue;}
  if(e.kind==='FENCE'){if(fenced)fail('journal_fence');fenced=true;continue;}
  if(e.kind==='CALLBACKS_JOINED'){if(!fenced||joined||!Number.isSafeInteger(e.callbacks)||e.callbacks<0)fail('journal_join');joined=true;continue;}
  if(e.kind==='CANDIDATE'){if(!fenced||!joined||active.size||e.state!=='SCOPED_REQUESTS_JOINED'||e.lineage!=='LINEAGE_UNBOUND'
    ||e.all_effects_cleanup!=='UNCONFIRMED'||e.authority_effect!==false)fail('journal_candidate');candidate=true;continue;}
  if(e.kind==='INTENT'){
   if(fenced||intents.has(e.request_id))fail('journal_intent');
   const row=dispatched.get(e.request_id),q=row?.request;
   if(q&&(q.request_sha256!==e.request_sha256||q.frame.payload.operation!==e.operation||sha(q.frame.payload.job_binding)!==e.job_binding_sha256))fail('intent_digest');
   const state={digest:e.request_sha256,row,caller:false,terminal:false};intents.set(e.request_id,state);active.set(e.request_id,state);continue;
  }
  const state=active.get(e.request_id);if(!state||state.digest!==e.request_sha256)fail('journal_orphan');
  if(e.kind==='CALLER'){if(state.caller||!['OK','UNKNOWN','REJECTED'].includes(e.outcome))fail('journal_caller');state.caller=true;}
  else if(e.kind==='TERMINAL'){if(state.terminal||!state.row||e.state!=='SETTLED'||e.terminal_sha256!==sha(state.row.terminal))fail('journal_terminal');state.terminal=true;}
  else if(e.kind==='UNSENT'){if(state.row||state.terminal)fail('journal_unsent');state.terminal=true;}
  else fail('journal_event');
  if(state.caller&&state.terminal)active.delete(e.request_id);
 }
 if(!anchor||!candidate||!fenced||!joined||active.size||head!==journal.projection.head_sha256
  ||journal.records.length!==journal.projection.records||[...dispatched.keys()].some(id=>!intents.has(id)))fail('journal_truncated');
 return sha(c);
}

// State-owner WAL is the existing anchor. Opaque tickets exist only for the
// original IPC producer; serialized requests cannot recreate publication rights.
export function createNativeCodingPhysicalCustody({sql,hostInstanceId,hostPid,postgresIdentity,readNativeScope,readPublicationHost,
 readProtectedReceipt,readCallbackClosure}={}){
 if(typeof sql?.begin!=='function'||![readNativeScope,readPublicationHost].every(f=>typeof f==='function'))fail('dependencies');
 const tickets=new WeakMap(),liveTickets=new Set(),work=new Set(),waiters=new Set(),birth=nativeCapacityPostgresBirth(postgresIdentity?.started_at);
 let closed=false,cleanupUnconfirmed=false;
 const change=()=>{for(const resolve of waiters)resolve();waiters.clear();};
 const retain=operation=>{const promise=Promise.resolve().then(operation);work.add(promise);const done=()=>{work.delete(promise);change();};promise.then(done,done);return promise;};
 const open=()=>{if(closed)fail('closed');};
 async function physical(tx){
  const [pg]=await tx.unsafe(`select current_user::text as owner,session_user::text as session_owner,current_setting('fsync') as fsync,
   current_setting('full_page_writes') as full_page_writes,(select system_identifier::text from pg_control_system()) as system_identifier,
   to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
  if(pg?.owner!=='state_owner'||pg.session_owner!=='state_owner'||pg.fsync!=='on'||pg.full_page_writes!=='on'
   ||pg.system_identifier!==postgresIdentity.system_identifier||pg.started_at!==birth)fail('postgres_changed');
  const native=await readNativeScope(null,false,tx),host=await readPublicationHost();
  if(host.pid!==hostPid||native.postgres?.postmaster?.pid!==postgresIdentity.pid
   ||native.postgres.system_identifier!==pg.system_identifier||!HASH.test(native.postgres.data_directory_identity_sha256||''))fail('native_changed');
  return {host:{...host,instance_id:hostInstanceId},main_birth:native.host_process.process_incarnation_id,
   postgres:{system_identifier:pg.system_identifier,started_at:pg.started_at,pid:postgresIdentity.pid,
    process_incarnation_id:native.postgres.postmaster.process_incarnation_id,data_directory_identity_sha256:native.postgres.data_directory_identity_sha256}};
 }
 async function write(fn,cleanup=false){if(!cleanup)open();return sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');return fn(tx);});}
 const lock=(tx,run)=>tx.unsafe("select pg_advisory_xact_lock(hashtextextended('native-physical-run:'||$1::text,303002))",[run]);
 // SERIALIZABLE snapshots can predate an advisory-lock wait. Both dispatch
 // and fencing make the same-value MVCC write to the existing execution;
 // an old snapshot must serialize-fail before it can admit a late request.
 async function barrier(tx,scope,run){
  const rows=await tx.unsafe(`update destruktion_meta.native_coding_execution_h205f22 set callback_publication=callback_publication
   where task_id=$1::uuid and lease_generation=$2::bigint returning callback_publication`,[scope.task_id,scope.lease_generation]);
  if(rows.length!==1||rows[0].callback_publication?.root?.run_id!==run)fail('run_binding_changed');
 }
 async function request(tx,id){const rows=await tx.unsafe('select request,terminal from destruktion_meta.native_coding_physical_request_h205f22 where request_id=$1::uuid',[id]);if(rows.length!==1)fail('request_missing');return rows[0];}
 async function beginRequest(frame){
  if(!tracked.has(frame.action))return null;
  const fixed=structuredClone(frame),ticket=Object.freeze({});
  const record=await write(async tx=>{
   if(fixed.instance_id!==hostInstanceId||fixed.host_pid!==hostPid)fail('host_mismatch');
   if(fixed.action==='AGENT_OPERATION'){
    const run=fixed.payload.binding.run_id;await lock(tx,run);
    await barrier(tx,fixed.payload.binding,run);
    const fence=await tx.unsafe('select run_id from destruktion_meta.native_coding_physical_fence_h205f22 where run_id=$1::uuid',[run]);if(fence.length)fail('run_fenced');
    const [e]=await tx.unsafe('select callback_publication from destruktion_meta.native_coding_execution_h205f22 where task_id=$1::uuid and lease_generation=$2::bigint',
     [fixed.payload.binding.task_id,fixed.payload.binding.lease_generation]);
    if(e?.callback_publication?.root?.run_id!==run||e.callback_publication.root.host_instance_id!==hostInstanceId)fail('callback_unanchored');
   }
   const value={schema:'metaengine.native-coding.physical-request.v1',frame:fixed,request_sha256:sha(fixed),...await physical(tx)};
   await tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request) values($1::uuid,$2::text::jsonb)',[fixed.request_id,json(value)]);return value;
  });
  // Independent committed read. Failure retains UNKNOWN and never dispatches.
  const observed=await request(sql,fixed.request_id);if(!same(observed.request,record)||observed.terminal!==null)fail('dispatch_readback');
  tickets.set(ticket,record);liveTickets.add(ticket);change();return ticket;
 }
 async function endRequest(ticket,held=false){
  if(ticket===null)return;
  const r=tickets.get(ticket);if(!r)fail('original_ticket_required');tickets.delete(ticket);
  if(held)cleanupUnconfirmed=true;
  const terminal=nativeCodingHostSettlement(binding(r),held);
  try{
   await write(async tx=>{
    const current=await physical(tx);if(!same(current,{host:r.host,main_birth:r.main_birth,postgres:r.postgres}))fail('terminal_lineage');
    const rows=await tx.unsafe('update destruktion_meta.native_coding_physical_request_h205f22 set terminal=$2::text::jsonb where request_id=$1::uuid and terminal is null returning terminal',
     [r.frame.request_id,json(terminal)]);if(rows.length!==1||!same(rows[0].terminal,terminal))fail('terminal_write');
   },true);
   const readback=await request(sql,r.frame.request_id);if(!same(readback.request,r)||!same(readback.terminal,terminal))fail('terminal_readback');
  }catch{cleanupUnconfirmed=true;throw markNativePhysicalSettlementUnconfirmed(Error('native_physical_custody_terminal_unknown'));}
  finally{liveTickets.delete(ticket);change();}
  // Proof publication is separate from the caller's effect outcome. A late
  // callback drain may finish after RESULT_READY; collection can repeat only
  // these proof reads, never the original operation.
  if(!closed&&!held&&r.frame.action==='ADVANCE_EXECUTION'&&r.frame.payload.transition?.to==='RESULT_READY'){
   await sealTask(r.frame.payload.scope).catch(()=>{});
  }
 }
 async function sealSetup({operationId,custodyId,actor,request:origin,operation:ownedOperation}={}){
  return write(async tx=>{
   const native=await physical(tx),q=await request(tx,origin?.requestId),r=requestRecord(q);
   if(r.frame.action!=='BEGIN_NATIVE_SETUP_V1'||r.request_sha256!==origin.requestDigest||!same(r.host,native.host)||!same(r.postgres,native.postgres)||r.main_birth!==native.main_birth)fail('setup_origin');
   const [row]=await tx.unsafe('select to_jsonb(s) as value from destruktion_meta.native_coding_setup_operation_h205f22 s where operation_id=$1::uuid',[operationId]);
   const s=row?.value;
   if(!same(s,ownedOperation))fail('setup_original_job_changed');
   if(s?.custody_id!==custodyId||s.cleanup_state!=='DRAINED'||!['STOPPED','HOLD'].includes(s.state)
    ||s.intent.host_instance_id!==hostInstanceId||s.intent.host_pid!==hostPid||!same(s.intent.actor,actor)
    ||Object.entries(r.frame.payload.body.input).some(([k,v])=>!same(s.intent[k],v)))fail('setup_readback');
   setupLineage(s,r);
   const closure={schema:'metaengine.native-coding.physical-setup-closure.v1',operation:s,request_id:r.frame.request_id,request_sha256:r.request_sha256,
    host:r.host,postgres:r.postgres,main_birth:r.main_birth,automatic_retry_allowed:false,authority_effect:false};
   await tx.unsafe("insert into destruktion_meta.native_coding_physical_closure_h205f22(kind,key,closure) values('SETUP',$1::text,$2::text::jsonb)",[operationId,json(closure)]);
   return {schema:'metaengine.native-coding.physical-closure-ack.v1',state:'SOURCE_GRAPH_CANDIDATE',graph_sha256:sha(closure),
    historical_resolution:'HOLD',full_scope_qualification:'UNAVAILABLE',readiness:false,automatic_retry_allowed:false,authority_effect:false};
  },true);
 }
 async function taskInputs(tx,scope){
  const [row]=await tx.unsafe(`select e.callback_publication,j.job_envelope,j.canonical_job_envelope,j.job_envelope_sha256,
   j.result_receipt,j.canonical_result_receipt,j.result_receipt_sha256,p.permit from destruktion_meta.native_coding_execution_h205f22 e
   join destruktion_meta.native_coding_job_registration_h205f22 j using(task_id,lease_generation)
   join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=j.permit_id
   where e.task_id=$1::uuid and e.lease_generation=$2::bigint and e.reservation_id=$3::uuid`,[scope.task_id,scope.lease_generation,scope.reservation_id]);
  if(!row?.callback_publication||!same(row.callback_publication.root.scope,scope))fail('task_unanchored');
  if(typeof readProtectedReceipt!=='function'||typeof readCallbackClosure!=='function')fail('task_reader_unbound');
  const publication=row.callback_publication,r=publication.root,job=row.job_envelope;
  if(row.canonical_job_envelope!==json(job)||row.job_envelope_sha256!==sha(job)||sha(row.permit)!==r.permit_sha256)fail('original_job_changed');
  const receipt=await readProtectedReceipt({scope,permit:row.permit,job});
  if(!row.result_receipt||!same(row.result_receipt,receipt)||row.canonical_result_receipt!==json(receipt)||row.result_receipt_sha256!==sha(receipt))fail('original_receipt_changed');
  const journal=await readCallbackClosure({scope,permit:row.permit,expected:publication.cursor});
  const requests=await tx.unsafe("select request,terminal from destruktion_meta.native_coding_physical_request_h205f22 where request#>>'{frame,action}'='AGENT_OPERATION' and request#>>'{frame,payload,binding,run_id}'=$1::text order by request_id",[r.run_id]);
  return {publication,job,receipt,journal,requests,permit:row.permit,reserve:await request(tx,r.reserve_request_id)};
 }
 async function sealTask(scope){
  // Fence is its own committed write and survives a failed proof/readback.
  // There is no reopen/replay API, including for an UNKNOWN caller outcome.
  const [e]=await sql.unsafe('select callback_publication from destruktion_meta.native_coding_execution_h205f22 where task_id=$1::uuid and lease_generation=$2::bigint and reservation_id=$3::uuid',[scope.task_id,scope.lease_generation,scope.reservation_id]);
  const r=e?.callback_publication?.root;if(!r||!same(r.scope,scope))fail('task_origin');
  const candidateInput=await taskInputs(sql,scope);
  const candidateClosure={schema:'metaengine.native-coding.physical-task-closure.v1',publication:candidateInput.publication,receipt:candidateInput.receipt,
   journal:candidateInput.journal,reserve_request_sha256:candidateInput.reserve.request.request_sha256,automatic_retry_allowed:false,authority_effect:false};
  verifyNativePhysicalTask({...candidateInput,closure:candidateClosure});
  let fenceLineageVerified=false;
  try{await write(async tx=>{
   const native=await physical(tx);
   if(r.pg_identity.system_identifier!==native.postgres.system_identifier||r.pg_identity.data_directory_identity_sha256!==native.postgres.data_directory_identity_sha256)fail('task_data_lineage');
   fenceLineageVerified=true;
   await lock(tx,r.run_id);
   await barrier(tx,r.scope,r.run_id);
   const [fence]=await tx.unsafe('select host_instance_id from destruktion_meta.native_coding_physical_fence_h205f22 where run_id=$1::uuid',[r.run_id]);
   if(fence){if(fence.host_instance_id!==r.host_instance_id)fail('fence_changed');return;}
   await tx.unsafe('insert into destruktion_meta.native_coding_physical_fence_h205f22(run_id,host_instance_id) values($1::uuid,$2::uuid)',[r.run_id,r.host_instance_id]);
  });}catch(error){
   // A lost fence ACK permits an exact independent proof read, never another
   // AGENT dispatch or reopening the immutable fence.
   if(!fenceLineageVerified)throw error;
   const [fence]=await sql.unsafe('select host_instance_id from destruktion_meta.native_coding_physical_fence_h205f22 where run_id=$1::uuid',[r.run_id]);
   if(fence?.host_instance_id!==r.host_instance_id)throw error;
  }
  return write(async tx=>{
   const native=await physical(tx);
   if(r.pg_identity.system_identifier!==native.postgres.system_identifier||r.pg_identity.data_directory_identity_sha256!==native.postgres.data_directory_identity_sha256)fail('task_data_lineage');
   await lock(tx,r.run_id);const input=await taskInputs(tx,scope);
   const closure={schema:'metaengine.native-coding.physical-task-closure.v1',publication:input.publication,receipt:input.receipt,
    journal:input.journal,reserve_request_sha256:input.reserve.request.request_sha256,automatic_retry_allowed:false,authority_effect:false};
   verifyNativePhysicalTask({...input,closure});
   await tx.unsafe("insert into destruktion_meta.native_coding_physical_closure_h205f22(kind,key,closure) values('TASK',$1::text,$2::text::jsonb)",[`${scope.task_id}:${scope.lease_generation}`,json(closure)]);
   return {schema:'metaengine.native-coding.physical-closure-ack.v1',state:'SOURCE_GRAPH_CANDIDATE',graph_sha256:sha(closure),
    historical_resolution:'HOLD',full_scope_qualification:'UNAVAILABLE',readiness:false,automatic_retry_allowed:false,authority_effect:false};
  });
 }
 async function verifySetup(tx,c,row,actor,current){
  if(c?.schema!=='metaengine.native-coding.physical-setup-closure.v1'||c.automatic_retry_allowed!==false||c.authority_effect!==false)fail('setup_closure');
  const q=await request(tx,c.request_id),r=settled(q);
  if(r.frame.action!=='BEGIN_NATIVE_SETUP_V1'||r.request_sha256!==c.request_sha256||!same(c.host,r.host)||!same(c.postgres,r.postgres)||c.main_birth!==r.main_birth)fail('setup_request');
  const [saved]=await tx.unsafe('select to_jsonb(s) as value from destruktion_meta.native_coding_setup_operation_h205f22 s where operation_id=$1::uuid',[row.key]);
  const s=saved?.value;
  if(!same(s,c.operation)||s.custody_id!==row.custody_id||s.cleanup_state!=='DRAINED'||!['STOPPED','HOLD'].includes(s.state)
   ||Object.entries(r.frame.payload.body.input).some(([k,v])=>!same(s.intent[k],v))||s.intent.host_instance_id!==r.host.instance_id||s.intent.host_pid!==r.host.pid
   ||s.intent.actor.device_id!==actor.device_id||s.intent.actor.client_id!==actor.client_id||s.intent.actor.admin_grant_epoch!==actor.admin_grant_epoch
   ||s.intent.actor.key_fingerprint_sha256!==actor.key_fingerprint_sha256
   ||r.postgres.system_identifier!==current.postgres.system_identifier||r.postgres.data_directory_identity_sha256!==current.postgres.data_directory_identity_sha256)fail('setup_changed');
  setupLineage(s,r);
  return sha(c);
 }
 async function prepareClosures(){
  open();let after=null;
  for(;;){
   const rows=await sql.unsafe(`select q.request from destruktion_meta.native_coding_physical_request_h205f22 q
    where q.request#>>'{frame,action}'='ADVANCE_EXECUTION' and q.request#>>'{frame,payload,transition,to}'='RESULT_READY'
     and q.terminal->>'state'='SETTLED' and ($1::text is null or q.request_id::text>$1::text)
     and not exists(select 1 from destruktion_meta.native_coding_physical_closure_h205f22 c where c.kind='TASK'
      and c.key=(q.request#>>'{frame,payload,scope,task_id}')||':'||(q.request#>>'{frame,payload,scope,lease_generation}'))
    order by q.request_id::text limit 32`,[after]);
   if(!rows.length)return;
   for(const {request:r} of rows){after=r.frame.request_id;await sealTask(r.frame.payload.scope).catch(()=>{});}
  }
 }
 async function verifyObservation(){
  open();
  // No existing native/Owner producer currently supplies a full-scope private
  // qualification capability. Persisted graphs, hashes and caller objects do
  // not fill that gap. This method cannot grant a historical resolution and
  // deliberately reads/writes neither candidate receipts nor resolution cache.
  return 0;
 }
 async function auditCandidateScope({tx,actor,kind,key}={}){
  open();
  const projection={schema:'metaengine.native-coding.physical-candidate-audit.v1',kind,key,
   state:'HOLD',historical_resolution:'HOLD',full_scope_qualification:'UNAVAILABLE',readiness:false,
   automatic_retry_allowed:false,authority_effect:false};
  if(!['SETUP','TASK'].includes(kind)||typeof key!=='string'||!key||key.length>80)fail('audit_selector');
  try{
   const current=await physical(tx);
   const rows=await tx.unsafe(`select r as row,c.closure from destruktion_meta.native_coding_capacity_rows_v1($1::uuid,$2::text) r
    join destruktion_meta.native_coding_physical_closure_h205f22 c on c.kind=r->>'kind' and c.key=r->>'key'
    where r->>'kind'=$3::text and r->>'key'=$4::text`,[actor.device_id,actor.client_id,kind,key]);
   if(rows.length!==1)return projection;
   const {row,closure}=rows[0];let graphSha;
   if(kind==='SETUP')graphSha=await verifySetup(tx,closure,row,actor,current);
   else{
    const root=closure.publication?.root;
    if(root?.device_id!==actor.device_id||root.client_id!==actor.client_id||root.admin_grant_epoch!==actor.admin_grant_epoch
     ||root.key_sha256!==actor.key_fingerprint_sha256||root.pg_identity.system_identifier!==current.postgres.system_identifier
     ||root.pg_identity.data_directory_identity_sha256!==current.postgres.data_directory_identity_sha256)fail('task_principal');
    const fence=await tx.unsafe('select run_id from destruktion_meta.native_coding_physical_fence_h205f22 where run_id=$1::uuid and host_instance_id=$2::uuid',[root.run_id,root.host_instance_id]);if(fence.length!==1)fail('task_unfenced');
    graphSha=verifyNativePhysicalTask({...await taskInputs(tx,root.scope),closure});
   }
   return {...projection,state:'SOURCE_GRAPH_JOINED',graph_sha256:graphSha,durable_sha256:row.durable_sha256};
  }catch{return projection;}
 }
 async function drain(){
  while(work.size||liveTickets.size){if(work.size)await Promise.allSettled([...work]);else await new Promise(resolve=>waiters.add(resolve));}
  if(cleanupUnconfirmed)throw markNativePhysicalSettlementUnconfirmed(Error('native_physical_custody_cleanup_unconfirmed'));
 }
 return Object.freeze({beginRequest:frame=>retain(()=>beginRequest(frame)),endRequest:(ticket,held)=>retain(()=>endRequest(ticket,held)),
  sealSetup(token){const source=consumeNativeSetupJobDrain(token);return retain(()=>sealSetup(source));},
  sealTask:scope=>retain(()=>sealTask(scope)),prepareClosures:()=>retain(prepareClosures),auditCandidateScope:input=>retain(()=>auditCandidateScope(input)),
  verifyObservation:()=>retain(verifyObservation),close(){closed=true;change();},drain,
  snapshot:()=>Object.freeze({closed,pending_requests:liveTickets.size,active_work:work.size,cleanup_unconfirmed:cleanupUnconfirmed,
   historical_resolution:'HOLD',full_scope_qualification:'UNAVAILABLE',readiness:false,authority_effect:false})});
}
