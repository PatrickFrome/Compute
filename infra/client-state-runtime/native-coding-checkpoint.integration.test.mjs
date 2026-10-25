import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {buildNativeCodingHistoricalTaskContext,buildNativeCodingExecutionScope,nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha}
  from './native-coding-task-context.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url),source=name=>fs.readFile(new URL(name,migrations),'utf8');

// Actual Host SELECTs, canonical casts, historical ledger CAS and finalizer in
// real disposable PG17. ALL OS/image/sandbox/Git reader values are generated
// fixtures, not installed authority or proof that an agent performed work.
test('private checkpoint Host verifies and commits a historical pair on a disposable PG17',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-coding-checkpoint-host-')),data=path.join(directory,'pgdata');
  const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
  const command=(name,args)=>new Promise((resolve,reject)=>{
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
    const timer=setTimeout(()=>{child.kill();reject(Error('disposable_checkpoint_command_timeout'));},90000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_checkpoint_command_failed_'+name));});
  });
  let started=false,sql,passed=0,cluster;const authorities=[];
  try {
    await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    started=true;await command('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,onnotice:()=>{},connect_timeout:5,
      connection:{application_name:'METAENGINE_CHECKPOINT_HOST_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
    const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,
      current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
      (select system_identifier::text from pg_control_system()) as system_identifier`);
    assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');
    assert.ok(identity.version>=170000&&identity.version<180000);assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());cluster=identity.system_identifier;
    await sql.unsafe(`create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;
      create schema destruktion_meta;
      create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
        active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
        admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text);
      create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);
      create table public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id uuid,client_id text,state jsonb,last_seen_at timestamptz default clock_timestamp(),authority_effect boolean default false);
      create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true);
      create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
        $$select jsonb_build_object('refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),
          'supervisor_admission_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false))$$;
      create function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(value jsonb)returns jsonb language sql immutable as $$select value$$;`);
    const bootstrap=await source('20260929010000_client_v1_fresh_project_bootstrap_v1.sql');
    const first=bootstrap.indexOf('create table if not exists destruktion_meta.devos_fleet_task_h205f22'),last=bootstrap.indexOf('create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22');
    assert.ok(first>=0&&last>first);await sql.unsafe(bootstrap.slice(first,last));
    const goal=await source('20260929211500_client_v1_goal_progress_reconciliation_v1.sql');
    await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'),goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
    const result=await source('20260929224500_client_v1_agent_origin_result_proof_v1.sql');
    await sql.unsafe(result.slice(0,result.indexOf('-- Keep the existing Client progress contract')));
    await sql.unsafe(await source('20260903052200_devos_dispatch_admission_signed_native_v3.sql'));
    await sql.unsafe(`create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
      for each row execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()`);
    for(const name of ['20261010100000_project_continuity_history_v1.sql','20261012130000_project_verifier_reference_transport_v1.sql',
      '20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql',
      '20261025070000_native_coding_project_continuation_v1.sql'])await sql.unsafe(await source(name));

    async function fixture() {
      const f=checkpointFixture(),root=sha(randomUUID());
      f.native.postgres=structuredClone(f.writer.permit.postgres);f.native.postgres.system_identifier=cluster;
      f.native.host_process=structuredClone(f.writer.registration.job_envelope.payload.host_process);
      f.native.worktree.root_identity_sha256=root;
      for(const b of [f.writer,f.critic]) {
        b.permit.postgres.system_identifier=cluster;b.permit.worktree.root_identity_sha256=root;
        b.registration.job_envelope.payload.postgres=structuredClone(b.permit.postgres);
        b.registration.job_envelope.payload.worktree=structuredClone(b.permit.worktree);
        const context=buildNativeCodingHistoricalTaskContext(b.task,{projectId:f.project.project_id,providerId:b.permit.provider_id,
          verificationSubject:b.task.task_spec.native_coding.verification_subject??null});
        Object.assign(b.execution,buildNativeCodingExecutionScope(b.permit,context.value,b.registration.job_envelope.payload.host_process));
        f.refresh(b,{resign:true});
      }
      const token=randomUUID();await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 values($1,true)',[token]);
      await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
        values($1,$2,$3,$4,$5,$6)`,[f.project.device_id,f.project.client_id,f.writer.device.profile,sql.json(f.writer.device.public_jwk),f.writer.device.key_fingerprint_sha256,token]);
      const supervisor={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
        transport_identity:{profile:f.writer.device.profile,device_id:f.project.device_id,key_fingerprint_sha256:f.writer.device.key_fingerprint_sha256},
        supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}}};
      await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[f.project.workspace_id,f.project.client_id,sql.json(supervisor)]);
      await sql.unsafe('insert into public.qa_native_environment values($1,true)',[f.project.workspace_id]);
      for(const b of [f.writer,f.critic]) {
        const p=b.permit,j=b.registration,e=b.execution,task=b.task;
        await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22
          (permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
          values($1,$2,$3,$4,1,$5,$6,1,$7,$8)`,[p.permit_id,p.workspace_id,f.project.client_id,p.device_id,p.provider_id,p.agent_id,sql.json(p),p.record_sha256]);
        const {schema,issued_at,expires_at,revoked,storage_evidence_sha256,record_sha256,...permitScope}=p;
        const provider=f.f.envelope({...f.f.payload(),...permitScope,target_id:'codex-cli:'+p.provider_id,sandbox:j.job_envelope.payload.sandbox});
        await sql.unsafe(`insert into destruktion_meta.native_coding_provider_registration_h205f22 values($1,$2,$3,$4,clock_timestamp())`,[p.permit_id,sql.json(provider),json(provider),sha(provider)]);
        await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22
          (task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key,state,lease_generation,lease_agent_id,lease_tab_id,
            lease_target_id,lease_agent_generation_epoch,lease_expires_at)values($1::uuid,$2::uuid,'checkpoint-host-fixture',$3,$4,$5,$6,$1::text,'RESULT_READY',1,$7,$8,$9,1,$10)`,
          [task.task_id,task.workspace_id,task.role,task.base_sha,sql.json(task.task_spec),sha(task.task_spec),task.lease_agent_id,task.lease_tab_id,task.lease_target_id,task.lease_expires_at]);
      }
      await sql.unsafe(`insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal)
        values($1,$2,$3,$4,$5,$6,1,'Generated Host checkpoint fixture')`,[f.project.project_id,f.project.workspace_id,randomUUID(),f.writer.task.task_id,f.project.device_id,f.project.client_id]);
      await sql.unsafe('insert into destruktion_meta.project_task_h205f22 values($1,$2,1,$1,null,0),($3,$2,2,$1,$1,1)',[f.writer.task.task_id,f.project.project_id,f.critic.task.task_id]);
      for(const b of [f.writer,f.critic]) {
        const p=b.permit,j=b.registration,e=b.execution,task=b.task;
        await sql.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22
          (workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256,state,job_proof_sha256,result_sha256)
          values($1,$2,1,$3,$4,$5,1,$6,$7,'RESULT_READY',$8,$9)`,[e.workspace_id,e.task_id,e.reservation_id,e.agent_id,e.target_id,e.host_incarnation,e.scope_sha256,e.job_proof_sha256,e.result_sha256]);
        await sql.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22
          (task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256,result_receipt,canonical_result_receipt,result_receipt_sha256,result_registered_at)
          values($1,1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,[j.task_id,j.permit_id,j.run_id,sql.json(j.job_envelope),j.canonical_job_envelope,j.job_envelope_sha256,sql.json(j.result_receipt),j.canonical_result_receipt,j.result_receipt_sha256]);
        await sql.unsafe(`insert into destruktion_meta.devos_fleet_claim_h205f22
          (task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at)
          values($1,$2,'checkpoint-host-fixture',$3,$4,'MUTATING',$5,$6,$7,1,1,$8)`,[task.task_id,task.workspace_id,task.base_sha,task.role,task.lease_agent_id,task.lease_tab_id,task.lease_target_id,task.lease_expires_at]);
        await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED' where task_id=$1",[task.task_id]);
        const summary={schema:'metaengine.native-coding.result-summary.v1',run_id:j.run_id,result_sha256:j.result_receipt.result_sha256,
          receipt_sha256:j.result_receipt_sha256,git_artifact_sha256:j.result_receipt.git_after.artifact_sha256,source_head:j.result_receipt.git_after.head,
          useful_work_verified:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
        await sql.unsafe(`update destruktion_meta.devos_fleet_task_h205f22 set result_summary=$2::jsonb,
          result_summary_sha256=encode(extensions.digest(convert_to(($2::jsonb)::text,'UTF8'),'sha256'),'hex'),
          result_sha256=encode(extensions.digest(convert_to(($2::jsonb)::text,'UTF8'),'sha256'),'hex')where task_id=$1`,[task.task_id,sql.json(summary)]);
      }
      let lastPgError;
      const privateSql={unsafe:(q,a)=>sql.unsafe(q,a),begin:(mode,callback)=>sql.begin(mode,tx=>callback({unsafe:async(q,a)=>{
        try{return await tx.unsafe(q,a);}catch(error){lastPgError={code:error.code,message:error.message};throw error;}
      }}))};
      const authority=await createNativeCodingHostAuthority({sql:privateSql,readProtectedReceipt:f.readProtectedReceipt,readCheckpointScope:f.readCheckpointScope,
        readNativeScope:async()=>{throw Error('checkpoint_must_not_request_launch_canary');},readNativeWorker:async()=>{throw Error('old_exited_worker_is_not_current');}});
      authorities.push(authority);return {f,authority,request:{project_id:f.project.project_id},diagnostic:()=>lastPgError};
    }
    async function subtest(name,callback){await t.test(name,async()=>{await callback();passed++;});}
    await subtest('actual candidate JOIN, historical proof verification, both CAS and finalizer commit atomically',async()=>{
      const x=await fixture();assert.equal((await x.authority.READ_PROJECT_CHECKPOINT(x.request)).state,'PENDING');
      let result;try{result=await x.authority.RECONCILE_PROJECT(x.request);}catch(error){t.diagnostic(JSON.stringify(x.diagnostic()));throw error;}
      assert.equal(result.state,'CHECKPOINTED_PENDING_COMMIT');assert.equal(result.successor_admitted,false);
      assert.deepEqual(await x.authority.READ_PROJECT_CHECKPOINT(x.request),result);
      const rows=await sql.unsafe('select state,checkpoint_sha256,host_incarnation from destruktion_meta.native_coding_execution_h205f22 where workspace_id=$1',[x.f.project.workspace_id]);
      assert.equal(rows.length,2);assert.ok(rows.every(row=>row.state==='CHECKPOINTED'&&row.checkpoint_sha256===result.checkpoint_sha256));
      assert.equal((await sql.unsafe("select count(*)::int as n from destruktion_meta.devos_fleet_task_h205f22 where workspace_id=$1 and state='COMPLETED'",[x.f.project.workspace_id]))[0].n,2);
      assert.equal((await sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where workspace_id=$1',[x.f.project.workspace_id]))[0].state,'CHECKPOINTED_PENDING_COMMIT');
    });
    await subtest('changed current bytes deny all checkpoint writes and leave historical execution states intact',async()=>{
      const x=await fixture();x.f.native.git.artifact_sha256='f'.repeat(64);
      await assert.rejects(x.authority.RECONCILE_PROJECT(x.request),error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
      assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_checkpoint_h205f22 where project_id=$1',[x.f.project.project_id]))[0].n,0);
      assert.ok((await sql.unsafe('select state from destruktion_meta.native_coding_execution_h205f22 where workspace_id=$1',[x.f.project.workspace_id])).every(row=>row.state==='RESULT_READY'));
    });
    assert.equal(passed,2);
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.checkpoint-host.disposable-qa.v1',state:'PASS',
      source_classification:'REAL_DISPOSABLE_PG_WITH_GENERATED_OS_IMAGE_GIT_SANDBOX_FIXTURES',subtests:passed,port,postgres_system_identifier:cluster,
      installed_keeper_used:false,installed_autonomy_proven:false,model_calls:0,authority_effect:false},null,2));
    t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));
  }finally{
    for(const authority of authorities)authority.close();if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    if(started){assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:cluster,postmaster_pid_file_absent:true,installed_keeper_used:false,authority_effect:false},null,2));}
  }
});
