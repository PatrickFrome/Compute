import {createPhysicalReadGate} from './ui-read-flight.mjs';

export const DRAFT_SCOPE_TTL_MS=5000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/i;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const timestamp=value=>{
 if(typeof value!=='string')return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value?parsed:null;
};

// This namespace is presentation data. Neither it nor localStorage grants
// execution authority or protects against arbitrary same-origin JavaScript.
export function normalizeDraftScopeObservation(value,{now,requestedAt}){
 if(!Number.isFinite(now)||!Number.isFinite(requestedAt)||now<requestedAt
  ||!exact(value,['schema','state','scope','observed_at','expires_at','authority_effect','automatic_retry_allowed'])
  ||value.schema!=='metaengine.client.draft-scope.v1'||value.authority_effect!==false||value.automatic_retry_allowed!==false)return null;
 const observedAt=timestamp(value.observed_at);
 if(observedAt===null||observedAt<requestedAt||observedAt>now)return null;
 if(value.state==='UNKNOWN')return value.scope===null&&value.expires_at===null
  ?Object.freeze({state:'UNKNOWN',scope:null,observedAt,expiresAt:null}):null;
 const scope=value.scope,expiresAt=timestamp(value.expires_at);
 if(value.state!=='READY'||!exact(scope,['principal_kind','principal_id','workspace_id','project_id'])
  ||scope.principal_kind!=='ENROLLED_NATIVE_DEVICE'||typeof scope.principal_id!=='string'||!HASH.test(scope.principal_id)
  ||typeof scope.workspace_id!=='string'||!UUID.test(scope.workspace_id)||scope.project_id!==null
  ||expiresAt===null||expiresAt-observedAt!==DRAFT_SCOPE_TTL_MS)return null;
 const deadline=Math.min(expiresAt,requestedAt+DRAFT_SCOPE_TTL_MS);
 if(now>=deadline)return null;
 return Object.freeze({state:'READY',scope:Object.freeze({principalId:scope.principal_id.toLowerCase(),
  workspaceId:scope.workspace_id.toLowerCase(),projectId:null}),observedAt,expiresAt:deadline});
}

const INITIAL=Object.freeze({state:'UNKNOWN',scope:null,generation:0,observedAt:null,expiresAt:null});
const sameScope=(a,b)=>a&&b&&a.principalId===b.principalId&&a.workspaceId===b.workspaceId&&a.projectId===b.projectId;

export function createDraftScopeResource({bridge,now=Date.now,monotonicNow=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,
 onVisibilityChange=()=>()=>{}}){
 const flight=createPhysicalReadGate(),listeners=new Set();
 let snapshot=INITIAL,lifetime=0,poll=null,expiry=null,lease=null,unsubscribeVisibility=null;
 const current=epoch=>listeners.size>0&&lifetime===epoch;
 const publish=value=>{snapshot=Object.freeze(value);for(const listener of listeners)listener();};
 const fresh=()=>{
  const wall=now(),monotonic=monotonicNow();
  return snapshot.state==='READY'&&lease!==null&&wall>=snapshot.observedAt&&wall<snapshot.expiresAt
   &&monotonic>=lease.startedAt&&monotonic<lease.deadline;
 };
 const clearExpiry=()=>{if(expiry!==null)cancel(expiry);expiry=null;lease=null;};
 const unknown=()=>{
  clearExpiry();
  if(snapshot.state!=='UNKNOWN')publish({...INITIAL,generation:snapshot.generation+1});
 };
 const expire=()=>{if(snapshot.state==='READY'&&!fresh())unknown();};
 async function refresh(){
  if(!listeners.size)return;
  expire();
  if(flight.isBusy())return;
  let channel;
  try{channel=bridge();if(typeof channel?.draftScope!=='function'){unknown();return;}}
  catch{unknown();return;}
  const epoch=lifetime,requestedAt=now(),startedAt=monotonicNow();let timedOut=false;
  if(!Number.isFinite(startedAt)){unknown();return;}
  const read=flight.run(()=>{
   if(!current(epoch))throw Error('draft_scope_lifetime_changed');
   return channel.draftScope(); // The contract accepts no renderer arguments.
  });
  const deadline=schedule(()=>{timedOut=true;if(current(epoch))unknown();},DRAFT_SCOPE_TTL_MS);
  try{
   const value=await read;
   if(!current(epoch)||timedOut)return;
   expire();
   const elapsed=monotonicNow()-startedAt;
   if(!(elapsed>=0&&elapsed<DRAFT_SCOPE_TTL_MS)){unknown();return;}
   if(bridge()!==channel){unknown();return;}
   const next=normalizeDraftScopeObservation(value,{now:now(),requestedAt});
   if(!next||next.state!=='READY'){unknown();return;}
   let generation=snapshot.generation;
   if(!sameScope(snapshot.scope,next.scope)){
    generation++;
    if(snapshot.state==='READY')publish({...INITIAL,state:'CHANGED',generation});
   }
   const acceptedLease={startedAt,deadline:startedAt+DRAFT_SCOPE_TTL_MS};
   clearExpiry();lease=acceptedLease;publish({...next,generation});
   // Timer delivery expires this exact observation even if wall time stopped
   // or moved backwards. A queued older timer cannot revoke a renewed lease.
   expiry=schedule(()=>{if(lease===acceptedLease)unknown();},
    Math.max(0,Math.min(next.expiresAt-now(),acceptedLease.deadline-monotonicNow())));
  }catch{if(current(epoch)&&!timedOut)unknown();}
  finally{cancel(deadline);}
 }
 const queuePoll=()=>{poll=schedule(()=>{poll=null;void refresh();if(listeners.size)queuePoll();},2000);};
 return Object.freeze({
  getSnapshot:()=>snapshot,
  getServerSnapshot:()=>INITIAL,
  // Pure check: also fences callbacks before an overdue timer gets CPU time.
  isCurrent:generation=>listeners.size>0&&snapshot.generation===generation&&snapshot.state!=='CHANGED'
   &&(snapshot.state!=='READY'||fresh()),
  refresh,
  subscribe(listener){
   listeners.add(listener);
   if(listeners.size===1){
    lifetime++;
    // Child subscriptions can run before the Page subscription during React
    // hydration. Publish a fresh mount generation so their guards resubscribe.
    publish({...INITIAL,generation:snapshot.generation+1});
    void refresh();queuePoll();
    unsubscribeVisibility=onVisibilityChange(()=>{expire();void refresh();});
   }
   return ()=>{
    listeners.delete(listener);
    if(!listeners.size){
     lifetime++;if(poll!==null)cancel(poll);poll=null;clearExpiry();unsubscribeVisibility?.();unsubscribeVisibility=null;
     snapshot=Object.freeze({...INITIAL,generation:snapshot.generation+1});
     // Keep the physical flight until its promise settles. No cancellation is
     // available here; a remount cannot start an overlapping native operation.
    }
   };
  },
 });
}
