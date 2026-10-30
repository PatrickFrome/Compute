import {pendingOwnerScope} from './native-coding-pending-owner-phase.mjs';
// Private, fixed-purpose phase protocol on the already-owned Host ChildProcess.
// No SQL, paths, Owner JSON, keys, credentials, renderer or public status API.
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
export const PENDING_ACTIVATION_PHASE='metaengine.native-coding.pending-activation-phase.v1';
export const PENDING_ACTIVATION_ACTIONS=Object.freeze(['ACTIVATE_PREPARED_GOAL_V1']);
const fail=()=>{throw Error('native_pending_activation_phase_invalid');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const KEYS=['instance_id','host_pid','request_id','action','request_sha256','body_sha256'];
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});return{promise,resolve,reject};};
export function pendingActivationInput(v){
 if(!exact(v,['preparation_id','configuration_sha256','request_id','objective','activation_id','profile_id','profile_sha256'])
  ||![v.preparation_id,v.request_id,v.activation_id,v.profile_id].every(x=>UUID.test(x||''))
  ||![v.configuration_sha256,v.profile_sha256].every(x=>HASH.test(x||''))
  ||typeof v.objective!=='string'||!v.objective||v.objective!==v.objective.trim()||[...v.objective].length>480
  ||Buffer.byteLength(v.objective)>1920||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.objective))fail();
 return Object.freeze(structuredClone(v));
}
export function pendingActivationScope(value){
 if(!exact(value,['schema','input','scope','artifact'])||value.schema!=='metaengine.native-coding.pending-activation-scope.v1')fail();
 pendingActivationInput(value.input);pendingOwnerScope(value.scope);
 if(!exact(value.artifact,['installed_exe_sha256','installed_asar_sha256','runtime_bundle_sha256','source_sha','cli_executable_sha256'])
  ||!Object.entries(value.artifact).every(([k,v])=>(k==='source_sha'?/^[a-f0-9]{40}$/:HASH).test(v||'')))fail();
 return Object.freeze(structuredClone(value));
}
function binding(value){
 if(!exact(value,KEYS)||![value.instance_id,value.request_id].every(v=>UUID.test(v||''))
  ||!Number.isSafeInteger(value.host_pid)||value.host_pid<1||!PENDING_ACTIVATION_ACTIONS.includes(value.action)
  ||![value.request_sha256,value.body_sha256].every(v=>HASH.test(v||'')))fail();
 return Object.freeze({...value});
}
function frame(b,sequence,phase,value){return{schema:PENDING_ACTIVATION_PHASE,...b,sequence,phase,value};}
function validate(message,b){
 if(!exact(message,['schema',...KEYS,'sequence','phase','value'])||message.schema!==PENDING_ACTIVATION_PHASE
  ||KEYS.some(k=>message[k]!==b[k])||!Number.isSafeInteger(message.sequence)||message.sequence<0||message.sequence>7
  ||Buffer.byteLength(json(message))>4096)fail();
}
function empty(v){if(!exact(v,[]))fail();}

export function createPendingActivationHostPhases({binding:raw,send,signal}={}){
 const b=binding(raw);
 let closed=false,started=false,waiting=null,inProgress=false,sequence=0,reads=0,verified=false,sealed=null;
 const open=()=>{if(closed||signal?.aborted)fail();};
 function close(){closed=true;waiting?.reject(Error('native_pending_activation_phase_closed'));waiting=null;signal?.removeEventListener('abort',close);}
 signal?.addEventListener('abort',close,{once:true});
 function receive(message,handle){
  if(message?.schema!==PENDING_ACTIVATION_PHASE||message.request_id!==b.request_id)return false;
  try{open();validate(message,b);if(handle||!started||inProgress||!waiting||message.sequence!==sequence+1)fail();
   const gate=waiting;waiting=null;inProgress=true;gate.resolve(message);
  }catch{close();}return true;
 }
 async function run(initial,handlers){
  open();if(started)fail();started=true;
  try{
   let next=deferred();waiting=next;
   send(frame(b,0,'LOCKED',pendingActivationScope(initial)));
   for(;;){
    const message=await next.promise;open();sequence=message.sequence;
    let result={};
    if(message.phase==='ABORT'){empty(message.value);fail();}
    if(message.phase==='RECHECK_SCOPE'){
     empty(message.value);
     if(reads!==0||verified)fail();
     result=pendingActivationScope(await handlers.readScope());reads++;
    }else if(message.phase==='VERIFY_TRANSITION'){
     if(verified||reads!==1||!exact(message.value,['sealed_sha256'])||!HASH.test(message.value.sealed_sha256||''))fail();
     await handlers.verifyTransition(message.value);verified=true;sealed=message.value.sealed_sha256;
    }else if(message.phase==='RELEASE'){
     empty(message.value);if(!verified||reads!==1)fail();
     await handlers.readScope();open();
     return Object.freeze({sealed_sha256:sealed});
    }else fail();
    open();next=deferred();waiting=next;inProgress=false;
    send(frame(b,sequence,'ACK',result));
   }
  }catch(error){close();throw error;}
 }
 return Object.freeze({receive,authorize:run,assertOpen:open,close});
}

export function createPendingActivationClientPhases({binding:raw,send,callback,assertLifetime,input}={}){
 const b=binding(raw);
 const expected=pendingActivationInput(input);
 if(typeof callback!=='function'||typeof assertLifetime!=='function')fail();
 let closed=false,started=false,sequence=0,waiting=null,scope=null,work=Promise.resolve(),released=false,reads=0,verified=false,waitingPhase=null;
 const open=()=>{if(closed)fail();assertLifetime();};
 const transmit=(phase,value)=>{
  open();if(waiting||released)fail();sequence++;if(sequence>7)fail();
  const gate=deferred();waiting=gate;waitingPhase=phase;
  try{send(frame(b,sequence,phase,value));}catch{close();}
  return gate.promise;
 };
 function close(){closed=true;waiting?.reject(Error('native_pending_activation_phase_closed'));waiting=null;}
 function receive(message,handle){
  if(message?.schema!==PENDING_ACTIVATION_PHASE||message.request_id!==b.request_id)return false;
  try{
   open();validate(message,b);if(handle)fail();
   if(message.phase==='LOCKED'){
    if(started||message.sequence!==0)fail();started=true;scope=pendingActivationScope(message.value);if(json(scope.input)!==json(expected))fail();
    const fixed=scope;
    const readScope=async()=>{
     if(reads!==0||verified)fail();
     const current=pendingActivationScope(await transmit('RECHECK_SCOPE',{}));
     if(json({...current,scope:{...current.scope,observed_at:null}})!==json({...fixed,scope:{...fixed.scope,observed_at:null}}))fail();
     scope=current;reads++;return structuredClone(current.scope);
    };
    const tx=Object.freeze({assertOpen:open,readScope,activation:structuredClone(fixed),
     readAuthenticatedAdmin:async()=>{open();return{device_id:scope.scope.device_id,client_id:scope.scope.client_id,
      admin_grant_epoch:scope.scope.admin_grant_epoch,access_tier:'ADMIN',admin_ready:true};},
     verifyTransition:async value=>{if(verified||reads!==1||!exact(value,['sealed_sha256'])||!HASH.test(value.sealed_sha256||''))fail();await transmit('VERIFY_TRANSITION',value);verified=true;},
    });
    work=Promise.resolve().then(()=>callback(tx)).then(value=>{
     open();if(value==null)fail();
     if(waiting||!verified||reads!==1)fail();sequence++;released=true;send(frame(b,sequence,'RELEASE',{}));
    }).catch(()=>{
     if(!closed&&!released){try{sequence++;send(frame(b,sequence,'ABORT',{}));}catch{}}
     close();
    });
   }else{
    if(!started||!waiting||message.phase!=='ACK'||message.sequence!==sequence)fail();
    if(waitingPhase==='RECHECK_SCOPE')pendingActivationScope(message.value);else empty(message.value);
    const gate=waiting;waiting=null;waitingPhase=null;gate.resolve(message.value);
   }
  }catch{close();}return true;
 }
 async function finish(value){
  if(!released){close();await work;fail();}
  await work;open();
  close();return value;
 }
 return Object.freeze({receive,finish,close,drain:()=>work});
}
