// Native-main-only custody retained after an initialization rejects. No renderer
// methods, effect retries, alternative Host or elapsed-time settlement.
const held=new WeakSet();
export const nativeHostScopeCleanupHeld=error=>!!error&&held.has(error);
export const nativeHostScopeCleanupHold=()=>{const error=Error('native_host_scope_cleanup_unconfirmed');held.add(error);return error;};
export function createNativeHostScopeCleanup({capability,unbind=null}={}){
 if(typeof capability?.drainPhysical!=='function'||typeof capability?.close!=='function'||unbind!==null&&typeof unbind!=='function')throw Error('native_host_scope_cleanup_dependencies');
 let cleaned=false,pending=null;
 function close(){
  if(cleaned)return Promise.resolve();if(pending)return pending;
  const work=(async()=>{
   let proof;try{proof=await capability.drainPhysical({wait:false});}catch{throw nativeHostScopeCleanupHold();}
   if(proof?.schema!=='metaengine.native-coding.physical-drain.v1'||proof.cleanup_confirmed!==true)throw nativeHostScopeCleanupHold();
   await unbind?.();capability.close();cleaned=true;
  })();
  pending=work;const done=()=>{if(pending===work)pending=null;};work.then(done,done);return work;
 }
 return Object.freeze({close,whenSettled:()=>capability.drainPhysical(),snapshot:()=>Object.freeze({state:cleaned?'CLOSED':'HOLD',cleanup_confirmed:cleaned,authority_effect:false})});
}
export async function drainNativeHostScopeCleanups(records,{cleanup,quit=false,drainWorkers,stopHost}={}){
 const remaining=[];
 for(const record of records){
  try{await cleanup(record);}catch(error){if(record.kind!=='HOST_SCOPE'||!nativeHostScopeCleanupHeld(error))throw error;remaining.push({record,error});}
 }
 if(!remaining.length)return;
 if(!quit)throw remaining[0].error;
 // Only an explicit quit may request existing owned Host shutdown. A positive
 // native worker-tree drain MUST precede it; false/timeout never falls through.
 await drainWorkers();
 const stopped=await stopHost();
 if(stopped?.cleanup_confirmed!==true)throw remaining[0].error;
 for(const {record} of remaining)await cleanup(record); // Each exact capability independently rechecks its generation.
}
