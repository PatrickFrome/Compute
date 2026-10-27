// Same SERIAL fixture on separately factory-owned native PG17 or supplemental
// PostgreSQL-WASM. Neither lane proves concurrency or installed-client behavior.
// All authority/device/claim/heartbeat rows are synthetic TEST-ONLY data in a
// newly allocated disposable database; no existing DB URI is ever accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {qualifyFreshSchemaNative} from './test/fresh-schema-disposable.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {loadFreshSchemaCandidatePlan} from './fresh-schema-plan.mjs';
import {assertBrowserParentSuspensionReceipt} from '../../apps/metaengine-browser/src/browser-parent-suspension.mjs';
const moduleUrl=process.env.METAENGINE_PGLITE_MODULE,cryptoUrl=process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE;
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const root=new URL('../../',import.meta.url);
const sha=v=>createHash('sha256').update(v).digest('hex');
test('browser suspension SQL (supplemental WASM, serial): exact lease, replay, dependency and custody fences',{skip:!moduleUrl||!cryptoUrl,timeout:120000},async t=>{
 const {PGlite}=await import(moduleUrl);
 const {pgcrypto}=await import(cryptoUrl);
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const wrap=c=>({unsafe:async(s,a)=>a?.length?(await c.query(s,a)).rows:(await c.exec(s)).at(-1)?.rows??[],begin:cb=>cb(wrap(c))});
 await db.exec('create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;create schema destruktion_meta');
 const plan=await loadFreshSchemaCandidatePlan();
 assert.match(plan.upgrade_sources_sha256,/^[a-f0-9]{64}$/);
 for(const e of plan.baseline)await db.exec(await readFile(new URL(e.path,root),'utf8'));
 await applyLocalRuntimeMigrations({sql:wrap(db),expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
 await exerciseBrowserParentSuspension({q,exec:s=>db.exec(s)});
});

test('browser suspension SQL (factory-owned native PG17, serial): exact lease, replay, dependency and custody fences', {
 skip:!bin||!driver?'Native PG17 binaries/driver absent: native suspension and concurrency UNQUALIFIED':false,timeout:240000,
},async()=>{
 const receipt=await qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE,
  exercise:async({sql,engine,parallel_backends})=>{
   assert.equal(engine,'NATIVE_PG17');assert.equal(parallel_backends,1);
   await exerciseBrowserParentSuspension({q:(s,a=[])=>sql.unsafe(s,a),exec:s=>sql.unsafe(s)});
   return {status:'BROWSER_PARENT_SUSPENSION_SERIAL_ASSERTIONS_PASSED',engine,parallel_backends,
    synthetic_authority_fixture:true,concurrency_qualified:false,installed_client_qualified:false,production_qualified:false};
  }});
 assert.equal(receipt.native_identity_verified,true);
 assert.equal(receipt.test_exercise.status,'BROWSER_PARENT_SUSPENSION_SERIAL_ASSERTIONS_PASSED');
 assert.equal(receipt.test_exercise.concurrency_qualified,false);
 console.log(JSON.stringify(receipt.test_exercise));
});

test('native fixture callback rejects non-code values before allocating any cluster',async()=>{
 await assert.rejects(qualifyFreshSchemaNative({exercise:{connection:'not accepted'}}),/fresh_test_exercise_invalid/);
});

async function exerciseBrowserParentSuspension({q,exec}) {
 const workspace=randomUUID(),device=randomUUID(),project=randomUUID(),sid=randomUUID(),client='suspension-fixture',base='a'.repeat(40),fp='d'.repeat(64),url='https://chatgpt.com/c/'+randomUUID();
 const agent={agent_id:'agent_suspension-00000001',ownership:'FLEET_OWNED',lifecycle_state:'ACTIVE',authority_effect:false,automatic_retry_allowed:false,role:'RESEARCHER',tab_id:'tab_'+randomUUID(),target_id:'webcontents:1',generation_epoch:4};
 const heartbeat=async()=>{agent.transport_proof={schema:'metaengine.browser.fleet-transport-proof.v1',authority_effect:false,tab_id:agent.tab_id,target_id:agent.target_id,generation_epoch:agent.generation_epoch,conversation_url_sha256:sha(url),agent_surface_sha256:'e'.repeat(64),proven_at:new Date().toISOString()};
 const state={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',transport_identity:{profile:'A2_DEVICE_HTTP_SIGNATURE_V1',device_id:device,key_fingerprint_sha256:fp,access_tier:'ADMIN',admin_grant_epoch:1,admin_ready:true},supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'READY'}},fleet:{schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',agents:[agent]}};
 await q('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state,authority_effect) values($1,$2,clock_timestamp(),$3::jsonb,true) on conflict(client_id) do update set state=excluded.state,last_seen_at=excluded.last_seen_at',[client,workspace,JSON.stringify(state)]);};
 await q('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values($1)',['b'.repeat(64)]);
 await q(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash,access_tier,admin_grant_epoch,admin_scopes) values($1,$2,'{"kty":"EC","crv":"P-256","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}',$3,$4,'ADMIN',1,'["CONTROL_PLANE","DEVOS"]')`,[device,client,fp,'b'.repeat(64)]);
 await heartbeat();
 const rpc=async(name,args)=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v)))[0].value;
 const enqueue=async(point)=>(await rpc('devos_fleet_enqueue_v1',[workspace,point,'RESEARCHER',base,{objective:'Synthetic fixture only',claim_class:'READ_ONLY'},point,null,50])).task_id;
 const parent=await enqueue('suspension.parent'),child=await enqueue('suspension.child');
 await q('insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal) values($1,$2,$3,$4,$5,$6,1,$7)',[project,workspace,randomUUID(),parent,device,client,'Synthetic fixture only']);
 await q('insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth) values($1,$2,1,$1,null,0),($3,$2,2,$1,$1,1)',[parent,project,child]);
 const lease=await rpc('devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id,4,900]);assert.equal(lease.task_id,parent);
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='RUNNING' where task_id=$1",[parent]);
 const claim=(await q("select claim_id from destruktion_meta.devos_fleet_claim_h205f22 where task_id=$1 and state='ACTIVE'",[parent]))[0].claim_id;
 await q('insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,refill_enabled,supervisor_admission_enabled) values($1,true,true) on conflict(workspace_id) do update set refill_enabled=true,supervisor_admission_enabled=true',[workspace]);
 await q("select destruktion_meta.devos_emit_event_h205f22($1,'TASK_TRANSPORT_PROVEN',$2,'suspension.parent','RESEARCHER',$3,1,$4,$5::jsonb,'fixture-origin')",[workspace,parent,agent.agent_id,base,JSON.stringify({conversation_url_sha256:sha(url),agent_surface_sha256:'e'.repeat(64)})]);
 const checkpoint={schema:'metaengine.browser.parent-checkpoint.v1',conversation_url:url,conversation_url_sha256:sha(url),transcript_floor:10,transcript_total_chars:20,transcript_sha256:sha('synthetic transcript'),agent_surface_sha256:'e'.repeat(64),confirmed_turn_sha256:sha('confirmed receipt fixture'),delivered_tool_results:[],observed_at:new Date().toISOString(),tab_id:agent.tab_id,target_id:agent.target_id,agent_id:agent.agent_id,agent_generation_epoch:4,control_generation:0,worktree_custody:null};
 const suspend=(cp=checkpoint,id=sid)=>rpc('h205f22_project_suspend_browser_v1',[workspace,project,parent,claim,1,id,cp,device,client,1]);
 await assert.rejects(suspend({...checkpoint,worktree_custody:{fake:true}}),/CHECKPOINT_INVALID/);
 await assert.rejects(suspend({...checkpoint,agent_surface_sha256:'f'.repeat(64)}),/CONVERSATION_UNPROVEN/);
 await q("update destruktion_meta.devos_fleet_task_h205f22 set claim_class='MUTATING' where task_id=$1",[parent]);await assert.rejects(suspend(),/READ_ONLY_REQUIRED/);
 await q("update destruktion_meta.devos_fleet_task_h205f22 set claim_class='READ_ONLY' where task_id=$1",[parent]);
 const missing=await rpc('h205f22_project_suspension_read_v1',[workspace,child,device,client,1]);assert.equal(missing.found,false);assert.equal(missing.task_id,child);assert.equal(missing.automatic_retry_allowed,false);
 const suspended=await suspend();assertBrowserParentSuspensionReceipt(suspended,{task_id:parent,checkpoint});assert.equal(suspended.state,'WAITING_CHILDREN');assert.equal((await suspend()).replayed,true);
 await assert.rejects(suspend(checkpoint,randomUUID()),/PRIOR_INTENT/);
 assert.equal((await q('select state from destruktion_meta.devos_fleet_claim_h205f22 where claim_id=$1',[claim]))[0].state,'CLOSED');
 const staleLease=await rpc('devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id,4,900]);assert.equal(staleLease.wait_reason,'BROWSER_PHYSICAL_CUSTODY_HELD','durable SUSPENDED parent blocks even stale ACTIVE heartbeat without reservation');
 const aliasNative=await rpc('devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,'codex-cli:'+randomUUID(),4,900]);assert.equal(aliasNative.wait_reason,'BROWSER_PHYSICAL_CUSTODY_HELD','changing transport cannot bypass suspended logical identity');
 await assert.rejects(q("insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at) values($1,$2,'suspension.child',$3,'RESEARCHER','READ_ONLY',$4,$5,$6,4,1,clock_timestamp()+interval '900 seconds')",[child,workspace,base,agent.agent_id,agent.tab_id,agent.target_id]),/BROWSER_PARENT_AGENT_SUSPENDED/);
 const childAgent='agent_retirement-00000001',childTab='tab_'+randomUUID(),childTarget='webcontents:9';
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 disable trigger user');
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='RESULT_READY',lease_agent_id=$2,lease_tab_id=$3,lease_target_id=$4,lease_agent_generation_epoch=4,lease_generation=1 where task_id=$1",[child,childAgent,childTab,childTarget]);
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 enable trigger user');
 const retire=(tab=childTab)=>rpc('h205f22_project_release_browser_child_v1',[workspace,child,1,childAgent,tab,childTarget,4,device,client,1]);
 // Contradictory ACTIVE claim is fixture-only; even expired custody blocks retirement.
 await q("update destruktion_meta.devos_fleet_claim_h205f22 set task_id=$2,agent_id=$3,state='ACTIVE',expires_at=clock_timestamp()-interval '1 second' where claim_id=$1",[claim,child,childAgent]);
 await assert.rejects(retire(),/CUSTODY_HELD/);
 await q("update destruktion_meta.devos_fleet_claim_h205f22 set task_id=$2,agent_id=$3,state='CLOSED' where claim_id=$1",[claim,parent,agent.agent_id]);
 const retired=await retire();assert.equal(retired.retired,true);assert.equal((await retire()).retirement_id,retired.retirement_id);assert.equal((await retire()).replayed,true);
 await assert.rejects(q('delete from destruktion_meta.browser_child_retirement_h205f22 where retirement_id=$1',[retired.retirement_id]),/IMMUTABLE/);
 await assert.rejects(retire('tab_'+randomUUID()),/COLLISION/);
 const retiredLease=await rpc('devos_fleet_lease_v1',[workspace,childAgent,'RESEARCHER',childTab,childTarget,4,900]);assert.equal(retiredLease.wait_reason,'BROWSER_PHYSICAL_CUSTODY_HELD');
 await assert.rejects(q("insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at) values($1,$2,'suspension.child',$3,'RESEARCHER','READ_ONLY',$4,$5,$6,4,1,clock_timestamp()+interval '900 seconds')",[child,workspace,base,childAgent,childTab,childTarget]),/BROWSER_PHYSICAL_IDENTITY_RETIRED/);
 const list=()=>rpc('h205f22_project_suspension_list_v1',[workspace,device,client,1,0,32]);assert.equal((await list()).entries.length,1);
 agent.browser_parent_restoration={schema:'metaengine.browser.parent-restoration-reservation.v1',suspension_id:sid,task_id:parent,checkpoint_sha256:suspended.checkpoint_sha256,authority_effect:false,automatic_retry_allowed:false};
 agent.generation_epoch=5;agent.tab_id='tab_'+randomUUID();agent.target_id='webcontents:2';await heartbeat();
 const restoration={schema:'metaengine.devos.browser-parent-restoration.v1',checkpoint_sha256:suspended.checkpoint_sha256,conversation_url:url,conversation_url_sha256:sha(url),transcript_floor:10,transcript_total_chars:20,transcript_sha256:checkpoint.transcript_sha256,agent_surface_sha256:checkpoint.agent_surface_sha256,observed_at:new Date().toISOString(),agent_id:agent.agent_id,tab_id:agent.tab_id,target_id:agent.target_id,agent_generation_epoch:5,control_generation:0};
 const resume=(v=restoration)=>rpc('h205f22_project_resume_browser_v1',[workspace,sid,v,device,client,1]);
 await assert.rejects(resume(),/DEPENDENCIES_PENDING/);
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='FAILED' where task_id=$1",[child]);assert.equal((await list()).entries[0].state,'BLOCKED_CHILDREN');await assert.rejects(resume(),/DEPENDENCIES_PENDING/);
 // Test fixture completion bypass is explicit, never used by production resume.
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 disable trigger user');
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED' where task_id=$1",[child]);
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 enable trigger user');
 await assert.rejects(resume({...restoration,agent_generation_epoch:4}),/RESTORATION_INVALID/);
 await assert.rejects(resume({...restoration,transcript_sha256:'f'.repeat(64)}),/RESTORATION_INVALID/);
 await q('update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=false where workspace_id=$1',[workspace]);await assert.rejects(resume(),/OWNER_FENCED/);
 await q('update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=true where workspace_id=$1',[workspace]);
 agent.lifecycle_state='SUSPENDED';await heartbeat();
 await assert.rejects(resume(),/devos_transport_agent_not_active/);
 assert.equal((await q('select lease_generation,state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[parent]))[0].state,'SUSPENDED','failed admission rolls back new task generation and claim');
 agent.lifecycle_state='ACTIVE';await heartbeat();
 await assert.rejects(q("insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at) values($1,$2,'suspension.child',$3,'RESEARCHER','READ_ONLY',$4,$5,$6,5,1,clock_timestamp()+interval '900 seconds')",[child,workspace,base,agent.agent_id,agent.tab_id,agent.target_id]),/BROWSER_RESTORATION_CLAIM_RESERVED/);
 const deniedAllocation=await rpc('devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id,5,900]);assert.equal(deniedAllocation.wait_reason,'BROWSER_PHYSICAL_CUSTODY_HELD');
 const resumed=await resume();assert.equal(resumed.lease.lease_generation,2);assert.equal(resumed.lease.agent_id,agent.agent_id);assert.equal(resumed.lease.state,'RUNNING');assert.equal((await resume()).replayed,true);
 assert.equal((await list()).entries[0].status,'RESUMED');
 await assert.rejects(resume({...restoration,transcript_floor:0}),/COLLISION/);
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='FAILED' where task_id=$1",[parent]);assert.equal((await list()).entries.length,0);await assert.rejects(resume(),/RECEIPT_STALE/);

 // Projection contract is tested with explicit contradictory fixture rows; it
 // must never hide expired/older ACTIVE claims or frozen workspace custody.
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 disable trigger user');
 await q("update destruktion_meta.devos_fleet_task_h205f22 set state='RESULT_READY' where task_id=$1",[parent]);
 await exec('alter table destruktion_meta.devos_fleet_task_h205f22 enable trigger user');
 await q("update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED' where task_id=$1",[parent]);
 const projected=async()=>(await rpc('h205f22_project_snapshot_v1',[workspace,null,parent,0,32,device,client,1])).selected_task;
 let selected=await projected();assert.equal(selected.state,'RESULT_READY');assert.equal(selected.claim_class,'READ_ONLY');assert.equal(selected.lease_generation,2);assert.equal(selected.agent_id,agent.agent_id);assert.equal(selected.tab_id,agent.tab_id);assert.equal(selected.target_id,agent.target_id);assert.equal(selected.agent_generation_epoch,5);assert.equal(selected.active_claim_count,0);assert.equal(selected.active_workspace_binding_count,0);
 await q("update destruktion_meta.devos_fleet_claim_h205f22 set state='ACTIVE',expires_at=clock_timestamp()-interval '1 second' where claim_id=$1",[claim]);
 await q("insert into public.compute_fabric_a2_workspace_binding_h205f22(workspace_id,workspace_generation,worktree_id,coordination_workspace_id,task_id,claim_id,point_id,repo_id,repo_root,managed_root,worktree_path,base_sha,branch_name,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,lease_expires_at,state,ambiguity_code) values($1,1,$2,$1,$3,$4,'fixture','fixture','/fixture/repo','/fixture','/fixture/worktree',$5,'fixture/branch',$6,$7,$8,5,2,clock_timestamp(),'FROZEN','FIXTURE_UNKNOWN')",[workspace,randomUUID(),parent,claim,base,agent.agent_id,agent.tab_id,agent.target_id]);
 selected=await projected();assert.equal(selected.claim_id,null,'current live claim projection alone does not prove release');assert.equal(selected.active_claim_count,1);assert.equal(selected.active_workspace_binding_count,1);
 const privileges=await q("select has_function_privilege('anon','public.h205f22_project_resume_browser_v1(uuid,uuid,jsonb,uuid,text,bigint)','execute') allowed");assert.equal(privileges[0].allowed,false);
}
