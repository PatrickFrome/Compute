// Read-only fixed Windows process census over the installed .NET Framework.
// No Get-Process provider, dynamic Add-Type compiler, WMI, PATH lookup,
// caller-supplied code or second authority. All failures remain UNKNOWN.
export const ABSENT_PROCESS_ERROR = 'SYSTEM_DIAGNOSTICS_PROCESS_ID_NOT_FOUND';
export const ABSENT_PROCESS_TYPE = 'System.ArgumentException';
export const ABSENT_PROCESS_FIELDS = ['pid','state','native_error_id','native_error_category','native_error_type','native_target_pid'];

export const processScript = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) {
    throw new TypeError('w60_fixed_positive_kernel_pid_required');
  }
  return [
    '$ErrorActionPreference = "Stop"',
    '$requestedPid = ' + String(pid),
    '[Console]::Error.WriteLine("W60_SHELL_STARTED")',
    '[Console]::Error.WriteLine("W60_MANAGED_API_READY")',
    // This managed API calls Windows kernel process inventory directly; unlike
    // Get-Process it does not enumerate a PowerShell module/process provider.
    // Only a scoped GetProcessById MethodInvocationException whose precise
    // inner type is ArgumentException proves absent for a validated positive PID.
    // Access denied, unrelated exceptions and missing types remain UNKNOWN.
    'try { $p = [System.Diagnostics.Process]::GetProcessById($requestedPid) }',
    'catch {',
    '  $err = $_.Exception',
    '  $inner = $err.InnerException',
    '  if ($err.GetType().FullName -ceq "System.Management.Automation.MethodInvocationException" -and $null -ne $inner -and $inner.GetType().FullName -ceq "System.ArgumentException" -and [string]::IsNullOrEmpty([string]$inner.ParamName)) {',
    // Avoid PowerShell cmdlet/module autoload in the trusted OS readback.
    // Every output field here is a source-owned literal or validated integer.
    "    [Console]::Out.WriteLine('{\"pid\":' + [string]$requestedPid + ',\"state\":\"NOT_RUNNING\",\"native_error_id\":\"SYSTEM_DIAGNOSTICS_PROCESS_ID_NOT_FOUND\",\"native_error_category\":\"ObjectNotFound\",\"native_error_type\":\"System.ArgumentException\",\"native_target_pid\":' + [string]$requestedPid + '}')",
    '    [Console]::Error.WriteLine("W60_RESULT_WRITTEN"); exit 0',
    '  }',
    '  throw',
    '}',
    'try {',
    '  $h = $p.Handle',
    '  if ($h -eq [IntPtr]::Zero -or $p.Id -ne $requestedPid)',
    '    { throw "PROCESS_HANDLE_UNVERIFIED" }',
    '  [Console]::Error.WriteLine("W60_PROCESS_OPENED")',
    '  $start = $p.StartTime.ToUniversalTime().ToString("o")',
    '  $exe = $p.MainModule.FileName',
    '  if (-not $exe -or -not $start) { throw "PROCESS_FIELDS_UNVERIFIED" }',
    '  [Console]::Error.WriteLine("W60_PROCESS_FIELDS_READ")',
    // PowerShell ConvertTo-Json cmdlet autoload can block on hosted runners.
    // Transport path bytes as canonical UTF-8 Base64; let Node validate them.
    '  $exeB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($exe))',
    "  [Console]::Out.WriteLine('{\"pid\":' + [string]$requestedPid + ',\"created_at\":\"' + $start + '\",\"exe_path_base64\":\"' + $exeB64 + '\"}')",
    '  [Console]::Error.WriteLine("W60_RESULT_WRITTEN")',
    '} finally { if ($null -ne $p) { $p.Dispose() } }',
  ].join('\n');
};
