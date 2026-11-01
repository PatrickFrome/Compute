import {createPublicationOwnerHostPhases,createPublicationOwnerClientPhases,PUBLICATION_OWNER_PHASE} from '../../apps/metaengine-browser/src/native-coding-run-owner-phase.mjs';
import {generatedRunOwnerRead} from '../../apps/metaengine-browser/test/fixtures/native-run-owner-read.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from './native-coding-preparation-transaction.mjs';
import {nativePhysicalSettlementUnconfirmed,runNativePhysicalSettlementScope} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const mode='isolation level serializable';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
// These are actual PG17 transactions through the production monitor/facade.
// Only the two explicitly named rollback/release fault cases inject a DRIVER
// boundary failure. No native process/image/installed authority is claimed.
test('actual PG17 monitored Host transactions preserve settlement, quarantine and independent scope',{
 skip:!bin||!driver,timeout:120000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-preparation-transaction-')),data=path.join(directory,'pgdata');
 const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));assert.ok(![55432,55433,55434].includes(port));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},30000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);code===0&&!timedOut?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,verified=false,controller,systemIdentifier,passed=0;const pools=[],pending=new Set();
 const track=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
  started=true;await command('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  const config={host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,prepare:false,connect_timeout:5,idle_timeout:10,onnotice:()=>{},
   connection:{application_name:'METAENGINE_PREPARATION_DISPOSABLE_QA',statement_timeout:5000,lock_timeout:2000}};
  controller=postgres(config);
  const [identity]=await controller.unsafe(`select current_user::text as role,session_user::text as session,
   current_setting('server_version_num')::int as version,current_setting('data_directory') as directory,
   (select system_identifier::text from pg_control_system()) as system_identifier`);
  assert.equal(identity.role,'state_owner');assert.equal(identity.session,'state_owner');assert.ok(identity.version>=170000&&identity.version<180000);
  assert.equal(path.resolve(identity.directory).toLowerCase(),path.resolve(data).toLowerCase());systemIdentifier=identity.system_identifier;assert.match(systemIdentifier,/^\d+$/);verified=true;
  await controller.unsafe('create table public.fixture_effect(id integer primary key)');
  const count=async id=>(await controller.unsafe('select count(*)::int as n from public.fixture_effect where id=$1',[id]))[0].n;
  function fixture({fault=null}={}){
   let reserves=0,releases=0,callbacks=0;const commands=[];
   const monitor=createNativePreparationTransactions();
   const raw=postgres({...config,debug:monitor.debug,onclose:monitor.onclose});pools.push(raw);
   // Instrument reservation boundaries only; all noninjected statements go
   // through the actual reserved postgres.js connection and real PostgreSQL.
   const wrapped=new Proxy(raw,{get(target,key,receiver){
    if(key==='begin')return ()=>{throw Error('driver_begin_forbidden');};
    if(key==='reserve')return async()=>{
     reserves++;const reserved=await raw.reserve();
     return new Proxy(reserved,{get(r,k,recv){
      if(k==='release')return ()=>{if(fault==='release')throw Error('GENERATED_DRIVER_RELEASE_FAILURE');releases++;return reserved.release();};
      if(k==='unsafe')return (query,args)=>{
       commands.push(query.startsWith('begin ')?'begin':query==='commit'||query==='rollback'?query:'statement');
       if(fault==='rollback'&&query==='rollback')return Promise.reject(Error('GENERATED_DRIVER_ROLLBACK_FAILURE'));
       return reserved.unsafe(query,args);
      };
      return Reflect.get(r,k,recv);
     }});
    };return Reflect.get(target,key,receiver);
   }});
   const sql=bindNativeCodingTransactionPool(wrapped,monitor);
   return {sql,raw,commands,run:body=>track(sql.begin(mode,async tx=>{callbacks++;return body(tx);})),
    stats:()=>({reserves,releases,callbacks})};
  }
  const subtest=(name,body)=>t.test(name,async()=>{await body();passed++;});
  await subtest('normal COMMIT releases the real reservation and retained transaction cannot dispatch again',async()=>{
   const f=fixture();let held;
   await f.run(async tx=>{held=tx;await tx.unsafe('insert into public.fixture_effect values(1)');});
   assert.equal(await count(1),1);assert.deepEqual(f.stats(),{reserves:1,releases:1,callbacks:1});
   assert.throws(()=>held.unsafe('select 1'),/finished/);
   assert.equal(await f.run(async tx=>(await tx.unsafe('select 42::int as value'))[0].value),42);
   assert.deepEqual(f.stats(),{reserves:2,releases:2,callbacks:2});
  });
  await subtest('terminated backend aborts its exact signal, joins callback, retains physical HOLD and allows independent same-pool transaction',async()=>{
   const f=fixture(),entered=deferred(),release=deferred(),aborted=deferred();let retained,pid,settled=false,late=0;
   const physical=runNativePhysicalSettlementScope(()=>f.run(async tx=>{
    retained=tx;pid=(await tx.unsafe('select pg_backend_pid() as pid'))[0].pid;
    await tx.unsafe('insert into public.fixture_effect values(2)');
    tx.signal.addEventListener('abort',()=>aborted.resolve(),{once:true});entered.resolve();
    await release.promise;assert.throws(()=>tx.unsafe('insert into public.fixture_effect values(20)'),/connection_closed/);late++;return true;
   }));
   physical.promise.then(()=>{settled=true;},()=>{settled=true;});
   let timer;
   try{
    await Promise.race([entered.promise,physical.promise.then(()=>{throw Error('callback_finished_before_hold');})]);
    const controllerPid=(await controller.unsafe('select pg_backend_pid() as pid'))[0].pid;assert.notEqual(pid,controllerPid);
    assert.equal((await controller.unsafe('select pg_terminate_backend($1) as terminated',[pid]))[0].terminated,true);
    await Promise.race([aborted.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('backend_close_signal_missing')),5000);})]);
    assert.equal(retained.signal.aborted,true);assert.equal(settled,false);
   }finally{clearTimeout(timer);release.resolve();await assert.rejects(physical.promise,nativePhysicalSettlementUnconfirmed);}
   assert.equal(physical.unconfirmed(),true);assert.equal(late,1);assert.equal(await count(2),0);assert.equal(await count(20),0);
   assert.equal(f.commands.includes('rollback'),false);assert.equal(f.commands.includes('commit'),false);assert.equal(f.stats().releases,0);
   assert.equal((await controller.unsafe('select count(*)::int as n from pg_stat_activity where pid=$1',[pid]))[0].n,0);
   const independent=runNativePhysicalSettlementScope(()=>f.run(async tx=>{await tx.unsafe('insert into public.fixture_effect values(3)');return true;}));
   assert.equal(await independent.promise,true);assert.equal(independent.unconfirmed(),false);assert.equal(await count(3),1);
   assert.deepEqual(f.stats(),{reserves:2,releases:1,callbacks:2});
  });
  await subtest('ordinary real ROLLBACK releases a healthy reservation without physical poison',async()=>{
   const f=fixture();await assert.rejects(f.run(async tx=>{await tx.unsafe('insert into public.fixture_effect values(4)');throw Error('generated_body_failure');}),e=>!nativePhysicalSettlementUnconfirmed(e)&&e.message==='generated_body_failure');
   assert.equal(await count(4),0);assert.equal(f.commands.at(-1),'rollback');assert.equal(f.stats().releases,1);
  });
  await subtest('synchronous commit guard cancellation rolls back prior actual SQL',async()=>{
   const f=fixture(),abort=new AbortController();
   await assert.rejects(f.run(async tx=>{
    await tx.unsafe('insert into public.fixture_effect values(5)');
    tx.addCommitGuard(()=>{if(abort.signal.aborted)throw Error('generated_cancelled');});abort.abort();
   }),/generated_cancelled/);
   assert.equal(await count(5),0);assert.equal(f.commands.includes('commit'),false);assert.equal(f.commands.at(-1),'rollback');assert.equal(f.stats().releases,1);
  });
  for(const fault of ['rollback','release'])await subtest(`explicit DRIVER fault injection: ${fault} failure quarantines real reservation and forbids subsequent body`,async()=>{
   const f=fixture({fault}),id=fault==='rollback'?6:7;
   await assert.rejects(f.run(async tx=>{await tx.unsafe('insert into public.fixture_effect values($1)',[id]);if(fault==='rollback')throw Error('generated_body_failure');}),nativePhysicalSettlementUnconfirmed);
   assert.equal(await count(id),fault==='release'?1:0);const before=f.stats();
   await assert.rejects(f.run(async()=>{throw Error('forbidden_later_body');}),nativePhysicalSettlementUnconfirmed);assert.deepEqual(f.stats(),before);
   assert.equal(before.releases,0);await f.raw.end({timeout:2});assert.equal(await count(id),fault==='release'?1:0);
  });
  function ownerPhase(){
   const f=generatedRunOwnerRead(),{body_sha256,...origin}=f.binding,binding={...origin,action:'AGENT_OPERATION'},abort=new AbortController();
   const request={signal:abort.signal,deadlineAt:Date.now()+15000};let client;
   const host=createPublicationOwnerHostPhases({binding,signal:abort.signal,assertLifetime:()=>assertNativeCodingHostRequestOpen(request),onFailure:()=>abort.abort(),
    send:frame=>queueMicrotask(()=>client.receive(frame))});
   client=createPublicationOwnerClientPhases({binding,scope:f.scope.execution,assertLifetime:()=>assertNativeCodingHostRequestOpen(request),send:frame=>queueMicrotask(()=>host.receive(frame)),
    callback:async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
   const complete=async()=>{for(let i=0;i<3;i++)await host.run(f.scope,{readScope:async()=>f.scope,verifyOwner:async()=>{}});};
   const fail=kind=>host.receive({schema:PUBLICATION_OWNER_PHASE,...binding,cycle:3,sequence:4,
    phase:kind==='ABORT'?'CYCLE_ABORT':'CYCLE_RELEASED',value:kind==='ABORT'?{}:{unexpected:true}});
   return{host,client,request,abort,complete,fail};
  }
  for(const kind of ['malformed','ABORT'])await subtest('late Owner phase '+kind+' before COMMIT aborts original request and rolls back actual SQL',async()=>{
   const f=fixture(),phase=ownerPhase(),id=kind==='ABORT'?102:101;
   try{
    await assert.rejects(f.run(async tx=>{
     tx.addCommitGuard(()=>{assertNativeCodingHostRequestOpen(phase.request);});
     await tx.unsafe('insert into public.fixture_effect values($1)',[id]);await phase.complete();
     queueMicrotask(()=>phase.fail(kind));
    }),/request_cancelled/);
    assert.equal(phase.abort.signal.aborted,true);assert.equal(await count(id),0);assert.equal(f.commands.includes('commit'),false);
   }finally{phase.host.close();phase.client.close();await phase.client.drain();}
  });
  await subtest('normal Owner phase finish does not abort the original request or prevent its genuine COMMIT',async()=>{
   const f=fixture(),phase=ownerPhase();
   try{
    await f.run(async tx=>{tx.addCommitGuard(()=>{assertNativeCodingHostRequestOpen(phase.request);});
     await tx.unsafe('insert into public.fixture_effect values(103)');await phase.complete();phase.host.finish();await phase.client.finish();});
    assert.equal(phase.abort.signal.aborted,false);assert.equal(await count(103),1);
   }finally{phase.host.close();phase.client.close();await phase.client.drain();}
  });
  await subtest('Owner phase failure after COMMIT cannot relabel a durable effect as absent or permit replay',async()=>{
   const f=fixture(),phase=ownerPhase();
   try{
    await f.run(async tx=>{tx.addCommitGuard(()=>{assertNativeCodingHostRequestOpen(phase.request);});
     await tx.unsafe('insert into public.fixture_effect values(104)');await phase.complete();});
    phase.fail('malformed');assert.equal(phase.abort.signal.aborted,true);assert.throws(()=>phase.host.finish());
    await assert.rejects(phase.client.finish());assert.equal(await count(104),1);assert.equal(f.stats().callbacks,1);
   }finally{phase.host.close();phase.client.close();await phase.client.drain();}
  });
  assert.equal(passed,10);
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({state:'PASS',subtests:10,postgres_system_identifier:systemIdentifier,
   source_classification:'ACTUAL_PG_MONITOR_WITH_EXPLICIT_DRIVER_FAULT_CASES',installed_authority:false,authority_effect:false}));
 }finally{
  // Pool termination resolves any started SQL before stopped-cluster cleanup.
  await Promise.allSettled(pools.map(pool=>pool.end({timeout:2})));
  await Promise.allSettled([...pending]);
  if(controller)await controller.end({timeout:2});
  if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
  if(verified){assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-preparation-transaction-'));
   assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');
   await fs.rm(data,{recursive:true});await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:systemIdentifier,postmaster_pid_file_absent:true,generated_data_removed:true}));}
 }
});
