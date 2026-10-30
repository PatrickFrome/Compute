import {nativeCodingCanonicalSha256} from './native-coding-task-context.mjs';
import {signNativeCodingDeviceRequest,signLoadedNativeSetupRouteRead} from './native-coding-device-request.mjs';
const fail=()=>{throw Error('client_native_setup_route_unverified');};
const fields=['schema','workspace_id','repository_scope_sha256','device_id','client_id','key_fingerprint_sha256','admin_grant_epoch','host_instance_id','host_pid','retained_intent','scope_resolved',
 'prepared','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'];
// Main-only readback. A null protected configuration needs actual current-device
// absence proof; a missing file by itself says nothing about retained SQL intent.
async function readRoute({repository,identity,capability,assertOpen=()=>{}}={},sign){
 const before=identity.snapshot(),binding=capability.snapshot(),workspace_id=repository?.coordination_workspace_id??null;
 const check=()=>{assertOpen();const after=identity.snapshot();if(['device_id','client_id','key_fingerprint_sha256'].some(k=>before[k]!==after[k]))fail();};
 check();const signed=await sign({identity,binding,operation:'READ_NATIVE_SETUP_ROUTE_V1',input:{workspace_id}});check();
 const value=await capability.readNativeSetupRoute(signed);check();
 if(!value||Object.keys(value).sort().join('|')!==[...fields].sort().join('|')||value.schema!=='metaengine.native-coding.setup-route.v1'
  ||value.workspace_id!==workspace_id||['device_id','client_id','key_fingerprint_sha256'].some(k=>value[k]!==before[k])
  ||value.host_instance_id!==binding.instance_id||value.host_pid!==binding.host_pid
  ||!Number.isSafeInteger(value.admin_grant_epoch)||value.admin_grant_epoch<1
  ||typeof value.retained_intent!=='boolean'||value.scope_resolved!==(workspace_id!==null||!value.retained_intent)
  ||['prepared','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>value[k]!==false))fail();
 const expected=repository?{coordination_workspace_id:workspace_id,repo_id:repository.repo_id,repo_root:repository.repo_root,managed_root:repository.managed_root,
  device_id:before.device_id,client_id:before.client_id,admin_grant_epoch:value.admin_grant_epoch}:null;
 const digest=expected?nativeCodingCanonicalSha256(expected):null;
 if(value.repository_scope_sha256!==digest)fail();
 return Object.freeze({retained_intent:value.retained_intent,scope_resolved:value.scope_resolved,authority_effect:false});
}

export const readClientNativeSetupRoute=options=>readRoute(options,signNativeCodingDeviceRequest);
export const readLoadedClientNativeSetupRoute=options=>readRoute(options,signLoadedNativeSetupRouteRead);
