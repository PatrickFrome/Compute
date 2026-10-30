import {signLoadedRunOwnerRead} from './native-coding-device-request.mjs';
import {readVerifiedInstalledExecutableW68} from './installed-executable-provenance-w68.mjs';
import {readWindowsKernelProcessW60} from './host-native-owner-producers-w60.mjs';

// Private native Main composition. No ensure, enrollment, cache promotion or
// global W74 binding. The caller owns the original capability and quit order.
export async function readLoadedNativeRunOwner({identity,capability,input,app,assertOpen}={}){
 if(typeof assertOpen!=='function'||typeof identity?.readLoadedRunOwnerW74!=='function'||typeof capability?.withRunOwnerScope!=='function')
  throw Error('native_run_owner_main_unbound');
 assertOpen();const before=identity.snapshot();
 const open=()=>{assertOpen();const current=identity.snapshot();
  if(['device_id','client_id','key_fingerprint_sha256','enrolled'].some(k=>current[k]!==before[k])||capability.snapshot().closed)
   throw Error('native_run_owner_main_changed');};
 const request=await signLoadedRunOwnerRead({identity,binding:capability.snapshot(),input});open();
 const result=await capability.withRunOwnerScope(request,scope=>identity.readLoadedRunOwnerW74({scope,signal:scope.signal,assertLifetime:open,
  readSourceProof:()=>readVerifiedInstalledExecutableW68(app),readNativeKernel:pid=>readWindowsKernelProcessW60(pid)}));
 open();return result;
}
