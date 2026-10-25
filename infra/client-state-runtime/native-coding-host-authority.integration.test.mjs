import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {buildNativeCodingExecutionScope,nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson as canonical}
  from './native-coding-task-context.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const unknown=e=>e.effect_outcome==='UNKNOWN'&&e.automatic_retry_allowed===false;

// Real SQL / casts / locks / transactions in a NEW disposable PG17 cluster.
// Native processes, sandbox, image, and journal callbacks below are explicit
// generated fixtures. This test claims no installed authorization or work.
test('private Host authority SQL qualifies on a disposable PG17 state_owner LOGIN',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-coding-host-authority-'));
  const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  assert.ok(![55432,55433,55434].includes(port));
  const command=(name,args)=>new Promise((resolve,reject)=>{
    // pg_ctl postmaster children MUST inherit no captured pipes on Windows.
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
      {windowsHide:true,stdio:'ignore',shell:false});
    const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
  });
  let started=false,sql,cluster,passed=0;
  const authorities=[];
  try {
    await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,onnotice:()=>{},
      connect_timeout:5,idle_timeout:10,connection:{application_name:'METAENGINE_HOST_AUTHORITY_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
    const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,
      current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
      (select system_identifier::text from pg_control_system()) as system_identifier`);
    assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');
    assert.ok(identity.version>=170000&&identity.version<180000);
    assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());
    cluster=identity.system_identifier;
    await sql.unsafe(`create role anon;create role authenticated;create role service_role;create schema extensions;
      create extension pgcrypto with schema extensions;
      create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
        active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
        admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]');
      create table public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id uuid,client_id text,state jsonb,last_seen_at timestamptz default clock_timestamp());
      create table public.qa_native_environment(workspace_id uuid primary key,enabled boolean default true);
      create function public.devos_environment_state_v1(p_workspace uuid)returns jsonb language sql as
        $$select jsonb_build_object('refill_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false),
          'supervisor_admission_enabled',coalesce((select enabled from public.qa_native_environment where workspace_id=p_workspace),false))$$;
      create schema destruktion_meta;
      create function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(value jsonb)returns jsonb language sql immutable as $$select value$$;`);
    const bootstrap=await fs.readFile(new URL('20260929010000_client_v1_fresh_project_bootstrap_v1.sql',migrations),'utf8');
    const boundary=bootstrap.indexOf('create or replace function destruktion_meta.devos_emit_event_h205f22');assert.ok(boundary>0);
    await sql.unsafe(bootstrap.slice(0,boundary));
    const reconcileStart=bootstrap.indexOf('create or replace function public.devos_fleet_reconcile_v1(');
    const reconcileEnd=bootstrap.indexOf('end $$;',reconcileStart)+7;
    assert.ok(reconcileStart>0&&reconcileEnd>reconcileStart);await sql.unsafe(bootstrap.slice(reconcileStart,reconcileEnd));
    // Use the current project registry column types and constraints verbatim.
    const project=await fs.readFile(new URL('20261010100000_project_continuity_history_v1.sql',migrations),'utf8');
    const projectEnd=project.indexOf('create table destruktion_meta.project_event_h205f22');assert.ok(projectEnd>0);
    await sql.unsafe(project.slice(0,projectEnd));
    await sql.unsafe(await fs.readFile(new URL('20260903052200_devos_dispatch_admission_signed_native_v3.sql',migrations),'utf8'));
    await sql.unsafe(`create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
      for each row execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()`);
    for(const name of ['20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql'])
      await sql.unsafe(await fs.readFile(new URL(name,migrations),'utf8'));

    async function fixture() {
      const f=admissionFixture();f.permit.postgres.system_identifier=cluster;f.provider=f.envelope(f.payload());
      const native={artifact:structuredClone(f.permit.artifact),postgres:structuredClone(f.permit.postgres),
        worktree:structuredClone(f.permit.worktree),host_process:f.provider.payload.host_process,
        user_sid:f.permit.user_sid,sandbox:f.provider.payload.sandbox};
      const controls={worker:null,receipt:null},transactionReadbacks=[];
      // Query instrumentation delegates EVERY statement to the actual PG
      // connection; it is not a SQL/transaction double.
      const privateSql={unsafe:(query,args)=>sql.unsafe(query,args),begin:(mode,callback)=>sql.begin(mode,async tx=>{
        const result=await callback(tx);
        const [settings]=await tx.unsafe(`select current_setting('synchronous_commit') as synchronous_commit,
          current_setting('transaction_isolation') as isolation`);
        transactionReadbacks.push(settings);return result;
      })};
      const authority=await createNativeCodingHostAuthority({sql:privateSql,
        readNativeScope:async()=>structuredClone(native),readNativeWorker:async()=>structuredClone(controls.worker),
        readProtectedReceipt:async()=>structuredClone(controls.receipt)});
      authorities.push(authority);
      await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256)
        values($1::uuid,$2::text,$3::text,$4::jsonb,$5::text)`,[f.permit.device_id,f.clientId,f.identity.profile,sql.json(f.jwk),f.identity.key_fingerprint_sha256]);
      await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22
        (permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
        values($1::uuid,$2::uuid,$3::text,$4::uuid,1,$5::uuid,$6::text,1,$7::jsonb,$8::text)`,
        [f.permit.permit_id,f.workspaceId,f.clientId,f.permit.device_id,f.permit.provider_id,f.permit.agent_id,sql.json(f.permit),f.permit.record_sha256]);
      const spec={objective:'Qualify a generated disposable Host SQL task',constraints:['Use the disposable fixture only'],
        native_coding:{permit_id:f.permit.permit_id,goal_id:f.permit.goal_id,goal_sha256:f.permit.goal_sha256,project_id:f.permit.project_id}};
      await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22
        (task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key)
        values($1::uuid,$2::uuid,'host-sql-fixture','IMPLEMENTER',$3::text,$4::jsonb,$5::text,$1::text)`,
        [f.binding.task_id,f.workspaceId,f.permit.worktree.base_sha,sql.json(spec),sha(spec)]);
      await sql.unsafe(`insert into destruktion_meta.project_run_h205f22
        (project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal)
        values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,1,'Disposable fixture')`,
        [f.permit.project_id,f.workspaceId,randomUUID(),f.binding.task_id,f.permit.device_id,f.clientId]);
      await sql.unsafe(`insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,depth)
        values($1::uuid,$2::uuid,0,$1::uuid,0)`,[f.binding.task_id,f.permit.project_id]);
      const supervisor={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
        transport_identity:{profile:f.identity.profile,device_id:f.permit.device_id,key_fingerprint_sha256:f.identity.key_fingerprint_sha256},
        supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}}};
      await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',
        [f.workspaceId,f.clientId,sql.json(supervisor)]);
      await sql.unsafe('insert into public.qa_native_environment values($1,true)',[f.workspaceId]);
      const query={workspace_id:f.workspaceId,project_id:f.permit.project_id,task_id:f.binding.task_id,
        agent_id:f.permit.agent_id,lease_generation:1,provider_id:f.permit.provider_id};
      let lease,scope,job,receipt;
      const register=()=>authority.REGISTER_PROVIDER({descriptor:f.provider});
      async function prepare() {
        await register();
        const [leased]=await sql.unsafe(`select public.devos_fleet_lease_v1($1::uuid,$2::text,'IMPLEMENTER',$3::text,$4::text,1,900) as value`,
          [f.workspaceId,f.permit.agent_id,f.binding.tab_id,f.binding.target_id]);
        assert.equal(leased.value.leased,true);
        lease=(await authority.READ_LEASE(query)).value;
        scope=buildNativeCodingExecutionScope(f.permit,lease,native.host_process);
        const payload={...f.jobPayload,prompt_sha256:lease.prompt_sha256,lease_expires_at:lease.expires_at,
          job_id:f.jobPayload.run_id,expires_at:new Date(Math.min(Date.parse(lease.expires_at),Date.parse(f.permit.expires_at))-1000).toISOString()};
        job=f.envelope(payload);
        controls.worker={...payload.worker_process,user_sid:f.permit.user_sid,job_id:payload.job_id,
          run_id:payload.run_id,prompt_sha256:payload.prompt_sha256};
        const process={...payload.worker_process,started_at:payload.worker_process.created_at,job_id:payload.job_id,
          tree_control_bound:true,started_suspended:true,job_bound_before_resume:true,process_tree_control:'WINDOWS_JOB_OBJECT'};
        delete process.created_at;
        receipt={...f.receipt,provider:'CODEX_CLI',base_sha:f.permit.worktree.base_sha,workspace_id:f.workspaceId,
          project_id:f.permit.project_id,user_sid:f.permit.user_sid,worktree_path:f.permit.worktree.path,
          prompt_sha256:payload.prompt_sha256,sandbox_mode:'workspace-write',pid:payload.worker_process.pid,process,
          process_result:{exit_code:0,signal:null,reason:null,tree_cleanup_confirmed:true,process_tree_control:'WINDOWS_JOB_OBJECT'},
          git_before:{head:f.permit.worktree.base_sha,artifact_sha256:'1'.repeat(64)},
          git_after:{head:f.permit.worktree.base_sha,artifact_sha256:'2'.repeat(64)},
          useful_work_verified:false,model_claim_authority:false,
          result:{schema:'metaengine.codex-cli.result.v1',role:'IMPLEMENTER',outcome:'DONE',summary:'Generated SQL fixture',checks:[],followup_tasks:[]}};
        delete receipt.target_id;delete receipt.tab_id;controls.receipt=receipt;
        return {lease,scope,job,receipt};
      }
      const attempted=()=>({from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha(job),critic_proof_sha256:null,checkpoint_sha256:null,job_proof:job});
      const ready=()=>({from:'ATTEMPTED',to:'RESULT_READY',evidence_sha256:receipt.result_sha256,critic_proof_sha256:null,checkpoint_sha256:null,result_receipt:receipt});
      return {f,native,controls,authority,query,register,prepare,attempted,ready,transactionReadbacks};
    }
    async function subtest(name,callback){await t.test(name,async child=>{await callback(child);passed++;});}

    await subtest('actual LOGIN identity, own scope and project/device joins admit only the current binding',async()=>{
      const x=await fixture();let scope=await x.authority.READ_SCOPE();
      assert.ok(scope.bindings.some(b=>b.permit_id===x.f.permit.permit_id));
      for(const [column,value,original] of [['state','PAUSED','ACTIVE'],['client_id','foreign-client',x.f.clientId],
        ['admin_grant_epoch',2,1],['device_id',randomUUID(),x.f.permit.device_id]]) {
        // Identifiers are this fixed test-only allowlist; values stay bound.
        assert.ok(['state','client_id','admin_grant_epoch','device_id'].includes(column));
        await sql.unsafe(`update destruktion_meta.project_run_h205f22 set ${column}=$1 where project_id=$2::uuid`,[value,x.f.permit.project_id]);
        scope=await x.authority.READ_SCOPE();assert.equal(scope.bindings.some(b=>b.permit_id===x.f.permit.permit_id),false);
        await assert.rejects(x.register(),unknown);
        await sql.unsafe(`update destruktion_meta.project_run_h205f22 set ${column}=$1 where project_id=$2::uuid`,[original,x.f.permit.project_id]);
      }
      assert.equal((await x.register()).registered,true);
    });
    await subtest('REGISTER_PROVIDER passes exact canonical text/jsonb/SHA constraints and fresh short-lived device proof',async()=>{
      const x=await fixture();const ack=await x.register();
      const [stored]=await sql.unsafe(`select canonical_envelope,envelope_sha256,envelope from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=$1`,[x.f.permit.permit_id]);
      assert.equal(ack.envelope_sha256,sha(x.f.provider));assert.equal(stored.envelope_sha256,sha(x.f.provider));
      assert.equal(stored.canonical_envelope,canonical(x.f.provider));assert.deepEqual(stored.envelope,x.f.provider);
      assert.equal(x.transactionReadbacks.at(-1).synchronous_commit,'on');assert.equal(x.transactionReadbacks.at(-1).isolation,'serializable');
    });
    await subtest('READ_LEASE consumes a real W30 claim and reconstructs the Host prompt before reserve',async()=>{
      const x=await fixture();const {lease,scope}=await x.prepare();
      assert.equal(lease.target_id,x.f.binding.target_id);assert.match(lease.prompt_sha256,/^[a-f0-9]{64}$/);
      const response=await x.authority.READ_LEASE(x.query);assert.match(response.task_prompt,/Qualify a generated disposable Host SQL task/);
      const reserved=await x.authority.RESERVE_EXECUTION({scope});assert.equal(reserved.state,'RESERVED');
      const again=await x.authority.RESERVE_EXECUTION({scope});assert.equal(again.state,'READBACK_ONLY');assert.equal(again.automatic_retry_allowed,false);
    });
    await subtest('ATTEMPTED job registration and ledger CAS share one real synchronous serializable transaction',async()=>{
      const x=await fixture();const {scope,job}=await x.prepare();const reserved=await x.authority.RESERVE_EXECUTION({scope});
      const advanced=await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});
      assert.equal(advanced.state,'ATTEMPTED');
      const [stored]=await sql.unsafe(`select job_envelope_sha256,canonical_job_envelope from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1`,[scope.task_id]);
      assert.equal(stored.job_envelope_sha256,sha(job));assert.equal(stored.canonical_job_envelope,canonical(job));
      assert.equal((await x.authority.READ_EXECUTION({scope})).job_proof_sha256,sha(job));
      assert.deepEqual(x.transactionReadbacks.at(-1),{synchronous_commit:'on',isolation:'serializable'});
    });
    await subtest('actual PG CAS rejection rolls back the preceding job registration and reports UNKNOWN without retry',async()=>{
      const x=await fixture();const {scope}=await x.prepare();await x.authority.RESERVE_EXECUTION({scope});
      await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:{...scope,reservation_id:randomUUID()},transition:x.attempted()}),unknown);
      assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1',[scope.task_id]))[0].count,0);
      assert.equal((await x.authority.READ_EXECUTION({scope})).state,'RESERVED');
    });
    await subtest('RESULT_READY canonical receipt is committed with ledger result, preserving a legitimate new HEAD',async()=>{
      const x=await fixture();const {scope,receipt}=await x.prepare();const reserved=await x.authority.RESERVE_EXECUTION({scope});
      await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});
      receipt.git_after.head='a'.repeat(40);x.native.worktree.base_sha=receipt.git_after.head;
      const result=await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.ready()});assert.equal(result.state,'RESULT_READY');
      const [stored]=await sql.unsafe(`select result_receipt_sha256,canonical_result_receipt,result_receipt from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1`,[scope.task_id]);
      assert.equal(stored.result_receipt_sha256,sha(receipt));assert.equal(stored.canonical_result_receipt,canonical(receipt));assert.deepEqual(stored.result_receipt,receipt);
      assert.equal(result.result_sha256,receipt.result_sha256);assert.notEqual(result.result_sha256,stored.result_receipt_sha256);
      await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:{to:'CHECKPOINTED'}}),/checkpoint_verifier_unbound/);
    });
    await subtest('actual RESULT_READY CAS rejection rolls back the preceding protected receipt update',async()=>{
      const x=await fixture();const {scope}=await x.prepare();const reserved=await x.authority.RESERVE_EXECUTION({scope});
      await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});
      await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:{...reserved.scope,reservation_id:randomUUID()},transition:x.ready()}),unknown);
      const [stored]=await sql.unsafe('select result_receipt,result_receipt_sha256 from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1',[scope.task_id]);
      assert.equal(stored.result_receipt,null);assert.equal(stored.result_receipt_sha256,null);
      assert.equal((await x.authority.READ_EXECUTION({scope})).state,'ATTEMPTED');
    });
    await subtest('unknown tasks, revoked permits and changed native task goals cannot reserve or register jobs',async()=>{
      const x=await fixture();const {scope}=await x.prepare();
      await assert.rejects(x.authority.READ_LEASE({...x.query,task_id:randomUUID()}),/task_unavailable/);
      await sql.unsafe(`update destruktion_meta.devos_fleet_task_h205f22 set task_spec=jsonb_set(task_spec,'{native_coding,goal_sha256}',to_jsonb($1::text)) where task_id=$2`,['f'.repeat(64),scope.task_id]);
      await assert.rejects(x.authority.READ_LEASE(x.query),/task_binding_mismatch/);
      await assert.rejects(x.authority.RESERVE_EXECUTION({scope}),unknown);
      await sql.unsafe('update destruktion_meta.native_coding_operator_permit_h205f22 set revoked_at=clock_timestamp() where permit_id=$1',[x.f.permit.permit_id]);
      await assert.rejects(x.authority.READ_LEASE(x.query),/permit_unavailable/);await assert.rejects(x.register(),unknown);
      assert.equal((await x.authority.READ_SCOPE()).bindings.some(b=>b.permit_id===x.f.permit.permit_id),false);
      assert.equal((await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[scope.task_id]))[0].count,0);
    });
    await subtest('expired AMBIGUOUS W30 task records late protected evidence but cannot resume or reserve again',async()=>{
      const x=await fixture();const {scope}=await x.prepare();const reserved=await x.authority.RESERVE_EXECUTION({scope});
      await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});
      await sql.unsafe(`update destruktion_meta.devos_fleet_task_h205f22 set state='AMBIGUOUS',lease_expires_at=clock_timestamp()-interval '1 second' where task_id=$1`,[scope.task_id]);
      await sql.unsafe(`update destruktion_meta.devos_fleet_claim_h205f22 set state='EXPIRED',expires_at=clock_timestamp()-interval '1 second' where task_id=$1`,[scope.task_id]);
      await sql.unsafe(`update destruktion_meta.project_run_h205f22 set state='PAUSED' where project_id=$1`,[x.f.permit.project_id]);
      assert.equal((await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.ready()})).state,'RESULT_READY');
      await assert.rejects(x.authority.RESERVE_EXECUTION({scope}),unknown);
      assert.equal((await x.authority.READ_EXECUTION({scope})).automatic_retry_allowed,false);
    });
    assert.equal(passed,9,'a PASS receipt requires every subtest to finish successfully');
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding.host-authority.disposable-qa.v1',
      state:'PASS',postgres_version_num:identity.version,postgres_system_identifier:cluster,port,session_user:'state_owner',
      source_classification:'REAL_DISPOSABLE_PG_WITH_GENERATED_NATIVE_CALLBACK_FIXTURES',subtests:passed,
      installed_keeper_used:false,model_calls:0,installed_autonomy_proven:false,authority_effect:false},null,2));
    t.diagnostic('disposable_receipt='+path.join(directory,'receipt.json'));
  } finally {
    for(const authority of authorities)authority.close();
    if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    if(started) {
      assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null,'the new disposable postmaster must be stopped');
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({schema:'metaengine.native-coding.host-authority.disposable-cleanup.v1',
        state:'STOPPED',data_directory:data,postgres_system_identifier:cluster,postmaster_pid_file_absent:true,
        installed_keeper_used:false,authority_effect:false},null,2));
    }
  }
});
