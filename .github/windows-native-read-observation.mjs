import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {readWindowsSandboxHostBoot} from '../apps/metaengine-browser/src/codex-cli-sandbox-probe.mjs';
import {readNativeCodingWindowsProcess} from '../apps/metaengine-browser/src/native-coding-host-observers.mjs';

const diagnosticDeadline = 60000;
const phasePrefix = 'ME_NATIVE_READ_STAGE_V1 ';
const phaseStages = Object.freeze({
  kernel_boot: Object.freeze(['PS_ENTER','MODULE_IMPORT_BEGIN','MODULE_IMPORT_END','NATIVE_BIND_READY','BOOT_FIRST_READ','SYSTEM_CIM_BEGIN','SYSTEM_CIM_END',
    'OS_CIM_BEGIN','OS_CIM_END','SYSTEM_CONFIRM_BEGIN','SYSTEM_CONFIRM_END','BOOT_CONFIRM_END','JSON_BEGIN','JSON_END']),
  own_process: Object.freeze(['PS_ENTER','MODULE_IMPORT_BEGIN','MODULE_IMPORT_END','PROCESS_HANDLE_READY','PROCESS_IMAGE_READY','PROCESS_CIM_BEGIN','PROCESS_CIM_END',
    'PROCESS_OWNER_BEGIN','PROCESS_OWNER_END','OUTPUT_BEGIN','OUTPUT_END']),
});
const phase = label => `[Console]::Error.WriteLine('${phasePrefix}${label} '+$metaengineReadObservationClock.ElapsedMilliseconds);[Console]::Error.Flush()`;
const cimImport = String.raw`Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\CimCmdlets\CimCmdlets.psd1' -ErrorAction Stop`;
const utilityImport = String.raw`Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop`;

// Instrument only the two fixed diagnostic commands, with exact unique anchors.
// No stdout, query, binding, identity check or production script is changed.
export function instrumentWindowsNativeReadScript(reader, source) {
  const invalid=()=>Error('native_read_observation_source_anchor_invalid');
  if(typeof source!=='string'||!Object.hasOwn(phaseStages,reader)||source.includes('metaengineReadObservationClock')||source.includes(phasePrefix))throw invalid();
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const edits=reader==='kernel_boot'?[
    [utilityImport,phase('MODULE_IMPORT_BEGIN'),false],
    [cimImport,phase('MODULE_IMPORT_END'),true],
    ["$native=$type.CreateType()",phase('NATIVE_BIND_READY'),true],
    ["$boot=Read-KernelBootId",phase('BOOT_FIRST_READ'),true],
    ["$system=Get-CimInstance Win32_Process -Filter 'ProcessId=4' -Property Name,CreationDate",phase('SYSTEM_CIM_BEGIN'),false],
    ["$system=Get-CimInstance Win32_Process -Filter 'ProcessId=4' -Property Name,CreationDate",phase('SYSTEM_CIM_END'),true],
    ["$os=Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime,Version",phase('OS_CIM_BEGIN'),false],
    ["$os=Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime,Version",phase('OS_CIM_END'),true],
    ["$again=Get-CimInstance Win32_Process -Filter 'ProcessId=4' -Property Name,CreationDate",phase('SYSTEM_CONFIRM_BEGIN'),false],
    ["$again=Get-CimInstance Win32_Process -Filter 'ProcessId=4' -Property Name,CreationDate",phase('SYSTEM_CONFIRM_END'),true],
    ["if(-not $again -or $again.CreationDate.ToUniversalTime().ToFileTimeUtc() -ne $birth.ToFileTimeUtc() -or (Read-KernelBootId) -ne $boot){throw 'kernel_boot_changed'}",phase('BOOT_CONFIRM_END'),true],
    ["@{schema='metaengine.windows.kernel-boot.v1';kernel_boot_id=$boot;",phase('JSON_BEGIN'),false],
    ["last_boot_at=$os.LastBootUpTime.ToUniversalTime().ToString('o');os_version=$os.Version}|ConvertTo-Json -Depth 4 -Compress",phase('JSON_END'),true],
  ]:[
    [utilityImport,phase('MODULE_IMPORT_BEGIN'),false],
    [cimImport,phase('MODULE_IMPORT_END'),true],
    ["if($p.Handle -eq [IntPtr]::Zero -or $p.Id -ne $n){throw 'native_process_handle'}",phase('PROCESS_HANDLE_READY'),true],
    ["$birth=$p.StartTime.ToUniversalTime(); $image=$p.MainModule.FileName",phase('PROCESS_IMAGE_READY'),true],
    ["$c=Get-CimInstance Win32_Process -Filter ('ProcessId='+$n)",phase('PROCESS_CIM_BEGIN'),false],
    ["$c=Get-CimInstance Win32_Process -Filter ('ProcessId='+$n)",phase('PROCESS_CIM_END'),true],
    ["$owner=Invoke-CimMethod -InputObject $c -MethodName GetOwnerSid",phase('PROCESS_OWNER_BEGIN'),false],
    ["$owner=Invoke-CimMethod -InputObject $c -MethodName GetOwnerSid",phase('PROCESS_OWNER_END'),true],
    ["$b64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($image))",phase('OUTPUT_BEGIN'),false],
    ["} finally {$p.Dispose()}",phase('OUTPUT_END'),true],
  ];
  const positions=edits.map(([anchor,marker,after],order)=>{
    if(source.split(anchor).length!==2)throw invalid();
    // A marker after a partial command would split any new arguments and
    // turn them into executable diagnostic text. Refuse unreviewed suffixes.
    const next=source[source.indexOf(anchor)+anchor.length];
    if(after&&next!==undefined&&!['\r','\n',';'].includes(next))throw invalid();
    return {at:source.indexOf(anchor)+(after?anchor.length:0),text:after?eol+marker:marker+eol,order};
  });
  for(const edit of positions.sort((a,b)=>b.at-a.at||b.order-a.order))source=source.slice(0,edit.at)+edit.text+source.slice(edit.at);
  return '$metaengineReadObservationClock=[Diagnostics.Stopwatch]::StartNew()'+eol+phase('PS_ENTER')+eol+source;
}

export function parseWindowsNativeReadPhases(reader, stderr) {
  if(!Object.hasOwn(phaseStages,reader))throw Error('native_read_observation_reader_invalid');
  const labels=phaseStages[reader];
  const bytes=Buffer.from(typeof stderr==='string'?stderr:'');
  const overflow=bytes.length>65536, text=bytes.subarray(0,65536).toString('utf8');
  const stages=[];let unknown=0,invalid=false,lastStage=-1,lastTime=-1;
  for(const line of text.split(/\r?\n/)){
    if(!line)continue;
    const match=/^ME_NATIVE_READ_STAGE_V1 ([A-Z_]+) ([0-9]{1,6})$/.exec(line);
    const index=match?labels.indexOf(match[1]):-1, elapsed=match?Number(match[2]):-1;
    if(index>lastStage&&elapsed>=lastTime&&elapsed<=120000){lastStage=index;lastTime=elapsed;stages.push({stage:labels[index],elapsed_ms:elapsed});}
    else{unknown=Math.min(65537,unknown+Buffer.byteLength(line));if(line.startsWith(phasePrefix))invalid=true;}
  }
  return {stages,unknown_stderr_bytes:Math.min(65537,unknown+Math.max(0,bytes.length-65536)),phase_stream_invalid:invalid,phase_stream_overflow:overflow};
}

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
    let calls=0, scopeInvalid=false, transportSucceeded=false, settled=null, outcome='READ_FAILED', stderr='';
    const started=now();
    const exec=(executable,args,options)=>{
      if(scopeInvalid || calls!==0 || options?.timeout!==productionDeadline || options.shell!==false
        || executable.replaceAll('/','\\').toLowerCase()!=='c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe'
        || !Array.isArray(args) || args.length!==5 || args.slice(0,4).join(' ')!=='-NoLogo -NoProfile -NonInteractive -EncodedCommand'){
        scopeInvalid=true;throw Error('native_read_observation_scope_invalid');}
      let observedArgs;
      try{
        if(typeof args[4]!=='string'||Buffer.from(args[4],'base64').toString('base64')!==args[4])throw Error('encoding');
        observedArgs=[...args.slice(0,4),Buffer.from(instrumentWindowsNativeReadScript(name,Buffer.from(args[4],'base64').toString('utf16le')),'utf16le').toString('base64')];
      }catch{scopeInvalid=true;throw Error('native_read_observation_source_invalid');}
      // Return the original Promise, including .child: inventory closes stdin.
      calls++;
      const pending=execute(executable,observedArgs,{...options,timeout:diagnosticDeadline});
      if(!pending||typeof pending.then!=='function'){scopeInvalid=true;throw Error('native_read_observation_transport_invalid');}
      settled=Promise.resolve(pending).then(result=>{transportSucceeded=true;stderr=result?.stderr;},error=>{stderr=error?.stderr;});
      return pending;
    };
    try { await read(exec); if(settled)await settled; if(calls===1&&!scopeInvalid&&transportSucceeded)outcome='READ_RETURNED'; }
    catch { /* Never export native errors, rows, commands, or credentials. */ }
    finally { if(settled)await settled; }
    const record={schema:'metaengine.ci.native-read-duration-observation.v2',reader:name,observed_at:new Date().toISOString(),
      elapsed_ms:Math.round(Math.max(0,now()-started)),production_timeout_ms:productionDeadline,
      diagnostic_timeout_ms:diagnosticDeadline,transport_calls:calls,outcome,
      ...parseWindowsNativeReadPhases(name,stderr),
      phase_timing_observation_only:true,
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
