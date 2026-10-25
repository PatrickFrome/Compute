import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixedWindowsNativeReadEnvironment } from './windows-native-read-environment.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import { codexCliEnvironment, codexCliTemporaryEnvironment } from './codex-cli-runner.mjs';

export const CODEX_SANDBOX_PROBE_SCHEMA = 'metaengine.codex-cli.sandbox-probe.v1';
const POWERSHELL = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const execFileAsync = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const modeValid = mode => ['workspace-write', 'read-only'].includes(mode);
const isWithin = (root, file) => { const rel = path.relative(root, file); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

// These overrides match exec's explicit legacy --sandbox mode. The sandbox
// command has no --ignore-user-config, so inherited writable roots are reset.
export function buildCodexSandboxProbeArgs({ mode, workspaceRoot, scriptPath, powershellPath = POWERSHELL }) {
  if (!modeValid(mode) || ![workspaceRoot, scriptPath, powershellPath].every(value => path.isAbsolute(value))) throw Error('codex_sandbox_probe_arguments_invalid');
  return ['-a', 'never', '-c', 'windows.sandbox="elevated"', '-c', `sandbox_mode="${mode}"`,
    '-c', 'sandbox_workspace_write.writable_roots=[]', '-c', 'sandbox_workspace_write.network_access=false',
    'sandbox', '--include-managed-config', '--permission-profile', mode === 'workspace-write' ? ':workspace' : ':read-only',
    '-C', workspaceRoot, '--', powershellPath, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
}

function canaryScript(input) {
  const payload = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  return `$ErrorActionPreference='Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
function Try-Write([string]$file, [string]$kind) {
  try {
    if ($kind -eq 'append') { [IO.File]::AppendAllText($file, $data.nonce) }
    else { [IO.File]::WriteAllText($file, $data.nonce) }
    return @{ outcome='WRITTEN'; access_denied=$false }
  } catch {
    $errorObject=$_.Exception
    while ($errorObject.InnerException) { $errorObject=$errorObject.InnerException }
    return @{ outcome='ERROR'; access_denied=($errorObject -is [UnauthorizedAccessException]); error_type=$errorObject.GetType().FullName }
  }
}
$process=[Diagnostics.Process]::GetCurrentProcess()
$report=@{
  schema='metaengine.codex-cli.sandbox-canary.v1'; mode=$data.mode
  pid=$PID; started_at=$process.StartTime.ToUniversalTime().ToString('o')
  user_sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  inside_append=(Try-Write $data.inside_existing 'append')
  inside_create=(Try-Write $data.inside_new 'create')
  outside_append=(Try-Write $data.outside_existing 'append')
  outside_create=(Try-Write $data.outside_new 'create')
}
[Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 5 -Compress))
[Console]::Out.Flush()
# Keep the process alive briefly for independent host PID/birth/SID readback.
Start-Sleep -Seconds 10
`;
}

export async function readWindowsSandboxProcess(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1) throw Error('codex_sandbox_native_process_invalid');
  const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if(-not $p){exit 3}; $sid=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid; if($sid.ReturnValue -ne 0){exit 4}; @{pid=[int]$p.ProcessId; started_at=$p.CreationDate.ToUniversalTime().ToString('o'); user_sid=$sid.Sid; executable_path=$p.ExecutablePath} | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim());
}

// BootId is the kernel boot sequence (not a wall-clock-derived boot time):
// https://learn.microsoft.com/windows-hardware/drivers/ddi/ntddk/ns-ntddk-kuser_shared_data
// Its current-process telemetry field has the published SDK structure:
// https://learn.microsoft.com/windows/win32/devnotes/process_telemetry_id_information_type
// PID4's exact kernel-created FILETIME supplies an independent anchor. A boot
// configuration GUID and WMI's computed LastBootUpTime are not authority.
export function windowsSandboxBootIdentity(value){
  const p=value?.system_process,ms=Date.parse(p?.created_at||'');
  if(value?.schema!=='metaengine.windows.kernel-boot.v1'||!Number.isSafeInteger(value.kernel_boot_id)
    ||value.kernel_boot_id<1||value.kernel_boot_id>0xffffffff||p?.pid!==4||!Number.isFinite(ms)
    ||new Date(ms).toISOString()!==p.created_at||!/^[1-9][0-9]{16,18}$/.test(p.created_100ns||'')
    ||(BigInt(p.created_100ns)-116444736000000000n)/10000n!==BigInt(ms)
    ||!Number.isFinite(Date.parse(value.last_boot_at||''))||!/^\d+\.\d+\.\d+$/.test(value.os_version||''))
    throw Error('codex_sandbox_host_boot_unverified');
  return `${value.kernel_boot_id}:${p.created_100ns}`;
}
export async function readWindowsSandboxHostBoot({exec=execFileAsync,platform=process.platform}={}) {
  if(platform!=='win32')throw Error('codex_sandbox_probe_windows_required');
  // Emit only the fixed P/Invoke signature in memory. Compiling even a tiny C#
  // class through WinPS Add-Type invokes the external compiler on this bounded
  // read path. The native API, telemetry layout and double-read fence stay the
  // same; no assembly file, cache, caller-selected DLL or fallback is loaded.
  const script=`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Microsoft.PowerShell.Core\\Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\CimCmdlets\\CimCmdlets.psd1' -ErrorAction Stop
Microsoft.PowerShell.Core\\Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('MetaengineKernelBoot'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
$module=$assembly.DefineDynamicModule('Native')
$type=$module.DefineType('MetaengineKernelBoot.Native',[Reflection.TypeAttributes]::Public -bor [Reflection.TypeAttributes]::Abstract -bor [Reflection.TypeAttributes]::Sealed)
$parameters=[Type[]]@([IntPtr],[int],[IntPtr],[uint32],[uint32].MakeByRefType())
$method=$type.DefinePInvokeMethod('NtQueryInformationProcess','C:\\Windows\\System32\\ntdll.dll','NtQueryInformationProcess',[Reflection.MethodAttributes]::Public -bor [Reflection.MethodAttributes]::Static -bor [Reflection.MethodAttributes]::PinvokeImpl,[Reflection.CallingConventions]::Standard,[int],$parameters,[Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::None)
$method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
[void]$method.DefineParameter(5,[Reflection.ParameterAttributes]::Out,'returnLength')
$native=$type.CreateType()
function Read-KernelBootId {
 $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(65536)
 try {
  [uint32]$returned=0
  $status=$native::NtQueryInformationProcess([IntPtr]::new(-1),64,$buffer,65536,[ref]$returned)
  if($status -ne 0 -or $returned -lt 96 -or $returned -gt 65536){throw 'boot_telemetry_layout'}
  $header=[BitConverter]::ToUInt32([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt32($buffer,0)),0)
  $processId=[BitConverter]::ToUInt32([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt32($buffer,4)),0)
  $bootId=[BitConverter]::ToUInt32([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt32($buffer,60)),0)
  if($header -lt 96 -or $header -gt $returned -or $processId -ne [Diagnostics.Process]::GetCurrentProcess().Id -or $bootId -eq 0){throw 'boot_telemetry_scope'}
  return $bootId
 } finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
}
$boot=Read-KernelBootId
$system=Get-CimInstance Win32_Process -Filter 'ProcessId=4'
if(-not $system -or $system.Name -ne 'System' -or -not $system.CreationDate){throw 'system_process_absent'}
$birth=$system.CreationDate.ToUniversalTime();$os=Get-CimInstance Win32_OperatingSystem
$again=Get-CimInstance Win32_Process -Filter 'ProcessId=4'
if(-not $again -or $again.CreationDate.ToUniversalTime().ToFileTimeUtc() -ne $birth.ToFileTimeUtc() -or (Read-KernelBootId) -ne $boot){throw 'kernel_boot_changed'}
@{schema='metaengine.windows.kernel-boot.v1';kernel_boot_id=$boot;
system_process=@{pid=4;created_at=$birth.ToString('o');created_100ns=$birth.ToFileTimeUtc().ToString()};
last_boot_at=$os.LastBootUpTime.ToUniversalTime().ToString('o');os_version=$os.Version}|ConvertTo-Json -Depth 4 -Compress`;
  const pending=exec(POWERSHELL,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,shell:false,timeout:12000,maxBuffer:8192,env:fixedWindowsNativeReadEnvironment()});
  // This fixed encoded read has no interactive input; close its unused pipe
  // before awaiting completion, just like the native process inventory reader.
  pending.child?.stdin?.end();
  const {stdout}=await pending;
  const value=JSON.parse(stdout.trim());
  if(value.system_process)value.system_process.created_at=new Date(value.system_process.created_at).toISOString();
  windowsSandboxBootIdentity(value);return value;
}

const denied = value => value?.outcome === 'ERROR' && value.access_denied === true && value.error_type === 'System.UnauthorizedAccessException';
const wrote = value => value?.outcome === 'WRITTEN' && value.access_denied === false;

// A valid CLI flag or a Job Object is insufficient. Both the sandbox process
// incarnation and the host's independent file readback must match.
export function evaluateCodexSandboxProbe({ mode, report, nativeProcess, hostReadback, completion, hostUserSid, hostBootIdentity }) {
  if (!modeValid(mode)) throw Error('codex_sandbox_probe_mode_invalid');
  const blocked = reason => Object.freeze({ state: 'BLOCKED', reason, boundary_observed: false, execution_authorized: false, authority_effect: false });
  if (completion?.exit_code !== 0 || completion?.signal || completion?.reason || completion?.tree_cleanup_confirmed !== true) return blocked('SANDBOX_COMMAND_TERMINATION_UNVERIFIED');
  if (report?.schema !== 'metaengine.codex-cli.sandbox-canary.v1' || report.mode !== mode) return blocked('SANDBOX_CANARY_REPORT_INVALID');
  const birth = Date.parse(report.started_at), nativeBirth = Date.parse(nativeProcess?.started_at);
  try{windowsSandboxBootIdentity(hostBootIdentity);}catch{return blocked('SANDBOX_BOOT_IDENTITY_UNVERIFIED');}
  if(Number.isFinite(nativeBirth)&&nativeBirth<Date.parse(hostBootIdentity.system_process.created_at))return blocked('SANDBOX_OBSERVATION_BEFORE_CURRENT_BOOT');
  if (!Number.isSafeInteger(report.pid) || report.pid < 1 || nativeProcess?.pid !== report.pid || !Number.isFinite(birth)
    || !Number.isFinite(nativeBirth) || Math.abs(birth - nativeBirth) > 2 || !/^S-1-5-/.test(String(hostUserSid))
    || !/^S-1-5-/.test(String(nativeProcess?.user_sid)) || nativeProcess.user_sid !== report.user_sid
    || report.user_sid === hostUserSid) return blocked('SANDBOX_NATIVE_INCARNATION_UNVERIFIED');
  if (!denied(report.outside_append) || !denied(report.outside_create)
    || hostReadback?.outside_existing_unchanged !== true || hostReadback?.outside_new_absent !== true) return blocked('SANDBOX_OUTSIDE_WRITE_BOUNDARY_FAILED');
  const insideValid = mode === 'workspace-write'
    ? wrote(report.inside_append) && wrote(report.inside_create) && hostReadback.inside_existing_appended === true && hostReadback.inside_new_written === true
    : denied(report.inside_append) && denied(report.inside_create) && hostReadback.inside_existing_unchanged === true && hostReadback.inside_new_absent === true;
  if (!insideValid) return blocked('SANDBOX_WORKSPACE_WRITE_POLICY_FAILED');
  return Object.freeze({ state: 'OBSERVED', reason: null, boundary_observed: true, sandbox_backend: 'CODEX_WINDOWS_ELEVATED', mode,
    execution_authorized: false, authority_effect: false });
}

// No model, provider, credential or configuration-file operation occurs here.
// processController must enforce suspended -> Job binding -> resume and prove
// termination of the entire CLI tree. It is a lifetime control, not a sandbox.
export async function runCodexCliSandboxProbe({ cliPath, workspaceRoot, receiptDirectory, mode, processController,
  hostUserSid, readNativeProcess = readWindowsSandboxProcess, readHostBoot = readWindowsSandboxHostBoot,
  timeoutMs = 120000, powershellPath = POWERSHELL, onProcessStarted = null } = {}) {
  if (process.platform !== 'win32') throw Error('codex_sandbox_probe_windows_required');
  if (!modeValid(mode) || ![cliPath, workspaceRoot, receiptDirectory, powershellPath].every(value => typeof value === 'string' && path.isAbsolute(value))
    || typeof processController?.spawn !== 'function' || typeof readNativeProcess !== 'function' || typeof readHostBoot !== 'function' || !/^S-1-5-/.test(String(hostUserSid))
    || (onProcessStarted !== null && typeof onProcessStarted !== 'function')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 15000 || timeoutMs > 300000) throw Error('codex_sandbox_probe_configuration_invalid');
  const workspace = await fs.realpath(workspaceRoot), receipts = await fs.realpath(receiptDirectory);
  const hostBoot = await readHostBoot();windowsSandboxBootIdentity(hostBoot);
  if (receipts === workspace || isWithin(workspace, receipts)) throw Error('codex_sandbox_probe_outside_root_required');
  const runId = randomUUID(), directory = path.join(workspace, `.metaengine-sandbox-probe-${runId}`);
  const receipt = path.join(receipts, `sandbox-probe-${mode}-${runId}.json`);
  const scratchParent = path.join(process.env.LOCALAPPDATA || '', 'METAENGINE', 'operator-qa-scratch');
  if (!path.isAbsolute(scratchParent) || isWithin(receipts, scratchParent) || isWithin(workspace, scratchParent)) throw Error('codex_sandbox_probe_scratch_root_invalid');
  let createdScratchParent = false;
  try { await fs.mkdir(scratchParent); createdScratchParent = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (createdScratchParent) await protectOwnerOnlyWindowsDirectory(scratchParent);
  else await verifyOwnerOnlyWindowsStorage(scratchParent, { operation: 'VERIFY_DIRECTORY' });
  const temporaryPath = path.join(await fs.realpath(scratchParent), runId);
  await fs.mkdir(temporaryPath);
  const scratchAcl = await protectOwnerOnlyWindowsDirectory(temporaryPath);
  await fs.mkdir(directory);
  const nonce = randomUUID(), original = randomUUID();
  const files = { mode, nonce, inside_existing: path.join(directory, 'existing.txt'), inside_new: path.join(directory, 'new.txt'),
    outside_existing: path.join(receipts, `${runId}-outside-existing.txt`), outside_new: path.join(receipts, `${runId}-outside-new.txt`) };
  const scriptPath = path.join(directory, 'probe.ps1');
  await fs.writeFile(files.inside_existing, original, { flag: 'wx' });
  await fs.writeFile(files.outside_existing, original, { flag: 'wx' });
  await fs.writeFile(scriptPath, canaryScript(files), { flag: 'wx' });
  const cliSha = digest(await fs.readFile(cliPath));
  const args = buildCodexSandboxProbeArgs({ mode, workspaceRoot: workspace, scriptPath, powershellPath });
  // Avoid recursively provisioning the user's accumulated global Temp tree.
  // This is per-child environment only, outside source, journals and receipts.
  const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex');
  const env = codexCliTemporaryEnvironment(codexCliEnvironment(codexHome), temporaryPath);
  const stdoutPath = path.join(receipts, `${runId}.stdout.log`), stderrPath = path.join(receipts, `${runId}.stderr.log`), exitPath = path.join(receipts, `${runId}.exit.json`);
  const stdoutFile = await fs.open(stdoutPath, 'wx', 0o600), stderrFile = await fs.open(stderrPath, 'wx', 0o600);
  let stdoutWrites = Promise.resolve(), stderrWrites = Promise.resolve(), logWriteFailed = false;
  const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();
  let handle;
  try { handle = await processController.spawn({ executablePath: cliPath, args, cwd: workspace, env, timeoutMs, deadlineAt, runId, expectedExecutableSha256: cliSha }); }
  catch (error) { await stdoutFile.close(); await stderrFile.close(); throw error; }
  try { onProcessStarted?.(Object.freeze({ run_id: runId, mode, process: handle.proof, timeout_ms: timeoutMs, temporary_path: temporaryPath, model_called: false })); }
  catch { await handle.terminate('PROBE_OBSERVER_FAILED'); throw Error('codex_sandbox_probe_observer_failed'); }
  let output = '', stderrBytes = 0, report = null, nativeProcess = null, observation = null;
  const observationTasks = [];
  handle.stdout.on('data', chunk => {
    const bytes = Buffer.from(chunk);
    stdoutWrites = stdoutWrites.then(() => stdoutFile.write(bytes)).catch(() => { logWriteFailed = true; void handle.terminate('SANDBOX_PROBE_LOG_WRITE_FAILED'); });
    output += chunk.toString('utf8');
    if (Buffer.byteLength(output) > 32768) { output = output.slice(0, 32768); void handle.terminate('SANDBOX_PROBE_OUTPUT_LIMIT'); return; }
    for (const line of output.split(/\r?\n/)) {
      if (report || !line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.schema !== 'metaengine.codex-cli.sandbox-canary.v1') continue;
        report = parsed;
        const task = Promise.resolve().then(() => readNativeProcess(parsed.pid)).then(value => { nativeProcess = value; }).catch(() => {});
        observationTasks.push(task);
      } catch {}
    }
  });
  handle.stderr.on('data', chunk => {
    const bytes = Buffer.from(chunk);
    stderrWrites = stderrWrites.then(() => stderrFile.write(bytes)).catch(() => { logWriteFailed = true; void handle.terminate('SANDBOX_PROBE_LOG_WRITE_FAILED'); });
    stderrBytes += bytes.length; if (stderrBytes > 32768) void handle.terminate('SANDBOX_PROBE_STDERR_LIMIT');
  });
  await handle.resume('', { deadlineAt });
  const completion = await handle.completion;
  await Promise.all([stdoutWrites, stderrWrites]);
  await Promise.all([stdoutFile.sync(), stderrFile.sync()]);
  await Promise.all([stdoutFile.close(), stderrFile.close()]);
  const exitFile = await fs.open(exitPath, 'wx', 0o600);
  try { await exitFile.writeFile(JSON.stringify(completion) + '\n'); await exitFile.sync(); } finally { await exitFile.close(); }
  await Promise.allSettled(observationTasks);
  const read = async file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const [insideExisting, insideNew, outsideExisting, outsideNew] = await Promise.all([read(files.inside_existing), read(files.inside_new), read(files.outside_existing), read(files.outside_new)]);
  const hostReadback = { inside_existing_unchanged: insideExisting === original, inside_existing_appended: insideExisting === original + nonce,
    inside_new_written: insideNew === nonce, inside_new_absent: insideNew === null, outside_existing_unchanged: outsideExisting === original, outside_new_absent: outsideNew === null };
  const bootAfter=await readHostBoot();
  observation = windowsSandboxBootIdentity(bootAfter)!==windowsSandboxBootIdentity(hostBoot)
    ?Object.freeze({state:'BLOCKED',reason:'SANDBOX_BOOT_IDENTITY_CHANGED',boundary_observed:false,execution_authorized:false,authority_effect:false})
    :evaluateCodexSandboxProbe({ mode, report, nativeProcess, hostReadback, completion, hostUserSid, hostBootIdentity:hostBoot });
  if (logWriteFailed) observation = Object.freeze({ state: 'BLOCKED', reason: 'SANDBOX_PROBE_LOG_WRITE_FAILED', boundary_observed: false, execution_authorized: false, authority_effect: false });
  const evidence = { schema: CODEX_SANDBOX_PROBE_SCHEMA, run_id: runId, observed_at: new Date().toISOString(), ...observation,
    cli_path: await fs.realpath(cliPath), cli_sha256: cliSha, workspace_path: workspace, host_user_sid: hostUserSid,
    temporary_path: temporaryPath, temporary_owner_dacl_verified_before_sandbox_setup: scratchAcl.owner_dacl_verified === true,
    host_boot: hostBoot, execution_deadline: deadlineAt,
    logs: { stdout_path: stdoutPath, stdout_sha256: digest(await fs.readFile(stdoutPath)), stderr_path: stderrPath,
      stderr_sha256: digest(await fs.readFile(stderrPath)), exit_path: exitPath, exit_sha256: digest(await fs.readFile(exitPath)) },
    cli_process: handle.proof, sandbox_process: nativeProcess, canary: report, host_readback: hostReadback, completion,
    stderr_bytes: stderrBytes, model_called: false, authority_effect: false };
  const canonical = JSON.stringify(evidence);
  const receiptFile = await fs.open(receipt, 'wx', 0o600);
  try { await receiptFile.writeFile(canonical + '\n'); await receiptFile.sync(); } finally { await receiptFile.close(); }
  // Delete only the exact files and fresh directory created above. Retain the
  // outside canaries and receipt as independent host evidence.
  if (await fs.realpath(directory) !== directory || !isWithin(workspace, directory)) throw Error('codex_sandbox_probe_cleanup_path_changed');
  for (const file of [files.inside_existing, files.inside_new, scriptPath]) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(directory);
  return Object.freeze({ ...observation, receipt_path: receipt, sandbox_evidence_sha256: digest(canonical + '\n'), cli_sha256: cliSha,
    workspace_path: workspace, user_sid: hostUserSid, sandbox_process: nativeProcess, model_called: false });
}
