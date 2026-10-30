import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPendingOwnerHostPhases,createPendingOwnerClientPhases,PENDING_OWNER_PHASE} from '../src/native-coding-pending-owner-phase.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture({write=true,callback,alterClient=v=>v,alterHost=v=>v}={}){
 const binding={instance_id:randomUUID(),host_pid:1234,request_id:randomUUID(),action:write?'ESTABLISH_PENDING_OWNER_V1':'READ_PENDING_OWNER_V1',request_sha256:'a'.repeat(64),body_sha256:'b'.repeat(64)};
 const scope={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'c'.repeat(64),admin_grant_epoch:7,project_id:randomUUID(),observed_at:new Date().toISOString()};
 const transition={previous_sha256:null,next_sha256:'d'.repeat(64)},events=[],controller=new AbortController();let preparations=0,verifications=0;
 let host,client;
 host=createPendingOwnerHostPhases({binding,signal:controller.signal,send:message=>{events.push(['HOST',message]);queueMicrotask(()=>client.receive(alterHost(structuredClone(message))));}});
 client=createPendingOwnerClientPhases({binding,assertLifetime:()=>{},send:message=>{events.push(['MAIN',message]);queueMicrotask(()=>host.receive(alterClient(structuredClone(message))));},
  callback:callback||(async tx=>{
   await tx.readScope();
   if(write){assert.equal(tx.verifyTransition,undefined);await tx.prepareTransition(transition);for(let i=0;i<3;i++)await tx.readScope();}
   else{assert.equal(tx.prepareTransition,undefined);await tx.verifyTransition({sealed_sha256:transition.next_sha256});}
   return{localOnly:'not sent over phase wire'};
  })});
 const run=()=>host.run(scope,{readScope:async()=>scope,prepareTransition:async value=>{assert.deepEqual(value,transition);preparations++;},
  verifyTransition:async value=>{assert.equal(value.sealed_sha256,transition.next_sha256);verifications++;}}).then(value=>client.finish(value),async error=>{client.close();await client.drain();throw error;});
 return{binding,scope,transition,host,client,events,controller,run,get preparations(){return preparations;},get verifications(){return verifications;}};
}
for(const write of [true,false])test(`private pending Owner ${write?'write':'read'} phase lifecycle has fixed capability set`,async()=>{
 const f=fixture({write});const value=await f.run();assert.deepEqual(value,{localOnly:'not sent over phase wire'});
 assert.equal(f.preparations,write?1:0);assert.equal(f.verifications,write?0:1);
 assert.equal(JSON.stringify(f.events).includes('localOnly'),false);
 assert.deepEqual(f.events.filter(x=>x[0]==='MAIN').map(x=>x[1].phase),write?
  ['RECHECK_SCOPE','PREPARE_TRANSITION','RECHECK_SCOPE','RECHECK_SCOPE','RECHECK_SCOPE','RELEASE']:
  ['RECHECK_SCOPE','VERIFY_TRANSITION','RELEASE']);
});
for(const key of ['request_sha256','body_sha256','instance_id','host_pid','action','sequence'])test(`private phase rejects changed ${key} correlation`,async()=>{
 const f=fixture({alterClient:message=>({...message,[key]:key==='sequence'?message.sequence+1:'wrong'})});
 await assert.rejects(f.run());assert.equal(f.preparations,0);
});
test('duplicate or reordered phase cannot prepare twice',async()=>{
 const f=fixture({callback:async tx=>{await tx.readScope();await tx.prepareTransition({previous_sha256:null,next_sha256:'d'.repeat(64)});await tx.prepareTransition({previous_sha256:null,next_sha256:'d'.repeat(64)});return true;}});
 await assert.rejects(f.run());assert.equal(f.preparations,1);
});
test('read facade cannot emit preparation and reordered verify has no effect',async()=>{
 const f=fixture({write:false,callback:async tx=>{assert.equal(tx.prepareTransition,undefined);await tx.verifyTransition({sealed_sha256:'d'.repeat(64)});return true;}});
 await assert.rejects(f.run());assert.equal(f.preparations,0);assert.equal(f.verifications,0);
});
test('cancellation rejects phase waits but joins an already-started main native callback',async()=>{
 const entered=deferred(),gate=deferred();let finished=false;
 const f=fixture({callback:async tx=>{await tx.readScope();entered.resolve();await gate.promise;finished=true;tx.assertOpen();return true;}});
 const pending=f.run();pending.catch(()=>{});await entered.promise;f.controller.abort();
 let settled=false;pending.catch(()=>{settled=true;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 gate.resolve();await assert.rejects(pending);assert.equal(finished,true);assert.equal(f.preparations,0);
});
test('premature outer completion closes the callback instead of orphaning its phase wait',async()=>{
 const gate=deferred();
 const f=fixture({callback:async tx=>{gate.resolve();await tx.readScope();return true;},alterClient:message=>({...message,request_id:randomUUID()})});
 const hostWork=f.host.run(f.scope,{readScope:async()=>f.scope});hostWork.catch(()=>{});
 await gate.promise;await assert.rejects(f.client.finish({schema:'metaengine.native-coding.pending-owner-release.v1',state:'RELEASED',authority_effect:false}));
 f.host.close();await assert.rejects(hostWork);
});

for(const variant of ['malformed-ack','duplicate-locked'])test(`private client refuses ${variant} without another prepared transition`,async()=>{
 let first;
 const f=fixture({alterHost:message=>{
  if(message.phase==='LOCKED')first=structuredClone(message);
  if(message.phase==='ACK')return variant==='malformed-ack'?{...message,value:{secret:'not scope'}}:first;
  return message;
 }});
 const pending=f.run();pending.catch(()=>{});
 await new Promise(r=>setImmediate(r));f.controller.abort();
 await assert.rejects(pending);assert.equal(f.preparations,0);
});
