import path from 'node:path';
import {runtimeHostPidState} from '../../../infra/client-state-runtime/runtime-host-orphan-reconciliation.mjs';
import {readWindowsKernelProcessW60} from '../src/host-native-owner-producers-w60.mjs';

// Local manual-forward readback only. A PID reused by a later, unrelated
// executable is not the former owned process. Unknown observations stay held.
export function createForwardPriorPidReadback({config,status,readNative=readWindowsKernelProcessW60,pidState=runtimeHostPidState,now=Date.now}={}) {
  const root=config?.bundle_directory,stateDirectory=config?.state_directory,observed=Date.parse(status?.checked_at||'');
  const children=status?.children;
  const valid=process.platform==='win32' && typeof root==='string' && path.win32.isAbsolute(root)
    && !root.startsWith('\\\\') && typeof stateDirectory==='string' && path.win32.isAbsolute(stateDirectory)
    && !stateDirectory.startsWith('\\\\') && Number.isFinite(observed) && observed<=now()
    && status?.state==='READY' && status.runtime_ready===true
    && status.bundle_sha256===config?.expected_bundle_sha256
    && Number.isSafeInteger(status.host_pid) && status.host_pid>0
    && Array.isArray(children) && children.length===2
    && new Set(children.map(c=>c?.name)).size===2
    && children.every(c=>['api','edge'].includes(c?.name)&&Number.isSafeInteger(c.pid)&&c.pid>0)
    && new Set([status.host_pid,...children.map(c=>c.pid)]).size===3;
  const pids=valid?new Set([status.host_pid,...children.map(c=>c.pid)]):new Set();
  return async pid=>{
    const state=pidState(pid);
    if(state!=='PRESENT'||!pids.has(pid))return state;
    const native=await readNative(pid);
    if(native?.state!=='PRESENT'||native.source!=='OS_PROCESS_INVENTORY'||native.pid!==pid||native.authority_effect!==false
      ||!Number.isFinite(Date.parse(native.created_at))||Date.parse(native.created_at)<=observed||Date.parse(native.created_at)>now()+5000
      ||typeof native.exe_path!=='string'||!path.win32.isAbsolute(native.exe_path)||native.exe_path.startsWith('\\\\'))return 'PRESENT';
    // Edge is launched from the Host's private staged Deno directory, not
    // necessarily from the immutable bundle itself.
    for(const owned of [root,path.win32.join(stateDirectory,'deno-runtime')]){
      const relative=path.win32.relative(owned.toLowerCase(),native.exe_path.toLowerCase());
      if(!relative||(!relative.startsWith('..'+path.win32.sep)&&relative!=='..'&&!path.win32.isAbsolute(relative)))return 'PRESENT';
    }
    return 'ABSENT';
  };
}
