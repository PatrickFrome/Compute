// Native composition only. A resolved promise is not a physical worker-tree
// witness. Keep project journals and the Host capability until that witness.
export async function drainManagedRuntimeBindings({coding=null,codingHost=null,projectRuntime=null,host=null}={}){
  if(coding){
    const result=await coding.close();
    if(result?.schema!=='metaengine.native-coding.runtime.v1'||result.shutdown_state!=='DRAINED'
      ||result.worker_cleanup_confirmed!==true)throw Error('managed_runtime_worker_cleanup_unconfirmed');
  }
  codingHost?.close();
  await projectRuntime?.close();
  await host?.close();
  return Object.freeze({schema:'metaengine.managed-runtime-drain.v1',cleanup_confirmed:true,
    interrupted_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false});
}
