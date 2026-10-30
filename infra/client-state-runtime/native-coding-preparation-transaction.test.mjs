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



test('synchronous commit lifetime guard fences callback-to-COMMIT microtask gap',async()=>{
 const f=fixture();let live=true;
 await assert.rejects(f.run(async tx=>{tx.addCommitGuard(()=>{if(!live)throw Error('native_lifetime_closed');});
  await tx.unsafe('select effect');queueMicrotask(()=>{live=false;});return 'effect';}),/native_lifetime_closed/);
 assert.equal(f.seen.queries.some(x=>x[1]==='commit'),false);assert.equal(f.seen.queries.at(-1)[1],'rollback');
});
test('commit guards are append-only synchronous functions and cannot survive finished transaction',async()=>{
 const f=fixture();let held;const called=[];
 await f.run(async tx=>{held=tx;tx.addCommitGuard(()=>{called.push(1);});tx.addCommitGuard(()=>{called.push(2);});});
 assert.deepEqual(called,[1,2]);assert.throws(()=>held.addCommitGuard(()=>{}),/finished/);
 for(const guard of [()=>true,async()=>{},async()=>{throw Error('consumed test rejection');}]){
  const g=fixture();await assert.rejects(g.run(async tx=>{tx.addCommitGuard(guard);}),/commit_guard_invalid/);
  assert.equal(g.seen.queries.some(x=>x[1]==='commit'),false);assert.equal(g.seen.queries.at(-1)[1],'rollback');
 }
});

test('rollback poison and connection death carry private unconfirmed-settlement marker, not ordinary rollback',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 for(const failure of [{query:'rollback'},{query:'commit',close:true},{query:'rollback',close:true}]){
  const f=fixture();f.fail(failure);await assert.rejects(f.run(async()=>{if(failure.query==='rollback')throw Error('body');return true;}),error=>nativePhysicalSettlementUnconfirmed(error));
 }
 const f=fixture();await assert.rejects(f.run(async()=>{throw Error('body');}),error=>!nativePhysicalSettlementUnconfirmed(error));
 assert.equal(nativePhysicalSettlementUnconfirmed(Object.assign(Error('forged'),{physical_settlement_unconfirmed:true})),false);
});

test('general Host pool facade reuses reserved monitor and preserves approved readonly isolation without driver begin race',async()=>{
 const {bindNativeCodingTransactionPool}=await import('./native-coding-preparation-transaction.mjs');
 const f=fixture();f.pool.begin=()=>{throw Error('racing driver begin must not run');};f.pool.unsafe=async()=>[];
 const bound=bindNativeCodingTransactionPool(f.pool,f.monitor);let retained;
 assert.equal(await bound.begin('isolation level repeatable read read only',async tx=>{retained=tx;return(await tx.unsafe('select 1'))[0].value;}),1);
 assert.match(f.seen.queries[0][1],/^begin isolation level repeatable read read only /);assert.deepEqual(f.seen.releases,[1]);assert.throws(()=>retained.unsafe('late'),/finished/);
 for(const mode of ['read write','isolation level read uncommitted','isolation level serializable; select 1'])await assert.rejects(bound.begin(mode,async()=>true),/dependencies_required/);
});
test('general pool reserve failure never starts callback; closed native callback remains joined and late dispatch refused',async()=>{
 const {bindNativeCodingTransactionPool}=await import('./native-coding-preparation-transaction.mjs');
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=fixture();f.pool.unsafe=async()=>[];const bound=bindNativeCodingTransactionPool(f.pool,f.monitor);
 const original=f.pool.reserve;let bodies=0;f.pool.reserve=async()=>{throw Object.assign(Error('PRIVATE_RESERVE_DETAIL'),{code:'CONNECTION_CLOSED'});};
 await assert.rejects(bound.begin('isolation level serializable',async()=>{bodies++;}),error=>nativePhysicalSettlementUnconfirmed(error)&&!String(error.stack).includes('PRIVATE_RESERVE_DETAIL'));assert.equal(bodies,0);
 f.pool.reserve=original;const gate=deferred(),entered=deferred();let settled=false;
 const work=bound.begin('isolation level repeatable read read only',async tx=>{bodies++;entered.resolve();await gate.promise;return tx.unsafe('late query');});work.catch(()=>{settled=true;});await entered.promise;
 f.monitor.onclose(1);await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await assert.rejects(work,nativePhysicalSettlementUnconfirmed);
 assert.equal(f.seen.queries.some(q=>q[1]==='late query'),false);assert.equal(bodies,1);
});
test('private physical HOLD survives sanitized or swallowed errors in the exact async operation only',async()=>{
 const {bindNativeCodingTransactionPool}=await import('./native-coding-preparation-transaction.mjs');
 const {runNativePhysicalSettlementScope,nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const monitor=createNativePreparationTransactions(),secret='SENTINEL_SQL_PARAMETERS';
 const pool={reserve:async()=>{throw Error('unused');},unsafe:async()=>{throw Object.assign(Error(secret),{code:'ECONNRESET',query:secret,parameters:[secret]});}};
 const bound=bindNativeCodingTransactionPool(pool,monitor);
 const a=runNativePhysicalSettlementScope(async()=>{try{await bound.unsafe('select fixture');}catch(error){assert.equal(nativePhysicalSettlementUnconfirmed(error),true);assert.doesNotMatch(String(error.stack)+JSON.stringify(error),/SENTINEL/);}return {recovered:true};});
 const b=runNativePhysicalSettlementScope(async()=>({unrelated:true}));assert.deepEqual(await a.promise,{recovered:true});await b.promise;assert.equal(a.unconfirmed(),true);assert.equal(b.unconfirmed(),false);
});

test('reservation release failure is sanitized mandatory HOLD even after COMMIT and poisons reuse',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=fixture(),original=f.pool.reserve,secret='SENTINEL_RELEASE_SECRET';
 f.pool.reserve=async()=>{const reserved=await original();reserved.release=()=>{throw Object.assign(Error(secret),{parameters:[secret]});};return reserved;};
 await assert.rejects(f.run(async()=>42),error=>nativePhysicalSettlementUnconfirmed(error)&&error.message==='native_workspace_transaction_release_unconfirmed'&&!String(error.stack).includes(secret));
 assert.equal(f.seen.queries.at(-1)[1],'commit');await assert.rejects(f.run(async()=>43),nativePhysicalSettlementUnconfirmed);assert.equal(f.seen.queries.length,2);
});
