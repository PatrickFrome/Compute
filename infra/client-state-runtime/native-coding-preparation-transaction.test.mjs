import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePreparationTransactions} from './native-coding-preparation-transaction.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function fixture(){
 const seen={queries:[],releases:[],hooks:[]};let next=0,failure=null;
 const monitor=createNativePreparationTransactions({debug:id=>seen.hooks.push(['debug',id]),onclose:id=>seen.hooks.push(['close',id])});
 const pool={reserve:async()=>{const id=++next;return{unsafe:async query=>{
  seen.queries.push([id,query]);monitor.debug(id,query,[],[]);
  if(failure?.query===query){if(failure.close)monitor.onclose(id);throw Object.assign(Error(failure.message||'fixture failure'),{code:failure.close?'CONNECTION_CLOSED':'TEST_FAILURE'});}
  return[{value:id}];},release:()=>seen.releases.push(id)};}};
 return{monitor,pool,seen,fail:v=>{failure=v;},run:body=>monitor.transaction(pool,'isolation level serializable',body)};
}
test('reserved scope commits and releases once; hooks compose without retaining parameters',async()=>{
 const f=fixture();assert.equal(await f.run(async tx=>(await tx.unsafe('select 1'))[0].value),1);
 assert.equal(f.seen.queries[0][1].startsWith('begin isolation level serializable /* native-workspace-preparation:'),true);
 assert.deepEqual(f.seen.queries.map(x=>x[1]).slice(1),['select 1','commit']);assert.deepEqual(f.seen.releases,[1]);assert.equal(f.seen.hooks.length,3);
});
test('callback failure rolls back without retry and releases only confirmed clean session',async()=>{
 const f=fixture();await assert.rejects(f.run(async()=>{throw Error('callback failed');}),/callback failed/);
 assert.equal(f.seen.queries.at(-1)[1],'rollback');assert.deepEqual(f.seen.releases,[1]);
});
test('commit connection loss is unknown and cannot issue rollback or return dead slot; independent scope remains usable',async()=>{
 const f=fixture();f.fail({query:'commit',close:true});let effects=0;
 await assert.rejects(f.run(async()=>{effects++;return 'written';}),/connection_closed/);
 assert.equal(effects,1);assert.equal(f.seen.queries.some(x=>x[1]==='rollback'),false);assert.deepEqual(f.seen.releases,[]);
 f.fail(null);assert.equal(await f.run(async()=>42),42);assert.deepEqual(f.seen.releases,[2]);assert.equal(effects,1);
});
test('unconfirmed rollback quarantines reservation for pool teardown and fences new transactions',async()=>{
 const f=fixture();f.fail({query:'rollback',message:'ROLLBACK_FAILED'});
 await assert.rejects(f.run(async()=>{throw Error('body failed');}),/query_failed/);assert.deepEqual(f.seen.releases,[]);
 await assert.rejects(f.run(async()=>42),/rollback_unconfirmed/);assert.equal(f.seen.queries.length,2);
});
test('close during physical callback joins it and fences late SQL, foreign close cannot cancel other scope',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred();let finished=false;
 const pending=f.run(async tx=>{entered.resolve();await gate.promise;finished=true;return tx.unsafe('select late');});await entered.promise;
 f.monitor.onclose(99);f.monitor.onclose(1);let settled=false;pending.catch(()=>{settled=true;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 gate.resolve();await assert.rejects(pending,/connection_closed/);assert.equal(finished,true);
 assert.equal(f.seen.queries.some(x=>['select late','rollback','commit'].includes(x[1])),false);assert.deepEqual(f.seen.releases,[]);
 assert.equal(await f.run(async()=>true),true);
});
test('missing hook binding fails before callback effects; no raw transaction mode or generic pool fallback',async()=>{
 const monitor=createNativePreparationTransactions();let effects=0;const queries=[];
 const pool={reserve:async()=>({unsafe:async q=>{queries.push(q);return[];},release:()=>{}})};
 await assert.rejects(monitor.transaction(pool,'isolation level serializable',async()=>{effects++;}),/monitor_unbound/);
 assert.equal(effects,0);assert.equal(queries.at(-1),'rollback');
 await assert.rejects(monitor.transaction(pool,'read write',async()=>{}),/dependencies_required/);
 await assert.rejects(monitor.transaction({begin:async()=>{}},'isolation level serializable',async()=>{}),/dependencies_required/);
});

for(const outcome of ['commit','rollback'])test(`retained facade is fenced after ${outcome}`,async()=>{
 const f=fixture();let retained;
 const result=f.run(async tx=>{retained=tx;if(outcome==='rollback')throw Error('body failed');return true;});
 if(outcome==='rollback')await assert.rejects(result,/body failed/);else await result;
 const before=f.seen.queries.length;assert.throws(()=>retained.unsafe('select forbidden'),/finished/);
 assert.equal(f.seen.queries.length,before);
});
test('driver query errors strip enumerable SQL, parameters and causes',async()=>{
 const monitor=createNativePreparationTransactions(),secret='SENTINEL_PRIVATE_QUERY_PARAMETER';
 const pool={reserve:async()=>({unsafe:async q=>{monitor.debug(1,q,[],[]);if(q==='select failing')throw Object.assign(Error(secret),{query:secret,parameters:[secret],args:[secret],types:[secret],cause:Error(secret)});return[];},release(){}})};
 await assert.rejects(monitor.transaction(pool,'isolation level serializable',tx=>tx.unsafe('select failing')),
  error=>error.message==='native_workspace_transaction_query_failed'&&!JSON.stringify(error).includes(secret)&&!String(error.stack).includes(secret)&&!error.cause);
});

test('rollback disconnect reclaims dead slot without poisoning distinct future transaction',async()=>{
 const f=fixture();f.fail({query:'rollback',close:true});let effects=0;
 await assert.rejects(f.run(async()=>{effects++;throw Error('body failed');}),/connection_closed/);
 assert.equal(effects,1);assert.deepEqual(f.seen.releases,[]);
 assert.equal(f.seen.queries.filter(x=>x[1]==='rollback').length,1);
 f.fail(null);assert.equal(await f.run(async()=>42),42);
 assert.deepEqual(f.seen.releases,[2]);assert.equal(effects,1);
});

test('exact reserved-connection close aborts its private phase signal but still joins body work',async()=>{
 const f=fixture(),gate=deferred(),entered=deferred();let scope,aborted=false,settled=false;
 const pending=f.run(async tx=>{scope=tx;tx.signal.addEventListener('abort',()=>{aborted=true;});entered.resolve();await gate.promise;tx.assertOpen();});
 pending.catch(()=>{settled=true;});await entered.promise;
 f.monitor.onclose(99);assert.equal(aborted,false);
 f.monitor.onclose(1);assert.equal(aborted,true);assert.equal(scope.signal.aborted,true);
 await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 gate.resolve();await assert.rejects(pending,/connection_closed/);assert.equal(f.seen.releases.length,0);
});

test('successful commit does not abort the failure-only connection signal; retained facade is still finished',async()=>{
 const f=fixture();let scope;
 assert.equal(await f.run(async tx=>{scope=tx;return true;}),true);
 assert.equal(scope.signal.aborted,false);assert.throws(()=>scope.assertOpen(),/finished/);
});
