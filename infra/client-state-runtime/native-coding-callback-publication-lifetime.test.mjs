import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingCallbackPublication} from './native-coding-callback-publication.mjs';

// Actual publisher ordering with inert transaction/native doubles. This does
// not establish PostgreSQL, native identity, publication or installed authority.
const deferred=()=>Promise.withResolvers();
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const unknown=error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false;
function fixture({owner=async()=>{},scoped}={}){
 const abort=new AbortController(),scope={task_id:randomUUID()},statements=[],reads={host:0,prefix:0,owner:0};
 const request={instanceId:randomUUID(),hostPid:process.pid,requestId:randomUUID(),action:'RESERVE_EXECUTION',
  signal:abort.signal,deadlineAt:Date.now()+30000};
 const tx={unsafe:async query=>{statements.push(query);assert.equal(query,'set local synchronous_commit=on');return [];}};
 const publisher=createNativeCodingCallbackPublication({sql:{begin:async(_mode,body)=>body(tx)},owner,scoped,open(){},
  identity:{hostInstanceId:request.instanceId,hostPid:request.hostPid,postgresIdentity:{}},
  readPublicationHost:async()=>{reads.host++;throw Error('unexpected host read');},
  readCallbackPrefix:async()=>{reads.prefix++;throw Error('unexpected prefix read');},
  readOwnerControl:async()=>{reads.owner++;throw Error('unexpected Owner read');}});
 const reservation={state:'RESERVED',scope};publisher.retainReservation(reservation,request);
 return {abort,scope,request,tx,reads,statements,publisher,publish:()=>publisher.api.publish(reservation,request)};
}

test('publication native scope receives the original request, live fence and transaction',async()=>{
 let captured;
 const f=fixture({scoped:async(...args)=>{captured=args;throw Error('generated scope refusal');}});
 await assert.rejects(f.publish(),unknown);
 assert.equal(captured[0],f.tx);assert.deepEqual(captured[1],f.scope);
 assert.equal(captured[2],true);assert.equal(captured[3],f.request);
 assert.deepEqual(f.reads,{host:0,prefix:0,owner:0});
});

test('publication cancellation reaches a started native read and still joins its original completion',async()=>{
 const entered=deferred(),release=deferred();let sawAbort=false,finished=false;
 const f=fixture({scoped:async(_tx,_scope,_live,request)=>{
  const cancelled=()=>{sawAbort=true;};request?.signal.addEventListener('abort',cancelled,{once:true});entered.resolve();
  try{await release.promise;throw Error('generated native refusal');}
  finally{request?.signal.removeEventListener('abort',cancelled);}
 }});
 const work=f.publish();work.then(()=>{finished=true;},()=>{finished=true;});
 try{await entered.promise;f.abort.abort();await turn();assert.equal(sawAbort,true);assert.equal(finished,false);}
 finally{release.resolve();await assert.rejects(work,unknown);}
 assert.equal(finished,true);assert.deepEqual(f.reads,{host:0,prefix:0,owner:0});
});

test('cancellation during Owner role validation starts no later native scope read',async()=>{
 const entered=deferred(),release=deferred();let scopes=0,roleReads=0;
 const f=fixture({owner:async()=>{if(++roleReads===2){entered.resolve();await release.promise;}},
  scoped:async()=>{scopes++;throw Error('unexpected scope read');}});
 const work=f.publish();work.catch(()=>{});await entered.promise;f.abort.abort();release.resolve();
 await assert.rejects(work,unknown);assert.equal(scopes,0);assert.deepEqual(f.reads,{host:0,prefix:0,owner:0});
});

test('cancellation during native scope observation starts no later Host observation',async()=>{
 const entered=deferred(),release=deferred();
 const f=fixture({scoped:async()=>{entered.resolve();await release.promise;return {c:{permit:{}},native:{}};}});
 const work=f.publish();work.catch(()=>{});await entered.promise;f.abort.abort();release.resolve();
 await assert.rejects(work,unknown);assert.deepEqual(f.reads,{host:0,prefix:0,owner:0});
});
