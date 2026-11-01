import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {nativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {createNativeInstalledPublicationSchemaVerifier} from './native-coding-installed-publication-schema.mjs';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool,bindNativeCodingPublicationTransactionPool} from './native-coding-preparation-transaction.mjs';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {provisionLocalApiLogin} from './db-api-grants.mjs';
import {inspectAttachedApiAdmission} from './attached-postgres-onboarding.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const SERIALIZABLE='isolation level serializable',READONLY='isolation level repeatable read read only';
const API_LOGIN='actual_installed_schema_api',FAIL=/native_installed_publication_schema_|native_migration_api_identity_unattested/;
const MIGRATION_BUSY=/native_workspace_transaction_publication_migration_busy/;
const LOCK="pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0)";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const within=async(promise,milliseconds=10000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('generated_qa_wait_timeout')),milliseconds);})]);}finally{clearTimeout(timer);}};
const callbacks=['native_coding_callback_publication_valid_v1(jsonb)','native_coding_callback_publication_guard_v1()',
 'native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb)','native_coding_callback_publication_read_v1(uuid,bigint,uuid)'];
const triggers=[['native_callback_publication_guard_v1','native_coding_execution_h205f22'],
 ['aa_native_execution_task_fence_v1','native_coding_execution_h205f22'],['aa_native_job_initial_anchor_v1','native_coding_job_registration_h205f22'],
 ['aa_native_claim_task_history_v1','devos_fleet_claim_h205f22'],['aa_native_running_anchor_v1','devos_fleet_task_h205f22']];

// Actual disposable PG17 and the full registered schema/provisioning path.
// Catalog mutation is confined to this newly created cluster; each negative
// transaction rolls back. This is source/SQL proof, never installed authority.
test('installed publication verifier on registered disposable PG17: read-only attest, exact transaction recheck and catalog fences',{
 skip:!bin||!driver,timeout:240000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-installed-publication-schema-')),data=path.join(directory,'pgdata');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},90000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);code===0&&!timedOut?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,qualified=false,systemIdentifier,owner,raw,api,controller,postgres,apiConnectionClosed;const pools=[],verifiers=new Set(),commands=[];
 const closeVerifier=async v=>{v.close();await v.drain();verifiers.delete(v);};
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
  started=true;await command('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  postgres=(await import(pathToFileURL(driver))).default;
  const config={host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,prepare:false,connect_timeout:5,idle_timeout:30,onnotice:()=>{},
   connection:{application_name:'METAENGINE_INSTALLED_SCHEMA_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}};
  controller=postgres(config);pools.push(controller);
  const monitor=createNativePreparationTransactions({debug:(_id,query)=>commands.push(query)});
  raw=postgres({...config,debug:monitor.debug,onclose:monitor.onclose});pools.push(raw);owner=bindNativeCodingPublicationTransactionPool(raw,monitor);
  const [identity]=await controller.unsafe(`select current_user::text as role,session_user::text as session,
   current_setting('server_version_num')::int as version,current_setting('data_directory') as directory,
   (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier`);
  assert.equal(identity.role,'state_owner');assert.equal(identity.session,'state_owner');assert.ok(identity.version>=170000&&identity.version<180000);
  assert.equal(path.resolve(identity.directory).toLowerCase(),path.resolve(data).toLowerCase());systemIdentifier=identity.system_identifier;qualified=true;
  const plan=await loadFreshSchemaApplicationPlan();
  await controller.begin(async tx=>{
   await tx.unsafe(plan.prerequisite_sql);for(const row of plan.statements)await tx.unsafe(row.sql);
   await applyLocalRuntimeMigrations({sql:{unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)},expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
  });
  await controller.begin(tx=>tx.unsafe(plan.post_upgrade_acl_sql));
  await provisionLocalApiLogin({sql:controller,databaseName:'postgres',login:API_LOGIN,password:'generated-disposable-only-'.repeat(3),roleMode:'direct'});
  api=postgres({...config,user:API_LOGIN,max:1,onclose:()=>apiConnectionClosed?.resolve()});pools.push(api);await inspectAttachedApiAdmission({sql:api,apiLogin:API_LOGIN});
  await controller.unsafe('create role installed_schema_foreign_probe login noinherit');
  const make=(options={})=>{
   const lifetime=new AbortController();let current=true;
   const verifier=createNativeInstalledPublicationSchemaVerifier({ownerSql:owner,apiSql:api,apiLogin:API_LOGIN,
    signal:lifetime.signal,assertCurrent(){if(!current)throw Error('generated_host_generation_lost');},...options});
   verifiers.add(verifier);return {verifier,lifetime,loseGeneration(){current=false;}};
  };
  const run=(name,body)=>t.test(name,body);
  const withVerifier=async body=>{const f=make();try{await body(f);}finally{await closeVerifier(f.verifier);}};
  const fingerprint=async()=>(await controller.unsafe(`select md5(jsonb_build_object(
   'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','destruktion_meta') and (p.proname like 'native_coding_%' or p.proname in ('native_execution_task_fence_v1','native_job_initial_anchor_v1','native_claim_task_history_v1','native_running_anchor_v1'))),
   'relations',(select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='destruktion_meta'),
   'attributes',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='destruktion_meta'),
   'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid=c.connamespace where n.nspname='destruktion_meta'),
   'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='destruktion_meta'))::text) as sha`))[0].sha;
  await run('attest uses one monitored REPEATABLE READ READ ONLY and returns no transferable readiness marker',()=>withVerifier(async({verifier})=>{
   const before=await fingerprint(),start=commands.length;assert.equal(await verifier.attest(),undefined);
   const emitted=commands.slice(start);assert.equal(emitted.filter(q=>q.startsWith('begin '+READONLY)).length,1);
   assert.equal(emitted.filter(q=>q.startsWith('begin ')).length,1);
   assert.ok(emitted.findIndex(q=>q.includes('pg_try_advisory_lock_shared('))<emitted.findIndex(q=>q.startsWith('begin ')));
   assert.ok(emitted.findIndex(q=>q.includes('pg_advisory_unlock_shared('))>emitted.findIndex(q=>q==='commit'));
   assert.equal(emitted.filter(q=>q.includes('pg_try_advisory_lock_shared(')).length,1);
   assert.equal(emitted.filter(q=>q.includes('pg_advisory_unlock_shared(')).length,1);
   assert.ok(emitted.every(q=>/^(?:select\b|begin\b|commit\b|rollback\b)/i.test(q.trim())), 'attestation cannot run DDL, migration DO blocks or DML');
   assert.equal(await fingerprint(),before);
   assert.equal((await api.unsafe("select pg_catalog.to_regclass('pg_temp.native_callback_migration_api_identity_v1') is null as absent"))[0].absent,true);
  }));
  await run('recheck reads original live SERIALIZABLE transaction without any nested BEGIN or catalog mutation',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const before=await fingerprint();
   for(let i=0;i<2;i++)await owner.begin(SERIALIZABLE,async tx=>{
    const start=commands.length;assert.equal(await verifier.recheck(tx),undefined);assert.equal(commands.slice(start).filter(q=>q.startsWith('begin ')).length,0);
   });assert.equal(await fingerprint(),before);
  }));
  for(const kind of ['plain','cloned','wrong-mode','foreign-pool','finished'])await run(kind+' transaction object cannot recheck',()=>withVerifier(async({verifier})=>{
   await verifier.attest();
   if(kind==='plain')await assert.rejects(verifier.recheck({unsafe:owner.unsafe.bind(owner)}),/native_workspace_transaction_scope_unbound/);
   else if(kind==='cloned')await owner.begin(SERIALIZABLE,tx=>assert.rejects(verifier.recheck({...tx}),/native_workspace_transaction_scope_unbound/));
   else if(kind==='wrong-mode')await owner.begin(READONLY,tx=>assert.rejects(verifier.recheck(tx),/native_workspace_transaction_scope_unbound/));
   else if(kind==='foreign-pool'){
    const otherMonitor=createNativePreparationTransactions(),otherRaw=postgres({...config,debug:otherMonitor.debug,onclose:otherMonitor.onclose});pools.push(otherRaw);
    const other=bindNativeCodingPublicationTransactionPool(otherRaw,otherMonitor);await other.begin(SERIALIZABLE,tx=>assert.rejects(verifier.recheck(tx),/native_workspace_transaction_scope_unbound/));
   }else{let retained;await owner.begin(SERIALIZABLE,async tx=>{retained=tx;});await assert.rejects(verifier.recheck(retained),/native_workspace_transaction_finished/);}
  }));
  await run('unattested verifier cannot recheck an otherwise genuine transaction',()=>withVerifier(async({verifier})=>{
   await owner.begin(SERIALIZABLE,tx=>assert.rejects(verifier.recheck(tx),FAIL));
  }));
  await run('wrong authenticated API connection cannot attest by naming the restricted principal',async()=>{
   const f=make({apiSql:controller});try{await assert.rejects(f.verifier.attest(),FAIL);}finally{await closeVerifier(f.verifier);}
  });
  await run('ordinary monitored facade is not publication-fenced custody',async()=>{
   const regular=bindNativeCodingTransactionPool(raw,monitor),f=make({ownerSql:regular});
   try{await assert.rejects(f.verifier.attest(),/native_workspace_transaction_publication_scope_unbound/);}finally{await closeVerifier(f.verifier);}
  });
  await run('canonical migration exclusive lock rejects attest before BEGIN without waiting or entering consumer scope',async()=>{
   await controller.begin(async held=>{
    await held.unsafe('select pg_catalog.pg_advisory_xact_lock('+LOCK+')');
    const f=make();try{const started=performance.now(),start=commands.length;
     await assert.rejects(f.verifier.attest(),MIGRATION_BUSY);assert.ok(performance.now()-started<5000);
     assert.equal(commands.slice(start).some(q=>q.startsWith('begin ')),false);
     let entered=false;await assert.rejects(owner.begin(SERIALIZABLE,async()=>{entered=true;}),MIGRATION_BUSY);assert.equal(entered,false);
    }finally{await closeVerifier(f.verifier);}
   });
  });
  for(const mode of [SERIALIZABLE,READONLY])for(const loseRollback of [false,true])await run('lost genuine BEGIN acknowledgement '+(loseRollback?'and ROLLBACK acknowledgement quarantine original session':'requires rollback before publication unlock/release')+': '+mode,async sub=>{
   let reservation,pid,bodies=0,releases=0,injected=false,rollbackInjected=false;const seen=[];
   const faultMonitor=createNativePreparationTransactions({debug:(_id,query)=>seen.push(query)});
   const faultRaw=postgres({...config,max:1,debug:faultMonitor.debug,onclose:faultMonitor.onclose});pools.push(faultRaw);
   const wrapped=new Proxy(faultRaw,{get(target,key,receiver){
    if(key==='reserve')return async()=>{
     reservation=await faultRaw.reserve();pid=(await reservation.unsafe('select pg_catalog.pg_backend_pid() as pid'))[0].pid;
     return new Proxy(reservation,{get(r,k,recv){
      if(k==='unsafe')return async(query,args)=>{const result=await reservation.unsafe(query,args);
       // Genuine PG already accepted BEGIN. Lose only that acknowledgement,
       // without pretending the physical connection is dead or retrying work.
       if(!injected&&query.startsWith('begin '+mode)){injected=true;throw Error('generated_begin_ack_lost');}
       if(loseRollback&&query==='rollback'){rollbackInjected=true;throw Error('generated_rollback_ack_lost');}return result;};
      if(k==='release')return()=>{releases++;return reservation.release();};
      return Reflect.get(r,k,recv);
     }});
    };return Reflect.get(target,key,receiver);
   }});
   const fenced=bindNativeCodingPublicationTransactionPool(wrapped,faultMonitor);
   try{
    await assert.rejects(fenced.begin(mode,async()=>{bodies++;}),error=>loseRollback?nativePhysicalSettlementUnconfirmed(error):error.message==='native_workspace_transaction_query_failed'&&!nativePhysicalSettlementUnconfirmed(error));
    assert.equal(bodies,0);assert.equal(injected,true);
    const [activity]=await controller.unsafe('select pid,state,xact_start is not null as transaction_open from pg_catalog.pg_stat_activity where pid=$1',[pid]);
    let exclusive;await controller.begin(async tx=>{exclusive=(await tx.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked;});
    sub.diagnostic(JSON.stringify({generated_backend:pid,bodies,releases,state:activity?.state,transaction_open:activity?.transaction_open,
     rollback_sent:seen.includes('rollback'),rollback_ack_lost:rollbackInjected,unlock_sent:seen.some(q=>q.includes('pg_advisory_unlock_shared(')),exclusive_migration_available:exclusive}));
    assert.equal(activity?.transaction_open,false,'never return an unacknowledged but active BEGIN transaction to the pool');
    assert.ok(seen.indexOf('rollback')>=0,'dispatch original-reservation rollback after attempted BEGIN');
    if(loseRollback){
     assert.equal(rollbackInjected,true);assert.equal(releases,0);assert.equal(exclusive,false,'unknown ROLLBACK acknowledgement retains original session migration fence');
     assert.equal(seen.some(q=>q.includes('pg_advisory_unlock_shared(')),false);const count=seen.length;
     await assert.rejects(fenced.begin(mode,async()=>{bodies++;}),error=>nativePhysicalSettlementUnconfirmed(error)&&error.message==='native_workspace_transaction_rollback_unconfirmed');
     assert.equal(seen.length,count,'poisoned monitor cannot reacquire or retry');assert.equal(bodies,0);
    }else{assert.equal(releases,1);assert.equal(exclusive,true);
     assert.ok(seen.indexOf('rollback')<seen.findIndex(q=>q.includes('pg_advisory_unlock_shared(')),'confirmed rollback must precede session unlock');
    }
   }finally{
    // Failure-reproduction cleanup is confined to this generated max:1 pool.
    // Never reuse or signal an installed/shared production connection.
    if(releases)await faultRaw.unsafe('rollback');else await faultRaw.end({timeout:1});
   }
   if(loseRollback){
    await within((async()=>{while((await controller.unsafe('select exists(select 1 from pg_catalog.pg_stat_activity where pid=$1) as alive',[pid]))[0].alive)await new Promise(resolve=>setTimeout(resolve,10));})());
    await controller.begin(async tx=>assert.equal((await tx.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,true));
    assert.equal(releases,0,'exact generated pool teardown, never a manual reservation release, removes quarantined session');
   }
  });
  await run('pre-BEGIN session fence prevents intervening canonical migration and used snapshots still cannot authorize first recheck',()=>withVerifier(async({verifier})=>{
   await verifier.attest();await owner.begin(SERIALIZABLE,async tx=>{
    await tx.unsafe("select count(*) from pg_catalog.pg_trigger where tgname='aa_native_execution_task_fence_v1'");
    await controller.begin(async migration=>assert.equal((await migration.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,false));
    await assert.rejects(verifier.recheck(tx),/native_workspace_transaction_scope_snapshot_already_used/);
   });
  }));
  await run('recheck shared migration lock lives through the exact original transaction end',()=>withVerifier(async({verifier})=>{
   await verifier.attest();await owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx);await controller.begin(async other=>assert.equal((await other.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,false));
   });await controller.begin(async other=>assert.equal((await other.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,true));
  }));
  const mutation=async(name,change)=>run(name+' is observed and refused in the original transaction, not repaired',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const before=await fingerprint();await assert.rejects(owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx); // Repeat within the same original guarded transaction to observe its DDL.
    if(typeof change==='function')await change(tx);else await tx.unsafe(change);await verifier.recheck(tx);
   }),FAIL);assert.equal(await fingerprint(),before);
  }));
  for(const [trigger,table] of triggers){
   await mutation('disabled '+trigger,'alter table destruktion_meta.'+table+' disable trigger '+trigger);
   await mutation('missing '+trigger,'drop trigger '+trigger+' on destruktion_meta.'+table);
  }
  for(const signature of callbacks)await mutation('missing '+signature,'drop function destruktion_meta.'+signature+' cascade');
  for(const [name,change] of [
   ['missing mandatory anchor','alter table destruktion_meta.native_coding_execution_h205f22 drop column callback_publication cascade'],
   ['anchor default',"alter table destruktion_meta.native_coding_execution_h205f22 alter column callback_publication set default '{}'::jsonb"],
   ['anchor NOT NULL','alter table destruktion_meta.native_coding_execution_h205f22 alter column callback_publication set not null'],
   ['missing task uniqueness','alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_execution_one_task_v1'],
   ['deferrable task uniqueness','alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_execution_one_task_v1; alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_execution_one_task_v1 unique(task_id) deferrable'],
   ['wrong task uniqueness columns','alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_execution_one_task_v1; alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_execution_one_task_v1 unique(task_id,lease_generation)'],
   ['changed anchor check','alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_callback_publication_shape_v1; alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_callback_publication_shape_v1 check(callback_publication is null)'],
   ['unvalidated anchor check','alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_callback_publication_shape_v1; alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_callback_publication_shape_v1 check(destruktion_meta.native_coding_callback_publication_valid_v1(callback_publication)) not valid'],
   ['execution RLS disabled','alter table destruktion_meta.native_coding_execution_h205f22 disable row level security'],
   ['execution FORCE RLS','alter table destruktion_meta.native_coding_execution_h205f22 force row level security'],
   ['execution foreign table ACL','grant select on destruktion_meta.native_coding_execution_h205f22 to installed_schema_foreign_probe'],
   ['execution foreign column ACL','grant select(callback_publication) on destruktion_meta.native_coding_execution_h205f22 to installed_schema_foreign_probe'],
   ['execution policy','create policy installed_schema_probe on destruktion_meta.native_coding_execution_h205f22 using(true)'],
   ['private callback PUBLIC execution','grant execute on function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) to public'],
   ['private callback API execution','grant execute on function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) to '+API_LOGIN],
   ['fence function security definer','alter function destruktion_meta.native_execution_task_fence_v1() security definer'],
   ['callback search_path','alter function destruktion_meta.native_coding_callback_publication_guard_v1() set search_path=public,pg_catalog'],
   ['callback volatility','alter function destruktion_meta.native_coding_callback_publication_valid_v1(jsonb) volatile'],
   ['callback function owner','alter function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) owner to installed_schema_foreign_probe'],
   ['API context direct grant removed','revoke execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) from '+API_LOGIN],
   ['API context foreign grant','grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to installed_schema_foreign_probe'],
   ['API context grant option','grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to '+API_LOGIN+' with grant option'],
   ['API role membership','grant service_role to '+API_LOGIN],
   ['API role inbound membership','grant '+API_LOGIN+' to installed_schema_foreign_probe'],
   ['API role inheritance','alter role '+API_LOGIN+' inherit'],
   ['API role createdb','alter role '+API_LOGIN+' createdb'],
  ])await mutation(name,change);
  await mutation('tampered callback body',tx=>tx.unsafe(`create or replace function destruktion_meta.native_coding_callback_publication_valid_v1(v jsonb)
   returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,destruktion_meta as $$begin return true;end $$`));
  await mutation('tampered task fence body',tx=>tx.unsafe(`create or replace function destruktion_meta.native_execution_task_fence_v1()
   returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$begin return new;end $$`));
  await mutation('changed callback trigger predicate',async tx=>{
   await tx.unsafe('drop trigger native_callback_publication_guard_v1 on destruktion_meta.native_coding_execution_h205f22');
   await tx.unsafe('create trigger native_callback_publication_guard_v1 before insert or update or delete on destruktion_meta.native_coding_execution_h205f22 for each row when (true) execute function destruktion_meta.native_coding_callback_publication_guard_v1()');
  });
  await mutation('changed callback trigger arguments',async tx=>{
   await tx.unsafe('drop trigger native_callback_publication_guard_v1 on destruktion_meta.native_coding_execution_h205f22');
   await tx.unsafe("create trigger native_callback_publication_guard_v1 before insert or update or delete on destruktion_meta.native_coding_execution_h205f22 for each row execute function destruktion_meta.native_coding_callback_publication_guard_v1('unexpected')");
  });
  await run('duplicate historical generations are refused without deletion or repair before original rollback',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const before=await fingerprint();
   await assert.rejects(owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx);
    await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_execution_one_task_v1');
    // Seed impossible legacy history only in this generated cluster/transaction.
    // Restore both fixture-only trigger suspensions before the actual recheck.
    for(const name of ['aa_native_execution_task_fence_v1','native_coding_execution_worktree_fence_trg'])
     await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 disable trigger '+name);
    await tx.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key)
     values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','generated-history','IMPLEMENTER',repeat('a',40),'{}',repeat('b',64),'generated-installed-schema-duplicate-history')`);
    await tx.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22(workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256)
     select '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',n,gen_random_uuid(),'fixture-agent','codex-cli:33333333-3333-4333-8333-333333333333',1,'pid:1:created_100ns:134000000000000000',repeat('a',64) from generate_series(1,2)n`);
    for(const name of ['aa_native_execution_task_fence_v1','native_coding_execution_worktree_fence_trg'])
     await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 enable trigger '+name);
    const rows=async()=>(await tx.unsafe("select jsonb_agg(to_jsonb(e) order by lease_generation) as rows from destruktion_meta.native_coding_execution_h205f22 e where task_id='11111111-1111-4111-8111-111111111111'"))[0].rows;
    const history=await rows();assert.equal(history.length,2);
    await assert.rejects(verifier.recheck(tx),/native_installed_publication_schema_duplicate_history/);
    assert.deepEqual(await rows(),history,'both original evidence rows remain unchanged until original rollback');
    throw Error('generated_history_rollback');
   }),/generated_history_rollback/);
   assert.equal(await fingerprint(),before);
   assert.equal((await controller.unsafe('select count(*)::int as n from destruktion_meta.native_coding_execution_h205f22'))[0].n,0);
  }));
  await run('original transaction replication-role bypass is refused without resetting or repairing that session',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const before=await fingerprint();await assert.rejects(owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx);await tx.unsafe("set local session_replication_role='replica'");
    await assert.rejects(verifier.recheck(tx),/native_installed_publication_schema_postgres_identity/);
    assert.equal((await tx.unsafe("select pg_catalog.current_setting('session_replication_role') as role"))[0].role,'replica');
    throw Error('generated_session_rollback');
   }),/generated_session_rollback/);assert.equal(await fingerprint(),before);
  }));
  await run('original transaction current-role substitution fails genuine owner identity without automatic role reset',()=>withVerifier(async({verifier})=>{
   await verifier.attest();await assert.rejects(owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx);await tx.unsafe('set local role installed_schema_foreign_probe');
    await assert.rejects(verifier.recheck(tx),/native_migration_api_identity_unattested/);
    assert.equal((await tx.unsafe('select current_user::text as role'))[0].role,'installed_schema_foreign_probe');
    throw Error('generated_session_rollback');
   }),/generated_session_rollback/);
  }));
  await run('temporary catalog shadows cannot replace qualified installed observations or conceal a missing trigger',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const before=await fingerprint();await assert.rejects(owner.begin(SERIALIZABLE,async tx=>{
    await verifier.recheck(tx);
    for(const name of ['pg_proc','pg_class','pg_roles','pg_trigger'])await tx.unsafe('create temp table '+name+'(forged_ready boolean) on commit drop');
    assert.equal((await tx.unsafe("select pg_catalog.to_regclass('pg_proc')=pg_catalog.to_regclass('pg_temp.pg_proc') as shadowed"))[0].shadowed,true);
    assert.equal(await verifier.recheck(tx),undefined,'genuine installed catalogs remain visible despite temp-name shadows');
    await tx.unsafe('drop trigger aa_native_execution_task_fence_v1 on destruktion_meta.native_coding_execution_h205f22');
    await assert.rejects(verifier.recheck(tx),/native_installed_publication_schema_trigger/);
    throw Error('generated_shadow_rollback');
   }),/generated_shadow_rollback/);assert.equal(await fingerprint(),before);
  }));
  await run('fully committed missing protection is rejected at fresh attest without migration or repair',async()=>{
   const [saved]=await controller.unsafe("select pg_catalog.pg_get_triggerdef(oid) as ddl from pg_catalog.pg_trigger where tgrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and tgname='aa_native_execution_task_fence_v1'");
   await controller.unsafe('drop trigger aa_native_execution_task_fence_v1 on destruktion_meta.native_coding_execution_h205f22');
   try{const before=await fingerprint();await withVerifier(async({verifier})=>{await assert.rejects(verifier.attest(),FAIL);});assert.equal(await fingerprint(),before);}
   finally{await controller.unsafe(saved.ddl);}
  });
  for(const stop of ['close','abort','generation'])await run(stop+' invalidates original verifier without closing the shared PostgreSQL pools',()=>withVerifier(async f=>{
   await f.verifier.attest();if(stop==='close')f.verifier.close();else if(stop==='abort')f.lifetime.abort();else f.loseGeneration();
   await owner.begin(SERIALIZABLE,tx=>assert.rejects(f.verifier.recheck(tx),FAIL));
   assert.equal((await controller.unsafe('select 1::int as n'))[0].n,1);assert.equal((await api.unsafe('select 1::int as n'))[0].n,1);
  }));
  for(const stop of ['close','abort'])await run(stop+' while a real catalog SELECT result is held joins original read and rollback',async()=>{
   const entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
   const heldMonitor=createNativePreparationTransactions(),heldRaw=postgres({...config,max:1,debug:heldMonitor.debug,onclose:heldMonitor.onclose});pools.push(heldRaw);
   // Fault injection holds only delivery of one completed, genuine catalog
   // SELECT. The exact monitor/pool/transaction identities remain unchanged.
   const wrapped=new Proxy(heldRaw,{get(target,key,receiver){
    if(key==='reserve')return async()=>{const reserved=await heldRaw.reserve();return new Proxy(reserved,{get(r,k,recv){
     if(k==='unsafe')return async(query,args)=>{const result=await reserved.unsafe(query,args);
      if(!held&&query.includes('pg_catalog.pg_proc')&&query.includes('jsonb_array_elements')){held=true;entered.resolve();await release.promise;}return result;};
     return Reflect.get(r,k,recv);
    }});};return Reflect.get(target,key,receiver);
   }});
   const heldOwner=bindNativeCodingPublicationTransactionPool(wrapped,heldMonitor),f=make({ownerSql:heldOwner}),work=f.verifier.attest();work.catch(()=>{});
   try{await Promise.race([entered.promise,work.then(()=>{throw Error('catalog_hold_not_reached');})]);
    if(stop==='close')f.verifier.close();else f.lifetime.abort();let done=false;const drain=f.verifier.drain().then(()=>done=true);
    await tick();assert.equal(done,false);release.resolve();await assert.rejects(work,FAIL);await drain;
    assert.equal((await heldRaw.unsafe('select 1::int as n'))[0].n,1);assert.equal((await api.unsafe('select 1::int as n'))[0].n,1);
   }finally{release.resolve();await work.catch(()=>{});await closeVerifier(f.verifier);}
  });
  await run('recheck drain joins its reads, not the original transaction; close fences its later COMMIT',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const entered=Promise.withResolvers(),release=Promise.withResolvers();let settled=false;
   const original=owner.begin(SERIALIZABLE,async tx=>{await verifier.recheck(tx);entered.resolve();await release.promise;});
   original.then(()=>{settled=true;},()=>{settled=true;});
   try{await entered.promise;verifier.close();await verifier.drain();assert.equal(settled,false);
    await controller.begin(async other=>assert.equal((await other.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,false));
    release.resolve();await assert.rejects(original,FAIL);
    await controller.begin(async other=>assert.equal((await other.unsafe('select pg_catalog.pg_try_advisory_xact_lock('+LOCK+') as locked'))[0].locked,true));
   }finally{release.resolve();await original.catch(()=>{});}
  }));
  await run('changing authenticated API backend cannot reuse the old verifier on a silently reconnected session',()=>withVerifier(async({verifier})=>{
   await verifier.attest();const old=(await api.unsafe('select pg_catalog.pg_backend_pid() as pid'))[0].pid;
   const closed=Promise.withResolvers();apiConnectionClosed=closed;
   try{assert.equal((await controller.unsafe('select pg_catalog.pg_terminate_backend($1) as stopped',[old]))[0].stopped,true);
    await within(closed.promise); // Wait for the actual old transport to die, not an arbitrary sleep.
   }finally{apiConnectionClosed=null;}
   const fresh=(await within(api.unsafe('select pg_catalog.pg_backend_pid() as pid')))[0].pid;
   assert.ok(fresh&&fresh!==old,'generated QA connection must actually reconnect before custody comparison');
   await assert.rejects(owner.begin(SERIALIZABLE,tx=>verifier.recheck(tx)),FAIL);
  }));
  await run('same cluster after actual postmaster restart cannot revive old verifier; fresh attestation still works',async()=>{
   const f=make();try{
    await f.verifier.attest();await command('pg_ctl',['-D',data,'-m','fast','-w','restart']);
    await assert.rejects(owner.begin(SERIALIZABLE,tx=>f.verifier.recheck(tx)),FAIL);
   }finally{await closeVerifier(f.verifier);}
   await withVerifier(async({verifier})=>{assert.equal(await verifier.attest(),undefined);await owner.begin(SERIALIZABLE,tx=>verifier.recheck(tx));});
  });
 }finally{
  for(const verifier of verifiers){verifier.close();await verifier.drain().catch(()=>{});}
  for(const pool of pools)await pool.end({timeout:5});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
  if(qualified){assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-installed-publication-schema-'));
   assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');await fs.rm(data,{recursive:true});
   await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:systemIdentifier,
    postmaster_pid_file_absent:true,generated_data_removed:true,installed_state_used:false}));}
 }
});
