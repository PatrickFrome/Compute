// Real disposable PG migrations, signed requests, activation, W30 and reservation.
// Native/ACL observations are generated STAGING fixtures, never qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from '../native-coding-host-authority.mjs';
import {nativeCapacityPrincipal,nativeCapacityProjection} from '../../../apps/metaengine-browser/src/native-coding-capacity-contract.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from '../native-coding-task-context.mjs';
import {createNativeCodingHostServiceHeartbeatV2} from '../native-coding-host-service-heartbeat.mjs';
import {bindNativeCodingTransactionPool} from '../native-coding-preparation-transaction.mjs';
import {buildNativeCodingExecutionScope} from '../native-coding-task-context.mjs';
import {signNativeCodingDeviceRequest,signLoadedRunOwnerRead} from '../../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {readNativeCodingProtectedJson} from '../../../apps/metaengine-browser/src/native-coding-host-observers.mjs';

export async function activeRunOwnerPgCoverage(t,{sql,activationFixture,monitor}){
 const bootstrap=await fs.readFile(new URL('../../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql',import.meta.url),'utf8');
 const controlStart=bootstrap.indexOf('create table if not exists destruktion_meta.devos_fleet_runtime_control_h205f22');
 assert.ok(controlStart>=0);await sql.unsafe(bootstrap.slice(controlStart,bootstrap.indexOf(';',controlStart)+1));
 const source=await fs.readFile(new URL('../../../supabase/migrations/20260831152000_a2_workspace_binding_registry_v1.sql',import.meta.url),'utf8');
 await sql.unsafe(source.slice(source.indexOf('create table public.compute_fabric_a2_workspace_binding_h205f22'),source.indexOf('alter table public.compute_fabric_a2_workspace_binding_h205f22')));
 const g=await activationFixture(),activation=await g.activate(),a=g.c.agents[0];
 const id=g.c.workspace_id,project=activation.activation.project_id;
 await sql.unsafe('insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,refill_enabled,supervisor_admission_enabled)values($1,true,true)',[id]);
 const agent='agent_owner-planner-001',tab='tab_'+randomUUID(),target='webcontents:42';
 const heartbeat={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
  transport_identity:{profile:g.d.profile,device_id:g.d.device_id,key_fingerprint_sha256:g.d.key_fingerprint_sha256,access_tier:'ADMIN',admin_grant_epoch:1,admin_ready:true},
  supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}},
  fleet:{schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',agents:[{
   agent_id:agent,role:'PLANNER',tab_id:tab,target_id:target,generation_epoch:1,ownership:'FLEET_OWNED',lifecycle_state:'ACTIVE',authority_effect:false,automatic_retry_allowed:false,
   transport_proof:{schema:'metaengine.browser.fleet-transport-proof.v1',tab_id:tab,target_id:target,generation_epoch:1,conversation_url_sha256:'a'.repeat(64),proven_at:new Date().toISOString(),authority_effect:false}}]}};
 await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=$1,last_seen_at=clock_timestamp() where workspace_id=$2',[sql.json(heartbeat),id]);
 const parent=(await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',[id,agent,'PLANNER',tab,target]))[0].value;
 assert.equal(parent.leased,true);assert.equal(parent.task_id,g.admission.root_task_id);
 const spawned=(await sql.unsafe('select public.h205f22_project_spawn_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,1) as value',
  [id,project,parent.task_id,parent.claim_id,parent.lease_generation,randomUUID(),sql.json([{role:'IMPLEMENTER',objective:'Check active Owner custody in a disposable test'}]),g.d.device_id,g.d.client_id]))[0].value;
 assert.equal(spawned.children[0].status,'ADMITTED');const task=spawned.children[0].task_id;
 const p=(await sql.unsafe('select p.permit from destruktion_meta.native_coding_operator_permit_h205f22 p join destruktion_meta.devos_fleet_task_h205f22 t on p.permit_id=(t.task_spec#>>\'{native_coding,permit_id}\')::uuid where t.task_id=$1',[task]))[0].permit;
 const {schema,issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,...scopeFields}=p;
 const native={...await g.options.readNativeScope(p),sandbox:a.sandbox},payload={...scopeFields,schema:'metaengine.codex-cli.transport-proof.v1',issuer:'NATIVE_HOST',audience:'METAENGINE_NATIVE_SUPERVISOR',provider:'CODEX_CLI',
  target_id:'codex-cli:'+p.provider_id,host_process:native.host_process,sandbox:a.sandbox,proven_at:new Date().toISOString(),expires_at:new Date(Date.now()+50000).toISOString(),
  state:'READY',automatic_retry_allowed:false,production_qualified:false,authority_effect:false};
 const authority=await createNativeCodingHostAuthority({sql:bindNativeCodingTransactionPool(sql,monitor),readNativeScope:async(permit,_live,tx)=>{
  assert.equal(typeof tx.unsafe,'function');return {...await g.options.readNativeScope(permit),sandbox:g.c.agents.find(agent=>agent.provider_id===permit.provider_id).sandbox};},readNativeWorker:async()=>{throw Error('worker forbidden');},readProtectedReceipt:async()=>{throw Error('receipt forbidden');},
  runOwnerReadOptions:{identity:{hostInstanceId:g.host.instance_id,hostPid:g.host.host_pid},stateDirectory:g.root,
   readProtectedJson:(file,options)=>readNativeCodingProtectedJson(file,{...options,verifyStorage:async()=>({owner_dacl_verified:true})})}});
 try{
  const descriptor=await g.identity.signNativeCodingProof(payload,{expected:payload});
  await authority.REGISTER_PROVIDER({descriptor});
  // A registered provider alone is not execution admission. Exercise the same
  // signed heartbeat and current capacity SQL gates as the production path.
  const tryLease=async()=>(await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',[id,p.agent_id,p.role,'native-coding:'+p.provider_id,'codex-cli:'+p.provider_id]))[0].value;
  assert.equal((await tryLease()).leased,false,'provider registration must not bypass missing service heartbeat');
  for(const file of ['native-coding-setup-operation-v1.sql','native-coding-capacity-v2.sql'])
   await sql.begin(tx=>fs.readFile(new URL('../'+file,import.meta.url),'utf8').then(bytes=>tx.unsafe(bytes)));
  const [pg]=await sql.unsafe(`select (select system_identifier::text from pg_control_system()) as system_identifier,
   to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
  const now=Date.now(),evidence={schema:'metaengine.native-coding.capacity-evidence.v1',host_instance_id:g.host.instance_id,host_pid:g.host.host_pid,
   device_key_fingerprint_sha256:g.d.key_fingerprint_sha256,admin_grant_epoch:1,main_incarnation:native.host_process.process_incarnation_id,
   postgres_scope_sha256:sha(pg),postgres_system_identifier:pg.system_identifier,postgres_started_at_us:pg.started_at,
   generation:1,observed_at:new Date(now).toISOString(),expires_at:new Date(now+10000).toISOString(),owned_tasks:[],owned_setup:[],resolved:[]};
  const found=(await sql.unsafe('select destruktion_meta.native_coding_capacity_census_v1($1,$2,1,$3::text::jsonb) as value',[g.d.device_id,g.d.client_id,json(evidence)]))[0].value;
  const census={schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:g.host.instance_id,host_pid:g.host.host_pid,
   principal_sha256:nativeCapacityPrincipal({...g.d,admin_grant_epoch:1}),postgres_scope_sha256:evidence.postgres_scope_sha256,
   generation:1,owned_tasks_sha256:sha([]),observed_at:evidence.observed_at,expires_at:evidence.expires_at,...found,
   complete:true,state:found.counts.unresolved_slots?'HOLD':'CURRENT',automatic_retry_allowed:false,authority_effect:false};
  const budget=p.physical_slot_budget,input={schema:'metaengine.native-coding.service-heartbeat.v2',workspace_id:id,
   host_process:native.host_process,artifact:p.artifact,postgres:p.postgres,
   control:{supervisor_mode:'CONTROL',armed:true,interrupted_setup_recovery_fenced:false,runtime_control_generation:0},
   runtime:{schema:'metaengine.native-coding.runtime.v1',physical_slot_budget:budget,occupied_slots:0,closed:false,shutdown_state:'OPEN',host_unavailable_reason:null,jobs:[]},
   providers:[{permit_id:p.permit_id,provider_id:p.provider_id,agent_id:p.agent_id,role:p.role,agent_generation_epoch:p.agent_generation_epoch,envelope_sha256:sha(descriptor)}],
   capacity:{census,projection:nativeCapacityProjection({census,configuredCeiling:budget,resourceCeiling:budget,localTaskCount:0,localRevision:0})},
   production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const heartbeatService=createNativeCodingHostServiceHeartbeatV2({sql,readCurrentDevice:g.context.readCurrentDevice,
   hostInstanceId:g.host.instance_id,hostPid:g.host.host_pid,readNativeScope:async permit=>({...await g.options.readNativeScope(permit),sandbox:a.sandbox}),
   readCapacityEvidence:async()=>evidence});
  try{
   const packet=await signNativeCodingDeviceRequest({identity:g.identity,binding:g.host,operation:'SERVICE_HEARTBEAT_V2',input});
   const ack=await g.context.run('SERVICE_HEARTBEAT_V2',packet,()=>heartbeatService.SERVICE_HEARTBEAT_V2(packet));
   assert.equal(ack.accepted,true,json(ack));
  }finally{heartbeatService.close();}
  const leased=(await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',[id,p.agent_id,p.role,'native-coding:'+p.provider_id,'codex-cli:'+p.provider_id]))[0].value;
  assert.equal(leased.leased,true,JSON.stringify(leased));assert.equal(leased.task_id,task);
  const query={workspace_id:id,project_id:project,task_id:task,agent_id:p.agent_id,lease_generation:Number(leased.lease_generation),provider_id:p.provider_id};
  const lease=(await authority.READ_LEASE(query)).value,scope=buildNativeCodingExecutionScope(p,lease,native.host_process);
  const reserved=await authority.RESERVE_EXECUTION({scope});assert.equal(reserved.state,'RESERVED');
  const before=await fs.readFile(path.join(g.root,'identity.json'));
  let phaseCount=0,lastScope;
  const context={instanceId:g.host.instance_id,hostPid:g.host.host_pid,requestId:randomUUID(),signal:new AbortController().signal,deadlineAt:Date.now()+30000,
   runOwnerPhases:{close(){},async run(current,handlers){phaseCount++;lastScope=current;await handlers.readScope();throw Error('generated_native_evidence_unqualified');}}};
  const read=async(selected=reserved.scope)=>authority.READ_RUN_OWNER_CUSTODY_V1(await signLoadedRunOwnerRead({identity:g.identity,binding:g.host,input:{scope:selected}}),context);
  await t.test('actual activated project and active W30 reservation reach bounded Owner phase without native promotion',async()=>{
   await assert.rejects(read(),/generated_native_evidence_unqualified/);assert.equal(phaseCount,1);
   assert.equal(lastScope.project_id,project);assert.equal(lastScope.root_task_id,parent.task_id);assert.deepEqual(lastScope.execution,reserved.scope);
   assert.deepEqual(await fs.readFile(path.join(g.root,'identity.json')),before);
   const stored=(await sql.unsafe('select state,reservation_id from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[task]))[0];
   assert.deepEqual(stored,{state:'RESERVED',reservation_id:reserved.scope.reservation_id});
  });
  await t.test('foreign reservation cannot reach native phase on actual active task',async()=>{
   await assert.rejects(read({...reserved.scope,reservation_id:randomUUID()}));assert.equal(phaseCount,1);
  });
  for(const change of ['refill_enabled=false','generation_floor=2,reset_at=clock_timestamp()'])await t.test('committed control fence blocks active read: '+change,async()=>{
   await sql.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set '+change+',updated_at=clock_timestamp() where workspace_id=$1',[id]);
   await assert.rejects(read());assert.equal(phaseCount,1);
   await sql.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=true,generation_floor=0,reset_at=null,updated_at=clock_timestamp() where workspace_id=$1',[id]);
  });
  await t.test('revoked actual ADMIN pairing prevents phase entry',async()=>{
   await sql.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[g.pair]);
   await assert.rejects(read(),/current_device_unavailable/);assert.equal(phaseCount,1);
  });
 }finally{authority.close();}
}
