import {randomUUID} from 'node:crypto';
const PREFIX='begin isolation level serializable /* native-workspace-preparation:';
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
  if(typeof query==='string'&&query.startsWith(PREFIX)&&query.endsWith(' */')){
   const token=query.slice(PREFIX.length,-3),record=pending.get(token);
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
  if(poisoned)fail('rollback_unconfirmed');
  if(typeof pool?.reserve!=='function'||mode!=='isolation level serializable'||typeof body!=='function')fail('dependencies_required');
  const token=randomUUID(),record={id:null,closed:false,abort:new AbortController()};pending.set(token,record);
  let reserved,begun=false,settled=false,finished=false;
  const open=()=>{if(finished)fail('finished');if(record.closed)fail('connection_closed');};
  const unsafe=(query,args=[])=>{
   open();
   // Query.handle schedules a microtask; no await is inserted between this
   // guard and dispatch. The pool onclose hook fences later callback reads.
   return reserved.unsafe(query,args).catch(error=>{
    if(connectionLost(error))closeRecord(record);
    // postgres.js debug enables enumerable query/parameters on driver errors.
    // Never expose the original error or cause beyond this private boundary.
    fail(record.closed?'connection_closed':'query_failed');
   });
  };
  try{
   reserved=await pool.reserve();open();
   await unsafe(PREFIX+token+' */');begun=true;
   if(record.id===null)fail('monitor_unbound');
   // Failure-only private signal: consumers can stop a phase wait immediately
   // when this exact reservation dies, without acquiring/retrying a connection.
   const value=await body(Object.freeze({unsafe,signal:record.abort.signal,assertOpen:open}));
   open();await unsafe('commit');settled=true;return value;
  }catch(error){
   if(connectionLost(error))closeRecord(record);
   if(begun&&!settled&&!record.closed){
    try{await unsafe('rollback');settled=true;}catch(rollback){if(record.closed||connectionLost(rollback))closeRecord(record);else poisoned=true;throw rollback;}
   }
   throw error;
  }finally{
   finished=true;pending.delete(token);
   if(record.id!==null&&connections.get(record.id)===record)connections.delete(record.id);
   // onclose already removes the broken reservation in postgres.js. Releasing
   // that dead slot manually would return a closed connection to the open pool.
   if(reserved&&!record.closed&&(settled||!begun))reserved.release();
   // An unconfirmed rollback retains the reservation for pool teardown and
   // fences subsequent transactions; never return a dirty session to callers.
  }
 }
 return Object.freeze({debug,onclose,transaction});
}
