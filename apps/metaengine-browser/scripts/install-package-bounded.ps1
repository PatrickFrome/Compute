param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [ValidateRange(1,600)][int]$TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'package_installer_digest_invalid' }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'package_installer_missing' }
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) {
  throw 'package_installer_digest_mismatch'
}

# Start suspended, attach to our private kill-on-close job, and then resume.
# Unlike Start-Process -Wait, this has an explicit parent deadline. The job owns
# exactly this launch and its descendants; no process name or reused PID is killed.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class MetaengineBoundedPackageInstall {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct StartupInfo {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
    public ushort showWindow,reserved2Length; public IntPtr reserved2,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process,thread; public uint processId,threadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long processTime,jobTime; public uint flags;
    public UIntPtr minimumWorkingSet,maximumWorkingSet; public uint activeProcessLimit;
    public UIntPtr affinity; public uint priorityClass,schedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong readOperations,writeOperations,otherOperations,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io;
    public UIntPtr processMemoryLimit,jobMemoryLimit,peakProcessMemory,peakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job,int infoClass,ref ExtendedLimits info,uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,
    IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string directory,
    ref StartupInfo startup,out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool ok,string phase) {
    if (!ok) throw new InvalidOperationException("package_installer_"+phase+":"+Marshal.GetLastWin32Error());
  }
  public static uint Run(string application,uint timeoutMilliseconds) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null);
    Require(job!=IntPtr.Zero,"job_create_failed");
    var process=new ProcessInfo(); bool assigned=false;
    try {
      var limits=new ExtendedLimits(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"job_limits_failed");
      var startup=new StartupInfo(); startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfo));
      startup.flags=1; startup.showWindow=0; // STARTF_USESHOWWINDOW, SW_HIDE
      Require(CreateProcess(application,new StringBuilder("\""+application+"\" /S"),IntPtr.Zero,
        IntPtr.Zero,false,0x08000004,IntPtr.Zero,null,ref startup,out process),"launch_failed");
      Require(AssignProcessToJobObject(job,process.process),"job_assign_failed"); assigned=true;
      Require(ResumeThread(process.thread)!=0xffffffff,"resume_failed");
      uint wait=WaitForSingleObject(process.process,timeoutMilliseconds);
      if (wait==0x102) {
        Require(TerminateJobObject(job,124),"timeout_cleanup_failed");
        WaitForSingleObject(process.process,5000);
        throw new InvalidOperationException("package_installer_timeout");
      }
      Require(wait==0,"wait_failed");
      uint exitCode; Require(GetExitCodeProcess(process.process,out exitCode),"exit_readback_failed");
      if (exitCode!=0) throw new InvalidOperationException("package_installer_exit_"+exitCode);
      return process.processId;
    } finally {
      // A failed assignment leaves a suspended process outside the job.
      if (process.process!=IntPtr.Zero && !assigned) TerminateProcess(process.process,125);
      CloseHandle(job);
      if (process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      if (process.process!=IntPtr.Zero) CloseHandle(process.process);
    }
  }
}
'@
$installerPid = [MetaengineBoundedPackageInstall]::Run($installer, [uint32]($TimeoutSeconds * 1000))
[ordered]@{
  schema = 'metaengine.browser.bounded-package-install.v1'
  installer_sha256 = $ExpectedSha256
  installer_pid = $installerPid
  installer_exit_code = 0
  timeout_seconds = $TimeoutSeconds
  process_tree_scoped_job = $true
  descendant_cleanup_on_job_close = $true
  installed_payload_qualification_required = $true
  authority_effect = $false
} | ConvertTo-Json -Compress | Write-Output
