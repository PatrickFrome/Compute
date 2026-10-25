import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {admissionFixture,digest} from './fixtures/native-coding-admission-fixture.mjs';
import {canonicalNativeCodingAdmissionJSON,admitNativeCodingExecution} from '../supabase/a2-browser-native-supervisor-v1/native-coding-admission.mjs';
import {NativeCodingPgLedger} from '../src/native-coding-pg-ledger.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER,run=promisify(execFile);
const migration='20261023082533_native_coding_operator_qa_admission_v1.sql';
test('native admission uses real disposable PostgreSQL and existing W30; never installed Keeper',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const directory=await fs.mkdtemp(path.join(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir(),'native-coding-admission-'));
  const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
  const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const execute=(name,args)=>new Promise((resolve,reject)=>{
    // Windows pg_ctl's long-lived cmd/postmaster children must inherit no
    // captured pipes. Wait for the actual command exit, not descendants' EOF.
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
  });
  let started=false,sql;
  try{
    await execute('initdb',['-D',data,'--username=qa_native_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    started=true;await execute('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'qa_native_owner',database:'postgres',max:2,onnotice:()=>{},connection:{application_name:'METAENGINE_NATIVE_ADMISSION_DISPOSABLE_QA'}});
    await sql.unsafe(`create role anon;create role authenticated;create role service_role;create schema extensions;
      create extension pgcrypto with schema extensions;
      create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
        active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]');
      create table public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id uuid,client_id text,state jsonb,last_seen_at timestamptz default clock_timestamp());
      create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true);
      create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
        $$select jsonb_build_object('refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),'supervisor_admission_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false))$$;
      create schema destruktion_meta;
      create function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(value jsonb)returns jsonb language sql immutable as $$select value$$;`);
    const source=await fs.readFile(new URL('../../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql',import.meta.url),'utf8');
    await sql.unsafe(source.slice(0,source.indexOf('create or replace function destruktion_meta.devos_emit_event_h205f22')));
    for(const name of ['devos_fleet_reconcile_v1','devos_fleet_mark_running_v1','devos_fleet_complete_v1']){
      const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('end $$;',start)+7;
      assert.ok(start>0&&end>start);await sql.unsafe(source.slice(start,end));
    }
    await sql.unsafe(await fs.readFile(new URL('../../../supabase/migrations/20260903052200_devos_dispatch_admission_signed_native_v3.sql',import.meta.url),'utf8'));
    await sql.unsafe(`create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22 for each row execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22();`);
    await sql.unsafe(await fs.readFile(new URL('../../../supabase/migrations/20261022070000_native_coding_execution_ledger_v1.sql',import.meta.url),'utf8'));
    await sql.unsafe(await fs.readFile(new URL('../../../supabase/migrations/'+migration,import.meta.url),'utf8'));
    const [cluster]=await sql.unsafe('select system_identifier::text as id from pg_control_system()');
    async function fixture(change){
      const f=admissionFixture();f.permit.postgres.system_identifier=cluster.id;
      if(change)change(f);f.provider=f.envelope(f.payload());
      await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256) values($1,$2,$3,$4,$5)`,
        [f.identity.device_id,f.clientId,f.identity.profile,sql.json(f.jwk),f.identity.key_fingerprint_sha256]);
      await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22(permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)values($1,$2,$3,$4,1,$5,$6,1,$7,$8)`,
        [f.permit.permit_id,f.workspaceId,f.clientId,f.permit.device_id,f.permit.provider_id,f.permit.agent_id,sql.json(f.permit),f.permit.record_sha256]);
      await sql.unsafe(`insert into destruktion_meta.native_coding_provider_registration_h205f22(permit_id,envelope,canonical_envelope,envelope_sha256)values($1,$2,$3,$4)`,
        [f.permit.permit_id,sql.json(f.provider),canonicalNativeCodingAdmissionJSON(f.provider),digest(f.provider)]);
      const state={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
        transport_identity:{profile:f.identity.profile,device_id:f.identity.device_id,key_fingerprint_sha256:f.identity.key_fingerprint_sha256},
        supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}}};
      await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[f.workspaceId,f.clientId,sql.json(state)]);
      await sql.unsafe('insert into public.qa_native_environment values($1,true)',[f.workspaceId]);return f;
    }
    async function task(f,{native=true,priority=50}={}){
      const id=native?f.binding.task_id:randomUUID();
      const spec=native?{native_coding:{permit_id:f.permit.permit_id,goal_id:f.permit.goal_id,goal_sha256:f.permit.goal_sha256,project_id:f.permit.project_id}}:{};
      await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key,priority)values($1::uuid,$2,'fixture','IMPLEMENTER',$3,$4,$5,$1::text,$6)`,
        [id,f.workspaceId,f.permit.worktree.base_sha,sql.json(spec),'a'.repeat(64),priority]);return id;
    }
    const lease=f=>sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',[f.workspaceId,f.permit.agent_id,'IMPLEMENTER',f.binding.tab_id,f.binding.target_id]).then(rows=>rows[0].value);
    await t.test('only the permit-bound native task is picked, despite a higher-priority browser task',async()=>{
      const f=await fixture();const foreign=await task(f,{native:false,priority:999});await task(f);
      const out=await lease(f);assert.equal(out.task_id,f.binding.task_id);
      assert.equal((await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[foreign]))[0].state,'READY');
    });
    await t.test('browser allocator excludes native QA work and browser admission stays strict',async()=>{
      const f=await fixture();await task(f);
      const result=await sql.unsafe("select public.devos_fleet_lease_v1($1,$2,'IMPLEMENTER','tab_fixture','webcontents:123',1,900)as value",[f.workspaceId,f.permit.agent_id]);
      assert.equal(result[0].value.leased,false);
      await task(f,{native:false});
      await assert.rejects(sql.unsafe("select public.devos_fleet_lease_v1($1,$2,'IMPLEMENTER','tab_fixture','webcontents:123',1,900)",[f.workspaceId,f.permit.agent_id]),error=>error.code==='55000'&&error.message==='devos_transport_agent_missing');
    });
    await t.test('service/API cannot create permit/provider/job records or advance the private ledger',async()=>{
      for(const relation of ['native_coding_operator_permit_h205f22','native_coding_provider_registration_h205f22','native_coding_job_registration_h205f22']){
        assert.equal((await sql.unsafe("select has_table_privilege('service_role',$1,'INSERT')as allowed",['destruktion_meta.'+relation]))[0].allowed,false);
      }
      await assert.rejects(sql.begin(async tx=>{await tx.unsafe('set local role service_role');await tx.unsafe("select destruktion_meta.native_coding_reserve_v1(null,null,null,null,null,null,null,null,null)");}),error=>error.code==='42501');
    });
    await t.test('expired provider proof denies the claim and rolls back W30 task assignment',async()=>{
      const f=await fixture();await task(f);const expired=f.envelope({...f.provider.payload,expires_at:f.iso(-1)});
      await sql.unsafe('update destruktion_meta.native_coding_provider_registration_h205f22 set envelope=$1,canonical_envelope=$2,envelope_sha256=$3 where permit_id=$4',
        [sql.json(expired),canonicalNativeCodingAdmissionJSON(expired),digest(expired),f.permit.permit_id]);
      await assert.rejects(lease(f),error=>error.message.includes('native_coding_provider_unregistered'));
      assert.equal((await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.binding.task_id]))[0].state,'READY');
    });
    await t.test('old ambiguous Supervisor wake and closed workspace admission remain frozen',async()=>{
      const f=await fixture();await task(f);
      await sql.unsafe("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{supervisor_lifecycle,keepalive,state}','\"WAKE_AMBIGUOUS\"')where workspace_id=$1",[f.workspaceId]);
      await assert.rejects(lease(f),error=>error.message.includes('native_coding_continuity_fenced'));
      await sql.unsafe("update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{supervisor_lifecycle,keepalive,state}','\"WAITING\"')where workspace_id=$1",[f.workspaceId]);
      await sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[f.workspaceId]);
      await assert.rejects(lease(f),error=>error.message.includes('native_coding_environment_fenced'));
    });
    await t.test('native RUNNING/result cannot be forged through existing public W30 mutators',async()=>{
      const f=await fixture();await task(f);await lease(f);
      await assert.rejects(sql.unsafe('select public.devos_fleet_mark_running_v1($1,$2,1,$3,$4,1,$5)',[f.binding.task_id,f.permit.agent_id,f.binding.tab_id,f.binding.target_id,sql.json({verified:true})]),error=>error.message.includes('native_coding_job_unregistered'));
    });
    await t.test('registered attempt and result use the existing W30 transitions; result is not autonomous completion',async()=>{
      const f=await fixture();await task(f);const leased=await lease(f);
      f.jobPayload.lease_expires_at=new Date(leased.lease_expires_at).toISOString();
      const job=f.envelope(f.jobPayload),scope={workspace_id:f.workspaceId,task_id:f.binding.task_id,lease_generation:1,agent_id:f.permit.agent_id,target_id:f.binding.target_id,agent_generation_epoch:1,host_incarnation:f.jobPayload.host_process.process_incarnation_id,scope_sha256:'a'.repeat(64)};
      const ledger=new NativeCodingPgLedger({transaction:(callback,options={})=>sql.begin(options.readOnly?'read only':'isolation level serializable',callback)});
      const reserved=await ledger.reserve(scope);
      await sql.begin(async tx=>{
        await tx.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22(task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256)values($1,1,$2,$3,$4,$5,$6)`,
          [scope.task_id,f.permit.permit_id,f.jobPayload.run_id,tx.json(job),canonicalNativeCodingAdmissionJSON(job),digest(job)]);
        await tx.unsafe("select destruktion_meta.native_coding_advance_v1($1,1,$2,$3,$4,'RESERVED','ATTEMPTED',$5,null,null)",[scope.task_id,reserved.scope.reservation_id,scope.scope_sha256,scope.host_incarnation,digest(job)]);
      });
      await sql.unsafe('select public.devos_fleet_mark_running_v1($1,$2,1,$3,$4,1,$5)',[scope.task_id,scope.agent_id,f.binding.tab_id,scope.target_id,sql.json({schema:'metaengine.native-coding.mark-running.v1',job_proof_sha256:digest(job)})]);
      await sql.begin(async tx=>{
        await tx.unsafe('update destruktion_meta.native_coding_job_registration_h205f22 set result_receipt=$1,canonical_result_receipt=$2,result_receipt_sha256=$3,result_registered_at=clock_timestamp()where task_id=$4 and lease_generation=1',
          [tx.json(f.receipt),canonicalNativeCodingAdmissionJSON(f.receipt),digest(f.receipt),scope.task_id]);
        await tx.unsafe("select destruktion_meta.native_coding_advance_v1($1,1,$2,$3,$4,'ATTEMPTED','RESULT_READY',$5,null,null)",[scope.task_id,reserved.scope.reservation_id,scope.scope_sha256,scope.host_incarnation,f.receipt.result_sha256]);
      });
      const rpc=async(name,input)=>(await sql.unsafe(`select public.${name}($1,$2,$3,$4)as value`,[input.p_workspace,input.p_client,input.p_task,input.p_generation]))[0].value;
      const {summary}=await admitNativeCodingExecution({...f.binding,state:'RESULT_READY',native_coding:{schema:'metaengine.native-coding.complete.v1',receipt:f.receipt}},
        {rpc,identity:f.identity,workspaceId:f.workspaceId,clientId:f.clientId,complete:true});
      const out=(await sql.unsafe("select public.devos_fleet_complete_v1($1,$2,1,$3,$4,1,'RESULT_READY',$5,null)as value",[scope.task_id,scope.agent_id,f.binding.tab_id,scope.target_id,sql.json(summary)]))[0].value;
      assert.equal(out.state,'RESULT_READY');
      await assert.rejects(sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED'where task_id=$1",[scope.task_id]),error=>error.message.includes('native_coding_result_unregistered'));
    });
    await t.test('existing reconcile freezes expired native effects without requeue or retry',async()=>{
      const f=await fixture();await task(f);await lease(f);
      await sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set lease_expires_at=clock_timestamp()-interval '1 second'where task_id=$1",[f.binding.task_id]);
      await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second'where task_id=$1",[f.binding.task_id]);
      assert.equal((await lease(f)).leased,false);
      assert.equal((await sql.unsafe('select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.binding.task_id]))[0].state,'AMBIGUOUS');
    });
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.admission.disposable-qa.v1',state:'PASS',installed_keeper_used:false,authority_effect:false,migration},null,2));
  }finally{if(sql)await sql.end({timeout:5});if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await execute('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
});
