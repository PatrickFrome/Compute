// GENERATED TEST HOST ONLY. Real private IPC + transaction adapter + disposable
// PG connection, NOT production Windows Host authority or shutdown witness.
import {pathToFileURL} from 'node:url';
import {createNativeCodingHostIpcServer} from '../../../../infra/client-state-runtime/native-coding-host-ipc.mjs';
import {createNativePreparationTransactions,bindNativeCodingTransactionPool} from '../../../../infra/client-state-runtime/native-coding-preparation-transaction.mjs';
const postgres=(await import(pathToFileURL(process.env.METAENGINE_PG_TEST_DRIVER))).default;
const monitor=createNativePreparationTransactions(),sql=postgres({host:'127.0.0.1',port:Number(process.env.METAENGINE_TEST_PG_PORT),user:'state_owner',database:'postgres',
 max:1,prepare:false,connect_timeout:3,debug:monitor.debug,onclose:monitor.onclose,onnotice:()=>{},connection:{application_name:'METAENGINE_PUBLISHED_SCOPE_DISPOSABLE_QA'}});
const bound=bindNativeCodingTransactionPool(sql,monitor);let work=null,releaseCallback;
const callback=new Promise(resolve=>{releaseCallback=resolve;});
const operations=Object.fromEntries(['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT',
 'READ_PROJECT_CHECKPOINT','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'].map(name=>[name,async()=>{throw Error('unused_generated_operation');}]));
operations.AGENT_OPERATION=value=>{
 if(value.operation==='CHECK')return {schema:'metaengine.native-coding.agent-authorized.v1',run_id:value.binding.run_id,authorized:true,authority_effect:false};
 work=bound.begin('isolation level serializable',async tx=>{
  const [{pid}]=await tx.unsafe('select pg_backend_pid() as pid');process.send({schema:'fixture.query',pid});
  try{await tx.unsafe('select pg_advisory_xact_lock(274839)');}
  finally{process.send({schema:'fixture.callback-pending'});await callback;}
  return {fixture_only:true};
 });return work;
};
const server=createNativeCodingHostIpcServer({instanceId:process.env.METAENGINE_TEST_INSTANCE,operations,timeoutMs:50,send:(frame,cb)=>process.send(frame,cb)});
process.on('message',message=>{
 if(message?.schema==='fixture.release-callback'){releaseCallback();return;}
 if(message?.schema==='fixture.stop'){
  server.close();void(async()=>{await work?.catch(()=>{});await sql.end({timeout:0});process.exit(0);})();return;
 }
 server.handleMessage(message);
});
process.on('disconnect',()=>{releaseCallback();void sql.end({timeout:0}).finally(()=>process.exit(0));});
process.send({schema:'fixture.ready'});
