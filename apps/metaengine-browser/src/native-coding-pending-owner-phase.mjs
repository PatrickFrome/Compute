// Private, fixed-purpose phase protocol on the already-owned Host ChildProcess.
// No SQL, paths, Owner JSON, keys, credentials, renderer or public status API.
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
export const PENDING_OWNER_PHASE='metaengine.native-coding.pending-owner-phase.v1';
export const PENDING_OWNER_ACTIONS=Object.freeze(['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1']);
const fail=()=>{throw Error('native_pending_owner_phase_invalid');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const KEYS=['instance_id','host_pid','request_id','action','request_sha256','body_sha256'];
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});return{promise,resolve,reject};};
export function pendingOwnerScope(value){
 if(!exact(value,['device_id','client_id','key_fingerprint_sha256','admin_grant_epoch','project_id','observed_at'])
  ||![value.device_id,value.client_id,value.project_id].every(v=>UUID.test(v||''))
  ||!HASH.test(value.key_fingerprint_sha256||'')||!Number.isSafeInteger(value.admin_grant_epoch)||value.admin_grant_epoch<1
  ||!Number.isFinite(Date.parse(value.observed_at))||new Date(value.observed_at).toISOString()!==value.observed_at)fail();
 return Object.freeze(structuredClone(value));
}
export function pendingOwnerTransition(value){
 if(!exact(value,['previous_sha256','next_sha256'])||value.previous_sha256!==null||!HASH.test(value.next_sha256||''))fail();
 return Object.freeze({...value});
}
function binding(value){
 if(!exact(value,KEYS)||![value.instance_id,value.request_id].every(v=>UUID.test(v||''))
  ||!Number.isSafeInteger(value.host_pid)||value.host_pid<1||!PENDING_OWNER_ACTIONS.includes(value.action)
  ||![value.request_sha256,value.body_sha256].every(v=>HASH.test(v||'')))fail();
 return Object.freeze({...value});
}
function frame(b,sequence,phase,value){return{schema:PENDING_OWNER_PHASE,...b,sequence,phase,value};}
function validate(message,b){
 if(!exact(message,['schema',...KEYS,'sequence','phase','value'])||message.schema!==PENDING_OWNER_PHASE
  ||KEYS.some(k=>message[k]!==b[k])||!Number.isSafeInteger(message.sequence)||message.sequence<0||message.sequence>7
  ||Buffer.byteLength(json(message))>4096)fail();
}
function empty(v){if(!exact(v,[]))fail();}

export function createPendingOwnerHostPhases({binding:raw,send,signal}={}){
 const b=binding(raw),write=b.action==='ESTABLISH_PENDING_OWNER_V1';
 let closed=false,started=false,waiting=null,inProgress=false,sequence=0,reads=0,prepared=false,verified=false;
 const open=()=>{if(closed||signal?.aborted)fail();};
 function close(){closed=true;waiting?.reject(Error('native_pending_owner_phase_closed'));waiting=null;}
 signal?.addEventListener('abort',close,{once:true});
 function receive(message,handle){
  if(message?.schema!==PENDING_OWNER_PHASE||message.request_id!==b.request_id)return false;
  try{open();validate(message,b);if(handle||!started||inProgress||!waiting||message.sequence!==sequence+1)fail();
   const gate=waiting;waiting=null;inProgress=true;gate.resolve(message);
  }catch{close();}return true;
 }
 async function run(initial,handlers){
  open();if(started)fail();started=true;
  try{
   let next=deferred();waiting=next;
   send(frame(b,0,'LOCKED',pendingOwnerScope(initial)));
   for(;;){
    const message=await next.promise;open();sequence=message.sequence;
    let result={};
    if(message.phase==='ABORT'){empty(message.value);fail();}
    if(message.phase==='RECHECK_SCOPE'){
     empty(message.value);
     if(write?(reads>=4||reads>0&&!prepared):(reads!==0||verified))fail();
     result=pendingOwnerScope(await handlers.readScope());reads++;
    }else if(message.phase==='PREPARE_TRANSITION'){
     if(!write||prepared||reads!==1)fail();
     const transition=pendingOwnerTransition(message.value);
     await handlers.prepareTransition(transition);prepared=true;
    }else if(message.phase==='VERIFY_TRANSITION'){
     if(write||verified||reads!==1||!exact(message.value,['sealed_sha256'])||!HASH.test(message.value.sealed_sha256||''))fail();
     await handlers.verifyTransition(message.value);verified=true;
    }else if(message.phase==='RELEASE'){
     empty(message.value);if(write?(!prepared||reads!==4):(!verified||reads!==1))fail();
     await handlers.readScope();open();
     return Object.freeze({schema:'metaengine.native-coding.pending-owner-release.v1',state:'RELEASED',authority_effect:false});
    }else fail();
    open();next=deferred();waiting=next;inProgress=false;
    send(frame(b,sequence,'ACK',result));
   }
  }finally{close();signal?.removeEventListener('abort',close);}
 }
 return Object.freeze({receive,run,close});
}

export function createPendingOwnerClientPhases({binding:raw,send,callback,assertLifetime}={}){
 const b=binding(raw),write=b.action==='ESTABLISH_PENDING_OWNER_V1';
 if(typeof callback!=='function'||typeof assertLifetime!=='function')fail();
 let closed=false,started=false,sequence=0,waiting=null,scope=null,work=Promise.resolve(),result=null,released=false,reads=0,prepared=false,verified=false,waitingPhase=null;
 const open=()=>{if(closed)fail();assertLifetime();};
 const transmit=(phase,value)=>{
  open();if(waiting||released)fail();sequence++;if(sequence>7)fail();
  const gate=deferred();waiting=gate;waitingPhase=phase;
  try{send(frame(b,sequence,phase,value));}catch{close();}
  return gate.promise;
 };
 function close(){closed=true;waiting?.reject(Error('native_pending_owner_phase_closed'));waiting=null;}
 function receive(message,handle){
  if(message?.schema!==PENDING_OWNER_PHASE||message.request_id!==b.request_id)return false;
  try{
   open();validate(message,b);if(handle)fail();
   if(message.phase==='LOCKED'){
    if(started||message.sequence!==0)fail();started=true;scope=pendingOwnerScope(message.value);
    const fixed=scope;
    const readScope=async()=>{
     if(write?(reads>=4||reads>0&&!prepared):(reads!==0||verified))fail();
     const current=pendingOwnerScope(await transmit('RECHECK_SCOPE',{}));
     if(['device_id','client_id','key_fingerprint_sha256','admin_grant_epoch','project_id'].some(k=>current[k]!==fixed[k]))fail();
     scope=current;reads++;return{project_id:current.project_id,device_id:current.device_id,client_id:current.client_id,
      admin_grant_epoch:current.admin_grant_epoch,observed_at:current.observed_at};
    };
    const tx=Object.freeze({assertOpen:open,readScope,
     readAuthenticatedAdmin:async()=>{open();return{device_id:scope.device_id,client_id:scope.client_id,
      admin_grant_epoch:scope.admin_grant_epoch,access_tier:'ADMIN',admin_ready:true};},
     ...(write?{prepareTransition:async value=>{if(prepared||reads!==1)fail();await transmit('PREPARE_TRANSITION',pendingOwnerTransition(value));prepared=true;}}:
      {verifyTransition:async value=>{if(verified||reads!==1||!exact(value,['sealed_sha256'])||!HASH.test(value.sealed_sha256||''))fail();await transmit('VERIFY_TRANSITION',value);verified=true;}}),
    });
    work=Promise.resolve().then(()=>callback(tx)).then(value=>{
     open();if(value==null)fail();result=value;
     if(waiting||(write?(!prepared||reads!==4):(!verified||reads!==1)))fail();sequence++;released=true;send(frame(b,sequence,'RELEASE',{}));
    }).catch(()=>{
     if(!closed&&!released){try{sequence++;send(frame(b,sequence,'ABORT',{}));}catch{}}
     close();
    });
   }else{
    if(!started||!waiting||message.phase!=='ACK'||message.sequence!==sequence)fail();
    if(waitingPhase==='RECHECK_SCOPE')pendingOwnerScope(message.value);else empty(message.value);
    const gate=waiting;waiting=null;waitingPhase=null;gate.resolve(message.value);
   }
  }catch{close();}return true;
 }
 async function finish(value){
  if(!released){close();await work;fail();}
  await work;open();
  if(!exact(value,['schema','state','authority_effect'])||value.schema!=='metaengine.native-coding.pending-owner-release.v1'
   ||value.state!=='RELEASED'||value.authority_effect!==false)fail();
  close();return result;
 }
 return Object.freeze({receive,finish,close,drain:()=>work});
}
