import {signLoadedRunOwnerRead} from './native-coding-device-request.mjs';
import {readVerifiedInstalledExecutableW68} from './installed-executable-provenance-w68.mjs';
import {readWindowsKernelProcessW60} from './host-native-owner-producers-w60.mjs';

// Direct read facet for the ORIGINAL transaction's scope. It never sends IPC,
// starts another SQL transaction, drains the parent ticket, enrolls, or promotes
// cached evidence. Every invocation performs the existing W74/W68/kernel read.
export function createLoadedNativeRunOwnerCallback(options={}){return ownerReadContext(options).callback;}
function ownerReadContext({identity,capability,app,assertOpen}={}){
 if(typeof assertOpen!=='function'||typeof identity?.readLoadedRunOwnerW74!=='function'
   ||typeof identity.snapshot!=='function'||typeof capability?.snapshot!=='function')throw Error('native_run_owner_main_unbound');
 assertOpen();const before=structuredClone(identity.snapshot()),host=structuredClone(capability.snapshot());
 const open=()=>{assertOpen();const current=identity.snapshot(),live=capability.snapshot();
  if(['device_id','client_id','key_fingerprint_sha256','enrolled'].some(k=>current[k]!==before[k])
   ||live.closed||['instance_id','host_pid'].some(k=>live[k]!==host[k]))throw Error('native_run_owner_main_changed');};
 open();
 const callback=async scope=>{
  open();if(typeof scope?.assertOpen!=='function'||!scope.signal||scope.signal.aborted)throw Error('native_run_owner_main_scope_closed');
  const lifetime=()=>{open();scope.assertOpen();if(scope.signal.aborted)throw Error('native_run_owner_main_scope_closed');};
  lifetime();const value=await identity.readLoadedRunOwnerW74({scope,signal:scope.signal,assertLifetime:lifetime,
   readSourceProof:()=>{lifetime();return readVerifiedInstalledExecutableW68(app);},
   readNativeKernel:pid=>{lifetime();return readWindowsKernelProcessW60(pid);}});
  lifetime();return value;
 };
 return {callback,open};
}

// Standalone diagnostic uses the same direct callback under its own fixed read
// request. Publication must consume the callback directly, not call this wrapper
// recursively from inside the still-running RESERVE/publication ticket.
export async function readLoadedNativeRunOwner({identity,capability,input,app,assertOpen}={}){
 if(typeof capability?.withRunOwnerScope!=='function')throw Error('native_run_owner_main_unbound');
 const {callback,open}=ownerReadContext({identity,capability,app,assertOpen});
 const request=await signLoadedRunOwnerRead({identity,binding:capability.snapshot(),input});open();
 const result=await capability.withRunOwnerScope(request,callback);open();return result;
}
