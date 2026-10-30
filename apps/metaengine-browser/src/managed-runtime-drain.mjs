import {nativeHostScopeCleanupHold} from './native-host-scope-cleanup.mjs';
// Native composition only. A resolved promise is not a physical worker-tree
// witness. Keep project journals and the Host capability until that witness.
const workerDrains=new WeakMap();
export async function drainManagedRuntimeWorkers(coding){
  if(coding){
    const staged=typeof coding.drainNativeWorkers==='function';
    if(staged&&typeof coding.drainClosedWork!=='function')throw Error('managed_runtime_full_cleanup_unbound');
    const result=await (staged?coding.drainNativeWorkers():coding.close());
    if(staged?(result?.schema!=='metaengine.native-coding.runtime-worker-drain.v1'||result.admission_fenced!==true||result.worker_cleanup_confirmed!==true||result.authority_effect!==false)
      :(result?.schema!=='metaengine.native-coding.runtime.v1'||result.shutdown_state!=='DRAINED'||result.worker_cleanup_confirmed!==true))throw Error('managed_runtime_worker_cleanup_unconfirmed');
  }
  const proof=Object.freeze({cleanup_confirmed:true});workerDrains.set(proof,coding);return proof;
}
export async function drainManagedRuntimeBindings({coding=null,codingHost=null,projectRuntime=null,host=null,workerDrain=null}={}){
  if(!workerDrain||!workerDrains.has(workerDrain)||workerDrains.get(workerDrain)!==coding)await drainManagedRuntimeWorkers(coding);
  if(typeof coding?.drainClosedWork==='function'){const result=await coding.drainClosedWork();
    if(result?.schema!=='metaengine.native-coding.runtime.v1'||result.shutdown_state!=='DRAINED'||result.worker_cleanup_confirmed!==true)throw Error('managed_runtime_full_cleanup_unconfirmed');}
  if(codingHost?.drainPhysical){let proof;try{proof=await codingHost.drainPhysical();}catch{throw nativeHostScopeCleanupHold();}
    if(proof?.schema!=='metaengine.native-coding.physical-drain.v1'||proof.cleanup_confirmed!==true)throw nativeHostScopeCleanupHold();}
  codingHost?.close();
  await projectRuntime?.close();
  await host?.close();
  return Object.freeze({schema:'metaengine.managed-runtime-drain.v1',cleanup_confirmed:true,
    interrupted_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false});
}
