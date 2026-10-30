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
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupEx { public Startup startup; public IntPtr attributes; }
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
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,uint count,uint flags,ref UIntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr attribute,IntPtr value,UIntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder args,
    IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
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
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
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
    return Task.Run(()=> { try { using(var stream=new FileStream(new SafeFileHandle(handle,false),FileAccess.Read)) {
      var buffer=new byte[4096]; int n; while((n=stream.Read(buffer,0,buffer.Length))>0)
        Emit("{\"type\":\"output\",\"channel\":"+Escape(channel)+",\"data_b64\":"+Escape(Convert.ToBase64String(buffer,0,n))+"}");
    }} finally { CloseChecked(ref handle,"output_pipe_close_failed"); }});
  }
  static Task WriteInput(IntPtr handle,byte[] prompt) {
    return Task.Run(()=> { try { using(var input=new FileStream(new SafeFileHandle(handle,false),FileAccess.Write)) input.Write(prompt,0,prompt.Length); }
      finally { CloseChecked(ref handle,"input_pipe_close_failed"); } });
  }
  static string Identity(uint pid,long birth) { return "{\"pid\":"+pid+",\"created_at\":"+Escape(DateTime.FromFileTimeUtc(birth).ToString("o"))+",\"process_incarnation_id\":"+Escape("pid:"+pid+":created_100ns:"+birth)+"}"; }
  static string Terminal(string type,string launch,string helper,string runId,ProcessInfo process,long birth,uint code,string reason,bool neverResumed,string cancellationId,Accounting a) {
    return "{\"schema\":\"metaengine.codex-cli.native-terminal.v2\",\"type\":"+Escape(type)+",\"launch\":"+launch+",\"helper_process\":"+helper+
      ",\"run_id\":"+Escape(runId)+",\"job_id\":"+Escape(runId)+",\"pid\":"+process.pid+",\"process_incarnation_id\":"+Escape("pid:"+process.pid+":created_100ns:"+birth)+
      ",\"exit_code\":"+code+",\"reason\":"+(reason==null?"null":Escape(reason))+",\"never_resumed\":"+(neverResumed?"true":"false")+
      ",\"cancellation_id\":"+(cancellationId==null?"null":Escape(cancellationId))+",\"process_exit_confirmed\":true,\"handles_closed\":true,\"pipes_drained\":true,\"tree_cleanup_confirmed\":true,\"process_tree_control\":\"WINDOWS_JOB_OBJECT\""+
      ",\"job_accounting\":{\"active_processes\":"+a.active+",\"total_processes\":"+a.total+",\"total_terminated_processes\":"+a.terminated+"}}";
  }
  public static void Run(string exe,string[] args,string cwd,string runId,uint timeout,string expectedSha,string absoluteDeadlineMs,string requestId,string requestSha,string bindingSha,string promptSha) {
    IntPtr job=IntPtr.Zero,stdinRead=IntPtr.Zero,stdinWrite=IntPtr.Zero,stdoutRead=IntPtr.Zero,stdoutWrite=IntPtr.Zero,stderrRead=IntPtr.Zero,stderrWrite=IntPtr.Zero;
    var process=new ProcessInfo(); bool assigned=false;
    long helperBirth,helperExit,helperKernel,helperUser;
    Require(GetProcessTimes(GetCurrentProcess(),out helperBirth,out helperExit,out helperKernel,out helperUser),"helper_birth_failed");
    string helperIdentity=Identity(GetCurrentProcessId(),helperBirth);
    string launch="{\"request_id\":"+Escape(requestId)+",\"request_sha256\":"+Escape(requestSha)+",\"run_id\":"+Escape(runId)+",\"binding_sha256\":"+Escape(bindingSha)+",\"prompt_sha256\":"+Escape(promptSha)+"}";
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
      var startup=new Startup(); startup.flags=0x100|1; startup.show=0;
      startup.stdin=stdinRead; startup.stdout=stdoutWrite; startup.stderr=stderrWrite;
      var command=new StringBuilder(Quote(exe)); foreach(string arg in args) command.Append(" "+Quote(arg));
      // Windows 10+/Server 2016+ JOB_LIST binds within CreateProcess, before the
      // initial thread can run. Unsupported attributes refuse before creation;
      // there is deliberately no create-then-assign or breakaway fallback.
      IntPtr attributes=IntPtr.Zero,jobList=IntPtr.Zero,handleList=IntPtr.Zero; bool attributesInitialized=false;
      try {
        UIntPtr attributeBytes=UIntPtr.Zero;
        bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref attributeBytes); int sizeError=Marshal.GetLastWin32Error();
        if(sized || sizeError!=122 || attributeBytes==UIntPtr.Zero) throw new InvalidOperationException("codex_job_attributes_size_invalid:"+sizeError);
        attributes=Marshal.AllocHGlobal(checked((int)attributeBytes.ToUInt64()));
        Require(InitializeProcThreadAttributeList(attributes,2,0,ref attributeBytes),"attributes_initialize_failed"); attributesInitialized=true;
        jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);
        Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x0002000d),jobList,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job_attribute_failed");
        // Only these three child ends may be inherited. In particular neither
        // helper control/event stdio nor unrelated inheritable handles is listed.
        handleList=Marshal.AllocHGlobal(checked(IntPtr.Size*3));
        Marshal.WriteIntPtr(handleList,0,stdinRead); Marshal.WriteIntPtr(handleList,IntPtr.Size,stdoutWrite); Marshal.WriteIntPtr(handleList,IntPtr.Size*2,stderrWrite);
        Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x00020002),handleList,new UIntPtr((uint)(IntPtr.Size*3)),IntPtr.Zero,IntPtr.Zero),"handle_attribute_failed");
        var extended=new StartupEx(); extended.startup=startup; extended.startup.cb=Marshal.SizeOf(typeof(StartupEx)); extended.attributes=attributes;
        ProcessInfo createdProcess;
        bool created=CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004|0x00080000,IntPtr.Zero,cwd,ref extended,out createdProcess);
        Require(created,"create_process_failed");
        // Failed PROCESS_INFORMATION outputs are not owned handles. Transfer
        // them into the outer cleanup scope only after successful creation.
        process=createdProcess;
      } finally {
        // Attribute values must stay alive until the initialized list is deleted.
        if(attributesInitialized) DeleteProcThreadAttributeList(attributes);
        if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);
        if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      }
      bool inJob; Require(IsProcessInJob(process.process,job,out inJob)&&inJob,"membership_readback_failed"); assigned=true;
      long birth,exit,kernel,user; Require(GetProcessTimes(process.process,out birth,out exit,out kernel,out user),"birth_readback_failed");
      var image=new StringBuilder(32768); uint imageSize=32768; Require(QueryFullProcessImageName(process.process,0,image,ref imageSize),"image_readback_failed");
      if(!String.Equals(Path.GetFullPath(image.ToString()),Path.GetFullPath(exe),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("codex_job_image_changed");
      CloseChecked(ref stdinRead,"stdin_child_close_failed"); CloseChecked(ref stdoutWrite,"stdout_child_close_failed"); CloseChecked(ref stderrWrite,"stderr_child_close_failed");
      string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
      Emit("{\"type\":\"ready\",\"launch\":"+launch+",\"helper_process\":"+helperIdentity+",\"pid\":"+process.pid+",\"process_incarnation_id\":"+Escape("pid:"+process.pid+":created_100ns:"+birth)+
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
        Emit(Terminal("suspended_cancelled",launch,helperIdentity,runId,process,birth,cancelledCode,cancel[2],true,cancel[1],cancelledAccounting));
        return;
      }
      if(resume==null || !resume.StartsWith("RESUME ")) throw new InvalidOperationException("codex_job_resume_not_authorized");
      string expectedResume="RESUME "+requestId+" "+requestSha+" ";
      if(!resume.StartsWith(expectedResume,StringComparison.Ordinal)) throw new InvalidOperationException("codex_job_resume_request_changed");
      string resumeBody=resume.Substring(expectedResume.Length); int separator=resumeBody.IndexOf(' ');
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
      using(var sha=System.Security.Cryptography.SHA256.Create()) {
        if(BitConverter.ToString(sha.ComputeHash(prompt)).Replace("-","").ToLowerInvariant()!=promptSha) throw new InvalidOperationException("codex_job_prompt_changed");
      }
      Require(ResumeThread(process.thread)!=0xffffffff,"resume_failed");
      Emit("{\"type\":\"resumed\",\"request_id\":"+Escape(requestId)+",\"request_sha256\":"+Escape(requestSha)+"}");
      var outTask=Pump(stdoutRead,"stdout"); stdoutRead=IntPtr.Zero; var errTask=Pump(stderrRead,"stderr"); stderrRead=IntPtr.Zero;
      var inputTask=WriteInput(stdinWrite,prompt); stdinWrite=IntPtr.Zero;
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
      Require(empty && accounting.total>=1 && accounting.terminated<=accounting.total,"accounting_not_empty");
      // Killing the exact job closes every child-owned pipe end BEFORE joining
      // readers/writer. Never wait for stdin consumption before terminating it.
      Require(Task.WaitAll(new[]{outTask,errTask,inputTask},5000),"pipe_drain_unconfirmed");
      CloseChecked(ref process.thread,"thread_close_failed"); CloseChecked(ref process.process,"process_close_failed");
      CloseChecked(ref job,"job_close_failed");
      // Candidate only: the parent still has to join this original helper close.
      Emit(Terminal("exit",launch,helperIdentity,runId,process,birth,code,reason,false,null,accounting));
    } finally {
      if(process.process!=IntPtr.Zero && !assigned) TerminateProcess(process.process,125);
      foreach(IntPtr h in new[]{job,stdinRead,stdinWrite,stdoutRead,stdoutWrite,stderrRead,stderrWrite,process.thread,process.process}) if(h!=IntPtr.Zero) CloseHandle(h);
    }
  }
}
'@
try {
  $PSModuleAutoLoadingPreference = 'None'
  Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Length -gt 180000) { throw 'codex_job_envelope_invalid' }
  $envelope = $line | ConvertFrom-Json
  if ($envelope.schema -cne 'metaengine.codex-cli.launch.v2' -or $envelope.request_sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'codex_job_envelope_invalid' }
  $bytes = [Convert]::FromBase64String([string]$envelope.body_b64)
  if ($bytes.Length -lt 1 -or $bytes.Length -gt 131072 -or [Convert]::ToBase64String($bytes) -cne $envelope.body_b64) { throw 'codex_job_body_invalid' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  if ($actual -cne $envelope.request_sha256) { throw 'codex_job_body_changed' }
  $request = ([Text.UTF8Encoding]::new($false,$true)).GetString($bytes) | ConvertFrom-Json
  if ($request.schema -cne 'metaengine.codex-cli.launch.v2' -or $request.request_id -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    -or $request.run_id -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    -or $request.expected_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $request.binding_sha256 -cnotmatch '^[a-f0-9]{64}$'
    -or $request.prompt_sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'codex_job_request_invalid' }
  if ([int]$request.timeout_ms -lt 100 -or [int]$request.timeout_ms -gt 1800000) { throw 'codex_job_timeout_invalid' }
  [MetaengineCodexJob]::Run([string]$request.executable_path,[string[]]$request.args,[string]$request.cwd,
    [string]$request.run_id,[uint32]$request.timeout_ms,[string]$request.expected_sha256,[string]$request.deadline_ms,
    [string]$request.request_id,[string]$envelope.request_sha256,[string]$request.binding_sha256,[string]$request.prompt_sha256)
} catch {
  # A controlled error is reported without command text, prompt, env or credential values.
  [Console]::Out.WriteLine('{"type":"error","reason":"NATIVE_JOB_FAILED"}')
  exit 1
}
