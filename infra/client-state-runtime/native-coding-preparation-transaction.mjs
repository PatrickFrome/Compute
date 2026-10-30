import {markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {randomUUID} from 'node:crypto';
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
  const start=typeof query==='string'&&MODES.map(prefix).find(value=>query.startsWith(value));
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
 async function transaction(pool,mode,body){
  if(poisoned)throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_rollback_unconfirmed'));
  if(typeof pool?.reserve!=='function'||!MODES.includes(mode)||typeof body!=='function')fail('dependencies_required');
  const token=randomUUID(),record={id:null,closed:false,abort:new AbortController()};pending.set(token,record);
  let reserved,begun=false,settled=false,finished=false;const commitGuards=[];
  const open=()=>{if(finished)fail('finished');if(record.closed)fail('connection_closed');};
  const unsafe=(query,args=[])=>{
   open();
   // Query.handle schedules a microtask; no await is inserted between this
   // guard and dispatch. The pool onclose hook fences later callback reads.
   return reserved.unsafe(query,args).catch(error=>{
    if(connectionLost(error))closeRecord(record);
    // postgres.js debug enables enumerable query/parameters on driver errors.
    // Never expose the original error or cause beyond this private boundary.
    const safe=Error('native_workspace_transaction_'+(record.closed?'connection_closed':'query_failed'));
    if(!record.closed&&/^[0-9A-Z]{5}$/.test(error?.code||'')){safe.name='PostgresError';safe.code=error.code;}
    throw safe;
   });
  };
  try{
   try{reserved=await pool.reserve();}catch(error){
    if(connectionLost(error))closeRecord(record);
    throw Error('native_workspace_transaction_'+(record.closed?'connection_closed':'reserve_failed'));
   }open();
   await unsafe(prefix(mode)+token+' */');begun=true;
   if(record.id===null)fail('monitor_unbound');
   // Failure-only private signal: consumers can stop a phase wait immediately
   // when this exact reservation dies, without acquiring/retrying a connection.
   const value=await body(Object.freeze({unsafe,signal:record.abort.signal,assertOpen:open,
    addCommitGuard:guard=>{open();if(typeof guard!=='function')fail('commit_guard_invalid');commitGuards.push(guard);},
   }));
   open();
   // Only synchronous private lifetime fences: no await between the final
   // guard and COMMIT dispatch. Async callbacks are not accepted as authority.
   for(const guard of commitGuards){const result=guard();if(result!==undefined){
    if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    fail('commit_guard_invalid');
   }}
   await unsafe('commit');settled=true;return value;
  }catch(error){
   if(connectionLost(error))closeRecord(record);
   if(begun&&!settled&&!record.closed){
    try{await unsafe('rollback');settled=true;}catch(rollback){if(record.closed||connectionLost(rollback))closeRecord(record);else poisoned=true;throw markNativePhysicalSettlementUnconfirmed(rollback);}
   }
   // Connection loss is not evidence that the own-PG backend has stopped.
   // Keep cleanup on HOLD until the exact Host shutdown proves its children.
   throw record.closed?markNativePhysicalSettlementUnconfirmed(error):error;
  }finally{
   finished=true;pending.delete(token);
   if(record.id!==null&&connections.get(record.id)===record)connections.delete(record.id);
   // onclose already removes the broken reservation in postgres.js. Releasing
   // that dead slot manually would return a closed connection to the open pool.
   if(reserved&&!record.closed&&(settled||!begun)){try{reserved.release();}catch{poisoned=true;throw markNativePhysicalSettlementUnconfirmed(Error('native_workspace_transaction_release_unconfirmed'));}}
   // An unconfirmed rollback retains the reservation for pool teardown and
   // fences subsequent transactions; never return a dirty session to callers.
  }
 }
 return Object.freeze({debug,onclose,transaction});
}

// Private facade for the existing native Host pool. Reuses the SAME reserved
// transaction monitor instead of postgres.js begin's callback/onclose race.
// No new pool, savepoint API, relaxed isolation or caller-selected SQL mode.
export function bindNativeCodingTransactionPool(pool,transactions){
 if(!pool||typeof pool.unsafe!=='function'||typeof pool.reserve!=='function'||typeof transactions?.transaction!=='function')fail('pool_binding_invalid');
 const begin=(mode,body)=>transactions.transaction(pool,mode,body);
 const unsafe=(...args)=>pool.unsafe(...args).catch(error=>{
  const safe=Error('native_host_sql_'+(connectionLost(error)?'connection_closed':'query_failed'));
  if(connectionLost(error))throw markNativePhysicalSettlementUnconfirmed(safe);
  if(/^[0-9A-Z]{5}$/.test(error?.code||'')){safe.name='PostgresError';safe.code=error.code;}
  throw safe;
 });
 return new Proxy(pool,{get(target,key,receiver){return key==='begin'?begin:key==='unsafe'?unsafe:Reflect.get(target,key,receiver);}});
}
