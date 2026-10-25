import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = code => {throw new Error('runtime_recovery_'+code);};
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Fixed kernel read only. No WMI, Add-Type, PATH resolution, model command,
// caller-supplied script, process termination or authority from a Guardian plan.
export async function readRuntimeRecoveryProcess(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) fail('process_query_invalid');
  const root = 'C:\\Windows';
  if (String(process.env.SystemRoot || process.env.SYSTEMROOT || '').toLowerCase() !== root.toLowerCase()) fail('windows_root_unverified');
  const script = `$ErrorActionPreference='Stop'
[Console]::Error.WriteLine('RUNTIME_RECOVERY_PHASE_SCRIPT_STARTED')
$n=[int]$env:METAENGINE_RECOVERY_QUERY_PID
try {$p=[Diagnostics.Process]::GetProcessById($n)} catch {
 $x=$_.Exception
 if($x.GetType().FullName -ceq 'System.Management.Automation.MethodInvocationException' -and $null -ne $x.InnerException -and $x.InnerException.GetType().FullName -ceq 'System.ArgumentException' -and [string]::IsNullOrEmpty([string]$x.InnerException.ParamName)){
  [Console]::Out.WriteLine('{"state":"ABSENT","pid":'+$n+'}');exit 0
 };throw
}
try {
 if($p.Handle -eq [IntPtr]::Zero -or $p.Id -ne $n){throw 'PROCESS_HANDLE_UNVERIFIED'}
 [Console]::Error.WriteLine('RUNTIME_RECOVERY_PHASE_PROCESS_OPENED')
 $birth=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
 $exe=$p.MainModule.FileName
 if(-not $exe -or $p.HasExited){throw 'PROCESS_FIELDS_UNVERIFIED'}
 [Console]::Error.WriteLine('RUNTIME_RECOVERY_PHASE_FIELDS_READ')
 $b64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($exe))
 [Console]::Out.WriteLine('{"state":"PRESENT","pid":'+$n+',"created_100ns":"'+$birth+'","exe_b64":"'+$b64+'"}')
 [Console]::Error.WriteLine('RUNTIME_RECOVERY_PHASE_RESULT_WRITTEN')
} finally {$p.Dispose()}`;
  let value;
  try {
    const pending = exec(path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,shell:false,timeout:30000,maxBuffer:8192,env:{SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
        PATH:path.win32.join(root,'System32'),PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
        METAENGINE_RECOVERY_QUERY_PID:String(pid)}});
    pending.child.stdin?.end();
    value = JSON.parse((await pending).stdout.trim());
  } catch(error) {
    const phases=String(error?.stderr||'').match(/RUNTIME_RECOVERY_PHASE_(?:SCRIPT_STARTED|PROCESS_OPENED|FIELDS_READ|RESULT_WRITTEN)/g);
    const phase=phases?.at(-1)?.slice('RUNTIME_RECOVERY_PHASE_'.length).toLowerCase()||'not_started';
    fail('process_query_'+(error?.killed===true||error?.code==='ETIMEDOUT'?'timeout_':'unconfirmed_')+phase);
  }
  if (value?.pid !== pid) fail('process_query_unbound');
  if (value.state === 'ABSENT' && Object.keys(value).sort().join(',') === 'pid,state') {
    return Object.freeze({schema:'metaengine.browser.runtime-recovery-process.v1',state:'ABSENT',pid,authority_effect:false});
  }
  if (Object.keys(value).sort().join(',') !== 'created_100ns,exe_b64,pid,state' || value.state !== 'PRESENT'
    || !/^[1-9][0-9]{16,18}$/.test(value.created_100ns || '') || typeof value.exe_b64 !== 'string' || value.exe_b64.length > 4096) fail('process_query_unbound');
  const exe = Buffer.from(value.exe_b64,'base64');
  if (exe.toString('base64') !== value.exe_b64 || !exe.length) fail('process_image_invalid');
  let executable;
  try {executable = new TextDecoder('utf8',{fatal:true}).decode(exe);} catch {fail('process_image_invalid');}
  if (!path.isAbsolute(executable) || /[\x00-\x1f]/.test(executable)) fail('process_image_invalid');
  return Object.freeze({schema:'metaengine.browser.runtime-recovery-process.v1',state:'PRESENT',pid,
    created_100ns:value.created_100ns,executable,authority_effect:false});
}

async function canonicalFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /^(?:\\\\|\/\/)/.test(file) || /[\x00-\x1f]/.test(file)) fail('image_path_invalid');
  const resolved = path.resolve(file), real = await fs.realpath(resolved);
  let current = path.parse(resolved).root;
  for (const part of path.relative(current,resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);if ((await fs.lstat(current)).isSymbolicLink()) fail('image_alias');
  }
  const stat = await fs.lstat(real);
  if (!samePath(real,resolved) || !stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024*1024*1024) fail('image_file_invalid');
  return real;
}
async function executableDigest(file) {
  const physical = await canonicalFile(file), before = await fs.stat(physical), hash = createHash('sha256');
  for await (const chunk of createReadStream(physical)) hash.update(chunk);
  const after = await fs.stat(physical);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('image_changed');
  return hash.digest('hex');
}

export function sameRuntimeRecoveryProcess(a,b) {
  return Boolean(a && b && a.pid === b.pid && a.created_100ns === b.created_100ns
    && typeof a.executable === 'string' && typeof b.executable === 'string' && samePath(a.executable,b.executable)
    && HASH.test(a.executable_sha256 || '') && a.executable_sha256 === b.executable_sha256);
}

// main receives an Electron app object, never an executable/PID/shell from IPC.
// app.relaunch is the actual same-version effect adapter. Returning from it is
// only a request; success requires the successor's normal-bootstrap readback.
export function createSameExecutableRuntimeRecoveryAdapter({app,beforeRelaunch,readProcess=readRuntimeRecoveryProcess}={}) {
  if (app?.isPackaged !== true || typeof app.getPath !== 'function' || typeof app.relaunch !== 'function' || typeof app.quit !== 'function'
    || typeof readProcess !== 'function' || typeof beforeRelaunch !== 'function') fail('packaged_app_required');
  async function capture() {
    const executable = await canonicalFile(app.getPath('exe'));
    const before = await readProcess(process.pid);
    if (before?.state !== 'PRESENT' || before.pid !== process.pid || before.authority_effect !== false
      || !/^[1-9][0-9]{16,18}$/.test(before.created_100ns || '') || !samePath(before.executable,executable)) fail('own_process_unbound');
    const executable_sha256 = await executableDigest(executable);
    const after = await readProcess(process.pid);
    if (after?.state !== 'PRESENT' || after.pid !== before.pid || after.created_100ns !== before.created_100ns
      || !samePath(after.executable,executable)) fail('own_process_changed');
    return Object.freeze({schema:'metaengine.browser.runtime-recovery-browser.v1',pid:process.pid,
      created_100ns:before.created_100ns,executable,executable_sha256,authority_effect:false});
  }
  return Object.freeze({capture, readProcess,
    async requestRelaunch(ticket,expected) {
      if (!UUID.test(ticket || '')) fail('relaunch_binding_changed');
      // Native main coordinates Sentinel's expected transition and its own quit
      // reason here. That callback supplies no executable/arguments or effect
      // authority; the durable transaction has already crossed its barrier.
      await beforeRelaunch(ticket);
      if (!sameRuntimeRecoveryProcess(await capture(),expected)) fail('relaunch_binding_changed');
      app.relaunch({execPath:expected.executable,args:['--metaengine-runtime-recovery='+ticket]});
      app.quit();
      return Object.freeze({schema:'metaengine.browser.runtime-recovery-request.v1',state:'REQUESTED',
        ticket_id:ticket,successor_ready:false,automatic_retry_allowed:false,authority_effect:false});
    },
  });
}
