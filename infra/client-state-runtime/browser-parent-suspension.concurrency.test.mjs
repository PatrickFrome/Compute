// Native PG17 ONLY. Two independent, identity-checked reserved backends overlap
// actual SQL transactions. pg_blocking_pids proves the contender is waiting on
// the holder before COMMIT/ROLLBACK: wall-clock sleeps are not race evidence.
// Synthetic authority/heartbeat/child-completion setup is TEST ONLY; this does
// not qualify signed Host transport, installed clients, or arbitrary schedules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {qualifyFreshSchemaNative} from './test/fresh-schema-disposable.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const sha=value=>createHash('sha256').update(value).digest('hex');
const rpc=async(sql,name,args)=>(await sql.unsafe('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',
  args.map(value=>value&&typeof value==='object'?JSON.stringify(value):value)))[0].value;

test('native concurrency fixture rejects unsupported backend counts before allocating a cluster',async()=>{
  for(const exerciseBackends of [0,3,'2'])await assert.rejects(qualifyFreshSchemaNative({exerciseBackends,exercise:()=>{}}),/fresh_test_backend_count_invalid/);
  await assert.rejects(qualifyFreshSchemaNative({exerciseBackends:2}),/fresh_test_backend_count_invalid/);
});

test('two-backend qualification stays registered in local and native PG17 CI lanes',async()=>{
  const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
  for(const name of ['test','test:fresh-provider:pg17'])assert(pkg.scripts[name].split(' ').includes('browser-parent-suspension.concurrency.test.mjs'));
  const workflow=await readFile(new URL('../../.github/workflows/client-source-candidate-w59.yml',import.meta.url),'utf8');
  assert.match(workflow,/METAENGINE_PG_TEST_BIN=\/usr\/lib\/postgresql\/17\/bin/);
  assert.match(workflow,/"\$NODE_BIN" --test [^\n]*infra\/client-state-runtime\/browser-parent-suspension[.]concurrency[.]test[.]mjs/);
});

test('two-backend native fixture revokes both handles and removes owned cluster on callback failure',{
  skip:!bin||!driver?'Native PG17 binaries/driver absent: cleanup UNQUALIFIED':false,timeout:120000,
},async()=>{
  const intentional=Error('intentional_two_backend_callback_failure');
  let captured,directory;
  await assert.rejects(qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE,exerciseBackends:2,
    exercise:async({backends})=>{
      captured=backends;
      const rows=await Promise.all(backends.map(async({sql,pid})=>{
        const [row]=await sql.unsafe("select current_setting('data_directory') as directory,pg_backend_pid() as pid");
        assert.equal(Number(row.pid),pid);return row;
      }));
      assert.notEqual(rows[0].pid,rows[1].pid);assert.equal(rows[0].directory,rows[1].directory);
      directory=path.dirname(rows[0].directory);throw intentional;
    }}),error=>error===intentional);
  assert.equal(captured.length,2);
  for(const {sql} of captured)await assert.rejects(sql.unsafe('select 1'),/fresh_test_exercise_closed/);
  await assert.rejects(stat(directory),error=>error.code==='ENOENT');
});

async function overlap(holder,contender,firstAction,secondAction,{rollback=false}={}){
  const intentional=Error('intentional_concurrent_holder_rollback');
  let first,second,pending,contenderTransactionId,lockEvidence,blocked=false,settled=false;
  try{
    await holder.sql.begin(async tx=>{
      first=await firstAction(tx);
      pending=contender.sql.begin(async connection=>{
        const [transaction]=await connection.unsafe('select pg_current_xact_id()::text as id');
        contenderTransactionId=transaction.id;return secondAction(connection);
      }).then(value=>({ok:true,value}),error=>({ok:false,error}));
      pending.then(()=>{settled=true;});
      const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const [row]=await tx.unsafe('select $1::int=any(pg_catalog.pg_blocking_pids($2::int)) as blocked',[holder.pid,contender.pid]);
        if(row.blocked){blocked=true;break;}
        assert.equal(settled,false,'contender completed without the required database lock overlap');
        await delay(5);
      }
      assert.equal(blocked,true,'PostgreSQL must attest a contender blocked by the independent holder backend');
      const [observed]=await tx.unsafe(`select pg_current_xact_id()::text as holder_transaction_id,
        pg_blocking_pids($1::int) as blocking_pids,
        (select jsonb_agg(jsonb_build_object('locktype',locktype,'mode',mode,'granted',granted,
          'transactionid',transactionid::text,'classid',classid,'objid',objid,'objsubid',objsubid))
          from pg_catalog.pg_locks where pid=$1::int and not granted) as waiting_locks`,[contender.pid]);
      assert(observed.blocking_pids.includes(holder.pid));assert(observed.waiting_locks?.length>0);
      lockEvidence={holder_backend_pid:holder.pid,contender_backend_pid:contender.pid,contender_transaction_id:contenderTransactionId,...observed};
      if(rollback)throw intentional;
    });
  }catch(error){if(error!==intentional)throw error;}
  finally{if(pending)second=await pending;}
  assert.equal(blocked,true);
  const [released]=await holder.sql.unsafe('select pg_xact_status($1::xid8) as holder_transaction_status,pg_blocking_pids($2::int) as remaining_blockers,pg_xact_status($3::xid8) as contender_transaction_status',
    [lockEvidence.holder_transaction_id,contender.pid,contenderTransactionId]);
  assert.equal(released.holder_transaction_status,rollback?'aborted':'committed');assert.equal(released.remaining_blockers.length,0);
  assert.equal(released.contender_transaction_status,second.ok?'committed':'aborted');
  return {first,second,lockEvidence:{...lockEvidence,...released}};
}

async function seed(sql){
  const workspace=randomUUID(),device=randomUUID(),project=randomUUID(),sid=randomUUID();
  const client='concurrency-'+randomUUID(),base='a'.repeat(40),fp='d'.repeat(64),pairing=sha(randomUUID()),url='https://chatgpt.com/c/'+randomUUID();
  const agent={agent_id:'agent_'+randomUUID(),ownership:'FLEET_OWNED',lifecycle_state:'ACTIVE',authority_effect:false,
    automatic_retry_allowed:false,role:'RESEARCHER',tab_id:'tab_'+randomUUID(),target_id:'webcontents:1',generation_epoch:4};
  const heartbeat=async(connection=sql)=>{
    agent.transport_proof={schema:'metaengine.browser.fleet-transport-proof.v1',authority_effect:false,tab_id:agent.tab_id,target_id:agent.target_id,
      generation_epoch:agent.generation_epoch,conversation_url_sha256:sha(url),agent_surface_sha256:'e'.repeat(64),proven_at:new Date().toISOString()};
    const state={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',
      transport_identity:{profile:'A2_DEVICE_HTTP_SIGNATURE_V1',device_id:device,key_fingerprint_sha256:fp,access_tier:'ADMIN',admin_grant_epoch:1,admin_ready:true},
      supervisor_lifecycle:{continuous_service:{enabled:true},actuation_enabled:true,keepalive:{state:'READY'}},
      fleet:{schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',agents:[agent]}};
    await connection.unsafe('insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state,authority_effect) values($1,$2,clock_timestamp(),$3::jsonb,true) on conflict(client_id) do update set state=excluded.state,last_seen_at=excluded.last_seen_at',[client,workspace,JSON.stringify(state)]);
  };
  await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values($1)',[pairing]);
  await sql.unsafe(`insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash,access_tier,admin_grant_epoch,admin_scopes)
    values($1,$2,'{"kty":"EC","crv":"P-256","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}',$3,$4,'ADMIN',1,'["CONTROL_PLANE","DEVOS"]')`,[device,client,fp,pairing]);
  await heartbeat();
  const enqueue=async point=>(await rpc(sql,'devos_fleet_enqueue_v1',[workspace,point,'RESEARCHER',base,{objective:'Synthetic concurrency fixture only',claim_class:'READ_ONLY'},point,null,50])).task_id;
  const parent=await enqueue('concurrency.parent'),child=await enqueue('concurrency.child');
  await sql.unsafe('insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal) values($1,$2,$3,$4,$5,$6,1,$7)',[project,workspace,randomUUID(),parent,device,client,'Synthetic concurrency fixture only']);
  await sql.unsafe('insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth) values($1,$2,1,$1,null,0),($3,$2,2,$1,$1,1)',[parent,project,child]);
  const lease=await rpc(sql,'devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id,4,900]);
  assert.equal(lease.task_id,parent);assert.equal(lease.lease_generation,1);
  await sql.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='RUNNING' where task_id=$1",[parent]);
  const claim=lease.claim_id;
  await sql.unsafe('insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,refill_enabled,supervisor_admission_enabled) values($1,true,true) on conflict(workspace_id) do update set refill_enabled=true,supervisor_admission_enabled=true',[workspace]);
  await sql.unsafe("select destruktion_meta.devos_emit_event_h205f22($1,'TASK_TRANSPORT_PROVEN',$2,'concurrency.parent','RESEARCHER',$3,1,$4,$5::jsonb,$6)",[workspace,parent,agent.agent_id,base,JSON.stringify({conversation_url_sha256:sha(url),agent_surface_sha256:'e'.repeat(64)}),'fixture-origin:'+parent]);
  const checkpoint={schema:'metaengine.browser.parent-checkpoint.v1',conversation_url:url,conversation_url_sha256:sha(url),transcript_floor:10,
    transcript_total_chars:20,transcript_sha256:sha('synthetic transcript'),agent_surface_sha256:'e'.repeat(64),confirmed_turn_sha256:sha('confirmed receipt fixture'),
    delivered_tool_results:[],observed_at:new Date().toISOString(),tab_id:agent.tab_id,target_id:agent.target_id,agent_id:agent.agent_id,
    agent_generation_epoch:4,control_generation:0,worktree_custody:null};
  const suspend=(connection=sql,id=sid)=>rpc(connection,'h205f22_project_suspend_browser_v1',[workspace,project,parent,claim,1,id,checkpoint,device,client,1]);
  let restoration;
  const prepareResume=async()=>{
    const suspended=await suspend();
    // Fixture-only child completion; no claim/suspension/resume guards are disabled.
    await sql.begin(async tx=>{
      await tx.unsafe('alter table destruktion_meta.devos_fleet_task_h205f22 disable trigger user');
      await tx.unsafe("update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED' where task_id=$1",[child]);
      await tx.unsafe('alter table destruktion_meta.devos_fleet_task_h205f22 enable trigger user');
    });
    agent.browser_parent_restoration={schema:'metaengine.browser.parent-restoration-reservation.v1',suspension_id:sid,task_id:parent,
      checkpoint_sha256:suspended.checkpoint_sha256,authority_effect:false,automatic_retry_allowed:false};
    agent.generation_epoch=5;agent.tab_id='tab_'+randomUUID();agent.target_id='webcontents:2';await heartbeat();
    restoration={schema:'metaengine.devos.browser-parent-restoration.v1',checkpoint_sha256:suspended.checkpoint_sha256,conversation_url:url,
      conversation_url_sha256:sha(url),transcript_floor:10,transcript_total_chars:20,transcript_sha256:checkpoint.transcript_sha256,
      agent_surface_sha256:checkpoint.agent_surface_sha256,observed_at:new Date().toISOString(),agent_id:agent.agent_id,
      tab_id:agent.tab_id,target_id:agent.target_id,agent_generation_epoch:5,control_generation:0};
  };
  const resume=(connection=sql)=>rpc(connection,'h205f22_project_resume_browser_v1',[workspace,sid,restoration,device,client,1]);
  const read=async()=>{
    const [row]=await sql.unsafe(`select t.state,t.lease_generation::int as generation,
      (select count(*)::int from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and state='ACTIVE') as active_claims,
      (select count(*)::int from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id) as total_claims,
      (select count(*)::int from destruktion_meta.browser_parent_suspension_h205f22 where task_id=t.task_id) as suspensions,
      (select status from destruktion_meta.browser_parent_suspension_h205f22 where task_id=t.task_id) as suspension_status,
      (select count(*)::int from destruktion_meta.project_event_h205f22 where task_id=t.task_id and event_type='BROWSER_PARENT_SUSPENDED') as suspend_events,
      (select count(*)::int from destruktion_meta.project_event_h205f22 where task_id=t.task_id and event_type='BROWSER_PARENT_RESUMED') as resume_events
      from destruktion_meta.devos_fleet_task_h205f22 t where task_id=$1`,[parent]);
    return row;
  };
  const allocate=(connection=sql)=>rpc(connection,'devos_fleet_lease_v1',[workspace,agent.agent_id,agent.role,agent.tab_id,agent.target_id,agent.generation_epoch,900]);
  return {workspace,parent,child,agent,heartbeat,suspend,prepareResume,resume,allocate,read};
}

function assertSuspended(row,{generation=1}={}){
  assert.deepEqual({...row},{state:'SUSPENDED',generation,active_claims:0,total_claims:1,suspensions:1,suspension_status:'SUSPENDED',suspend_events:1,resume_events:0});
}
function assertResumed(row){
  assert.deepEqual({...row},{state:'RUNNING',generation:2,active_claims:1,total_claims:2,suspensions:1,suspension_status:'RESUMED',suspend_events:1,resume_events:1});
}
function requireSuccess(result){if(!result.ok)throw result.error;return result.value;}

test('browser suspension/resume native PG17: two-backend lock-observed concurrency and fencing',{
  skip:!bin||!driver?'Native PG17 binaries/driver absent: concurrency UNQUALIFIED':false,timeout:240000,
},async t=>{
  let captured;
  const cases=[],lockEvidence=[];
  const race=async(...args)=>{const result=await overlap(...args);lockEvidence.push(result.lockEvidence);return result;};
  const receipt=await qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE,exerciseBackends:2,
    exercise:async({sql,backends,engine,parallel_backends})=>{
      assert.equal(engine,'NATIVE_PG17');assert.equal(parallel_backends,2);assert.equal(backends.length,2);
      const [a,b]=backends;assert.notEqual(a.pid,b.pid);captured=b.sql;
      for(const backend of backends)await backend.sql.unsafe("set statement_timeout='15s'");
      const scenario=async(name,body)=>{await t.test(name,async()=>{
        const before=lockEvidence.length;await body(await seed(sql),a,b);assert.equal(lockEvidence.length,before+1);
        lockEvidence.at(-1).case=name;cases.push(name);
      });};
      await scenario('simultaneous same-intent suspension is exactly-once with replay',async(f,a,b)=>{
        const result=await race(a,b,tx=>f.suspend(tx),tx=>f.suspend(tx));
        assert.equal(result.first.replayed,false);assert.equal(requireSuccess(result.second).replayed,true);assertSuspended(await f.read());
      });
      await scenario('simultaneous conflicting suspension intent is rejected without a second row',async(f,a,b)=>{
        const other=randomUUID();const result=await race(a,b,tx=>f.suspend(tx),tx=>f.suspend(tx,other));
        assert.equal(result.second.ok,false);assert.match(result.second.error.message,/PRIOR_INTENT/);assertSuspended(await f.read());
      });
      await scenario('ordinary allocator cannot take the suspending parent physical custody',async(f,a,b)=>{
        const result=await race(a,b,tx=>f.suspend(tx),tx=>f.allocate(tx));
        const denied=requireSuccess(result.second);assert.equal(denied.leased,false);assert.equal(denied.wait_reason,'BROWSER_PHYSICAL_CUSTODY_HELD');
        assertSuspended(await f.read());
        const [child]=await a.sql.unsafe('select state,lease_generation::int as generation from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[f.child]);
        assert.deepEqual({...child},{state:'READY',generation:0});
      });
      await scenario('rolled-back suspension lets the blocked contender commit the only certificate',async(f,a,b)=>{
        const result=await race(a,b,tx=>f.suspend(tx),tx=>f.suspend(tx),{rollback:true});
        assert.equal(requireSuccess(result.second).replayed,false);assertSuspended(await f.read());
      });
      await scenario('simultaneous resume produces one new generation and one active claim',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>f.resume(tx),tx=>f.resume(tx));
        const replay=requireSuccess(result.second);assert.equal(result.first.replayed,false);assert.equal(replay.replayed,true);
        assert.equal(replay.lease.claim_id,result.first.lease.claim_id);assert.equal(replay.lease.lease_generation,2);assertResumed(await f.read());
      });
      await scenario('ordinary allocator cannot duplicate the concurrently resumed parent claim',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>f.resume(tx),tx=>f.allocate(tx));
        const denied=requireSuccess(result.second);assert.equal(denied.leased,false);assert.equal(denied.wait_reason,'BROWSER_PARENT_RESTORATION_RESERVED');
        assertResumed(await f.read());
      });
      await scenario('rolled-back resume does not leak its claim or generation to the contender',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>f.resume(tx),tx=>f.resume(tx),{rollback:true});
        const committed=requireSuccess(result.second);assert.equal(committed.replayed,false);assert.equal(committed.lease.lease_generation,2);
        assert.notEqual(committed.lease.claim_id,result.first.lease.claim_id);assertResumed(await f.read());
      });
      await scenario('owner-stop commit fences an already-running blocked resume',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>tx.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=false,supervisor_admission_enabled=false where workspace_id=$1',[f.workspace]),tx=>f.resume(tx));
        assert.equal(result.second.ok,false);assert.match(result.second.error.message,/BROWSER_RESUME_OWNER_FENCED/);assertSuspended(await f.read());
      });
      await scenario('owner-stop waits for admitted resume then fences replay without another claim',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>f.resume(tx),tx=>tx.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=false,supervisor_admission_enabled=false where workspace_id=$1',[f.workspace]));
        requireSuccess(result.second);assert.equal(result.first.replayed,false);assertResumed(await f.read());
        await assert.rejects(f.resume(),/BROWSER_RESUME_OWNER_FENCED/);assertResumed(await f.read());
      });
      await scenario('control-generation commit fences an already-running blocked resume',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>tx.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set generation_floor=generation_floor+1 where workspace_id=$1',[f.workspace]),tx=>f.resume(tx));
        assert.equal(result.second.ok,false);assert.match(result.second.error.message,/BROWSER_RESUME_OWNER_FENCED/);assertSuspended(await f.read());
      });
      await scenario('lease-generation commit fences resume after its task-row wait',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,tx=>tx.unsafe('update destruktion_meta.devos_fleet_task_h205f22 set lease_generation=lease_generation+1 where task_id=$1',[f.parent]),tx=>f.resume(tx));
        assert.equal(result.second.ok,false);assert.match(result.second.error.message,/BROWSER_RESUME_TASK_FENCED/);assertSuspended(await f.read(),{generation:2});
      });
      await scenario('late transport denial rolls back the in-function generation increment and claim',async(f,a,b)=>{
        await f.prepareResume();const result=await race(a,b,async tx=>{
          await tx.unsafe('select 1 from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id=$1 for update',[f.workspace]);
          f.agent.lifecycle_state='SUSPENDED';await f.heartbeat(tx);
        },tx=>f.resume(tx));
        assert.equal(result.second.ok,false);assert.match(result.second.error.message,/devos_transport_agent_not_active/);assertSuspended(await f.read());
      });
      assert.equal(cases.length,12);
      return {status:'NATIVE_PG17_TWO_BACKEND_CONCURRENCY_ASSERTIONS_PASSED',engine,parallel_backends,lock_overlap_observed_cases:cases.length,cases,lock_evidence:lockEvidence,
        concurrency_scope:'LISTED_DATABASE_INTERLEAVINGS_ONLY',synthetic_authority_fixture:true,synthetic_owner_stop_row_update:true,
        signed_transport_qualified:false,installed_client_qualified:false,production_qualified:false};
    }});
  assert.equal(receipt.native_identity_verified,true);assert.equal(Math.floor(Number(receipt.postgres_version_num)/10000),17);
  assert.equal(receipt.test_exercise.lock_overlap_observed_cases,12);
  await assert.rejects(captured.unsafe('select 1'),/fresh_test_exercise_closed/);
  console.log(JSON.stringify(receipt.test_exercise));
});
