// W60 fixed Windows OS handle readback. This is source-owned native code, not
// renderer input or user-supplied PowerShell. PID is validated before use.
export const ABSENT_PROCESS_ERROR = 'ERROR_INVALID_PARAMETER_87';
export const ABSENT_PROCESS_TYPE = 'kernel32.OpenProcess';
export const ABSENT_PROCESS_FIELDS = ['pid','state','native_error_id','native_error_category','native_error_type','native_target_pid'];

const WINDOWS_NATIVE_SOURCE = String.raw`using System;
using System.Text;
using System.Globalization;
using System.Runtime.InteropServices;
public static class MetaengineWinProcessW60 {
  private struct FileTime { public uint Low; public uint High; }
  public class Readback {
    public string State;
    public string CreatedAt;
    public string ExePath;
    public int Error;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool GetProcessTimes(IntPtr h, out FileTime created,
    out FileTime exited, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", EntryPoint="QueryFullProcessImageNameW",
    CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool QueryFullProcessImageName(IntPtr h, int flags,
    StringBuilder buffer, ref int size);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool CloseHandle(IntPtr h);
  public static Readback Probe(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) {
      int nativeError = Marshal.GetLastWin32Error();
      // ERROR_INVALID_PARAMETER from OpenProcess for a valid positive PID
      // uniquely means this process ID currently has no kernel process.
      return new Readback {State=nativeError == 87 ? "NOT_RUNNING" : "UNKNOWN",
        Error=nativeError};
    }
    try {
      FileTime created, exited, kernel, user;
      if (!GetProcessTimes(h,out created,out exited,out kernel,out user))
        return new Readback {State="UNKNOWN"};
      StringBuilder image = new StringBuilder(32768);
      int size = image.Capacity;
      if (!QueryFullProcessImageName(h,0,image,ref size) || size<1)
        return new Readback {State="UNKNOWN"};
      ulong raw = ((ulong)created.High << 32) | created.Low;
      if (raw==0 || raw>long.MaxValue)
        return new Readback {State="UNKNOWN"};
      DateTime birth = DateTime.FromFileTimeUtc((long)raw);
      return new Readback {State="PRESENT",
        CreatedAt=birth.ToString("o",CultureInfo.InvariantCulture),
        ExePath=image.ToString()};
    } catch {
      return new Readback {State="UNKNOWN"};
    } finally {
      CloseHandle(h);
    }
  }
}`;

export const processScript = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) {
    throw new TypeError('w60_fixed_positive_kernel_pid_required');
  }
  return [
  '$ErrorActionPreference = "Stop"',
  '$requestedPid = ' + String(pid),
  '[Console]::Error.WriteLine("W60_SHELL_STARTED")',
  "$native = @'\n" + WINDOWS_NATIVE_SOURCE + "\n'@",
  'Add-Type -TypeDefinition $native -ErrorAction Stop',
  '[Console]::Error.WriteLine("W60_NATIVE_TYPES_READY")',
  '$p = [MetaengineWinProcessW60]::Probe($requestedPid)',
  'if ($p.State -eq "NOT_RUNNING" -and $p.Error -eq 87) {',
  '  @{ pid = [int]$requestedPid; state = "NOT_RUNNING";',
  '    native_error_id = "ERROR_INVALID_PARAMETER_87";',
  '    native_error_category = "ObjectNotFound";',
  '    native_error_type = "kernel32.OpenProcess";',
  '    native_target_pid = [int]$requestedPid } | ConvertTo-Json -Compress;',
  '  [Console]::Error.WriteLine("W60_RESULT_WRITTEN"); exit 0',
  '}',
  'if ($p.State -ne "PRESENT" -or -not $p.ExePath -or -not $p.CreatedAt)',
  '  { throw "NATIVE_PROCESS_READ_UNVERIFIED" }',
  '[Console]::Error.WriteLine("W60_PROCESS_OPENED")',
  '$start = [string]$p.CreatedAt',
  '$exe = [string]$p.ExePath',
  '[Console]::Error.WriteLine("W60_PROCESS_FIELDS_READ")',
  '@{ pid = [int]$requestedPid; created_at = $start; exe_path = $exe } | ConvertTo-Json -Compress',
  '[Console]::Error.WriteLine("W60_RESULT_WRITTEN")',
].join('\n');
};
