import test from 'node:test';
import assert from 'node:assert/strict';
import {clock, deferred, flush} from './ui-reliability-harness.mjs';
import {createDraftScopeResource, normalizeDraftScopeObservation} from './draft-scope.mjs';

const workspace='12345678-1234-4234-8234-123456789abc';
const ready=(at,principal='a'.repeat(64))=>({schema:'metaengine.client.draft-scope.v1',state:'READY',
 scope:{principal_kind:'ENROLLED_NATIVE_DEVICE',principal_id:principal,workspace_id:workspace,project_id:null},
 observed_at:new Date(at).toISOString(),expires_at:new Date(at+5000).toISOString(),authority_effect:false,automatic_retry_allowed:false});
const unknown=at=>({...ready(at),state:'UNKNOWN',scope:null,expires_at:null});
function fixture(){
 const time=clock(),reads=[],states=[];let channel;
 const bridge={draftScope(){const next=deferred();reads.push({at:time.now(),...next});return next.promise;}};
 channel=bridge;
 const resource=createDraftScopeResource({bridge:()=>channel,now:time.now,schedule:time.setTimeout,cancel:time.clearTimeout});
 return {time,reads,states,resource,bridge,replace:value=>{channel=value;},
  start:()=>resource.subscribe(()=>states.push(resource.getSnapshot())),
  resolve:(i,principal)=>reads[i].resolve(ready(reads[i].at,principal))};
}

test('draft scope accepts only exact dispatch-bound native device/workspace observations',()=>{
 const at=1800000000000,value=ready(at),options={now:at+50,requestedAt:at};
 const normalized=normalizeDraftScopeObservation(value,options);
 assert.equal(normalized.scope.principalId,'a'.repeat(64));assert.equal(normalized.scope.workspaceId,workspace);
 assert.equal(normalized.scope.projectId,null);assert.equal(normalized.expiresAt,at+5000);
 assert.equal(normalizeDraftScopeObservation(unknown(at),options).state,'UNKNOWN');
 for(const changed of [
  {...value,extra:true},{...value,authority_effect:true},{...value,automatic_retry_allowed:true},
  {...value,state:'CHANGED'},{...value,scope:{...value.scope,extra:true}},
  {...value,scope:{...value.scope,principal_kind:'HUMAN'}},
  {...value,scope:{...value.scope,principal_id:'not-a-hash'}},
  {...value,scope:{...value.scope,principal_id:['a'.repeat(64)]}},
  {...value,scope:{...value.scope,workspace_id:'folder-name'}},
  {...value,scope:{...value.scope,workspace_id:[workspace]}},
  {...value,scope:{...value.scope,project_id:workspace}},
  {...value,observed_at:new Date(at-1).toISOString()},
  {...value,observed_at:new Date(at+100).toISOString()},
  {...value,expires_at:new Date(at+5001).toISOString()},
  {...unknown(at),scope:value.scope},{...unknown(at),expires_at:value.expires_at},
 ])assert.equal(normalizeDraftScopeObservation(changed,options),null,JSON.stringify(changed));
 assert.equal(normalizeDraftScopeObservation(value,{now:at+5000,requestedAt:at}),null);
});

test('delayed native dispatch cannot extend the local read deadline',()=>{
 const at=1800000000000;
 const value=normalizeDraftScopeObservation(ready(at+1000),{requestedAt:at,now:at+2000});
 assert.equal(value.expiresAt,at+5000);
 assert.equal(normalizeDraftScopeObservation(ready(at+1000),{requestedAt:at,now:at+5000}),null);
});

test('scope expires independently of a hung next read and never overlaps it',async()=>{
 const f=fixture(),stop=f.start();await flush();f.resolve(0);await flush();
 const first=f.resource.getSnapshot();assert.equal(first.state,'READY');assert.equal(f.resource.isCurrent(first.generation),true);
 await f.time.advance(5000);assert.equal(f.reads.length,2);assert.equal(f.resource.getSnapshot().state,'UNKNOWN');
 assert.equal(f.resource.getSnapshot().scope,null);assert.equal(f.resource.isCurrent(first.generation),false);
 await f.time.advance(12000);assert.equal(f.reads.length,2);
 f.resolve(1);await flush();assert.equal(f.resource.getSnapshot().state,'UNKNOWN');
 await f.time.advance(1000);assert.equal(f.reads.length,3);f.resolve(2);await flush();
 assert.equal(f.resource.getSnapshot().state,'READY');assert.ok(f.resource.getSnapshot().generation>first.generation);stop();
});

test('A to UNKNOWN to A and A to B to A invalidate earlier callback generations',async()=>{
 const f=fixture(),stop=f.start();await flush();f.resolve(0);await flush();
 const a=f.resource.getSnapshot();await f.time.advance(2000);f.reads[1].resolve(unknown(f.reads[1].at));await flush();
 assert.equal(f.resource.isCurrent(a.generation),false);
 await f.time.advance(2000);f.resolve(2);await flush();const returned=f.resource.getSnapshot();
 assert.ok(returned.generation>a.generation);assert.equal(f.resource.isCurrent(a.generation),false);
 await f.time.advance(2000);f.resolve(3,'b'.repeat(64));await flush();const b=f.resource.getSnapshot();
 await f.time.advance(2000);f.resolve(4);await flush();
 assert.ok(f.resource.getSnapshot().generation>b.generation);
 assert.equal(f.resource.isCurrent(returned.generation),false);assert.equal(f.resource.isCurrent(b.generation),false);
 assert.ok(f.states.some(s=>s.state==='CHANGED'&&s.scope===null));stop();
});

test('renewing the same still-fresh scope keeps its callback generation',async()=>{
 const f=fixture(),stop=f.start();await flush();f.resolve(0);await flush();const generation=f.resource.getSnapshot().generation;
 await f.time.advance(2000);f.resolve(1);await flush();assert.equal(f.resource.getSnapshot().generation,generation);stop();
});

test('late responses from an unmounted lifetime cannot populate a remounted page',async()=>{
 const f=fixture(),stop=f.start();await flush();const generation=f.resource.getSnapshot().generation;
 stop();assert.equal(f.resource.isCurrent(generation),false);const stopAgain=f.start();await flush();
 assert.equal(f.reads.length,1);f.resolve(0);await flush();assert.equal(f.resource.getSnapshot().state,'UNKNOWN');
 await f.time.advance(2000);f.resolve(1);await flush();assert.equal(f.resource.getSnapshot().state,'READY');stopAgain();
});

test('missing bridge, malformed reply, rejection and replaced bridge hide the previous namespace',async()=>{
 for(const mode of ['missing','malformed','reject','replaced']){
  const f=fixture(),stop=f.start();await flush();f.resolve(0);await flush();
  if(mode==='missing')f.replace(null);
  await f.time.advance(2000);
  if(mode==='malformed')f.reads[1].resolve({...ready(f.reads[1].at),authority_effect:true});
  if(mode==='reject')f.reads[1].reject(Error('private native details'));
  if(mode==='replaced'){f.replace({draftScope:()=>Promise.resolve(unknown(f.time.now()))});f.resolve(1);}
  await flush();assert.equal(f.resource.getSnapshot().state,'UNKNOWN',mode);assert.equal(f.resource.getSnapshot().scope,null);stop();
 }
});
