import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from './native-coding-preparation-transaction.mjs';
import {markNativePhysicalSettlementUnconfirmed,nativePhysicalSettlementUnconfirmed,runNativePhysicalSettlementScope} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {readNativeCallbackProtectedPrefix} from './native-coding-callback-prefix.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {createNativeRunCallbackJournal,claimNativeRunCallbackJournal} from '../../apps/metaengine-browser/src/native-coding-run-callback-journal.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {joinedSettlementFixture} from '../../apps/metaengine-browser/test/fixtures/codex-cli-joined-settlement-fixture.mjs';
import {codexCliLocalOutputDrain} from '../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority,nativeCodingCallbackPublicationFor,nativeCodingCallbackPublicationCompositionFor} from './native-coding-host-authority.mjs';
import {buildNativeCodingExecutionScope,nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson as canonical}
  from './native-coding-task-context.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const unknown=e=>e.effect_outcome==='UNKNOWN'&&e.automatic_retry_allowed===false;

// Real SQL / casts / locks / transactions in a NEW disposable PG17 cluster.
// Native processes, sandbox, image, and journal callbacks below are explicit
// generated fixtures. This test claims no installed authorization or work.
test('callback publication on actual disposable PG17; native/Owner evidence GENERATED',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-callback-publication-'));
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
  const authorities=[];
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
    let agentToolsInstalled=false;
    async function fixture({ownerReader=true,identityOverride=null}={}) {
      const f=admissionFixture();if(agentToolsInstalled)f.permit.worktree.root_identity_sha256=sha(randomUUID());f.permit.postgres.system_identifier=cluster;f.permit.postgres.postmaster=structuredClone(pgNative);f.permit.postgres.data_directory_identity_sha256=await readDirectoryIdentity(data);f.provider=f.envelope({...f.payload(),proven_at:new Date().toISOString()});f.jobPayload.proven_at=new Date().toISOString();
      const native={artifact:structuredClone(f.permit.artifact),postgres:structuredClone(f.permit.postgres),
        worktree:structuredClone(f.permit.worktree),host_process:f.provider.payload.host_process,
        user_sid:f.permit.user_sid,sandbox:f.provider.payload.sandbox};
      const controls={worker:null,receipt:null,ownerChanged:false,hostChanged:false,afterCommit:null,prefixRead:null},transactionReadbacks=[],transactionEntries=[];
      // /workspace's overlay ancestor exposes a negative signed inode here; the
      // production whole-ancestor guard correctly refuses it. Generated journal
      // fixtures use the existing canonical /tmp filesystem, not a relaxed guard.
      const runDirectory=await fs.mkdtemp(path.join(await fs.realpath(process.env.METAENGINE_CALLBACK_JOURNAL_TEST_BASE||os.tmpdir()),'native-callback-prefix-'));
      const abort=new AbortController(),request={instanceId:hostIdentity.hostInstanceId,hostPid:hostIdentity.hostPid,
       requestId:randomUUID(),action:'RESERVE_EXECUTION',deadlineAt:Date.now()+120000,signal:abort.signal};
      const readPrefix=async ({expected,intent,publicationCursor,request})=>{
       if(controls.prefixRead)await controls.prefixRead();
       return readNativeCallbackProtectedPrefix({directory:runDirectory,expected,intent,publicationCursor,request,
        readProtectedJson:(file,options)=>readNativeCodingProtectedJson(file,{...options,verifyStorage:async()=>({owner_dacl_verified:true})})});
      };
      // Query instrumentation delegates EVERY statement to the actual PG
      // connection; it is not a SQL/transaction double.
      const privateSql={unsafe:(query,args)=>monitored.unsafe(query,args),begin:async(mode,callback)=>{const result=await monitored.begin(mode,async tx=>{
        transactionEntries.push(tx);const result=await callback(tx);
        if(controls.beforeCommit)await controls.beforeCommit(tx);
        const [settings]=await tx.unsafe(`select current_setting('synchronous_commit') as synchronous_commit,
          current_setting('transaction_isolation') as isolation`);
        transactionReadbacks.push(settings);return result;
      });if(controls.afterCommit)await controls.afterCommit();return result;}};
      const authority=await createNativeCodingHostAuthority({sql:privateSql,
        readNativeScope:async(_permit,requireLive,tx,request)=>{if(controls.nativeRead)await controls.nativeRead({requireLive,tx,request});return structuredClone(native);},readNativeWorker:async(_pid,options)=>{if(controls.workerRead)await controls.workerRead(options);return structuredClone(controls.worker);},
        readProtectedReceipt:async options=>{if(controls.receiptRead)await controls.receiptRead(options);return structuredClone(controls.receipt);},callbackPublicationIdentity:identityOverride??hostIdentity,
        readCallbackPrefix:readPrefix,readPublicationHost:async()=>({...hostNative,...(controls.hostChanged?{process_incarnation_id:`pid:${process.pid}:created_100ns:134000000000000003`}:{})}),
        readOwnerControl:ownerReader?async({tx,request})=>{if(controls.ownerRead)await controls.ownerRead({tx,request});return {owner:{schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',authority_effect:false,
         owner_id:f.clientId,device_id:f.permit.device_id,project_id:f.permit.project_id,...native.host_process,epoch:f.permit.owner_epoch,
         ...(controls.ownerMarker?{fixture_classification:'STAGING'}:{}),generation:controls.ownerChanged?2:1,source_sha:f.permit.artifact.source_sha,device_key_fingerprint_sha256:f.identity.key_fingerprint_sha256,
         observed_at:controls.sealedObservedAt??new Date().toISOString()},observed_at:controls.readObservedAt??new Date().toISOString(),control:{...(await tx.unsafe('select public.devos_environment_state_v1($1::uuid) as value',[f.workspaceId]))[0].value,revision:controls.controlRevision??0}};}:null});
      authorities.push(authority);
      await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256)
        values($1::uuid,$2::text,$3::text,$4::jsonb,$5::text)`,[f.permit.device_id,f.clientId,f.identity.profile,sql.json(f.jwk),f.identity.key_fingerprint_sha256]);
      if(agentToolsInstalled){const pairing=randomUUID();await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values($1)',[pairing]);
        await sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set enrollment_pairing_token_hash=$1 where device_id=$2',[pairing,f.permit.device_id]);}
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
      let writer;
      async function reserve(){const prepared=await prepare();const reserved=await authority.RESERVE_EXECUTION({scope:prepared.scope},request);return reserved;}
      async function journal(){
       const binding={task_id:scope.task_id,agent_id:scope.agent_id,base_sha:f.permit.worktree.base_sha,lease_generation:1,agent_generation_epoch:1,role:f.permit.role};
       const runId=f.jobPayload.run_id,runBinding={run_id:runId,workspace_id:f.workspaceId,project_id:f.permit.project_id,
        task_id:scope.task_id,lease_generation:1,agent_id:scope.agent_id,agent_generation_epoch:1,provider_id:f.permit.provider_id,role:f.permit.role};
       await fs.writeFile(path.join(runDirectory,'attempt.json'),JSON.stringify({...receipt,...binding,state:'RESERVED'}),{flag:'wx',mode:0o600});
       const handle=await createNativeRunCallbackJournal({directory:runDirectory,runId,binding});
       writer=await claimNativeRunCallbackJournal(handle,{binding:runBinding,instanceId:hostIdentity.hostInstanceId,hostPid:hostIdentity.hostPid});return writer;
      }
      return {f,native,controls,authority,query,register,prepare,attempted,ready,transactionReadbacks,transactionEntries,request,abort,runDirectory,reserve,journal,
       publish:value=>nativeCodingCallbackPublicationFor(authority).publish(value,request),read:value=>nativeCodingCallbackPublicationFor(authority).read(value,request),
       append:event=>writer.append(event??{kind:'INTENT',request_id:randomUUID(),request_sha256:'a'.repeat(64),operation:'CHECK',job_binding_sha256:'b'.repeat(64)})};
    }
    async function subtest(name,callback){await t.test(name,async child=>{await callback(child);passed++;});}

    await subtest('actual original reserve composition commits and independently reads the inert initial anchor before returning',async()=>{
      const x=await fixture(),p=await x.prepare();await x.journal();
      const composition=nativeCodingCallbackPublicationCompositionFor(x.authority);
      assert.equal(nativeCodingCallbackPublicationCompositionFor(x.authority),composition);
      assert.throws(()=>nativeCodingCallbackPublicationCompositionFor({...x.authority}),/unbound/);
      const r=await composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request);
      assert.equal(r.state,'RESERVED');assert.equal(r.initial_callback_publication.run_id,x.f.jobPayload.run_id);
      assert.equal(r.initial_callback_publication.request_id,x.request.requestId);
      assert.equal(r.initial_callback_publication.execution_ready,false);
      const [stored]=await sql.unsafe('select callback_publication as value from destruktion_meta.native_coding_execution_h205f22 where task_id=$1 and lease_generation=$2',[r.scope.task_id,r.scope.lease_generation]);
      assert.equal(sha(stored.value.root),r.initial_callback_publication.root_sha256);assert.equal(stored.value.cursor.record_count,2);
      const prior=await composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request);
      assert.equal(prior.state,'READBACK_ONLY');assert.equal(Object.hasOwn(prior,'initial_callback_publication'),false);
    });
    await subtest('original reserve composition without inert prefix leaves durable RESERVED but never returns a success or remints custody',async()=>{
      const x=await fixture(),p=await x.prepare(),composition=nativeCodingCallbackPublicationCompositionFor(x.authority);
      await assert.rejects(composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request));
      const r=await composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request);
      assert.equal(r.state,'READBACK_ONLY');assert.equal(r.execution.state,'RESERVED');assert.equal(Object.hasOwn(r,'initial_callback_publication'),false);
    });
    await subtest('initial publication cannot accept an already active intent prefix',async()=>{
      const x=await fixture(),p=await x.prepare();await x.journal();await x.append();
      const composition=nativeCodingCallbackPublicationCompositionFor(x.authority);
      await assert.rejects(composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request));
      const [row]=await sql.unsafe('select state,callback_publication from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[p.scope.task_id]);
      assert.equal(row.state,'RESERVED');assert.equal(row.callback_publication,null);
    });

    await subtest('old immutable Owner seal accepts a separate fresh current observation',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();
      x.controls.sealedObservedAt=new Date(Date.now()-86400000).toISOString();
      assert.equal((await x.publish(r)).state,'ANCHORED_SOURCE_CANDIDATE');
    });
    for(const observedAt of ['', 'invalid',new Date(Date.now()-60000).toISOString(),new Date(Date.now()+60000).toISOString()])
     await subtest('fresh-looking seal cannot replace invalid current observation: '+observedAt,async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.readObservedAt=observedAt;
      await assert.rejects(x.publish(r),unknown);
    });
    await subtest('control generation change during prefix observation is rejected even with both admission flags true',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();
      x.controls.prefixRead=()=>{x.controls.controlRevision=1;};
      await assert.rejects(x.publish(r),unknown);
    });
    for(const reason of ['cancelled','deadline'])await subtest('already '+reason+' reservation opens no new transaction or native read',async()=>{
      const x=await fixture(),prepared=await x.prepare(),before=x.transactionReadbacks.length;let reads=0;
      x.controls.nativeRead=()=>{reads++;};
      if(reason==='cancelled')x.abort.abort();else x.request.deadlineAt=Date.now()-1;
      await assert.rejects(x.authority.RESERVE_EXECUTION({scope:prepared.scope},x.request),reason==='cancelled'?/request_cancelled/:/deadline_exceeded/);
      assert.equal(reads,0);assert.equal(x.transactionReadbacks.length,before);
      const rows=await sql.unsafe('select task_id from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[prepared.scope.task_id]);
      assert.equal(rows.length,0);
    });
    await subtest('original reservation passes its actual request to native scope observation',async()=>{
      const x=await fixture(),prepared=await x.prepare(),reads=[];
      x.controls.nativeRead=observation=>{reads.push(observation);};
      const r=await x.authority.RESERVE_EXECUTION({scope:prepared.scope},x.request);
      assert.equal(r.state,'RESERVED');assert.equal(reads.length,1);
      assert.equal(reads[0].request,x.request);assert.equal(reads[0].requireLive,true);
    });
    await subtest('cancellation during reservation observation creates no execution row',async()=>{
      const x=await fixture(),prepared=await x.prepare();let observed;
      x.controls.nativeRead=observation=>{observed=observation;x.abort.abort();};
      await assert.rejects(x.authority.RESERVE_EXECUTION({scope:prepared.scope},x.request),unknown);
      assert.equal(observed.request,x.request);
      const rows=await sql.unsafe('select task_id from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[prepared.scope.task_id]);
      assert.equal(rows.length,0);
    });
    async function advanceFixture(target){
      const x=await fixture(),reserved=await x.reserve();
      if(target==='RESULT_READY')await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});
      const abort=new AbortController(),request={...x.request,action:'ADVANCE_EXECUTION',requestId:randomUUID(),signal:abort.signal};
      const input={scope:reserved.scope,transition:target==='ATTEMPTED'?x.attempted():x.ready()};
      const stored=async()=>{const [row]=await sql.unsafe(`select e.state,j.run_id,j.result_receipt,j.result_receipt_sha256,j.result_registered_at
       from destruktion_meta.native_coding_execution_h205f22 e left join destruktion_meta.native_coding_job_registration_h205f22 j using(task_id,lease_generation)
       where e.task_id=$1`,[reserved.scope.task_id]);return row;};
      return{x,reserved,abort,request,input,stored};
    }
    await subtest('advance cancellation fixture positively commits a valid RESULT_READY when its original request stays open',async()=>{
      const q=await advanceFixture('RESULT_READY');await q.x.authority.ADVANCE_EXECUTION(q.input,q.request);
      assert.equal((await q.stored()).state,'RESULT_READY');
    });
    for(const target of ['ATTEMPTED','RESULT_READY'])for(const reason of ['cancelled','deadline'])
     await subtest('advance '+target+' '+reason+' during native observation rolls back job and execution writes',async()=>{
      const q=await advanceFixture(target),before=await q.stored();let observed,outcome;
      q.x.controls.nativeRead=value=>{observed=value.request;if(reason==='cancelled')q.abort.abort();else q.request.deadlineAt=Date.now()-1;};
      try{await q.x.authority.ADVANCE_EXECUTION(q.input,q.request);}catch(error){outcome=error;}
      assert.deepEqual(await q.stored(),before,'cancellation must not commit a new execution/registration state');
      assert.equal(observed,q.request);assert.ok(unknown(outcome));
    });
    for(const [target,hook] of [['ATTEMPTED','workerRead'],['RESULT_READY','receiptRead']])
     await subtest('advance '+target+' cancellation joins its held protected read before rollback',async()=>{
      const q=await advanceFixture(target),before=await q.stored();let enter,release,observed;
      const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);
      q.x.controls[hook]=async value=>{observed=value.request;enter();await held;};
      let done=false,outcome;const operation=q.x.authority.ADVANCE_EXECUTION(q.input,q.request).catch(error=>{outcome=error;}).finally(()=>done=true);
      await entered;q.abort.abort();await new Promise(r=>setImmediate(r));assert.equal(done,false);release();await operation;
      assert.deepEqual(await q.stored(),before);assert.equal(observed,q.request);assert.ok(unknown(outcome));
    });
    for(const target of ['ATTEMPTED','RESULT_READY'])await subtest('already cancelled '+target+' advance starts no new transaction',async()=>{
      const q=await advanceFixture(target),before=q.x.transactionReadbacks.length;q.abort.abort();
      await assert.rejects(q.x.authority.ADVANCE_EXECUTION(q.input,q.request),/request_cancelled/);
      assert.equal(q.x.transactionReadbacks.length,before);
    });
    await subtest('all publication native reads retain the original request and their actual PG transaction',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const reads=[];
      x.controls.nativeRead=observation=>{reads.push(observation);};
      await x.publish(r);assert.equal(reads.length,6);
      for(const observation of reads){assert.equal(observation.request,x.request);assert.equal(observation.requireLive,true);}
      assert.equal(new Set(reads.slice(0,3).map(row=>row.tx)).size,1);
      assert.equal(new Set(reads.slice(3).map(row=>row.tx)).size,1);
      assert.notEqual(reads[0].tx,reads[3].tx,'committed readback owns a separate transaction, not an extra nested read');
    });
    await subtest('cancellation in native publication observation rolls back before any anchor write',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();let reads=0;
      x.controls.nativeRead=({request})=>{assert.equal(request,x.request);reads++;x.abort.abort();};
      await assert.rejects(x.publish(r),unknown);assert.equal(reads,1);
      const [row]=await sql.unsafe('select state,callback_publication from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]);
      assert.equal(row.state,'RESERVED');assert.equal(row.callback_publication,null);
    });
    await subtest('genuine fresh reservation, independently protected prefix, synchronous COMMIT and exact postcommit readback',async()=>{
      const x=await fixture(),reserved=await x.reserve();await x.journal();const answer=await x.publish(reserved);
      assert.equal(answer.state,'ANCHORED_SOURCE_CANDIDATE');assert.equal(answer.send_capability,false);assert.equal(answer.phase1b_settlement,'UNBOUND');
      assert.equal(answer.publication.cursor.record_count,2);assert.equal(answer.publication.root.scope.reservation_id,reserved.scope.reservation_id);
      const wire=await x.authority.READ_EXECUTION({scope:reserved.scope});assert.equal(Object.hasOwn(wire,'callback_publication'),false);
      const again=await x.authority.RESERVE_EXECUTION({scope:reserved.scope},x.request);assert.equal(again.state,'READBACK_ONLY');
      await assert.rejects(x.publish(again),/fresh_reservation_required/);await assert.rejects(x.publish(structuredClone(reserved)),/fresh_reservation_required/);
      await x.append();const next=await x.publish(reserved);assert.equal(next.publication.cursor.revision,1);assert.equal(next.publication.cursor.intent_count,1);
      assert.deepEqual((await x.read(reserved)).publication,next.publication);
    });
    await subtest('aborted late original reserve and lost COMMIT do not remint fresh reservation custody',async()=>{
      const x=await fixture();await x.prepare();x.controls.afterCommit=async()=>x.abort.abort();
      const scope=buildNativeCodingExecutionScope(x.f.permit,(await x.authority.READ_LEASE(x.query)).value,x.native.host_process);
      const reserved=await x.authority.RESERVE_EXECUTION({scope},x.request);assert.equal(reserved.state,'RESERVED');
      await assert.rejects(x.publish(reserved),/fresh_reservation_required/);
      const y=await fixture();await y.prepare();y.controls.afterCommit=async()=>{throw Error('generated_lost_commit_ack');};
      const s=buildNativeCodingExecutionScope(y.f.permit,(await y.authority.READ_LEASE(y.query)).value,y.native.host_process);
      await assert.rejects(y.authority.RESERVE_EXECUTION({scope:s},y.request),unknown);y.controls.afterCommit=null;
      const retry=await y.authority.RESERVE_EXECUTION({scope:s},y.request);assert.equal(retry.state,'READBACK_ONLY');await assert.rejects(y.publish(retry),/fresh_reservation_required/);
    });
    await subtest('existing ATTEMPTED signed registration binds exact anchored run without changing v1 projection',async()=>{
      const x=await fixture(),reserved=await x.reserve();await x.journal();await x.publish(reserved);
      const advanced=await x.authority.ADVANCE_EXECUTION({scope:reserved.scope,transition:x.attempted()});assert.equal(advanced.state,'ATTEMPTED');assert.equal(Object.hasOwn(advanced,'callback_publication'),false);
      const [stored]=await sql.unsafe('select callback_publication as p,job_proof_sha256 as sha from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[reserved.scope.task_id]);
      assert.equal(stored.p.job_sha256,stored.sha);assert.equal(stored.p.cursor.revision,0);
      assert.equal((await x.read(reserved)).publication.job_sha256,stored.sha);await x.append();
      const after=await x.publish(reserved);assert.equal(after.publication.job_sha256,stored.sha);assert.equal(after.publication.cursor.revision,1);
    });
    await subtest('same-count different head, immutable root, backward cursor, removal and direct API write are refused',async()=>{
      const x=await fixture(),reserved=await x.reserve();await x.journal();const original=(await x.publish(reserved)).publication;
      for(const mutate of [v=>v.cursor.head_sha256='f'.repeat(64),v=>v.root.run_id=randomUUID(),v=>v.cursor.record_count=1,v=>v.root.scope.reservation_id=randomUUID()]){
       const bad=structuredClone(original);mutate(bad);
       await assert.rejects(sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=on');await tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1,$2,$3,$4,$5)',[reserved.scope.task_id,1,reserved.scope.reservation_id,sql.json(original),sql.json(bad)]);}));
      }
      await assert.rejects(sql.unsafe('update destruktion_meta.native_coding_execution_h205f22 set callback_publication=null where task_id=$1',[reserved.scope.task_id]));
      await assert.rejects(sql.unsafe('delete from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[reserved.scope.task_id]));
      await assert.rejects(sql.begin(async tx=>{await tx.unsafe('set local role service_role');await tx.unsafe('select destruktion_meta.native_coding_callback_publication_read_v1($1,$2,$3)',[reserved.scope.task_id,1,reserved.scope.reservation_id]);}),e=>e.code==='42501');
      assert.deepEqual((await x.read(reserved)).publication,original);
    });

    await subtest('migration exact replay; public v1 service-role projection still excludes the private column',async()=>{
      await sql.begin(tx=>tx.unsafe(migration));
      const x=await fixture(),r=await x.reserve();await x.journal();await x.publish(r);
      await x.authority.ADVANCE_EXECUTION({scope:r.scope,transition:x.attempted()});
      const context=await sql.begin(async tx=>{await tx.unsafe('set local role service_role');return (await tx.unsafe('select public.native_coding_execution_context_v1($1,$2,$3,$4) as v',[x.f.workspaceId,x.f.clientId,r.scope.task_id,1]))[0].v;});
      assert.equal(Object.hasOwn(context.execution,'callback_publication'),false);assert.equal(context.execution.state,'ATTEMPTED');
      assert.equal(Object.hasOwn(nativeCodingCallbackPublicationFor(x.authority),'retainReservation'),false);
      assert.equal(Reflect.ownKeys(x.authority).includes('callbackPublication'),false);
    });
    for(const [label,change] of [
      ['function body',"create or replace function destruktion_meta.native_coding_callback_publication_read_v1(p_task uuid,p_generation bigint,p_reservation uuid) returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$begin return null;end$$"],
      ['function ACL',"grant execute on function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) to service_role"],
      ['function path',"alter function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) set search_path=public,pg_catalog"],
      ['trigger disabled',"alter table destruktion_meta.native_coding_execution_h205f22 disable trigger native_callback_publication_guard_v1"],
      ['constraint weakened',"alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_callback_publication_shape_v1;alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_callback_publication_shape_v1 check(true)"],
      ['column default',"alter table destruktion_meta.native_coding_execution_h205f22 alter column callback_publication set default '{}'::jsonb"],
      ['column grant',"grant update(callback_publication) on destruktion_meta.native_coding_execution_h205f22 to service_role"],
      ['partial function',"drop function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid)"],
    ])await subtest('migration refuses '+label+' without repairing it',async()=>{
      await assert.rejects(sql.begin(async tx=>{await tx.unsafe(change);await tx.unsafe(migration);}),/native_callback_/);
      await sql.begin(tx=>tx.unsafe(migration));
    });
    for(const [label,mutation] of [
      ['grant revoked',async x=>sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set active=false where device_id=$1',[x.f.permit.device_id])],
      ['grant epoch rotated',async x=>sql.unsafe('update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=2 where device_id=$1',[x.f.permit.device_id])],
      ['project paused',async x=>sql.unsafe("update destruktion_meta.project_run_h205f22 set state='PAUSED' where project_id=$1",[x.f.permit.project_id])],
      ['control disabled',async x=>sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[x.f.workspaceId])],
      ['Owner generation changed',async x=>{x.controls.ownerChanged=true;}],
      ['Owner staging marker',async x=>{x.controls.ownerMarker=true;}],
      ['Host PID reused',async x=>{x.controls.hostChanged=true;}],
      ['PG root changed',async x=>{x.native.postgres.data_directory_identity_sha256='f'.repeat(64);}],
    ])await subtest('retained prefix cannot advance after '+label,async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const prior=(await x.publish(r)).publication;await x.append();await mutation(x);
      await assert.rejects(x.publish(r),unknown);
      const [row]=await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]);assert.deepEqual(row.v,prior);
    });
    await subtest('lost publication COMMIT ACK reads exact anchor but never clears HOLD or upgrades caller',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.afterCommit=async()=>{throw Error('generated_lost_commit_ack');};
      await assert.rejects(x.publish(r),unknown);x.controls.afterCommit=null;
      const observed=await x.read(r);assert.equal(observed.state,'READBACK_ONLY');assert.equal(observed.prior_outcome,'UNKNOWN');assert.equal(observed.send_capability,false);
      await assert.rejects(x.publish(r),/custody_hold/);
    });
    await subtest('rollback before COMMIT preserves durable absence but cannot replay the original private publication',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.beforeCommit=async()=>{throw Error('generated_precommit_failure');};
      await assert.rejects(x.publish(r),unknown);x.controls.beforeCommit=null;
      const [row]=await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]);assert.equal(row.v,null);
      await assert.rejects(x.read(r),/readback_hold/);await assert.rejects(x.publish(r),/custody_hold/);
    });
    await subtest('swallowed private rollback poison cannot qualify a committed-looking candidate',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.beforeCommit=async()=>{markNativePhysicalSettlementUnconfirmed(Error('generated_private_hold'));};
      await assert.rejects(x.publish(r),e=>unknown(e)&&nativePhysicalSettlementUnconfirmed(e));x.controls.beforeCommit=null;
      assert.equal((await x.read(r)).send_capability,false);await assert.rejects(x.publish(r),/custody_hold/);
    });
    await subtest('actual PG backend death during publication transaction is UNKNOWN and leaves no replay capability',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();
      x.controls.beforeCommit=async tx=>{const [b]=await tx.unsafe('select pg_backend_pid() as pid');await sql.unsafe('select pg_terminate_backend($1)',[b.pid]);};
      await assert.rejects(x.publish(r),unknown);x.controls.beforeCommit=null;
      assert.equal((await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]))[0].v,null);
      await assert.rejects(x.publish(r),/custody_hold/);
    });
    await subtest('concurrent prefix CAS admits one exact revision; loser 40001 is not retried',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const before=(await x.publish(r)).publication;await x.append();
      const prefix=await readNativeCallbackProtectedPrefix({directory:x.runDirectory,expected:before.cursor,
        readProtectedJson:(file,options)=>readNativeCodingProtectedJson(file,{...options,verifyStorage:async()=>({owner_dacl_verified:true})})});
      const next={...before,cursor:{revision:1,record_count:prefix.record_count,intent_count:prefix.intent_count,head_sha256:prefix.head_sha256,dispatch_fenced:false}};
      let calls=0;const apply=()=>monitored.begin('isolation level serializable',async tx=>{calls++;await tx.unsafe('set local synchronous_commit=on');return tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1,$2,$3,$4,$5)',[r.scope.task_id,1,r.scope.reservation_id,sql.json(before),sql.json(next)]);});
      const outcomes=await Promise.allSettled([apply(),apply()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'40001');assert.equal(calls,2);
      const [stored]=await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]);assert.deepEqual(stored.v,next);
      await assert.rejects(x.read(r),/readback_hold/); // newer SQL is not silently adopted
    });
    await subtest('exact real capacity census digest changes with publication; v1 shape does not',async()=>{
      const setup=await fs.readFile(new URL('./native-coding-setup-operation-v1.sql',import.meta.url),'utf8');
      await sql.unsafe(setup.slice(setup.indexOf('create table if not exists'),setup.indexOf('create or replace function destruktion_meta.native_coding_setup_operation_v1')));
      const capacity=await fs.readFile(new URL('./native-coding-capacity-v2.sql',import.meta.url),'utf8'),start=capacity.indexOf('create or replace function destruktion_meta.native_coding_capacity_rows_v1');
      await sql.unsafe(capacity.slice(start,capacity.indexOf('end $$;',start)+7));
      const x=await fixture(),r=await x.reserve();await x.journal();
      const read=async()=>(await sql.unsafe('select * from destruktion_meta.native_coding_capacity_rows_v1($1,$2)',[x.f.permit.device_id,x.f.clientId]))[0].native_coding_capacity_rows_v1;
      const before=await read(),v1=await x.authority.READ_EXECUTION({scope:r.scope});await x.publish(r);const after=await read();
      assert.notEqual(before.durable_sha256,after.durable_sha256);assert.equal(before.key,after.key);
      assert.deepEqual(await x.authority.READ_EXECUTION({scope:r.scope}),v1);
    });
    await subtest('permanent logged relation and local WAL settings are checked, never changed globally',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const value=(await x.publish(r)).publication;
      await assert.rejects(sql.begin('isolation level serializable',async tx=>{await tx.unsafe('set local synchronous_commit=off');await tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1,$2,$3,$4,$5)',[r.scope.task_id,1,r.scope.reservation_id,sql.json(value),sql.json(value)]);}),/wal_unqualified/);
      const [settings]=await sql.unsafe("select current_setting('fsync') as fsync,current_setting('full_page_writes') as full_page_writes");assert.deepEqual(settings,{fsync:'on',full_page_writes:'on'});
    });

    await subtest('actual default missing W74 reader refuses before prefix/SQL publication; no arbitrary JSON override',async()=>{
      const x=await fixture({ownerReader:false}),r=await x.reserve();await x.journal();const count=x.transactionReadbacks.length;
      assert.equal(nativeCodingCallbackPublicationFor(x.authority).status().reason,'OWNER_CUSTODY_UNBOUND');
      await assert.rejects(x.publish(r),/owner_custody_unbound/);assert.equal(x.transactionReadbacks.length,count);
      assert.equal((await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]))[0].v,null);
    });
    await subtest('same-millisecond different PG birth is not accepted as the original incarnation',async()=>{
      const bad=structuredClone(hostIdentity),parts=bad.postgresIdentity.started_at.split('.');
      const fraction=parts[1].slice(0,6);bad.postgresIdentity.started_at=parts[0]+'.'+fraction.slice(0,5)+(fraction[5]==='0'?'1':'0')+'Z';
      assert.equal(Date.parse(bad.postgresIdentity.started_at),Date.parse(hostIdentity.postgresIdentity.started_at));
      const x=await fixture({identityOverride:bad}),r=await x.reserve();await x.journal();await assert.rejects(x.publish(r),unknown);
    });
    await subtest('foreign original request/Host and foreign authority cannot claim exact fresh reservation',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();
      await assert.rejects(nativeCodingCallbackPublicationFor(x.authority).publish(r,{...x.request}),/custody_hold/);
      await assert.rejects(nativeCodingCallbackPublicationFor(x.authority).publish(r,{...x.request,hostPid:x.request.hostPid+1}),/request_scope_changed/);
      const y=await fixture();await assert.rejects(y.publish(r),/fresh_reservation_required/);assert.equal((await x.publish(r)).send_capability,false);
    });
    await subtest('a foreign protected attempt/run cannot be anchored for the original lease',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const file=path.join(x.runDirectory,'attempt.json'),a=JSON.parse(await fs.readFile(file,'utf8'));
      a.run_id=randomUUID();await fs.writeFile(file,JSON.stringify(a));await assert.rejects(x.publish(r),unknown);
      assert.equal((await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]))[0].v,null);
    });
    await subtest('missing committed local prefix remains HOLD, never false absence or a replacement writer',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const original=(await x.publish(r)).publication;
      await fs.rename(path.join(x.runDirectory,'host-callback-custody'),path.join(x.runDirectory,'lost-prefix'));
      await assert.rejects(x.read(r));await assert.rejects(x.publish(r),/custody_hold/);
      assert.deepEqual((await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]))[0].v,original);
    });
    await subtest('deadline and shutdown after file observation prevent a new prefix publication',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.prefixRead=()=>{x.abort.abort();};
      await assert.rejects(x.publish(r),unknown);
      assert.equal((await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]))[0].v,null);
      const y=await fixture(),r2=await y.reserve();await y.journal();y.authority.close();await assert.rejects(y.publish(r2),/fresh_reservation_required|closed/);
    });
    await subtest('swallowed poison in the genuine reserve transaction cannot mint private custody',async()=>{
      const x=await fixture();await x.prepare();const scope=buildNativeCodingExecutionScope(x.f.permit,(await x.authority.READ_LEASE(x.query)).value,x.native.host_process);
      x.controls.beforeCommit=async()=>{markNativePhysicalSettlementUnconfirmed(Error('generated_reserve_hold'));};
      await assert.rejects(x.authority.RESERVE_EXECUTION({scope},x.request),nativePhysicalSettlementUnconfirmed);x.controls.beforeCommit=null;
      const r=await x.authority.RESERVE_EXECUTION({scope},x.request);assert.equal(r.state,'READBACK_ONLY');await assert.rejects(x.publish(r),/fresh_reservation_required/);
    });
    await subtest('foreign signed ATTEMPTED run rolls back registration instead of rebinding the immutable anchor',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();await x.publish(r);
      const transition=x.attempted(),payload={...transition.job_proof.payload,run_id:randomUUID()};payload.job_id=payload.run_id;
      x.controls.worker.run_id=payload.run_id;x.controls.worker.job_id=payload.job_id;
      transition.job_proof=x.f.envelope(payload);transition.evidence_sha256=sha(transition.job_proof);
      await assert.rejects(x.authority.ADVANCE_EXECUTION({scope:r.scope,transition}),unknown);
      assert.equal((await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_job_registration_h205f22 where task_id=$1',[r.scope.task_id]))[0].n,0);
      assert.equal((await x.read(r)).publication.job_sha256,null);
    });

    await subtest('late post-COMMIT Owner change fences candidate and later ABA read cannot clear UNKNOWN',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();x.controls.afterCommit=()=>{x.controls.ownerChanged=true;};
      await assert.rejects(x.publish(r),unknown);x.controls.afterCommit=null;x.controls.ownerChanged=false;
      const read=await x.read(r);assert.equal(read.prior_outcome,'UNKNOWN');assert.equal(read.send_capability,false);
      await assert.rejects(x.publish(r),/custody_hold/);
    });
    await subtest('direct API table writes and widened EXECUTE plus caller GUC cannot become trusted publication',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const value=(await x.publish(r)).publication;
      await assert.rejects(sql.begin(async tx=>{await tx.unsafe('grant usage on schema destruktion_meta to service_role');await tx.unsafe('set local role service_role');
       await tx.unsafe('update destruktion_meta.native_coding_execution_h205f22 set callback_publication=$1 where task_id=$2',[sql.json(value),r.scope.task_id]);}),e=>e.code==='42501');
      await assert.rejects(sql.begin('isolation level serializable',async tx=>{
       await tx.unsafe('grant usage on schema destruktion_meta to service_role;grant execute on function destruktion_meta.native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb) to service_role');
       await tx.unsafe("set local role service_role;set local metaengine.callback_publication_verified='true';set local synchronous_commit=on");
       await tx.unsafe('select destruktion_meta.native_coding_callback_publication_cas_v1($1,$2,$3,$4,$5)',[r.scope.task_id,1,r.scope.reservation_id,sql.json(value),sql.json(value)]);
      }),e=>e.code==='42501'&&/owner_required/.test(e.message));
      await sql.begin(tx=>tx.unsafe(migration));assert.deepEqual((await x.read(r)).publication,value);
    });

    await subtest('rejected sanitized wrappers retain exact nested physical poison in the original outer scope',async()=>{
      for(const mode of ['reserve','publish','readback']){
       const x=await fixture();let r,scope;
       if(mode==='reserve'){await x.prepare();scope=buildNativeCodingExecutionScope(x.f.permit,(await x.authority.READ_LEASE(x.query)).value,x.native.host_process);}
       else {r=await x.reserve();await x.journal();if(mode==='readback')await x.publish(r);}
       x.controls.beforeCommit=async()=>{markNativePhysicalSettlementUnconfirmed(Error('generated_private_poison'));throw Error('generated_sanitized_wrapper');};
       const outer=runNativePhysicalSettlementScope(()=>mode==='reserve'?x.authority.RESERVE_EXECUTION({scope},x.request):mode==='publish'?x.publish(r):x.read(r));
       await assert.rejects(outer.promise,nativePhysicalSettlementUnconfirmed);assert.equal(outer.unconfirmed(),true,mode);
      }
    });
    await subtest('ordinary prefix rollback is denied; simulated privileged restore is readback HOLD, never adopted',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const old=(await x.publish(r)).publication;await x.append();await x.publish(r);
      await assert.rejects(sql.unsafe('update destruktion_meta.native_coding_execution_h205f22 set callback_publication=$1 where task_id=$2',[sql.json(old),r.scope.task_id]),/cursor_invalid/);
      // Deliberate corruption fixture simulates restoration by the DB owner.
      // The exact guard is reinstated BEFORE exercising the production reader;
      // no ledger/guard is deleted and no restore/rebuild is accepted as success.
      await sql.begin(async tx=>{await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 disable trigger native_callback_publication_guard_v1');
       await tx.unsafe('update destruktion_meta.native_coding_execution_h205f22 set callback_publication=$1 where task_id=$2',[sql.json(old),r.scope.task_id]);
       await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 enable trigger native_callback_publication_guard_v1');});
      await assert.rejects(x.read(r),/readback_hold/);await assert.rejects(x.publish(r),/custody_hold/);await assert.rejects(x.publish(r),/custody_hold/);
      await sql.begin(tx=>tx.unsafe(migration));
    });

    await subtest('same-run readback and publication share one owned in-flight operation, without a queue or replay',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const prior=(await x.publish(r)).publication;
      let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
      x.controls.prefixRead=async()=>{enter();await held;};const reading=x.read(r);await entered;
      await assert.rejects(x.read(r),/custody_hold/);await assert.rejects(x.publish(r),/custody_hold/);
      release();assert.deepEqual((await reading).publication,prior);x.controls.prefixRead=null;
      assert.deepEqual((await x.read(r)).publication,prior);
    });
    const crashRestart=()=>subtest('crash restart retains WAL anchor but old Host/PG lineage cannot readopt or advance it',async()=>{
      const x=await fixture(),r=await x.reserve();await x.journal();const value=(await x.publish(r)).publication;
      await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
      await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
      const [stored]=await sql.unsafe('select callback_publication as v from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[r.scope.task_id]);assert.deepEqual(stored.v,value);
      await assert.rejects(x.read(r),/readback_hold/);await x.append();await assert.rejects(x.publish(r),/custody_hold/);
      const again=await x.authority.RESERVE_EXECUTION({scope:r.scope},x.request);assert.equal(again.state,'READBACK_ONLY');await assert.rejects(x.publish(again),/fresh_reservation_required/);
    });
    async function handoffFixture({composed=false}={}){
      const x=await fixture();let reservation,composition=null;
      if(composed){const p=await x.prepare();await x.journal();composition=nativeCodingCallbackPublicationCompositionFor(x.authority);
       reservation=await composition.operations.RESERVE_EXECUTION({scope:p.scope},x.request);
      }else{reservation=await x.reserve();await x.journal();await x.publish(reservation);}
      await x.authority.ADVANCE_EXECUTION({scope:reservation.scope,transition:x.attempted()});
      const api=nativeCodingCallbackPublicationFor(x.authority),handoff=composition?.callbackPublication??api.handoff(reservation),p=x.attempted().job_proof.payload;
      const intent=()=>({binding:Object.fromEntries(['run_id','workspace_id','project_id','task_id','lease_generation','agent_id','agent_generation_epoch','provider_id','role'].map(k=>[k,p[k]])),
        request_id:randomUUID(),request_sha256:'a'.repeat(64),operation:'CHECK',
        job_binding_sha256:sha({job_id:p.job_id,pid:p.worker_process.pid,process_incarnation_id:p.worker_process.process_incarnation_id,executable_sha256:p.artifact.cli_executable_sha256})});
      const publish=async i=>{const {binding,...record}=i;await x.append({kind:'INTENT',...record});
        return handoff.publish(i,{...x.request,action:'PUBLISH_RUN_CALLBACK_V1',requestId:randomUUID(),requestDigest:'c'.repeat(64)});};
      const context=i=>({...x.request,action:'AGENT_OPERATION',requestId:i.request_id,requestDigest:i.request_sha256});
      return {x,reservation,api,handoff,intent,publish,context,composition};
    }
    await subtest('original reserve composition retains actual private routing for later intent publication and one-shot recheck',async()=>{
      const q=await handoffFixture({composed:true}),intent=q.intent(),capability=await q.publish(intent);
      assert.throws(()=>q.api.handoff(q.reservation),/fresh_reservation_required/,'serialized projection is not original custody');
      await assert.rejects(q.handoff.recheck(structuredClone(capability),q.context(intent)),/handoff_unbound/);
      await q.handoff.recheck(capability,q.context(intent));await assert.rejects(q.handoff.recheck(capability,q.context(intent)),/handoff_unbound/);
      await assert.rejects(q.handoff.publish({...intent,binding:{...intent.binding,run_id:randomUUID()}},{...q.context(intent),action:'PUBLISH_RUN_CALLBACK_V1'}),/run_unbound/);
    });
    await subtest('closing the original authority fences its composed routing and retained handoff',async()=>{
      const q=await handoffFixture({composed:true}),intent=q.intent(),capability=await q.publish(intent);q.x.authority.close();
      await assert.rejects(q.handoff.recheck(capability,q.context(intent)),/closed/);
      await assert.rejects(q.handoff.publish(intent,{...q.context(intent),action:'PUBLISH_RUN_CALLBACK_V1'}),/closed/);
    });
    await subtest('fixed effect continuation shares the actual recheck transaction and returns only after the final Owner snapshot',async()=>{
      const q=await handoffFixture(),intent={...q.intent(),operation:'agent_send_message'},capability=await q.publish(intent),id=randomUUID(),reads=[];
      const context=q.context(intent);q.x.controls.nativeRead=value=>{assert.equal(value.request,context);reads.push(value.tx);};let effectTx;
      const result=await q.handoff.recheck(capability,context,async tx=>{
       effectTx=tx;assert.equal(reads.length,2);await tx.unsafe('insert into public.qa_publication_effects values($1,$2)',[id,'generated effect, not a live agent']);return {stored:true,authority_effect:false};
      });
      assert.deepEqual(result,{stored:true,authority_effect:false});assert.equal(reads.length,3);assert.ok(reads.every(tx=>tx===effectTx));
      assert.equal((await sql.unsafe('select count(*)::int as n from public.qa_publication_effects where id=$1',[id]))[0].n,1);
    });
    for(const change of ['Owner','cancellation','effect rejection'])await subtest('same-transaction '+change+' after generated SQL effect rolls back before any COMMIT',async()=>{
      const q=await handoffFixture(),intent={...q.intent(),operation:'agent_send_message'},capability=await q.publish(intent),id=randomUUID(),context=q.context(intent);
      await assert.rejects(q.handoff.recheck(capability,context,async tx=>{
       await tx.unsafe('insert into public.qa_publication_effects values($1,$2)',[id,'must roll back']);
       if(change==='Owner')q.x.controls.ownerChanged=true;
       else if(change==='cancellation')q.x.abort.abort();else throw Error('generated effect rejection');
       return {stored:true,authority_effect:false};
      }),/handoff_hold/);
      assert.equal((await sql.unsafe('select count(*)::int as n from public.qa_publication_effects where id=$1',[id]))[0].n,0);
      await assert.rejects(q.handoff.recheck(capability,context),/handoff_unbound/);
    });
    await subtest('composed AGENT effect cannot be called outside its actual one-shot transaction continuation',async()=>{
      const q=await handoffFixture({composed:true}),intent=q.intent(),capability=await q.publish(intent),context=q.context(intent);
      await assert.rejects(q.composition.operations.AGENT_OPERATION({},context,{}),/effect_unbound/);
      await q.handoff.recheck(capability,context);
      await assert.rejects(q.composition.operations.AGENT_OPERATION({},context,{}),/effect_unbound/);
    });
    await subtest('real PG handoff is exact private custody; clones and a second consume cannot authorize',async()=>{
      const q=await handoffFixture(),intent=q.intent(),capability=await q.publish(intent);
      assert.throws(()=>q.api.handoff(structuredClone(q.reservation)),/fresh_reservation_required/);
      await assert.rejects(q.handoff.recheck(structuredClone(capability),q.context(intent)),/handoff_unbound/);
      await q.handoff.recheck(capability,q.context(intent));
      await assert.rejects(q.handoff.recheck(capability,q.context(intent)),/handoff_unbound/);
      assert.equal(q.api.status().send_capability,false,'default/serialized status remains no capability');
    });
    await subtest('two published original intents survive a later SQL head without substituting the latest cursor',async()=>{
      const q=await handoffFixture(),a=q.intent(),first=await q.publish(a),b=q.intent(),second=await q.publish(b);
      await q.handoff.recheck(first,q.context(a));await q.handoff.recheck(second,q.context(b));
    });
    await subtest('a local later intent is accepted only as extension of both exact anchored prefixes',async()=>{
      const q=await handoffFixture(),a=q.intent(),first=await q.publish(a),b=q.intent();const {binding,...record}=b;
      await q.x.append({kind:'INTENT',...record});await q.handoff.recheck(first,q.context(a));
    });
    await subtest('a wrong original digest consumes private custody without ever upgrading by retry',async()=>{
      const q=await handoffFixture(),a=q.intent(),cap=await q.publish(a);
      await assert.rejects(q.handoff.recheck(cap,{...q.context(a),requestDigest:'f'.repeat(64)}),/handoff_hold/);
      await assert.rejects(q.handoff.recheck(cap,q.context(a)),/handoff_unbound/);
    });
    await subtest('handoff intent requires the unchanged actual ATTEMPTED signed job',async()=>{
      const q=await handoffFixture(),a={...q.intent(),job_binding_sha256:'0'.repeat(64)};
      await assert.rejects(q.publish(a),unknown);
    });
    await subtest('lost handoff COMMIT ACK cannot be converted from exact readback into private custody',async()=>{
      const q=await handoffFixture(),a=q.intent();q.x.controls.afterCommit=async()=>{throw Error('generated lost handoff ACK');};
      await assert.rejects(q.publish(a),unknown);q.x.controls.afterCommit=null;
      const read=await q.api.read(q.reservation,q.x.request);assert.equal(read.prior_outcome,'UNKNOWN');
      await assert.rejects(q.handoff.recheck(read,q.context(a)),/handoff_unbound/);
    });
    for(const [label,change] of [
      ['Owner generation',q=>{q.x.controls.ownerChanged=true;}],
      ['Host incarnation',q=>{q.x.controls.hostChanged=true;}],
      ['PG directory',q=>{q.x.native.postgres.data_directory_identity_sha256='f'.repeat(64);}],
      ['current control',q=>sql.unsafe('update public.qa_native_environment set enabled=false where workspace_id=$1',[q.x.f.workspaceId])],
    ])await subtest('published handoff rechecks '+label+' before the original operation',async()=>{
      const q=await handoffFixture(),a=q.intent(),cap=await q.publish(a);await change(q);
      await assert.rejects(q.handoff.recheck(cap,q.context(a)),/handoff_hold/);
    });
    await subtest('a fenced local prefix cannot use an older committed publication to send',async()=>{
      const q=await handoffFixture(),a=q.intent(),cap=await q.publish(a);await q.x.append({kind:'FENCE'});
      await assert.rejects(q.handoff.recheck(cap,q.context(a)),/handoff_hold/);
    });
    await subtest('an intent with an existing caller outcome cannot be replayed through publication custody',async()=>{
      const q=await handoffFixture(),a=q.intent(),cap=await q.publish(a);
      await q.x.append({kind:'CALLER',request_id:a.request_id,request_sha256:a.request_sha256,outcome:'UNKNOWN'});
      await assert.rejects(q.handoff.recheck(cap,q.context(a)),/handoff_hold/);
    });
    // Install the genuine AgentTools dependencies only for the joined lane.
    // Earlier publication tests deliberately exercise the smaller schema. No
    // native_coding_agent_context_v1/auth/fence stub replaces these functions.
    await sql.unsafe(`alter table public.compute_fabric_a2_browser_device_h205f22 add column enrollment_pairing_token_hash text;
      create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true)`);
    const goal=await fs.readFile(new URL('20260929211500_client_v1_goal_progress_reconciliation_v1.sql',migrations),'utf8');
    await sql.unsafe(goal.slice(goal.indexOf('create table if not exists destruktion_meta.client_v1_goal_request_h205f22'),goal.indexOf('alter table destruktion_meta.client_v1_goal_request_h205f22')));
    const resultProof=await fs.readFile(new URL('20260929224500_client_v1_agent_origin_result_proof_v1.sql',migrations),'utf8');
    await sql.unsafe(resultProof.slice(0,resultProof.indexOf('-- Keep the existing Client progress contract')));
    await sql.unsafe(project.slice(projectEnd));
    for(const name of ['20261012130000_project_verifier_reference_transport_v1.sql','20261025070000_native_coding_project_continuation_v1.sql',
      '20261025080000_native_coding_worktree_lease_admission_v1.sql','20261025090000_native_coding_agent_project_tools_v1.sql'])
      await sql.unsafe(await fs.readFile(new URL(name,migrations),'utf8'));
    const markStart=bootstrap.indexOf('create or replace function public.devos_fleet_mark_running_v1(');
    const markEnd=bootstrap.indexOf('end $$;',markStart)+7;
    assert.ok(markStart>0&&markEnd>markStart);await sql.unsafe(bootstrap.slice(markStart,markEnd));
    // The joined path must also satisfy the additive mandatory anchor and
    // retained-task fence; isolated SQL and JS greens are not their composition.
    const taskFenceSql=await fs.readFile(new URL('./native-coding-initial-anchor-task-fence-v1.sql',import.meta.url),'utf8');
    await sql.begin(tx=>tx.unsafe(taskFenceSql));
    agentToolsInstalled=true;

    async function joinedAgentFixture(){
      const q=await handoffFixture({composed:true}),p=q.x.f.permit,job=q.x.attempted().job_proof.payload;
      const [running]=await sql.unsafe('select public.devos_fleet_mark_running_v1($1,$2,1,$3,$4,1,$5::jsonb) as value',
        [q.reservation.scope.task_id,p.agent_id,q.x.f.binding.tab_id,q.x.f.binding.target_id,
          sql.json({schema:'metaengine.native-coding.mark-running.v1',job_proof_sha256:sha(q.x.attempted().job_proof),authority_effect:false})]);
      assert.equal(running.value.state,'RUNNING');assert.equal(running.value.task_id,q.reservation.scope.task_id);
      const [current]=await sql.unsafe(`select t.state,c.state as claim_state,e.state as execution_state
        from destruktion_meta.devos_fleet_task_h205f22 t join destruktion_meta.devos_fleet_claim_h205f22 c using(task_id,lease_generation)
        join destruktion_meta.native_coding_execution_h205f22 e using(task_id,lease_generation) where t.task_id=$1`,[q.reservation.scope.task_id]);
      assert.deepEqual(current,{state:'RUNNING',claim_state:'ACTIVE',execution_state:'ATTEMPTED'});
      const [fence]=await sql.unsafe('select state,writer_task_id,writer_lease_generation from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=$1',[p.worktree.root_identity_sha256]);
      assert.equal(fence.state,'HELD');assert.equal(fence.writer_task_id,q.reservation.scope.task_id);assert.equal(Number(fence.writer_lease_generation),1);
      const peer={...structuredClone(p),permit_id:randomUUID(),provider_id:randomUUID(),agent_id:'agent_joined-peer-'+randomUUID().slice(0,8),
        worktree:{...p.worktree,path:p.worktree.path+'-peer',root_identity_sha256:sha(randomUUID())}},peerTask=randomUUID();
      await sql.unsafe(`insert into destruktion_meta.native_coding_operator_permit_h205f22
        (permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
        values($1,$2,$3,$4,1,$5,$6,1,$7,$8)`,[peer.permit_id,p.workspace_id,q.x.f.clientId,p.device_id,peer.provider_id,peer.agent_id,sql.json(peer),peer.record_sha256]);
      const spec={objective:'Receive one generated joined SQL message',native_coding:{permit_id:peer.permit_id,goal_id:p.goal_id,goal_sha256:p.goal_sha256,project_id:p.project_id}};
      await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key)
        values($1::uuid,$2::uuid,'joined.peer','IMPLEMENTER',$3::text,$4::jsonb,$5::text,$1::text)`,[peerTask,p.workspace_id,p.worktree.base_sha,sql.json(spec),sha(spec)]);
      await sql.unsafe('insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth) values($1,$2,1,$3,$3,1)',
        [peerTask,p.project_id,q.reservation.scope.task_id]);
      const payload={operation:'agent_send_message',binding:q.intent().binding,
        job_binding:{job_id:job.job_id,pid:job.worker_process.pid,process_incarnation_id:job.worker_process.process_incarnation_id,executable_sha256:p.artifact.cli_executable_sha256},
        args:{request_id:randomUUID(),target_agent_id:peer.agent_id,message:'Generated joined real-PG message; no native process was launched.'}};
      const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:q.x.request.instanceId,host_pid:q.x.request.hostPid,
        request_id:randomUUID(),action:'AGENT_OPERATION',payload};
      const intent={binding:payload.binding,request_id:frame.request_id,request_sha256:sha(frame),operation:payload.operation,job_binding_sha256:sha(payload.job_binding)};
      const {binding,...record}=intent;await q.x.append({kind:'INTENT',...record});
      const publicationFrame={...frame,request_id:randomUUID(),action:'PUBLISH_RUN_CALLBACK_V1',payload:intent};
      const publicationContext={...q.x.request,action:publicationFrame.action,requestId:publicationFrame.request_id,requestDigest:sha(publicationFrame)};
      const capability=await q.handoff.publish(intent,publicationContext),context=q.context(intent);
      const invoke=tx=>q.composition.operations.AGENT_OPERATION(payload,context,tx);
      const stored=async()=>({intents:[...await sql.unsafe('select receipt from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=$1 and request_id=$2',[job.run_id,payload.args.request_id])],
        events:[...await sql.unsafe("select content from destruktion_meta.project_event_h205f22 where project_id=$1 and event_type='NATIVE_AGENT_MESSAGE' and content->>'request_id'=$2",[p.project_id,payload.args.request_id])]});
      return {...q,payload,frame,intent,capability,context,invoke,stored,peerTask};
    }
    await subtest('joined actual composition and AgentTools commit one fixed message in the same monitored Owner transaction',async()=>{
      const q=await joinedAgentFixture(),native=[],owners=[],before=q.x.transactionEntries.length;
      q.x.controls.nativeRead=observation=>{assert.equal(observation.request,q.context);native.push(observation);};
      q.x.controls.ownerRead=observation=>{assert.equal(observation.request,q.context);owners.push(observation);};
      await assert.rejects(q.composition.operations.AGENT_OPERATION(q.payload,q.context,{}),/effect_unbound/);
      await assert.rejects(q.handoff.recheck(structuredClone(q.capability),q.context,q.invoke),/handoff_unbound/);
      let effectTx,inside,physical;
      const result=await q.handoff.recheck(q.capability,q.context,async tx=>{
        effectTx=tx;assert.equal(owners.length,2);assert.equal(typeof tx.addCommitGuard,'function');
        const value=await q.invoke(tx);
        inside=(await tx.unsafe('select count(*)::int as n from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=$1 and request_id=$2',[q.payload.binding.run_id,q.payload.args.request_id]))[0].n;
        physical=(await tx.unsafe("select pg_backend_pid() as pid,pg_current_xact_id()::text as xid,current_setting('transaction_isolation') as isolation,current_setting('synchronous_commit') as synchronous_commit"))[0];
        return value;
      });
      assert.equal(inside,1);assert.equal(result.stored,true);assert.equal(result.recipient_task_id,q.peerTask);
      assert.equal(owners.length,3);assert.equal(native.length,4);assert.equal(native.filter(x=>x.requireLive===false).length,1,'actual AgentTools bound() performed its own native check');
      assert.ok([...owners,...native].every(x=>x.tx===effectTx));assert.equal(q.x.transactionEntries.length-before,1,'no nested AgentTools begin');
      assert.equal(q.x.transactionEntries.at(-1),effectTx);assert.equal(physical.isolation,'serializable');assert.equal(physical.synchronous_commit,'on');assert.ok(physical.pid>0&&/^\d+$/.test(physical.xid));
      const read=await q.stored();assert.equal(read.intents.length,1);assert.deepEqual(read.intents[0].receipt,result);assert.equal(read.events.length,1);assert.equal(read.events[0].content.message,q.payload.args.message);
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),/handoff_unbound/);
      await assert.rejects(q.composition.operations.AGENT_OPERATION(q.payload,q.context,effectTx),/effect_unbound/);assert.deepEqual(await q.stored(),read);
    });
    for(const change of ['Owner','cancellation','effect rejection','second effect'])await subtest('joined '+change+' after actual AgentTools SQL rolls back both message and intent without replay',async()=>{
      const q=await joinedAgentFixture();let returned=false;
      await assert.rejects(q.handoff.recheck(q.capability,q.context,async tx=>{
        const result=await q.invoke(tx);returned=true;assert.equal(result.stored,true);
        assert.equal((await tx.unsafe('select count(*)::int as n from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=$1',[q.payload.binding.run_id]))[0].n,1);
        if(change==='Owner')q.x.controls.ownerChanged=true;
        else if(change==='cancellation')q.x.abort.abort();else if(change==='second effect')await q.invoke(tx);else throw Error('generated post-effect rejection');
        return result;
      }),/handoff_hold/);
      assert.equal(returned,true);assert.deepEqual(await q.stored(),{intents:[],events:[]});
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),change==='cancellation'?/native_coding_host_request_cancelled/:/handoff_unbound/);
      await assert.rejects(q.handoff.recheck(q.capability,{...q.context,signal:new AbortController().signal},q.invoke),/handoff_unbound/,'fresh signal cannot revive consumed custody');
    });
    await subtest('joined cancellation retains the actual post-effect Owner callback and transaction until that original callback joins',async()=>{
      const q=await joinedAgentFixture();let enter,release,reads=0,done=false,effectTx;
      const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
      q.x.controls.ownerRead=async observation=>{
        assert.equal(observation.request,q.context);if(++reads===3){assert.equal(observation.tx,effectTx);enter();await held;}
      };
      const operation=q.handoff.recheck(q.capability,q.context,async tx=>{effectTx=tx;const value=await q.invoke(tx);assert.equal(value.stored,true);return value;});
      const checked=assert.rejects(operation,/handoff_hold/).finally(()=>{done=true;});
      try{
        await Promise.race([entered,operation.then(()=>{throw Error('joined_owner_callback_not_entered');})]);
        q.x.abort.abort();await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
        assert.deepEqual(await q.stored(),{intents:[],events:[]},'uncommitted fixed effect is not visible on the independent connection');
      }finally{release();await checked;}
      assert.equal(reads,3);assert.deepEqual(await q.stored(),{intents:[],events:[]});
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),/native_coding_host_request_cancelled/);
      await assert.rejects(q.handoff.recheck(q.capability,{...q.context,signal:new AbortController().signal},q.invoke),/handoff_unbound/);
    });
    for(const change of ['context','transaction'])await subtest('joined effect rejects substituted '+change+' rather than adopting a matching object',async()=>{
      const q=await joinedAgentFixture();let entered=false;
      await assert.rejects(q.handoff.recheck(q.capability,q.context,async tx=>{entered=true;
        return q.composition.operations.AGENT_OPERATION(q.payload,change==='context'?{...q.context}:q.context,change==='transaction'?{...tx}:tx);
      }),/handoff_hold/);
      assert.equal(entered,true);assert.deepEqual(await q.stored(),{intents:[],events:[]});
    });
    await subtest('joined lost COMMIT ACK retains exactly one real message and receipt but no replay ticket',async()=>{
      const q=await joinedAgentFixture();q.x.controls.afterCommit=()=>{throw Error('generated joined commit ACK loss');};
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),/handoff_hold/);q.x.controls.afterCommit=null;
      const rows=await q.stored();assert.equal(rows.intents.length,1);assert.equal(rows.events.length,1);assert.equal(rows.intents[0].receipt.stored,true);
      const read=(await sql.unsafe('select destruktion_meta.native_coding_agent_intent_read_v1($1,$2) as value',[q.payload.binding.run_id,q.payload.args.request_id]))[0].value;
      assert.equal(read.found,true);assert.equal(read.readback_only,true);assert.equal(read.physical_effect_replayed,false);assert.deepEqual(read.receipt,rows.intents[0].receipt);
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),/handoff_unbound/);assert.deepEqual(await q.stored(),rows);
    });
    await subtest('actual terminal transition retires composed routing before an unused AgentTools effect ticket can run',async()=>{
      const q=await joinedAgentFixture();
      await q.composition.operations.ADVANCE_EXECUTION({scope:q.reservation.scope,transition:q.x.ready()}, {...q.context,action:'ADVANCE_EXECUTION',requestId:randomUUID()});
      await assert.rejects(q.handoff.recheck(q.capability,q.context,q.invoke),/handoff_unbound/);
      await assert.rejects(q.handoff.publish(q.intent,{...q.context,action:'PUBLISH_RUN_CALLBACK_V1',requestId:randomUUID()}),/run_unbound/);
      assert.deepEqual(await q.stored(),{intents:[],events:[]});
    });
    await crashRestart();assert.equal(passed,95);
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-callback-publication.disposable-qa.v1',state:'PASS',
     postgres_system_identifier:cluster,postgres_version_num:identity.version,subtests:passed,
     native_and_owner_classification:'GENERATED_FIXTURES',publication_gate:'CLOSED',send_capability:false,authority_effect:false}));
    t.diagnostic('disposable_log='+log);
  }finally{
    for(const authority of authorities)authority.close();
    if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
    if(qualifiedData){
      assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-callback-publication-'));
      assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');
      await fs.rm(data,{recursive:true,force:false}); // Only this exact newly-created, verified stopped fixture.
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({schema:'metaengine.native-callback-publication.disposable-cleanup.v1',
       state:'STOPPED',postgres_system_identifier:cluster,postmaster_pid_file_absent:true,generated_data_removed:true,installed_keeper_used:false}));
    }
  }
});
