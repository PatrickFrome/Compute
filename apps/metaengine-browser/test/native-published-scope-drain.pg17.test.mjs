import {createNativeRunCallbackJournal,readNativeRunCallbackJournal} from '../src/native-coding-run-callback-journal.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import vm from 'node:vm';
import {fork,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';
import {createNativeCodingWorkerRegistry} from '../src/native-coding-host-observers.mjs';
import {drainManagedRuntimeWorkers,drainManagedRuntimeBindings} from '../src/managed-runtime-drain.mjs';
import {createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold} from '../src/native-host-scope-cleanup.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
for(const runScoped of [false,true])test(`actual Main published scope quit upgrades pending real PG17/IPC work without confusing UNKNOWN with physical drain (${runScoped?'run journal custody':'legacy capability'})`,{
 skip:!bin||!driver?'explicit existing PG17 + pinned driver required':false,timeout:45000,
},async t=>{
 assert.ok(path.isAbsolute(bin)&&path.isAbsolute(driver));
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-published-scope-pg-'))),data=path.join(directory,'data'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const phase=name=>console.log('fixture phase: '+name);
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:['ignore','pipe','pipe'],shell:false});let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output+=bytes.toString();});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`disposable ${name} failed: ${output.slice(-2000)}`)));});
 let started=false,sql,child,capability,childExit,shutdownWitness=null;const events=[],pgStopped=deferred(),mainCallback=deferred(),hostShutdown=deferred();let stopping=false;
 const messages=[];const waits=new Map();
 const message=schema=>messages.find(row=>row.schema===schema)||Promise.race([new Promise(resolve=>waits.set(schema,resolve)),childExit.then(()=>{throw Error('generated Host exited before '+schema);})]);
 t.after(async()=>{
  if(child?.connected){child.send({schema:'fixture.release-callback'});child.send({schema:'fixture.stop'});}
  mainCallback.resolve();if(started){await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;}
  if(childExit)await childExit;capability?.close();await sql?.end({timeout:0});
  assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
  await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({schema:'fixture-only',stopped:true,installed_runtime_used:false}));
  t.diagnostic(`Disposable PG log and cleanup retained: ${directory}`);
 });
 await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
 await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
 started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
 const postgres=(await import(pathToFileURL(driver))).default;
 sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,onnotice:()=>{},connect_timeout:3});
 const [identity]=await sql.unsafe("select current_setting('server_version_num')::int as version,current_setting('data_directory') as data");
 assert.ok(identity.version>=170000&&identity.version<180000);assert.equal(await fs.realpath(identity.data),data);
 phase('PG verified');const lock=await sql.reserve();await lock.unsafe('select pg_advisory_lock(274839)');
 const instance=randomUUID();child=fork(fileURLToPath(new URL('./fixtures/native-published-scope-pg-child.mjs',import.meta.url)),[],{
  stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,METAENGINE_PG_TEST_DRIVER:driver,METAENGINE_TEST_PG_PORT:String(port),METAENGINE_TEST_INSTANCE:instance}});
 let stderr='';child.stderr.on('data',v=>{stderr+=v.toString();});
 childExit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{try{assert.equal(code,0,stderr);assert.equal(signal,null);resolve();}catch(error){reject(error);}});});
 child.on('message',row=>{messages.push(row);waits.get(row.schema)?.(row);waits.delete(row.schema);});await message('fixture.ready');phase('child ready');
 capability=createNativeCodingHostIpcClient({child,instanceId:instance,hostPid:child.pid,timeoutMs:75,readShutdownSettlement:async()=>{if(stopping)await hostShutdown.promise;return shutdownWitness;}});
 const run=randomUUID(),request={operation:'agent_send_message',args:{request_id:randomUUID(),target_agent_id:'agent_fixture-peer123',message:'Generated disposable fixture only'},
  binding:{run_id:run,workspace_id:randomUUID(),project_id:randomUUID(),task_id:randomUUID(),lease_generation:1,agent_id:'agent_fixture-worker123',agent_generation_epoch:1,provider_id:randomUUID(),role:'IMPLEMENTER'},
  job_binding:{job_id:run,pid:1234,process_incarnation_id:'pid:1234:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)}};
 let facet=null,journalDirectory;
 if(runScoped){journalDirectory=path.join(directory,'run');await fs.mkdir(journalDirectory);const journal=await createNativeRunCallbackJournal({directory:journalDirectory,runId:run,binding:request.binding});
  facet=await capability.openAgentRunCustody({binding:request.binding,journal});await facet.agentOperation({...request,operation:'CHECK',args:{}});await capability.drainPhysical();}
 const caller=facet?facet.agentOperation(request):capability.agentOperation(request);caller.catch(error=>phase('caller result '+error.reason));const running=await message('fixture.query');phase('query dispatched');
 await assert.rejects(caller,error=>error.ambiguous===true||error.outcome==='UNKNOWN'||error.reason==='REQUEST_TIMEOUT');
 phase('caller UNKNOWN');assert.equal(capability.snapshot().physical_inflight,1);
 const [waiter]=await sql.unsafe("select wait_event_type,wait_event from pg_stat_activity where pid=$1",[running.pid]);
 assert.equal(waiter.wait_event_type,'Lock');assert.equal(waiter.wait_event,'advisory');phase('actual SQL held');
 const workers=createNativeCodingWorkerRegistry({readProcess:async()=>{},processController:{spawn:async()=>{throw Error('no worker permitted');}}});let fenced=false,stops=0;
 const coding={drainNativeWorkers:async()=>{fenced=true;events.push('WORKERS');const proof=await workers.close();assert.equal(proof.cleanup_confirmed,true);
  return{schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};},
  drainClosedWork:async()=>{const joining=facet?.finish();await mainCallback.promise;if(joining){const value=await joining;assert.equal(value.state,'HOLD');assert.equal(value.all_effects_cleanup,'UNCONFIRMED');}return{schema:'metaengine.native-coding.runtime.v1',shutdown_state:'DRAINED',worker_cleanup_confirmed:true};}};
 const scope={Promise,Set,Map,Error,console,shutdownRequested:false,managedTaskProjectHostDrainPending:false,managedTaskProjectHostClosing:Promise.resolve(),
  nativeRuntimeInitializations:new Set(),pendingOwnerInitializationsByBarrier:new Map(),nativeSetupRouteInitializationsByBarrier:new Map(),nativeDraftScopeInitializationsByBarrier:new Map(),
  nativeCodingRuntimeMountPromise:null,nativeCodingRuntimeMountCustody:null,nativeSupervisorMountWaits:new Set(),nativeInitializationCleanupCandidates:new Set(),
  supervisorLoopbackRpc:null,managedTaskProjectHost:null,autonomousProjectRuntime:null,nativeCodingRuntime:coding,nativeCodingHostCapability:capability,nativeSupervisor:null,
  drainManagedRuntimeWorkers,drainManagedRuntimeBindings,createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold,
  cleanupNativeInitializationCandidate:async()=>{throw Error('unexpected initialization in published-only fixture');},
  stopOwnedLocalRuntimeHost:async()=>{stops++;stopping=true;events.push('HOST_STOP');assert.equal(fenced,true);
   await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;pgStopped.resolve();phase('PG stopped');
   child.send({schema:'fixture.stop'});await childExit;
   // GENERATED shutdown witness boundary, not production Windows qualification.
   shutdownWitness={schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:instance,host_pid:child.pid,cleanup_confirmed:true,authority_effect:false};
   hostShutdown.resolve();return{cleanup_confirmed:true};},
 };
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');const context=vm.createContext(scope);
 vm.runInContext(source.slice(source.indexOf('let managedTaskProjectHostDrainHeld='),source.indexOf('async function startInstalledRuntimeRecovery()')),context);
 let finished=false,failure=null;const ordinary=context.closeManagedTaskProjectHost();ordinary.then(()=>{finished=true;},error=>{failure=error;});
 assert.equal(fenced,true);await turn();assert.equal(failure,null);assert.equal(stops,0);assert.equal(finished,false);
 scope.shutdownRequested=true;assert.equal(context.closeManagedTaskProjectHost(),ordinary);phase('quit requested');await pgStopped.promise;await message('fixture.callback-pending');
 assert.equal(stops,1);assert.equal(finished,false);assert.equal(capability.snapshot().physical_inflight,1);
 child.send({schema:'fixture.release-callback'});await childExit;phase('child exited');await turn();assert.equal(finished,false,'original Main callback still has to join after Host termination');
 mainCallback.resolve();assert.equal((await ordinary).cleanup_confirmed,true);assert.equal(capability.snapshot().physical_inflight,0);
 if(runScoped){const audit=await readNativeRunCallbackJournal(journalDirectory);assert.equal(audit.state,'HOLD');assert.equal(audit.requests,2);assert.equal(audit.caller_unknown,1);assert.equal(audit.all_effects_cleanup,'UNCONFIRMED');}
 assert.equal(stops,1);assert.deepEqual(events,['WORKERS','HOST_STOP']);assert.equal(scope.nativeCodingHostCapability,null);
 t.diagnostic('REAL disposable PostgreSQL17 + actual Main extraction + actual fork/IPC/transaction adapter; generated worker/Host-shutdown boundary, no Windows proof or effect reconciliation.');
});
