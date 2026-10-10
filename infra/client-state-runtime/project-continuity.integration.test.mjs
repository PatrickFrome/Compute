import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';
import { createProjectContinuityRoutes } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/project-continuity-routes.mjs';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, compileRpcRequest } from './db-api-core.mjs';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';

const exec = promisify(execFile);
const bin = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
const source = name => fs.readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
const migration = '20261010100000_project_continuity_history_v1.sql';
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('disposable PostgreSQL project lineage, history cursors, budget waits and independent verification', { skip: !bin, timeout: 240000 }, async t => {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-project-continuity-')));
  const data = path.join(root, 'pgdata'), port = await freePort();
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'], { windowsHide: true });
  let owned = null;
  let processPg = null;
  let pgOutput = '';
  let closed = Promise.resolve();
  if (process.platform !== 'win32') {
    processPg = spawn(path.join(bin, 'postgres' + suffix), ['-D', data, '-h', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [processPg.stdout, processPg.stderr]) stream.on('data', value => { pgOutput = (pgOutput + value).slice(-8192); });
    closed = new Promise(resolve => processPg.once('close', resolve));
  }
  const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: process.env.USERNAME || process.env.USER || 'postgres', max: 5, prepare: false, connect_timeout: 1 });
  t.after(async () => {
    await sql.end({ timeout: 2 });
    if (process.platform === 'win32') {
      if (owned) assert.equal((await owned.stop()).cleanup_confirmed, true);
    } else {
      await exec(path.join(bin, 'pg_ctl' + suffix), ['-D', data, 'stop', '-m', 'fast', '-w'], { windowsHide: true });
      await closed;
    }
    const relative = path.relative(os.tmpdir(), await fs.realpath(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  if (process.platform === 'win32') {
    owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 60000 });
    assert.equal((await owned.verify()).pid, owned.pid);
  }
  for (let tries = 0; ; tries++) {
    try { await sql`select 1`; break; }
    catch { if (tries > 40 || (processPg && processPg.exitCode !== null)) throw new Error(pgOutput || 'disposable_pg_readiness_failed'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await sql.unsafe('create role anon; create role authenticated; create role service_role; create schema destruktion_meta; create schema extensions; create extension pgcrypto with schema extensions;');
  const baseline = await source('20260929010000_client_v1_fresh_project_bootstrap_v1.sql');
  await sql.unsafe(baseline.slice(baseline.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22'), baseline.indexOf('create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22')));
  const goal = await source('20260929211500_client_v1_goal_progress_reconciliation_v1.sql');
  await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'), goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
  const result = await source('20260929224500_client_v1_agent_origin_result_proof_v1.sql');
  await sql.unsafe(result.slice(0, result.indexOf('-- Keep the existing Client progress contract')));
  await sql.unsafe(`create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text not null,active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text,profile text default 'A2_DEVICE_HTTP_SIGNATURE_V1',key_fingerprint_sha256 text);
    create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);
    create table public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id text primary key,workspace_id uuid,last_seen_at timestamptz,state jsonb,authority_effect boolean default false);`);
  const normalization = await source('20260902190500_devos_dispatch_admission_runtime_v2.sql');
  await sql.unsafe(normalization.slice(normalization.indexOf('create or replace function destruktion_meta.devos_normalize_native_supervisor_state_h205f22'), normalization.indexOf('create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22')));
  await sql.unsafe(await source(migration));
  const workspace = crypto.randomUUID(), request = crypto.randomUUID(), device = crypto.randomUUID(), client = 'continuity-test', base = 'a'.repeat(40), fingerprint = 'd'.repeat(64);
  const agents = ['CODER','RESEARCHER','IMPLEMENTER','CRITIC','CRITIC','FALSIFIER'].map((role,index) => ({ agent_id: 'agent_continuity-' + String(index).padStart(8,'0'), ownership: 'FLEET_OWNED', lifecycle_state: 'ACTIVE', authority_effect: false, automatic_retry_allowed: false, role, tab_id: 'tab_' + index, target_id: 'webcontents:' + index, generation_epoch: 4, transport_proof: { schema: 'metaengine.browser.fleet-transport-proof.v1', authority_effect: false, tab_id: 'tab_' + index, target_id: 'webcontents:' + index, generation_epoch: 4, conversation_url_sha256: String(index + 1).repeat(64), proven_at: new Date().toISOString() } }));
  const state = { schema: 'metaengine.native-browser-supervisor.state.v1', client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE', transport_identity: { profile: 'A2_DEVICE_HTTP_SIGNATURE_V1', device_id: device, key_fingerprint_sha256: fingerprint, access_tier: 'ADMIN', admin_grant_epoch: 1, admin_ready: true }, fleet: { schema: 'metaengine.browser.fleet-snapshot.v1', readiness_contract: 'TRANSPORT_PROOF_REQUIRED', agents } };
  await sql.unsafe("insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values('continuity');");
  await sql.unsafe('insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,enrollment_pairing_token_hash,key_fingerprint_sha256) values($1,$2,$3,$4)', [device, client, 'continuity', fingerprint]);
  await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state,authority_effect) values($1,$2,clock_timestamp(),$3::jsonb,true)', [client, workspace, sql.json(state)]);
  const rpc = async (name, args) => { const catalog = await sql.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]); const plan = compileRpcRequest(name,args,catalog); try { const rows = await sql.unsafe(plan.text,plan.values.map(({value,json}) => json ? sql.json(value) : value)); return rows[0].value; } catch(error) { if(!/^PROJECT_/.test(error.message)) console.error(name,error); throw error; } };
  const routes = createProjectContinuityRoutes({ workspaceId: workspace, rpc });
  const identity = { ok:true,id:client,device_id:device,admin_ready:true,access_tier:'ADMIN',admin_grant_epoch:1 };
  const route = async (operation, body) => { await sql.unsafe('update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where client_id=$1',[client]); const response = await routes({req:{method:'POST'},path:'/v1/devos/project/'+operation,body,identity}); const value = await response.json(); if(response.status !== 200) throw new Error(value.error); return value; };
  const [taskRow] = await sql.unsafe("select public.devos_fleet_enqueue_v1($1,'continuity.root','CODER',$2,$3::jsonb,'root',null,50) value",[workspace,base,sql.json({ objective:'Root user goal',claim_class:'MUTATING' })]);
  const rootTask = taskRow.value.task_id, rootDigest = taskRow.value.task_spec_sha256;
  await sql.unsafe("insert into destruktion_meta.client_v1_goal_request_h205f22(request_id,workspace_id,roadmap_id,request_sha256,plan_generation,alignment_epoch,baseline_sha,plan_sha256,point_id,task_id,task_spec_sha256,submission_receipt) values($1,$2,'metaengine-client-v1',$3,1,1,$4,$3,'continuity.root',$5,$6,$7::jsonb)",[request,workspace,'b'.repeat(64),base,rootTask,rootDigest,sql.json({schema:'metaengine.client-v1.goal-submit.v2',authority_effect:false,automatic_retry_allowed:false})]);
  const registered = await route('register',{request_id:request}), project = registered.project_id;
  assert.equal((await route('register',{request_id:request})).replayed,true);
  const lease = async (agent) => { const [row] = await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,4,900) value',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id]); assert.equal(row.value.leased,true); const value=row.value; const [claim] = await sql.unsafe("select * from destruktion_meta.devos_fleet_claim_h205f22 where task_id=$1 and state='ACTIVE'",[value.task_id]); await sql.unsafe('select public.devos_fleet_mark_running_v1($1,$2,$3,$4,$5,4,$6::jsonb)',[value.task_id,agent.agent_id,value.lease_generation,agent.tab_id,agent.target_id,sql.json({})]); return {task_id:value.task_id,claim_id:Number(claim.claim_id),lease_generation:Number(value.lease_generation),agent}; };
  const parent = await lease(agents[0]);
  await route('policy',{project_id:project,expected_generation:1,max_depth:0,max_tasks:null,max_children:null});
  const spawnRequest = crypto.randomUUID(), spawnBody={project_id:project,parent_task_id:rootTask,claim_id:parent.claim_id,lease_generation:parent.lease_generation,request_id:spawnRequest,children:[{role:'RESEARCHER',objective:'Investigate child'}]};
  assert.equal((await route('spawn',spawnBody)).children[0].status,'BUDGET_WAIT');
  await route('policy',{project_id:project,expected_generation:2,max_depth:null,max_tasks:null,max_children:null});
  const admitted=await route('spawn',spawnBody), child=admitted.children[0].task_id;
  assert.equal(admitted.children[0].status,'ADMITTED'); assert.equal((await route('spawn',spawnBody)).children[0].task_id,child);
  await assert.rejects(route('spawn',{...spawnBody,children:[{role:'RESEARCHER',objective:'collision'}]}),/COLLISION/);
  const childLease=await lease(agents[1]); assert.equal(childLease.task_id,child);
  const grand=await route('spawn',{project_id:project,parent_task_id:child,claim_id:childLease.claim_id,lease_generation:1,request_id:crypto.randomUUID(),children:[{role:'CODER',objective:'Implement grandchild'}]});
  assert.equal(grand.children[0].depth,2);
  const snap=await route('snapshot',{task_id:child,task_after_seq:0,limit:1});
  assert.equal(snap.selected_task.task_id,child); assert.equal(snap.immediate_children[0].task_id,grand.children[0].task_id); assert.equal(snap.task_cursor.has_more,true); assert.equal(snap.state,'WAITING_CHILDREN');
  await assert.rejects(sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED' where task_id=$1",[rootTask]),/PROJECT_COMPLETION/);
  const activity=await route('activity',{project_id:project,task_id:rootTask,claim_id:parent.claim_id,lease_generation:1,request_id:crypto.randomUUID(),event_type:'NOTE',causal_parent_seq:1,tool:null,artifact:null,content:{claimed_complete:true},receipt_event_id:null}); assert.equal(activity.verified_evidence,false);
  const history=await route('history',{project_id:project,after_seq:0,through_seq:null,limit:2,task_id:null,attempt:null,event_type:null}); assert.equal(history.cursor.commit_ordered,true); assert.equal(history.cursor.has_more,true);
  const filtered=await route('history',{project_id:project,after_seq:0,through_seq:history.cursor.through_seq,limit:128,task_id:null,attempt:null,event_type:'DOES_NOT_EXIST'}); assert.equal(filtered.cursor.next_seq,history.cursor.through_seq); assert.equal(filtered.cursor.has_more,false);
  const grandLease=await lease(agents[2]);
  const finish = async (value,disposition='READY',subject=null) => { const conversation=value.agent.transport_proof.conversation_url_sha256, claimSha=crypto.createHash('sha256').update(value.task_id+disposition).digest('hex'); await sql.unsafe('select destruktion_meta.devos_emit_event_h205f22($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[workspace,'TASK_TRANSPORT_PROVEN',value.task_id,'fixture',value.agent.role,value.agent.agent_id,value.lease_generation,base,sql.json({agent_origin_contract:'ZAI_AGENT_SURFACE_CAUSAL_V1',conversation_url_sha256:conversation,agent_surface_sha256:'e'.repeat(64),prompt_sha256:'f'.repeat(64),effect_state:'PROVEN_CONVERSATION'}),'origin:'+value.task_id]); const summary={result_claim_schema:'metaengine.agent-result-claim.v1',result_claim_sha256:claimSha,result_claim_disposition:disposition,model_claim_authority:false,conversation_url_sha256:conversation,raw_model_claim_included:false,page_content_included:false,...(subject?{result_claim_subject_task_id:subject.task_id,result_claim_subject_result_sha256:subject.sha}: {})}; await sql.unsafe('select public.devos_fleet_complete_v1($1,$2,$3,$4,$5,4,$6,$7::jsonb,null)',[value.task_id,value.agent.agent_id,value.lease_generation,value.agent.tab_id,value.agent.target_id,'RESULT_READY',sql.json(summary)]);return claimSha; };
  const grandSha=await finish(grandLease);
  assert.equal((await route('reconcile',{project_id:project})).admitted_verifiers,1);
  const critic=await lease(agents[3]);
  const [criticSpec]=await sql.unsafe('select task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[critic.task_id]); assert.deepEqual(criticSpec.task_spec.verification_subject,{task_id:grandLease.task_id,result_sha256:grandSha});
  await finish(critic,'ACCEPT',{task_id:grandLease.task_id,sha:grandSha});
  await route('reconcile',{project_id:project});
  const [grandState]=await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[grandLease.task_id]); assert.equal(grandState.state,'COMPLETED');
  const childSha=await finish(childLease);
  assert.equal((await route('reconcile',{project_id:null})).projects.length,1);
  const childCritic=await lease(agents[3]); await finish(childCritic,'ACCEPT',{task_id:child,sha:childSha}); await route('reconcile',{project_id:project});
  const rootSha=await finish(parent);
  assert.equal((await route('spawn',spawnBody)).replayed,true,'lost response replay is read-only after the parent lease closed');
  await route('reconcile',{project_id:null});
  const rootCritic=await lease(agents[3]); await finish(rootCritic,'ACCEPT',{task_id:rootTask,sha:rootSha}); await route('reconcile',{project_id:null});
  const complete=await route('snapshot',{task_id:rootTask}); assert.equal(complete.state,'COMPLETED'); assert.equal(complete.selected_task.state,'COMPLETED');
  const beforeSeq=complete.last_seq;
  let release, appended; const held=new Promise(resolve=>{release=resolve;}), firstAppended=new Promise(resolve=>{appended=resolve;});
  const append = (tx,key) => tx.unsafe("select destruktion_meta.project_append_h205f22($1,'CONCURRENCY_NOTE',$2,1,'fixture',null,null,null,'{}'::jsonb,'FIXTURE',null,false,$3) seq",[project,rootTask,key]);
  const first=sql.begin(async tx=>{ const row=await append(tx,'concurrent-a'); appended(); await held; return Number(row[0].seq); }); await firstAppended;
  const second=sql.begin(async tx=>Number((await append(tx,'concurrent-b'))[0].seq));
  const during=await route('history',{project_id:project,after_seq:beforeSeq,through_seq:null,limit:128,task_id:null,attempt:null,event_type:null});
  assert.equal(during.cursor.through_seq,beforeSeq,'uncommitted lower seq is not exposed as a forward highwater'); release();
  const [firstSeq,secondSeq]=await Promise.all([first,second]); assert.equal(firstSeq,beforeSeq+1);assert.equal(secondSeq,beforeSeq+2);
  await assert.rejects(sql.begin(async tx=>{await append(tx,'aborted');throw new Error('rollback fixture');}),/rollback fixture/);
  const after=await route('history',{project_id:project,after_seq:beforeSeq,through_seq:null,limit:128,task_id:null,attempt:null,event_type:null}); assert.deepEqual(after.entries.map(row=>row.seq),[firstSeq,secondSeq]); assert.equal(after.cursor.next_seq,secondSeq);
  const snapshotBeforeFailure=after.cursor.next_seq;
  await sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='FAILED',error_code='FIXTURE_CHILD_FAILED' where task_id=$1",[grandLease.task_id]);
  assert.equal((await route('snapshot',{task_id:rootTask})).state,'BLOCKED');
  const [immutable]=await sql.unsafe('select task_spec_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[rootTask]); assert.equal(immutable.task_spec_sha256,rootDigest);
  const [privileges]=await sql.unsafe("select has_function_privilege('anon','public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)','execute') anon,has_function_privilege('service_role','public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)','execute') service"); assert.equal(privileges.anon,false);assert.equal(privileges.service,true);
  await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[device]); await assert.rejects(route('snapshot',{task_id:rootTask}),/GRANT_REVOKED/);
  console.log(JSON.stringify({schema:'compute.project-continuity-evidence.v1',postgres:17,disposable:true,migration_sha256:crypto.createHash('sha256').update(await source(migration)).digest('hex'),lineage_depth:2,independent_verifier:true,root_completed_after_descendants:true,commit_ordered_cursor:true,aborted_event_rolled_back:true,root_task_spec_immutable:true,authority_effect:false}));
});
