// Real disposable PG17 and the complete registered application catalogue.
// Generated task/device rows are SQL fixtures, never installed execution proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {withFreshOwnerNativeFixture} from './test/fresh-owner-native-fixture.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {attestNativeMigrationApiIdentity} from './native-coding-migration-api-identity.mjs';
import {normalizeClientProjectSnapshot} from '../../apps/metaengine-browser/src/client-project-continuity.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const rpc='public.h205f22_project_snapshot_v1';
test('full registered PG17 catalogue preserves project control separately from execution and admission',{
 skip:!bin||!driver?'explicit native PG17 and pinned driver required':false,timeout:240000,
},async t=>withFreshOwnerNativeFixture({bin,driver},async({sql,edgeSql,withOwnerLane,check})=>{
 const workspace=randomUUID(),device=randomUUID(),request=randomUUID(),root=randomUUID(),client='generated-control-state-fixture';
 const pairing='a'.repeat(64),digest='b'.repeat(64),base='c'.repeat(40);
 await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash)values($1)',[pairing]);
 await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22
  (device_id,client_id,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash,access_tier,admin_grant_epoch,admin_scopes)
  values($1,$2,$3,$4,$5,'ADMIN',1,'["CONTROL_PLANE","DEVOS"]')`,
 [device,client,sql.json({kty:'EC',crv:'P-256',x:'a'.repeat(43),y:'b'.repeat(43)}),digest,pairing]);
 await sql.unsafe(`insert into destruktion_meta.devos_fleet_runtime_control_h205f22
  (workspace_id,refill_enabled,supervisor_admission_enabled)values($1,true,true)`,[workspace]);
 await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22
  (task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key,state)
  values($1,$2,'generated.control.root','PLANNER',$3,'{"objective":"Generated control-state regression"}',$4,'generated-control-root','RUNNING')`,[root,workspace,base,digest]);
 await sql.unsafe(`insert into destruktion_meta.client_v1_goal_request_h205f22
  (request_id,workspace_id,roadmap_id,request_sha256,plan_generation,alignment_epoch,baseline_sha,plan_sha256,point_id,task_id,task_spec_sha256,submission_receipt)
  values($1,$2,'metaengine-client-v1',$3,1,1,$4,$3,'generated.control.root',$5,$3,
   '{"schema":"metaengine.client-v1.goal-submit.v2","authority_effect":false,"automatic_retry_allowed":false}')`,[request,workspace,digest,base,root]);
 const [registered]=await edgeSql.unsafe('select public.h205f22_project_register_v1($1,$2,$3,$4,1) as value',[workspace,request,device,client]);
 const project=registered.value.project_id;
 const read=async(connection=sql,options={})=>{
  const [row]=await connection.unsafe(`select ${rpc}($1,$2,$3,$4,$5,$6,$7,1) as value`,
   [options.workspace??workspace,options.task?null:project,options.task??null,options.after??0,options.limit??128,options.device??device,client]);
  return row.value;
 };
 const state=async value=>sql.unsafe('update destruktion_meta.project_run_h205f22 set state=$2 where project_id=$1',[project,value]);
 const taskState=async value=>sql.unsafe('update destruktion_meta.devos_fleet_task_h205f22 set state=$2 where task_id=$1',[root,value]);
 const normalize=(value,expected={project_id:project})=>normalizeClientProjectSnapshot(value,expected);
 const applicationRows=async()=>{
  const tables=await sql.unsafe(`select schemaname,tablename from pg_tables where schemaname in('public','destruktion_meta') order by schemaname,tablename`);
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  return Promise.all(tables.map(async row=>{
   const [result]=await sql.unsafe(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as fingerprint from ${quote(row.schemaname)}.${quote(row.tablename)} t`);
   return [row.schemaname,row.tablename,result.fingerprint];
  }));
 };

 await t.test('PAUSED/RUNNING is preserved without cancelling work or writing during readback',async()=>{
  await state('PAUSED');
  const before=await applicationRows(),raw=await read();
  t.diagnostic(`stored=PAUSED task=${raw.selected_task.state} aggregate=${raw.state} control=${raw.control_state??'MISSING'}`);
  assert.equal(raw.state,'ACTIVE');assert.equal(raw.selected_task.state,'RUNNING');
  assert.deepEqual(await applicationRows(),before,'snapshot changes no durable application rows');
  assert.equal(raw.control_state,'PAUSED');assert.equal(normalize(raw).control_state,'PAUSED');
  const [saved]=await sql.unsafe('select state,last_seq from destruktion_meta.project_run_h205f22 where project_id=$1',[project]);
  assert.equal(saved.state,'PAUSED');assert.equal(Number(saved.last_seq),1);
 });
 let child;
 await t.test('child lookup and pagination retain PAUSED/WAITING_CHILDREN',async()=>{
  child=randomUUID();
  await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22
   (task_id,workspace_id,point_id,role,base_sha,task_spec_sha256,idempotency_key,state)
   values($1,$2,'generated.control.child','IMPLEMENTER',$3,$4,'generated-control-child','RUNNING')`,[child,workspace,base,digest]);
  await sql.unsafe(`insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth)values($1,$2,2,$3,$3,1)`,[child,project,root]);
  await sql.unsafe('update destruktion_meta.project_run_h205f22 set total_tasks=2 where project_id=$1',[project]);
  for(const options of [{limit:1},{after:1,limit:1},{task:child,after:1,limit:1}]){
   const raw=await read(sql,options),value=normalize(raw,options.task?{task_id:child}:{project_id:project});
   assert.equal(raw.state,'WAITING_CHILDREN');assert.equal(value.control_state,'PAUSED');
   assert.equal(value.task_cursor.next_seq,options.after?2:1);
  }
 });
 await t.test('FENCED and unknown physical outcome stay BLOCKED, never physical STOPPED',async()=>{
  for(const phase of ['FENCED','AMBIGUOUS']){
   await taskState(phase);const raw=await read(),value=normalize(raw);
   assert.equal(value.control_state,'PAUSED');assert.equal(value.state,'BLOCKED');assert.equal(value.selected_task.state,phase);
   assert.equal(raw.physical_execution_proven,undefined);assert.equal(raw.cleanup_confirmed,undefined);
  }
 });
 await t.test('workspace STOP/RESUME admission flags do not overwrite project pause or settle physical work',async()=>{
  for(const enabled of [false,true]){
   await sql.unsafe(`update destruktion_meta.devos_fleet_runtime_control_h205f22 set
    refill_enabled=$2,supervisor_admission_enabled=$2,generation_floor=generation_floor+1 where workspace_id=$1`,[workspace,enabled]);
   const [control]=await sql.unsafe('select public.devos_environment_state_v1($1) as value',[workspace]);
   assert.equal(control.value.refill_enabled,enabled);assert.equal(control.value.supervisor_admission_enabled,enabled);
   const value=normalize(await read());assert.equal(value.control_state,'PAUSED');assert.equal(value.state,'BLOCKED');
  }
  await state('ACTIVE');assert.equal(normalize(await read()).control_state,'ACTIVE');
  await state('PAUSED');
 });
 await t.test('independent committed control updates are visible; uncommitted or rolled back intent is not published',async()=>{
  await withOwnerLane(async({sql:other})=>{
   await other.unsafe('begin');
   try{
    await other.unsafe("update destruktion_meta.project_run_h205f22 set state='ACTIVE' where project_id=$1",[project]);
    assert.equal((await read()).control_state,'PAUSED');await other.unsafe('rollback');
    assert.equal((await read()).control_state,'PAUSED');
    await other.unsafe("update destruktion_meta.project_run_h205f22 set state='ACTIVE' where project_id=$1",[project]);
    assert.equal((await read()).control_state,'ACTIVE');
    await other.unsafe("update destruktion_meta.project_run_h205f22 set state='PAUSED' where project_id=$1",[project]);
    assert.equal((await read()).control_state,'PAUSED');
   }finally{await other.unsafe('rollback');}
  });
 });
 await t.test('fresh owner backend reload retains PAUSED and original task state',async()=>{
  await withOwnerLane(async({sql:restarted})=>{
   const value=normalize(await read(restarted));assert.equal(value.control_state,'PAUSED');assert.equal(value.selected_task.state,'AMBIGUOUS');
  });
 });
 await t.test('missing task has no inferred control and stored COMPLETED does not prove execution completion',async()=>{
  const missing=await read(sql,{task:randomUUID()});
  assert.equal(missing.found,false);assert.equal(missing.control_state,undefined);
  assert.equal(normalize(missing).control_state,undefined);
  await state('COMPLETED');const value=normalize(await read());
  assert.equal(value.control_state,'COMPLETED');assert.equal(value.state,'BLOCKED');
  await state('PAUSED');
 });
 await t.test('project scope, epoch, grant, RLS and restricted API fences remain enforced',async()=>{
  await assert.rejects(read(edgeSql,{workspace:randomUUID()}),e=>e.code==='42501');
  await assert.rejects(read(edgeSql,{device:randomUUID()}),e=>e.code==='42501');
  await assert.rejects(edgeSql.unsafe('select * from destruktion_meta.project_run_h205f22'),e=>e.code==='42501');
  await assert.rejects(edgeSql.unsafe(`select ${rpc}($1,$2,null,0,128,$3,$4,2)`,[workspace,project,device,client]),e=>e.code==='42501');
  await sql.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[pairing]);
  await assert.rejects(read(edgeSql),e=>e.code==='42501');
  await sql.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=true where token_hash=$1',[pairing]);
  const [rls]=await sql.unsafe("select relrowsecurity from pg_class where oid='destruktion_meta.project_run_h205f22'::regclass");assert.equal(rls.relrowsecurity,true);
 });
 await t.test('complete migration replay preserves readback and rejects unknown snapshot bodies',async()=>{
  const plan=await loadFreshSchemaApplicationPlan();
  const identity=await attestNativeMigrationApiIdentity({apiSql:edgeSql,ownerSql:sql,apiLogin:'local_state_api'});
  await sql.unsafe('begin');
  try{
   await applyLocalRuntimeMigrations({sql:{begin:fn=>fn(sql)},expectedMigrationSourcesSha256:plan.upgrade_sources_sha256,authenticatedApiIdentity:identity});
   await sql.unsafe('commit');
  }catch(error){await sql.unsafe('rollback');throw error;}
  assert.equal((await read()).control_state,'PAUSED');
  const [definition]=await sql.unsafe(`select pg_get_functiondef('${rpc}(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)'::regprocedure) as source`);
  const unknown=definition.source.replace("'control_state'","'unreviewed_control_state'");assert.notEqual(unknown,definition.source);
  // Roll back each deliberate fixture body/metadata alteration; do not accept it as a new predecessor.
  for(const change of [`alter function ${rpc}(uuid,uuid,uuid,bigint,integer,uuid,text,bigint) stable`,unknown]){
   await sql.unsafe('begin');
   try{
    await sql.unsafe(change);
    for(const file of ['native-coding-review-observation-v1.sql','native-coding-repair-v1.sql']){
     await sql.unsafe('savepoint rejected_body');
     await assert.rejects(sql.unsafe(await readFile(new URL(file,import.meta.url),'utf8')),/requires_review/);
     await sql.unsafe('rollback to savepoint rejected_body');
    }
   }finally{await sql.unsafe('rollback');}
  }
  assert.equal((await read()).control_state,'PAUSED');await check();
 });
}));
