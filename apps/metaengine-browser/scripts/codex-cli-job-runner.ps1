# Private transport for the native host. This is process lifetime control, NOT a sandbox.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MetaengineCodexJob {
  [StructLayout(LayoutKind.Sequential)] struct Security { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved,desktop,title; public uint x,y,xsize,ysize,xc,yc,fill,flags;
    public ushort show,reservedLength; public IntPtr reservedData,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ro,wo,oo,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public Io io; public UIntPtr pm,jm,ppm,pjm; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,ref Limits l,uint s);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr r,out IntPtr w,ref Security a,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder args,
    IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr p,IntPtr j,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long c,out long e,out long k,out long u);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr p,uint f,StringBuilder s,ref uint n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr p,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,out Accounting a,uint n,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  static readonly object outputLock = new object();
  static void Require(bool ok,string phase) { if(!ok) throw new InvalidOperationException("codex_job_"+phase+":"+Marshal.GetLastWin32Error()); }
  static void CloseChecked(ref IntPtr handle,string phase) {
    if(handle==IntPtr.Zero) return;
    Require(CloseHandle(handle),phase); handle=IntPtr.Zero;
  }
  static void Emit(string json) { lock(outputLock) { Console.Out.WriteLine(json); Console.Out.Flush(); } }
  static string Escape(string s) { return "\""+s.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\""; }
  static string Quote(string s) {
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char c in s) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); }
      else { b.Append('\\',slashes); b.Append(c); } slashes=0; }
    b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
  }
  static Task Pump(IntPtr handle,string channel) {
    return Task.Run(()=> { using(var stream=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read)) {
      var buffer=new byte[4096]; int n; while((n=stream.Read(buffer,0,buffer.Length))>0)
        Emit("{\"type\":\"output\",\"channel\":"+Escape(channel)+",\"data_b64\":"+Escape(Convert.ToBase64String(buffer,0,n))+"}");
    }});
  }
  public static void Run(string exe,string[] args,string cwd,string runId,uint timeout,string expectedSha,string absoluteDeadlineMs) {
    IntPtr job=IntPtr.Zero,stdinRead=IntPtr.Zero,stdinWrite=IntPtr.Zero,stdoutRead=IntPtr.Zero,stdoutWrite=IntPtr.Zero,stderrRead=IntPtr.Zero,stderrWrite=IntPtr.Zero;
    var process=new ProcessInfo(); bool assigned=false;
    try {
      using(var sha=System.Security.Cryptography.SHA256.Create()) using(var input=File.OpenRead(exe)) {
        string actual=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
        if(actual!=expectedSha) throw new InvalidOperationException("codex_job_executable_digest_mismatch");
      }
      job=CreateJobObject(IntPtr.Zero,null); Require(job!=IntPtr.Zero,"create_failed");
      var limits=new Limits(); limits.basic.flags=0x2000|0x8; limits.basic.active=64;
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"limits_failed");
      var security=new Security(); security.length=Marshal.SizeOf(typeof(Security)); security.inherit=1;
      Require(CreatePipe(out stdinRead,out stdinWrite,ref security,0),"stdin_pipe_failed");
      Require(CreatePipe(out stdoutRead,out stdoutWrite,ref security,0),"stdout_pipe_failed");
      Require(CreatePipe(out stderrRead,out stderrWrite,ref security,0),"stderr_pipe_failed");
      Require(SetHandleInformation(stdinWrite,1,0)&&SetHandleInformation(stdoutRead,1,0)&&SetHandleInformation(stderrRead,1,0),"parent_pipe_inheritance_failed");
      var startup=new Startup(); startup.cb=Marshal.SizeOf(typeof(Startup)); startup.flags=0x100|1; startup.show=0;
      startup.stdin=stdinRead; startup.stdout=stdoutWrite; startup.stderr=stderrWrite;
      var command=new StringBuilder(Quote(exe)); foreach(string arg in args) command.Append(" "+Quote(arg));
      Require(CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out process),"create_process_failed");
      Require(AssignProcessToJobObject(job,process.process),"assign_failed"); assigned=true;
      bool inJob; Require(IsProcessInJob(process.process,job,out inJob)&&inJob,"membership_readback_failed");
      long birth,exit,kernel,user; Require(GetProcessTimes(process.process,out birth,out exit,out kernel,out user),"birth_readback_failed");
      var image=new StringBuilder(32768); uint imageSize=32768; Require(QueryFullProcessImageName(process.process,0,image,ref imageSize),"image_readback_failed");
      if(!String.Equals(Path.GetFullPath(image.ToString()),Path.GetFullPath(exe),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("codex_job_image_changed");
      CloseChecked(ref stdinRead,"stdin_child_close_failed"); CloseChecked(ref stdoutWrite,"stdout_child_close_failed"); CloseChecked(ref stderrWrite,"stderr_child_close_failed");
      string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
      Emit("{\"type\":\"ready\",\"pid\":"+process.pid+",\"process_incarnation_id\":"+Escape("pid:"+process.pid+":created_100ns:"+birth)+
        ",\"started_at\":"+Escape(DateTime.FromFileTimeUtc(birth).ToString("o"))+",\"user_sid\":"+Escape(sid)+",\"job_id\":"+Escape(runId)+
        ",\"executable_path\":"+Escape(image.ToString())+",\"executable_sha256\":"+Escape(expectedSha)+",\"tree_control_bound\":true,\"started_suspended\":true,\"job_bound_before_resume\":true,\"process_tree_control\":\"WINDOWS_JOB_OBJECT\"}");
      // No model prompt or child execution before the native host's second authorization.
      string resume=Console.In.ReadLine();
      if(resume!=null && resume.StartsWith("CANCEL_SUSPENDED ",StringComparison.Ordinal)) {
        string[] cancel=resume.Split(' '); Guid cancellationId;
        if(cancel.Length!=3 || !Guid.TryParseExact(cancel[1],"D",out cancellationId) || cancellationId.ToString("D")!=cancel[1]
          || !System.Text.RegularExpressions.Regex.IsMatch(cancel[2],"\\A[A-Z_]{1,80}\\z")) throw new InvalidOperationException("codex_job_cancel_invalid");
        // This branch cannot call ResumeThread or pump/write child input. A receipt
        // is emitted only after native exit, empty accounting and checked closes.
        Require(TerminateJobObject(job,125),"suspended_termination_failed");
        Require(WaitForSingleObject(process.process,5000)==0,"suspended_exit_wait_failed");
        uint cancelledCode; Require(GetExitCodeProcess(process.process,out cancelledCode),"suspended_exit_readback_failed");
        Require(cancelledCode==125,"suspended_exit_code_invalid");
        CloseChecked(ref process.thread,"suspended_thread_close_failed"); CloseChecked(ref process.process,"suspended_process_close_failed");
        CloseChecked(ref stdinWrite,"suspended_stdin_close_failed"); CloseChecked(ref stdoutRead,"suspended_stdout_close_failed"); CloseChecked(ref stderrRead,"suspended_stderr_close_failed");
        var cancelDeadline=DateTime.UtcNow.AddSeconds(5); Accounting cancelledAccounting;
        do {
          Require(QueryInformationJobObject(job,1,out cancelledAccounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"suspended_accounting_readback_failed");
          if(cancelledAccounting.active==0) break;
          System.Threading.Thread.Sleep(20);
        } while(DateTime.UtcNow<cancelDeadline);
        // This unnamed, non-inheritable Job received exactly this one process;
        // its initial thread was never resumed, so it could not spawn children.
        Require(cancelledAccounting.active==0 && cancelledAccounting.total==1 && cancelledAccounting.terminated<=cancelledAccounting.total,"suspended_accounting_invalid");
        CloseChecked(ref job,"suspended_job_close_failed");
        Emit("{\"type\":\"suspended_cancelled\",\"run_id\":"+Escape(runId)+",\"job_id\":"+Escape(runId)+",\"pid\":"+process.pid+
          ",\"process_incarnation_id\":"+Escape("pid:"+process.pid+":created_100ns:"+birth)+",\"cancellation_id\":"+Escape(cancel[1])+",\"reason\":"+Escape(cancel[2])+
          ",\"exit_code\":"+cancelledCode+",\"never_resumed\":true,\"process_exit_confirmed\":true,\"handles_closed\":true,\"tree_cleanup_confirmed\":true,\"process_tree_control\":\"WINDOWS_JOB_OBJECT\""+
          ",\"job_accounting\":{\"active_processes\":"+cancelledAccounting.active+",\"total_processes\":"+cancelledAccounting.total+",\"total_terminated_processes\":"+cancelledAccounting.terminated+"}}");
        return;
      }
      if(resume==null || !resume.StartsWith("RESUME ")) throw new InvalidOperationException("codex_job_resume_not_authorized");
      string resumeBody=resume.Substring(7); int separator=resumeBody.IndexOf(' ');
      if(separator<1) throw new InvalidOperationException("codex_job_resume_deadline_missing");
      DateTime deadline=DateTime.UtcNow.AddMilliseconds(timeout);
      DateTime resumeDeadline=DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(resumeBody.Substring(0,separator),System.Globalization.CultureInfo.InvariantCulture)).UtcDateTime;
      if(resumeDeadline<deadline) deadline=resumeDeadline;
      if(!String.IsNullOrEmpty(absoluteDeadlineMs)) {
        DateTime originalDeadline=DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(absoluteDeadlineMs,System.Globalization.CultureInfo.InvariantCulture)).UtcDateTime;
        if(originalDeadline<deadline) deadline=originalDeadline;
      }
      if(DateTime.UtcNow>=deadline) throw new InvalidOperationException("codex_job_deadline_expired_before_resume");
      byte[] prompt=Convert.FromBase64String(resumeBody.Substring(separator+1));
      if(prompt.Length>65536) throw new InvalidOperationException("codex_job_prompt_too_large");
      var outTask=Pump(stdoutRead,"stdout"); stdoutRead=IntPtr.Zero; var errTask=Pump(stderrRead,"stderr"); stderrRead=IntPtr.Zero;
      Require(ResumeThread(process.thread)!=0xffffffff,"resume_failed");
      Emit("{\"type\":\"resumed\"}");
      IntPtr inputHandle=stdinWrite; stdinWrite=IntPtr.Zero;
      var inputTask=Task.Run(()=> { using(var input=new FileStream(new SafeFileHandle(inputHandle,true),FileAccess.Write)) input.Write(prompt,0,prompt.Length); });
      var control=Task.Run(()=>Console.In.ReadLine()); string reason=null;
      while(WaitForSingleObject(process.process,100)==0x102) {
        if(DateTime.UtcNow>=deadline) { reason="TIMEOUT"; break; }
        if(control.IsCompleted) { reason="CANCELLED"; break; }
      }
      if(reason!=null) Require(TerminateJobObject(job,124),"termination_failed");
      Require(WaitForSingleObject(process.process,5000)==0,"exit_wait_failed");
      uint code; Require(GetExitCodeProcess(process.process,out code),"exit_readback_failed");
      // Stop grandchildren even when the main CLI exited successfully. Observe
      // native job accounting before closing our only handle, then drain pipes.
      Require(TerminateJobObject(job,124),"descendant_cleanup_failed");
      var cleanupDeadline=DateTime.UtcNow.AddSeconds(5); Accounting accounting; bool empty=false;
      do { Require(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"accounting_readback_failed");
        empty=accounting.active==0; if(!empty) System.Threading.Thread.Sleep(20);
      } while(!empty && DateTime.UtcNow<cleanupDeadline);
      CloseHandle(job); job=IntPtr.Zero;
      bool drained=Task.WaitAll(new[]{outTask,errTask,inputTask},5000);
      Emit("{\"type\":\"exit\",\"exit_code\":"+code+",\"reason\":"+(reason==null?"null":Escape(reason))+",\"tree_cleanup_confirmed\":"+((drained&&empty)?"true":"false")+"}");
    } finally {
      if(process.process!=IntPtr.Zero && !assigned) TerminateProcess(process.process,125);
      foreach(IntPtr h in new[]{job,stdinRead,stdinWrite,stdoutRead,stdoutWrite,stderrRead,stderrWrite,process.thread,process.process}) if(h!=IntPtr.Zero) CloseHandle(h);
    }
  }
}
'@
try {
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  if ($request.run_id -notmatch '^[a-f0-9-]{36}$' -or $request.expected_sha256 -notmatch '^[a-f0-9]{64}$') { throw 'codex_job_request_invalid' }
  if ([int]$request.timeout_ms -lt 100 -or [int]$request.timeout_ms -gt 1800000) { throw 'codex_job_timeout_invalid' }
  [MetaengineCodexJob]::Run([string]$request.executable_path,[string[]]$request.args,[string]$request.cwd,
    [string]$request.run_id,[uint32]$request.timeout_ms,[string]$request.expected_sha256,[string]$request.deadline_ms)
} catch {
  # A controlled error is reported without command text, prompt, env or credential values.
  [Console]::Out.WriteLine('{"type":"error","reason":"NATIVE_JOB_FAILED"}')
  exit 1
}
