import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from './native-coding-preparation-transaction.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson as canonical}
  from './native-coding-task-context.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);

// Real SQL / casts / locks / transactions in a NEW disposable PG17 cluster.
// Native process, signer, sandbox and publication-root evidence are explicit
// generated fixtures. This test claims no installed authorization or work.
test('mandatory initial anchor and retained native task identity on actual PG17; all custody GENERATED',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-anchor-task-fence-'));
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
  let started=false,sql,cluster,passed=0,qualifiedData=false;
  try {
    await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
    started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    const transactions=createNativePreparationTransactions();
    sql=postgres({debug:transactions.debug,onclose:transactions.onclose,host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,onnotice:()=>{},
      connect_timeout:5,idle_timeout:10,connection:{application_name:'METAENGINE_HOST_AUTHORITY_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
    // Qualify the actual production reserved-connection facade, including its
    // dead-backend quarantine. Raw pool queries below are setup/controller only.
    const monitored=bindNativeCodingTransactionPool(sql,transactions);
    const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,
      current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
      (select system_identifier::text from pg_control_system()) as system_identifier`);
    assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');
    assert.ok(identity.version>=170000&&identity.version<180000);
    assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());
    cluster=identity.system_identifier;qualifiedData=true;
    const [pgBirth]=await sql.unsafe(`select to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
    const pgPid=Number((await fs.readFile(path.join(data,'postmaster.pid'),'utf8')).split('\n')[0]);
    const pgNative={pid:pgPid,created_at:new Date(pgBirth.started_at).toISOString(),process_incarnation_id:`pid:${pgPid}:created_100ns:${BigInt(Date.parse(pgBirth.started_at))*10000n+116444736000000000n}`};
    const hostIdentity={hostInstanceId:randomUUID(),hostPid:process.pid,postgresIdentity:{system_identifier:cluster,pid:pgPid,started_at:pgBirth.started_at}};
    const hostNative={pid:process.pid,created_at:new Date().toISOString(),process_incarnation_id:`pid:${process.pid}:created_100ns:134000000000000002`};
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
    const runningStart=bootstrap.indexOf('create or replace function public.devos_fleet_mark_running_v1(');
    await sql.unsafe(bootstrap.slice(runningStart,bootstrap.indexOf('end $$;',runningStart)+7));
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

    const migration=await fs.readFile(new URL('./native-coding-callback-publication-v1.sql',import.meta.url),'utf8');
    await sql.begin(tx=>tx.unsafe(migration));
    await sql.unsafe('create table public.qa_publication_effects(id uuid primary key,value text not null)');

    // Deliberately generated signed fixtures qualify SQL invariants only. They
    // do NOT claim actual Owner/signing/native process custody or installation.
    const fence=await fs.readFile(new URL('./native-coding-initial-anchor-task-fence-v1.sql',import.meta.url),'utf8');
    async function fixture(role='IMPLEMENTER'){
      const f=admissionFixture(),p=f.permit;p.role=role;p.postgres.system_identifier=cluster;
      f.jobPayload.role=role;f.jobPayload.postgres=structuredClone(p.postgres);
      const provider=f.envelope({...f.payload(),role,proven_at:new Date().toISOString()});
      await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256)
        values($1,$2,$3,$4,$5)`,[p.device_id,f.clientId,f.identity.profile,sql.json(f.jwk),f.identity.key_fingerprint_sha256]);
      await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22(permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
        values($1,$2,$3,$4,1,$5,$6,1,$7,$8)`,[p.permit_id,p.workspace_id,f.clientId,p.device_id,p.provider_id,p.agent_id,sql.json(p),p.record_sha256]);
      await sql.unsafe('insert into destruktion_meta.native_coding_provider_registration_h205f22 values($1,$2,$3,$4,clock_timestamp())',[p.permit_id,sql.json(provider),canonical(provider),sha(provider)]);
      await sql.unsafe('insert into public.qa_native_environment values($1,true)',[p.workspace_id]);
      await sql.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,state)values($1,$2,$3)',[p.workspace_id,f.clientId,sql.json({schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',transport_identity:{profile:f.identity.profile,device_id:p.device_id,key_fingerprint_sha256:f.identity.key_fingerprint_sha256},supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'WAITING'}}})]);
      const seed=async(taskId=f.binding.task_id,parent=null)=>{
        const spec={objective:'Generated SQL anchor fence',native_coding:{permit_id:p.permit_id,goal_id:p.goal_id,goal_sha256:p.goal_sha256,project_id:p.project_id},...(parent?{native_continuation:{previous_task_id:parent}}:{})};
        await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key)
          values($1::uuid,$2,'anchor-fence',$3,$4,$5,$6,$1::text)`,[taskId,p.workspace_id,role,p.worktree.base_sha,sql.json(spec),sha(spec)]);
        return taskId;
      };await seed();
      await sql.unsafe(`insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal)
        values($1,$2,$3,$4,$5,$6,1,'Generated anchor SQL')`,[p.project_id,p.workspace_id,randomUUID(),f.binding.task_id,p.device_id,f.clientId]);
      await sql.unsafe('insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,depth)values($1,$2,0,$1,0)',[f.binding.task_id,p.project_id]);
      const lease=async()=>{const [r]=await sql.unsafe('select public.devos_fleet_lease_v1($1,$2,$3,$4,$5,1,900) as value',[p.workspace_id,p.agent_id,role,f.binding.tab_id,f.binding.target_id]);assert.equal(r.value.leased,true);return r.value;};
      await lease();
      const scope={workspace_id:p.workspace_id,task_id:f.binding.task_id,lease_generation:1,agent_id:p.agent_id,target_id:f.binding.target_id,agent_generation_epoch:1,host_incarnation:provider.payload.host_process.process_incarnation_id,scope_sha256:'a'.repeat(64)};
      const reserve=async(s=scope)=>monitored.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');return(await tx.unsafe('select destruktion_meta.native_coding_reserve_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',[s.workspace_id,s.task_id,s.lease_generation,s.agent_id,s.target_id,s.agent_generation_epoch,randomUUID(),s.host_incarnation,s.scope_sha256]))[0].value;});
      let reserved;
      const take=async()=>{reserved=await reserve();return reserved;};
      const signedJob=f.envelope({...f.jobPayload,host_process:provider.payload.host_process}),job=()=>signedJob;
      const insertJob=async(tx=sql,envelope=job())=>tx.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22(task_id,lease_generation,permit_id,run_id,job_envelope,canonical_job_envelope,job_envelope_sha256)
       values($1,1,$2,$3,$4::text::jsonb,$4,$5)`,[scope.task_id,p.permit_id,envelope.payload.run_id,canonical(envelope),sha(envelope)]);
      const advance=async(tx=sql)=>tx.unsafe("select destruktion_meta.native_coding_advance_v1($1,1,$2,$3,$4,'RESERVED','ATTEMPTED',$5) as value",[scope.task_id,reserved.execution.reservation_id,scope.scope_sha256,scope.host_incarnation,sha(job())]);
      const anchor=()=>({schema:'metaengine.native-coding.callback-publication.v1',root:{run_id:f.jobPayload.run_id,scope:{...scope,reservation_id:reserved.execution.reservation_id},permit_id:p.permit_id,permit_sha256:sha(p),device_id:p.device_id,client_id:f.clientId,admin_grant_epoch:1,key_sha256:f.identity.key_fingerprint_sha256,owner_epoch:p.owner_epoch,owner_sha256:'b'.repeat(64),host_instance_id:hostIdentity.hostInstanceId,host_pid:hostIdentity.hostPid,host_birth:hostNative.process_incarnation_id,main_birth:scope.host_incarnation,pg_identity:{system_identifier:cluster,started_at:pgBirth.started_at,pid:pgPid,process_incarnation_id:pgNative.process_incarnation_id,data_directory_identity_sha256:'c'.repeat(64)},prefix_identity_sha256:'d'.repeat(64),attempt_sha256:'e'.repeat(64),header_sha256:'f'.repeat(64),bound_sha256:'a'.repeat(64),lease_binding_sha256:'b'.repeat(64),reserve_request_id:randomUUID(),prompt_sha256:f.jobPayload.prompt_sha256,base_sha:p.worktree.base_sha,role},cursor:{revision:0,record_count:2,intent_count:0,head_sha256:'c'.repeat(64),dispatch_fenced:false},job_sha256:null});
      const publish=async(value=anchor())=>sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');return tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1,1,$2,null,$3) as value',[scope.task_id,reserved.execution.reservation_id,sql.json(value)]);});
      const running=()=>sql.unsafe("select public.devos_fleet_mark_running_v1($1,$2,1,$3,$4,1,'{}') as value",[scope.task_id,p.agent_id,f.binding.tab_id,f.binding.target_id]);
      return{f,p,scope,seed,lease,reserve,take,job,insertJob,advance,anchor,publish,running};
    }
    const subtest=async(name,fn)=>t.test(name,async()=>{await fn();passed++;});
    const rows=async(x)=>(await sql.unsafe('select * from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[x.scope.task_id]));
    const jobs=async(x)=>(await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1',[x.scope.task_id]))[0].n;
    const legacy=[];
    for(const role of ['IMPLEMENTER','CRITIC'])for(const state of ['RESERVED','ATTEMPTED','RESULT_READY','FAILED','AMBIGUOUS','CHECKPOINTED']){
      const x=await fixture(role);await x.take();if(state!=='RESERVED')await sql.unsafe('update destruktion_meta.native_coding_execution_h205f22 set state=$2 where task_id=$1',[x.scope.task_id,state]);legacy.push({x,role,state});
    }
    await subtest('duplicate legacy generations reject migration atomically without deleting history',async()=>{
      const x=legacy[0].x;await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22(workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256)
         select workspace_id,task_id,2,$2,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256 from destruktion_meta.native_coding_execution_h205f22 where task_id=$1`,[x.scope.task_id,randomUUID()]);
        await tx.unsafe(fence);
      }),/duplicate_history_hold/);assert.equal((await rows(x)).length,1);
    });
    await subtest('unreviewed predecessor body refuses migration before constraints are installed',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe(`create or replace function destruktion_meta.native_coding_callback_publication_guard_v1() returns trigger language plpgsql as $$begin return new;end$$`);await tx.unsafe(fence);
      }),/predecessor_requires_review/);
    });
    await sql.begin(tx=>tx.unsafe(fence));await sql.begin(tx=>tx.unsafe(fence));
    await subtest('replay rejects changed trigger event mask without silently restoring it',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('drop trigger aa_native_execution_task_fence_v1 on destruktion_meta.native_coding_execution_h205f22');
        await tx.unsafe('create trigger aa_native_execution_task_fence_v1 before update on destruktion_meta.native_coding_execution_h205f22 for each row execute function destruktion_meta.native_execution_task_fence_v1()');
        await tx.unsafe(fence);
      }),/existing_requires_review/);
    });
    await subtest('replay rejects widened function privileges',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('grant execute on function destruktion_meta.native_execution_task_fence_v1() to public');
        await tx.unsafe(fence);
      }),/existing_requires_review/);
    });
    await subtest('replay rejects changed trigger WHEN filter',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('drop trigger aa_native_claim_task_history_v1 on destruktion_meta.devos_fleet_claim_h205f22');
        await tx.unsafe('create trigger aa_native_claim_task_history_v1 before insert on destruktion_meta.devos_fleet_claim_h205f22 for each row when (false) execute function destruktion_meta.native_claim_task_history_v1()');
        await tx.unsafe(fence);
      }),/existing_requires_review/);
    });
    for(const role of ['IMPLEMENTER','CRITIC'])for(const field of ['workspace_id','project_id','provider_id','agent_id','target_id','agent_generation_epoch'])await subtest(`${role} job ${field} drift rejects registration before ATTEMPTED`,async()=>{
      const x=await fixture(role);await x.take();await x.publish();
      const payload={...x.job().payload,[field]:field==='agent_generation_epoch'?2:field.endsWith('_id')?randomUUID():'changed'};
      await assert.rejects(x.insertJob(sql,x.f.envelope(payload)),/anchor_binding_changed/);
      assert.equal(await jobs(x),0);assert.equal((await rows(x))[0].state,'RESERVED');
    });
    for(const {x,role,state} of legacy)await subtest(`${role} legacy ${state} stays readable and fences new generation regardless of terminal label`,async()=>{
      assert.equal((await rows(x))[0].state,state);assert.equal((await x.reserve()).inserted,false);
      await assert.rejects(sql.unsafe('delete from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[x.scope.task_id]),/identity_retained/);
      await assert.rejects(sql.unsafe('update destruktion_meta.native_coding_execution_h205f22 set lease_generation=2 where task_id=$1',[x.scope.task_id]),/identity_immutable/);
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe(`update destruktion_meta.devos_fleet_task_h205f22 set lease_generation=2 where task_id=$1`,[x.scope.task_id]);
        await tx.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22(workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256)
         select workspace_id,task_id,2,$2,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256 from destruktion_meta.native_coding_execution_h205f22 where task_id=$1`,[x.scope.task_id,randomUUID()]);
      }),/history_hold/);
      await assert.rejects(sql.unsafe(`insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at)
       select task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,2,expires_at from destruktion_meta.devos_fleet_claim_h205f22 where task_id=$1`,[x.scope.task_id]),/history_hold/);
      assert.equal((await rows(x)).length,1);
    });
    for(const role of ['IMPLEMENTER','CRITIC']){
      await subtest(`${role} absent anchor forbids job and ATTEMPTED without partial registration`,async()=>{
        const x=await fixture(role);await x.take();await assert.rejects(x.insertJob(),/inert_anchor_required/);await assert.rejects(x.advance(),/inert_anchor_required/);
        assert.equal(await jobs(x),0);assert.equal((await rows(x))[0].state,'RESERVED');
      });
      await subtest(`${role} inert original anchor permits signed association and W30 RUNNING`,async()=>{
        const x=await fixture(role);await x.take();await x.publish();await monitored.begin('isolation level serializable',async tx=>{await x.insertJob(tx);await x.advance(tx);});
        assert.equal((await rows(x))[0].callback_publication.job_sha256,sha(x.job()));assert.equal((await x.running())[0].value.state,'RUNNING');
      });
      for(const kind of ['count','fenced','run'])await subtest(`${role} changed ${kind} anchor cannot authorize signed job`,async()=>{
        const x=await fixture(role);await x.take();const a=x.anchor();
        if(kind==='count'){a.cursor.record_count=3;a.cursor.intent_count=1;}else if(kind==='fenced')a.cursor.dispatch_fenced=true;else a.root.run_id=randomUUID();
        if(kind==='run'){await x.publish(a);await assert.rejects(x.insertJob(),/anchor_binding_changed/);}else await assert.rejects(x.publish(a),/inert_anchor_required/);
        assert.equal(await jobs(x),0);
      });
    }
    await subtest('legacy unanchored ATTEMPTED cannot newly enter RUNNING',async()=>{
      const x=legacy.find(x=>x.state==='ATTEMPTED').x;await assert.rejects(x.running(),/running_anchor_required/);
    });
    await subtest('concurrent same task reserve keeps one durable identity and no automatic retry',async()=>{
      const x=await fixture();const results=await Promise.allSettled([x.reserve(),x.reserve()]);
      assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.inserted).length,1);
      for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'40001');else if(!r.value.inserted)assert.equal(r.value.execution.state,'RESERVED');
      assert.equal((await rows(x)).length,1);
    });
    await subtest('new task continuation remains admissible after retained CHECKPOINTED predecessor',async()=>{
      const x=legacy.find(x=>x.state==='CHECKPOINTED'&&x.role==='IMPLEMENTER').x;
      await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED' where task_id=$1",[x.scope.task_id]);
      await sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='FAILED' where task_id=$1",[x.scope.task_id]);
      const next=await x.seed(randomUUID(),x.scope.task_id);await x.lease();
      const r=await x.reserve({...x.scope,task_id:next});assert.equal(r.inserted,true);assert.notEqual(r.execution.task_id,x.scope.task_id);assert.equal((await rows(x))[0].state,'CHECKPOINTED');
    });
    assert.equal(passed,42);
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({state:'PASS',subtests:passed,classification:'GENERATED_SQL_CUSTODY_ONLY',postgres_system_identifier:cluster,authority_effect:false}));
  }finally{
    if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
    if(qualifiedData){assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-anchor-task-fence-'));assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');await fs.rm(data,{recursive:true});
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:cluster,postmaster_pid_file_absent:true,generated_data_removed:true}));}
  }
});
