import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {readWindowsSandboxHostBoot} from '../apps/metaengine-browser/src/codex-cli-sandbox-probe.mjs';
import {readNativeCodingWindowsProcess} from '../apps/metaengine-browser/src/native-coding-host-observers.mjs';

const diagnosticDeadline = 60000;
// CI-only observation after a failed native probe. This never changes the
// production readers, repairs their failed result, or emits their private data.
// These later reads may run under different warm/load conditions; no causality claim.
export async function observeWindowsNativeReads({platform=process.platform, execute=promisify(execFile),
  readBoot=readWindowsSandboxHostBoot, readProcess=readNativeCodingWindowsProcess,
  now=()=>performance.now(), emit=value=>console.log(JSON.stringify(value))}={}) {
  if(platform!=='win32')throw Error('native_read_observation_windows_required');
  const records=[];
  for(const [name, productionDeadline, read] of [
    ['kernel_boot',12000,exec=>readBoot({exec})],
    ['own_process',15000,exec=>readProcess(process.pid,{exec})],
  ]) {
    let calls=0, scopeInvalid=false, transportSucceeded=false, settled=null, outcome='READ_FAILED';
    const started=now();
    const exec=(executable,args,options)=>{
      if(scopeInvalid || calls!==0 || options?.timeout!==productionDeadline || options.shell!==false
        || executable.replaceAll('/','\\').toLowerCase()!=='c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe'
        || !Array.isArray(args) || !args.includes('-EncodedCommand')){scopeInvalid=true;throw Error('native_read_observation_scope_invalid');}
      // Return the original Promise, including .child: inventory closes stdin.
      calls++;
      const pending=execute(executable,args,{...options,timeout:diagnosticDeadline});
      if(!pending||typeof pending.then!=='function'){scopeInvalid=true;throw Error('native_read_observation_transport_invalid');}
      settled=Promise.resolve(pending).then(()=>{transportSucceeded=true;},()=>{});
      return pending;
    };
    try { await read(exec); if(settled)await settled; if(calls===1&&!scopeInvalid&&transportSucceeded)outcome='READ_RETURNED'; }
    catch { /* Never export native errors, rows, commands, or credentials. */ }
    finally { if(settled)await settled; }
    const record={schema:'metaengine.ci.native-read-duration-observation.v1',reader:name,observed_at:new Date().toISOString(),
      elapsed_ms:Math.round(Math.max(0,now()-started)),production_timeout_ms:productionDeadline,
      diagnostic_timeout_ms:diagnosticDeadline,transport_calls:calls,outcome,
      original_probe_result_replaced:false,authority_effect:false,native_qualification_proven:false,causal_attribution_proven:false};
    records.push(record);emit(record);
  }
  return records;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length!==2)throw Error('native_read_observation_arguments_invalid');
  const records=await observeWindowsNativeReads();
  if(records.some(row=>row.outcome!=='READ_RETURNED'))process.exitCode=1;
}
