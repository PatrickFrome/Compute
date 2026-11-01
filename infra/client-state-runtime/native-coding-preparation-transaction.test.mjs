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

const {bindNativeCodingTransactionPool,assertNativeCodingTransactionPoolScope}=await import('./native-coding-preparation-transaction.mjs');
test('private provenance assertion accepts only exact live original pool scope/mode and can require first query',async()=>{
 const f=fixture();f.pool.unsafe=async()=>[];const bound=bindNativeCodingTransactionPool(f.pool,f.monitor);
 const g=fixture();g.pool.unsafe=async()=>[];const other=bindNativeCodingTransactionPool(g.pool,g.monitor);let held;
 await bound.begin('isolation level serializable',async tx=>{
  held=tx;assert.equal(assertNativeCodingTransactionPoolScope(bound,tx,'isolation level serializable',{unqueried:true}),undefined);
  for(const impostor of [{...tx},{unsafe:tx.unsafe},{}])assert.throws(()=>assertNativeCodingTransactionPoolScope(bound,impostor,'isolation level serializable'),/scope_unbound/);
  assert.throws(()=>assertNativeCodingTransactionPoolScope(other,tx,'isolation level serializable'),/scope_unbound/);
  assert.throws(()=>assertNativeCodingTransactionPoolScope(f.pool,tx,'isolation level serializable'),/scope_unbound/);
  assert.throws(()=>assertNativeCodingTransactionPoolScope(bound,tx,'isolation level repeatable read read only'),/scope_unbound/);
  await tx.unsafe('select 1');assert.throws(()=>assertNativeCodingTransactionPoolScope(bound,tx,'isolation level serializable',{unqueried:true}),/snapshot_already_used/);
  assertNativeCodingTransactionPoolScope(bound,tx,'isolation level serializable');
 });
 assert.throws(()=>assertNativeCodingTransactionPoolScope(bound,held,'isolation level serializable'),/finished/);
 await bound.begin('isolation level repeatable read read only',async tx=>assertNativeCodingTransactionPoolScope(bound,tx,'isolation level repeatable read read only',{unqueried:true}));
});
test('provenance assertion fences exact reservation loss without exposing pool or connection',async()=>{
 const f=fixture();f.pool.unsafe=async()=>[];const bound=bindNativeCodingTransactionPool(f.pool,f.monitor);
 await assert.rejects(bound.begin('isolation level serializable',async tx=>{f.monitor.onclose(1);assertNativeCodingTransactionPoolScope(bound,tx,'isolation level serializable');}),/connection_closed/);
});

const {bindNativeCodingPublicationTransactionPool}=await import('./native-coding-preparation-transaction.mjs');
function publicationFixture(){
 const seen=[],releases=[];let next=0,behavior=async()=>undefined;
 const monitor=createNativePreparationTransactions();
 const pool={unsafe:async()=>[],reserve:async()=>{const id=++next;return {unsafe:async q=>{seen.push([id,q]);monitor.debug(id,q,[],[]);const value=await behavior(q,id);
  if(value!==undefined)return value;
  if(q.startsWith('select pg_catalog.pg_try_advisory_lock_shared'))return[{locked:true}];
  if(q.startsWith('select pg_catalog.pg_advisory_unlock_shared'))return[{unlocked:true}];return[];
 },release:()=>{seen.push([id,'RELEASE']);releases.push(id);}};}};
 const bound=bindNativeCodingPublicationTransactionPool(pool,monitor);
 return {seen,releases,monitor,bound,pool,set:fn=>{behavior=fn;},run:body=>bound.begin('isolation level serializable',body)};
}
for(const outcome of ['commit','rollback'])test('publication migration session fence precedes snapshot and stays through '+outcome+' before verified unlock/release',async()=>{
 const f=publicationFixture();let held;
 const promise=f.run(async tx=>{held=tx;assertNativeCodingTransactionPoolScope(f.bound,tx,'isolation level serializable',{unqueried:true,publicationFence:true});
  await tx.unsafe('select operation');if(outcome==='rollback')throw Error('body failed');});
 if(outcome==='rollback')await assert.rejects(promise,/body failed/);else await promise;
 const queries=f.seen.map(x=>x[1]);assert.match(queries[0],/^select pg_catalog.pg_try_advisory_lock_shared/);assert.match(queries[1],/^begin isolation level serializable /);
 assert.equal(queries[2],'select operation');assert.equal(queries[3],outcome);assert.match(queries[4],/^select pg_catalog.pg_advisory_unlock_shared/);assert.equal(queries[5],'RELEASE');
 assert.throws(()=>assertNativeCodingTransactionPoolScope(f.bound,held,'isolation level serializable',{publicationFence:true}),/finished/);
});
test('fenced startup preserves fixed RR READ ONLY and regular binders cannot impersonate publication scopes',async()=>{
 const f=publicationFixture(),regular=bindNativeCodingTransactionPool(f.pool,f.monitor);
 await f.bound.begin('isolation level repeatable read read only',async tx=>{
  assertNativeCodingTransactionPoolScope(f.bound,tx,'isolation level repeatable read read only',{publicationFence:true});
  assert.throws(()=>assertNativeCodingTransactionPoolScope(regular,tx,'isolation level repeatable read read only',{publicationFence:true}),/publication_scope_unbound/);
 });
 await regular.begin('isolation level serializable',async tx=>assert.throws(()=>assertNativeCodingTransactionPoolScope(f.bound,tx,'isolation level serializable',{publicationFence:true}),/publication_scope_unbound/));
 assert.throws(()=>bindNativeCodingPublicationTransactionPool(f.pool,{...f.monitor}),/pool_binding_invalid/);
});
test('busy migration is refused before BEGIN/callback and proven unacquired session lock is released once',async()=>{
 const f=publicationFixture();f.set(async q=>q.startsWith('select pg_catalog.pg_try_advisory_lock_shared')?[{locked:false}]:undefined);let calls=0;
 await assert.rejects(f.run(async()=>{calls++;}),/publication_migration_busy/);assert.equal(calls,0);assert.equal(f.seen.length,2);assert.deepEqual(f.releases,[1]);
 f.set(async()=>undefined);await f.run(async()=>{});assert.deepEqual(f.releases,[1,2]);
});
for(const failure of ['lock_unknown','lock_error','unlock_false','unlock_error','rollback_error'])test('publication '+failure+' quarantines exact reservation and never unlocks/releases uncertain state',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture();f.set(async q=>{
  if(failure==='lock_unknown'&&q.startsWith('select pg_catalog.pg_try_advisory_lock_shared'))return[];
  if(failure==='lock_error'&&q.startsWith('select pg_catalog.pg_try_advisory_lock_shared'))throw Error('private query details');
  if(failure==='unlock_false'&&q.startsWith('select pg_catalog.pg_advisory_unlock_shared'))return[{unlocked:false}];
  if(failure==='unlock_error'&&q.startsWith('select pg_catalog.pg_advisory_unlock_shared'))throw Error('private query details');
  if(failure==='rollback_error'&&q==='rollback')throw Error('private query details');
 });
 const error=await f.run(async()=>{if(failure==='rollback_error')throw Error('body');}).catch(e=>e);assert(nativePhysicalSettlementUnconfirmed(error));assert(!String(error.stack).includes('private query details'));
 assert.deepEqual(f.releases,[]);if(failure==='rollback_error'||failure.startsWith('lock'))assert.equal(f.seen.some(x=>x[1].startsWith('select pg_catalog.pg_advisory_unlock_shared')),false);
 const before=f.seen.length;await assert.rejects(f.run(async()=>{}),/rollback_unconfirmed/);assert.equal(f.seen.length,before);
});
for(const at of ['lock','begin','commit','rollback','unlock'])test('publication connection loss at '+at+' retains physical HOLD and never returns dead reservation',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture();f.set(async(q,id)=>{
  if(at==='lock'&&q.startsWith('select pg_catalog.pg_try_advisory_lock_shared')||at==='begin'&&q.startsWith('begin ')
   ||at==='commit'&&q==='commit'||at==='rollback'&&q==='rollback'||at==='unlock'&&q.startsWith('select pg_catalog.pg_advisory_unlock_shared')){
   f.monitor.onclose(id);throw Object.assign(Error('lost ack'),{code:'CONNECTION_CLOSED'});
  }
 });
 const error=await f.run(async()=>{if(at==='rollback')throw Error('body');}).catch(e=>e);assert(nativePhysicalSettlementUnconfirmed(error));assert.deepEqual(f.releases,[]);
 if(['lock','begin','commit','rollback'].includes(at))assert.equal(f.seen.some(x=>x[1].startsWith('select pg_catalog.pg_advisory_unlock_shared')),false);
});
test('close during held operation joins callback then leaves lock for existing exact pool teardown, not a replacement connection',async()=>{
 const f=publicationFixture(),entered=deferred(),gate=deferred();let callbackEnded=false,settled=false;
 const pending=f.run(async tx=>{entered.resolve();await gate.promise;callbackEnded=true;tx.assertOpen();});pending.catch(()=>{settled=true;});await entered.promise;
 f.monitor.onclose(1);await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await assert.rejects(pending,/connection_closed/);
 assert.equal(callbackEnded,true);assert.deepEqual(f.releases,[]);assert.equal(f.seen.length,2);
});

for(const at of ['commit','rollback','unlock'])test('caller scope is sealed before physical '+at+' even while monitor retains migration fence',async()=>{
 const f=publicationFixture(),entered=deferred(),gate=deferred();let held;
 f.set(async q=>{if(at==='commit'&&q==='commit'||at==='rollback'&&q==='rollback'||at==='unlock'&&q.startsWith('select pg_catalog.pg_advisory_unlock_shared')){entered.resolve();await gate.promise;}});
 const pending=f.run(async tx=>{held=tx;if(at==='rollback')throw Error('expected body error');});pending.catch(()=>{});await entered.promise;
 const before=f.seen.length;assert.throws(()=>held.assertOpen(),/finished/);assert.throws(()=>held.unsafe('select late_after_body'),/finished/);
 assert.throws(()=>held.addCommitGuard(()=>{}),/finished/);assert.throws(()=>assertNativeCodingTransactionPoolScope(f.bound,held,'isolation level serializable',{publicationFence:true}),/finished/);
 assert.equal(f.seen.length,before);assert.deepEqual(f.releases,[]);gate.resolve();
 if(at==='rollback')await assert.rejects(pending,/expected body error/);else await pending;assert.deepEqual(f.releases,[1]);
});

for(const kind of ['regular','publication'])test(kind+' lost BEGIN acknowledgement requires same-reservation rollback before release',async()=>{
 const f=publicationFixture(),bound=kind==='regular'?bindNativeCodingTransactionPool(f.pool,f.monitor):f.bound;let body=0;
 f.set(async q=>{if(q.startsWith('begin '))throw Error('generated_nonfatal_lost_BEGIN_ACK');});
 await assert.rejects(bound.begin('isolation level serializable',async()=>{body++;}),/query_failed/);
 assert.equal(body,0);const queries=f.seen.map(x=>x[1]);
 assert.ok(queries.includes('rollback'),'unacknowledged BEGIN is not evidence of an idle reservation');
 assert.ok(queries.indexOf('rollback')<queries.indexOf('RELEASE'));
 if(kind==='publication')assert.ok(queries.indexOf('rollback')<queries.findIndex(q=>q.startsWith('select pg_catalog.pg_advisory_unlock_shared')));
 assert.deepEqual(f.releases,[1]);
});
test('lost BEGIN and unconfirmed rollback quarantine publication reservation without unlock/release',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture();f.set(async q=>{if(q.startsWith('begin ')||q==='rollback')throw Error('generated_nonfatal_lost_ACK');});
 const error=await f.run(async()=>assert.fail('body must not run')).catch(e=>e);assert(nativePhysicalSettlementUnconfirmed(error));
 assert.equal(f.seen.filter(x=>x[1]==='rollback').length,1);assert.equal(f.seen.some(x=>x[1].startsWith('select pg_catalog.pg_advisory_unlock_shared')),false);assert.deepEqual(f.releases,[]);
});

for(const kind of ['regular','publication'])for(const code of ['ECONNRESET','CONNECTION_DESTROYED'])test(kind+' foreign body '+code+' does not impersonate death of original reservation',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture(),bound=kind==='regular'?bindNativeCodingTransactionPool(f.pool,f.monitor):f.bound;
 const foreign=Object.assign(Error('foreign API driver error'),{code});let held;
 await assert.rejects(bound.begin('isolation level serializable',async tx=>{held=tx;await tx.unsafe('select original owner work');throw foreign;}),error=>error===foreign&&!nativePhysicalSettlementUnconfirmed(error));
 const queries=f.seen.map(x=>x[1]);assert.equal(held.signal.aborted,false);assert.ok(queries.includes('rollback'));assert.equal(queries.includes('commit'),false);
 if(kind==='publication')assert.ok(queries.indexOf('rollback')<queries.findIndex(q=>q.startsWith('select pg_catalog.pg_advisory_unlock_shared')));
 assert.deepEqual(f.releases,[1]);await bound.begin('isolation level serializable',async()=>{});assert.deepEqual(f.releases,[1,2]);
});
for(const code of ['ECONNRESET','CONNECTION_DESTROYED','TEST_FAILURE'])test('original reserved unsafe synchronous '+code+' is normalized at own dispatch boundary',async()=>{
 const {nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture(),original=f.pool.reserve,secret='SENTINEL_SYNC_DRIVER_SQL_PARAMETERS';
 f.pool.reserve=async()=>{const reserved=await original(),unsafe=reserved.unsafe;reserved.unsafe=q=>{if(q==='select generated sync failure')throw Object.assign(Error(secret),{code,query:secret,parameters:[secret]});return unsafe(q);};return reserved;};
 await assert.rejects(f.run(tx=>tx.unsafe('select generated sync failure')),error=>{
  assert.doesNotMatch(String(error.stack)+JSON.stringify(error),/SENTINEL/);assert.equal(nativePhysicalSettlementUnconfirmed(error),code!=='TEST_FAILURE');return true;
 });
 assert.equal(f.seen.some(x=>x[1]==='rollback'),code==='TEST_FAILURE');assert.deepEqual(f.releases,code==='TEST_FAILURE'?[1]:[]);
});
test('foreign physical UNKNOWN remains marked without poisoning confirmed rollback of this owner',async()=>{
 const {markNativePhysicalSettlementUnconfirmed,runNativePhysicalSettlementScope,nativePhysicalSettlementUnconfirmed}=await import('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs');
 const f=publicationFixture();const lane=runNativePhysicalSettlementScope(async()=>{
  await assert.rejects(f.run(async tx=>{await tx.unsafe('select original owner work');throw markNativePhysicalSettlementUnconfirmed(Object.assign(Error('foreign physical UNKNOWN'),{code:'CONNECTION_DESTROYED'}));}),nativePhysicalSettlementUnconfirmed);
 });await lane.promise;assert.equal(lane.unconfirmed(),true);assert.equal(f.seen.some(x=>x[1]==='rollback'),true);assert.deepEqual(f.releases,[1]);
});
