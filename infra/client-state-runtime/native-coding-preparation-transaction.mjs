import {markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {randomUUID} from 'node:crypto';
const transactionScopes=new WeakMap(),boundPools=new WeakMap(),publicationTransactions=new WeakMap(),publicationPools=new WeakSet();
const migrationKey="pg_catalog.hashtextextended(pg_catalog.current_database() || ':compute.local-runtime-migrations.v1',0)";
const lockPrefix=`select pg_catalog.pg_try_advisory_lock_shared(${migrationKey}) as locked /* native-publication-migration-fence:`;
const unlockSql=`select pg_catalog.pg_advisory_unlock_shared(${migrationKey}) as unlocked`;
const MODES=Object.freeze(['isolation level serializable','isolation level repeatable read read only']);
const prefix=mode=>'begin '+mode+' /* native-workspace-preparation:';
const fail=reason=>{throw Error('native_workspace_transaction_'+reason);};
const connectionLost=error=>error?.severity==='FATAL'||error?.severity_local==='FATAL'
 ||/^(?:08|57P0[125]|CONNECTION_|CONNECT_TIMEOUT|ECONN|EPIPE)/.test(String(error?.code||''));
// Private lifecycle monitor for the existing postgres.js pool. Uses supported
// reserve/release, debug(connectionId,query,params,types), onclose(connectionId).
// It never logs/retains parameters, credentials or other query strings. The
// generated BEGIN comment only correlates an owned reservation, not authority.
export function createNativePreparationTransactions({debug:previousDebug,onclose:previousClose}={}){
 if(previousDebug!==undefined&&typeof previousDebug!=='function'||previousClose!==undefined&&typeof previousClose!=='function')fail('hooks_invalid');
 const pending=new Map(),connections=new Map();let poisoned=false;
 const closeRecord=record=>{record.closed=true;record.abort.abort();};
 function debug(id,query,...rest){
  const start=typeof query==='string'&&[lockPrefix,...MODES.map(prefix)].find(value=>query.startsWith(value));
  if(start&&query.endsWith(' */')){
   const token=query.slice(start.length,-3),record=pending.get(token);
   if(record){
    if(record.id!==null&&record.id!==id)closeRecord(record);
    const prior=connections.get(id);if(prior&&prior!==record)closeRecord(prior);
    record.id=id;connections.set(id,record);
   }
  }
  previousDebug?.(id,query,...rest);
 }
 function onclose(id){
  const record=connections.get(id);
  if(record){closeRecord(record);connections.delete(id);}
  previousClose?.(id);
 }
 async function transaction(pool,mode,body,publicationFence=false){
  if(poisoned)throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_rollback_unconfirmed'));
  if(typeof pool?.reserve!=='function'||!MODES.includes(mode)||typeof body!=='function')fail('dependencies_required');
  const token=randomUUID(),record={id:null,closed:false,queries:0,abort:new AbortController()};pending.set(token,record);
  let reserved,beginState='NONE',settled=false,finished=false,scopeActive=false,fence='NONE';const commitGuards=[];
  const open=()=>{if(finished)fail('finished');if(record.closed)fail('connection_closed');};
  const scopeOpen=()=>{if(!scopeActive)fail('finished');open();};
  const unsafe=(query,args=[])=>{
   open();
   // Query.handle schedules a microtask; no await is inserted between this
   // guard and dispatch. The pool onclose hook fences later callback reads.
   record.queries++;
   const sanitize=error=>{
    if(connectionLost(error))closeRecord(record);
    // Both synchronous dispatch failures and asynchronous driver rejection
    // belong to THIS reservation. Body/foreign API errors do not prove its death.
    const safe=Error('native_workspace_transaction_'+(record.closed?'connection_closed':'query_failed'));
    if(!record.closed&&/^[0-9A-Z]{5}$/.test(error?.code||'')){safe.name='PostgresError';safe.code=error.code;}
    return safe;
   };
   try{return reserved.unsafe(query,args).catch(error=>{throw sanitize(error);});}
   catch(error){return Promise.reject(sanitize(error));}
  };
  try{
   try{reserved=await pool.reserve();}catch(error){
    if(connectionLost(error))closeRecord(record);
    throw Error('native_workspace_transaction_'+(record.closed?'connection_closed':'reserve_failed'));
   }open();
   if(publicationFence){
    // This fixed SESSION lock must precede BEGIN: acquiring an xact lock in
    // the first SELECT would already have taken a potentially stale snapshot.
    // No blocking queue/retry and no caller-selected key or SQL.
    fence='UNKNOWN';const [locked]=await unsafe(lockPrefix+token+' */');
    if(locked?.locked===false){fence='NONE';fail('publication_migration_busy');}
    if(locked?.locked!==true)fail('publication_lock_unconfirmed');
    fence='HELD';if(record.id===null)fail('monitor_unbound');
   }
   // Missing BEGIN acknowledgement does not prove it had no effect. Even an
   // ordinary driver error may follow a real server BEGIN; rollback this exact
   // reservation before unlock/release, or retain UNKNOWN for pool teardown.
   beginState='ATTEMPTED';await unsafe(prefix(mode)+token+' */');beginState='CONFIRMED';
   if(record.id===null)fail('monitor_unbound');
   // Failure-only private signal: consumers can stop a phase wait immediately
   // when this exact reservation dies, without acquiring/retrying a connection.
   scopeActive=true;
   const scope=Object.freeze({unsafe:(query,args)=>{scopeOpen();return unsafe(query,args);},signal:record.abort.signal,assertOpen:scopeOpen,
    addCommitGuard:guard=>{scopeOpen();if(typeof guard!=='function')fail('commit_guard_invalid');commitGuards.push(guard);},
   });
   const initialQueries=record.queries;
   transactionScopes.set(scope,{pool:boundPools.get(pool)??pool,mode,open:scopeOpen,publicationFence,unqueried:()=>record.queries===initialQueries});
   const value=await body(scope);scopeActive=false;
   open();
   // Only synchronous private lifetime fences: no await between the final
   // guard and COMMIT dispatch. Async callbacks are not accepted as authority.
   for(const guard of commitGuards){const result=guard();if(result!==undefined){
    if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    fail('commit_guard_invalid');
   }}
   await unsafe('commit');settled=true;return value;
  }catch(error){
   scopeActive=false;
   // Only own dispatch/reserve/onclose can close this record. A foreign body
   // error still requires confirmed rollback of this live original reservation.
   if(beginState!=='NONE'&&!settled&&!record.closed){
    try{await unsafe('rollback');settled=true;}catch(rollback){if(record.closed||connectionLost(rollback))closeRecord(record);else poisoned=true;throw markNativePhysicalSettlementUnconfirmed(rollback);}
   }
   // Connection loss is not evidence that the own-PG backend has stopped.
   // Keep cleanup on HOLD until the exact Host shutdown proves its children.
   throw record.closed?markNativePhysicalSettlementUnconfirmed(error):error;
  }finally{
   scopeActive=false;
   try{
    if(publicationFence&&fence!=='NONE'&&!record.closed){
     if(fence!=='HELD'||!(settled||beginState==='NONE')){poisoned=true;throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_publication_lock_unconfirmed'));}
     // Never release a session lock while original COMMIT/ROLLBACK is unknown.
     // An unknown/false unlock retains this reservation for the existing pool
     // teardown and permanently fences this monitor, not a replacement pool.
     fence='UNKNOWN';
     try{const [row]=await unsafe(unlockSql);if(row?.unlocked!==true)fail('publication_unlock_unconfirmed');fence='NONE';}
     catch{poisoned=true;throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_publication_unlock_unconfirmed'));}
    }
    // onclose removes a broken postgres.js reservation. Never release that
    // slot manually or release an unsettled / still session-locked backend.
    if(reserved&&!record.closed&&(settled||beginState==='NONE')&&fence==='NONE'){
     try{reserved.release();}catch{poisoned=true;throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_release_unconfirmed'));}
    }
   }finally{
    finished=true;pending.delete(token);
    if(record.id!==null&&connections.get(record.id)===record)connections.delete(record.id);
   }
  }
 }
 const monitor=Object.freeze({debug,onclose,transaction:(pool,mode,body)=>transaction(pool,mode,body)});
 publicationTransactions.set(monitor,(pool,mode,body)=>transaction(pool,mode,body,true));return monitor;
}

// Private facade for the existing native Host pool. Reuses the SAME reserved
// transaction monitor instead of postgres.js begin's callback/onclose race.
// No new pool, savepoint API, relaxed isolation or caller-selected SQL mode.
export function bindNativeCodingTransactionPool(pool,transactions){
 if(!pool||typeof pool.unsafe!=='function'||typeof pool.reserve!=='function'||typeof transactions?.transaction!=='function')fail('pool_binding_invalid');
 return bindPool(pool,(mode,body)=>transactions.transaction(pool,mode,body));
}
function bindPool(pool,begin){
 const unsafe=(...args)=>pool.unsafe(...args).catch(error=>{
  const safe=Error('native_host_sql_'+(connectionLost(error)?'connection_closed':'query_failed'));
  if(connectionLost(error))throw markNativePhysicalSettlementUnconfirmed(safe);
  if(/^[0-9A-Z]{5}$/.test(error?.code||'')){safe.name='PostgresError';safe.code=error.code;}
  throw safe;
 });
 const bound=new Proxy(pool,{get(target,key,receiver){return key==='begin'?begin:key==='unsafe'?unsafe:Reflect.get(target,key,receiver);}});
 boundPools.set(bound,pool);return bound;
}

// Opt-in private fixed lifecycle for publication schema consumers. The existing
// Host pool/monitor own settlement; regular workspace transactions are unchanged.
export function bindNativeCodingPublicationTransactionPool(pool,transactions){
 const transaction=publicationTransactions.get(transactions);
 if(!transaction||typeof pool?.unsafe!=='function'||typeof pool.reserve!=='function')fail('pool_binding_invalid');
 const bound=bindPool(pool,(mode,body)=>transaction(pool,mode,body));publicationPools.add(bound);return bound;
}

// Private provenance assertion only; no connection/credentials or new ticket.
// A shape-compatible object, copied scope or another bound pool is not custody.
export function assertNativeCodingTransactionPoolScope(bound,tx,mode,{unqueried=false,publicationFence=false}={}){
 const pool=boundPools.get(bound),scope=transactionScopes.get(tx);
 if(!pool||!scope||scope.pool!==pool||scope.mode!==mode||!MODES.includes(mode))fail('scope_unbound');
 if(publicationFence&&(!publicationPools.has(bound)||!scope.publicationFence))fail('publication_scope_unbound');
 scope.open();if(unqueried&&!scope.unqueried())fail('scope_snapshot_already_used');
}
