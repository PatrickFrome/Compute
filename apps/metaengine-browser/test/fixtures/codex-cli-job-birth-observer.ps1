# Disposable Windows test observer only; never an installed process controller.
# The observer stays outside its fresh OUTER guard Job. No INNER Job handle is
# opened, duplicated, inherited, or retained by this observer.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Globalization;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MetaengineJobBirthObserver {
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
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {
    public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string image;
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint bytes);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Limits limits,uint bytes,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting accounting,uint bytes,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr information,uint bytes,out uint returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetHandleInformation(IntPtr handle,out uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security security,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,uint count,uint flags,ref UIntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr attribute,IntPtr value,UIntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long birth,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder image,ref uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessId(IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32First(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32Next(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  public static string Phase = "setup";
  public static string FailureInventoryJson = "null";
  static void Require(bool ok,string stage) { if(!ok) { if(Phase=="setup") Phase=stage; throw new InvalidOperationException("observer_"+stage+":"+Marshal.GetLastWin32Error()); } }
  static void Close(ref IntPtr handle,string stage) { if(handle==IntPtr.Zero)return; Require(CloseHandle(handle),stage); handle=IntPtr.Zero; }
  static void Pipe(ref IntPtr read,ref IntPtr write,ref Security security,string stage) {
    IntPtr createdRead,createdWrite; Require(CreatePipe(out createdRead,out createdWrite,ref security,65536),stage);
    read=createdRead; write=createdWrite;
  }
  static void Cleanup(List<Exception> errors,Action action) { try { action(); } catch(Exception error) { errors.Add(error); } }
  static string Quote(string text) {
    var output=new StringBuilder("\""); int slashes=0;
    foreach(char c in text) { if(c=='\\') { slashes++; continue; } if(c=='\"') { output.Append('\\',slashes*2+1); output.Append(c); }
      else { output.Append('\\',slashes); output.Append(c); } slashes=0; }
    output.Append('\\',slashes*2); output.Append('"'); return output.ToString();
  }
  static string Image(IntPtr process) { var image=new StringBuilder(32768); uint size=32768; Require(QueryFullProcessImageName(process,0,image,ref size),"image_readback"); return Path.GetFullPath(image.ToString()); }
  static long Birth(IntPtr process) { long birth,exit,kernel,user; Require(GetProcessTimes(process,out birth,out exit,out kernel,out user),"birth_readback"); return birth; }
  static bool SamePath(string a,string b) { return String.Equals(Path.GetFullPath(a),Path.GetFullPath(b),StringComparison.OrdinalIgnoreCase); }
  static string DiagnosticWaitState(IntPtr process) {
    uint result=WaitForSingleObject(process,0);
    return result==0 ? "SIGNALED" : result==0x102 ? "LIVE" : "WAIT_UNCONFIRMED";
  }
  static bool DiagnosticSnapshotHints(HashSet<ulong> otherPids,out int consoleHosts,out int compilers,out int unclassified,out int seen) {
    consoleHosts=0; compilers=0; unclassified=0; seen=0;
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0); if(snapshot==IntPtr.Zero || snapshot==new IntPtr(-1)) return false;
    bool ok=false;
    try {
      var entry=new ProcessEntry(); entry.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
      if(Process32First(snapshot,ref entry)) {
        do {
          if(otherPids.Contains(entry.pid)) {
            seen++;
            if(String.Equals(entry.image,"conhost.exe",StringComparison.OrdinalIgnoreCase)) consoleHosts++;
            else if(String.Equals(entry.image,"csc.exe",StringComparison.OrdinalIgnoreCase) || String.Equals(entry.image,"cvtres.exe",StringComparison.OrdinalIgnoreCase)) compilers++;
            else unclassified++;
          }
        } while(Process32Next(snapshot,ref entry));
        ok=Marshal.GetLastWin32Error()==18;
      }
    } finally { if(!CloseHandle(snapshot)) ok=false; }
    return ok;
  }
  sealed class Inventory {
    public bool queryOk,complete,helperListed,childListed;
    public uint assigned,listed,returned; public int error,other,invalid,duplicates;
    public readonly HashSet<ulong> otherPids=new HashSet<ulong>();
  }
  static Inventory ReadInventory(IntPtr guard,uint helperPid,uint childPid) {
    // A complete bounded native association list must include both exact known
    // identities once. Auxiliary IDs remain opaque: no PID is opened and no
    // name, count or snapshot hint grants individual identity/effect authority.
    IntPtr information=IntPtr.Zero;
    try {
      const int capacity=256; int bytes=checked(8+capacity*IntPtr.Size);
      information=Marshal.AllocHGlobal(bytes); Marshal.Copy(new byte[bytes],0,information,bytes);
      var result=new Inventory();
      result.queryOk=QueryInformationJobObject(guard,3,information,(uint)bytes,out result.returned); result.error=result.queryOk ? 0 : Marshal.GetLastWin32Error();
      bool header=(result.queryOk || result.error==234) && result.returned>=8 && result.returned<=(uint)bytes;
      var seen=new HashSet<ulong>();
      if(header) {
        result.assigned=unchecked((uint)Marshal.ReadInt32(information,0)); result.listed=unchecked((uint)Marshal.ReadInt32(information,4));
        if(result.listed<=(uint)capacity && result.returned>=8+result.listed*(uint)IntPtr.Size) {
          for(int i=0;i<(int)result.listed;i++) {
            int at=8+i*IntPtr.Size;
            ulong pid=IntPtr.Size==4 ? unchecked((uint)Marshal.ReadInt32(information,at)) : unchecked((ulong)Marshal.ReadInt64(information,at));
            if(pid==0 || pid>UInt32.MaxValue) { result.invalid++; continue; }
            if(!seen.Add(pid)) { result.duplicates++; continue; }
            if(pid==helperPid) result.helperListed=true; else if(pid==childPid) result.childListed=true; else { result.other++; result.otherPids.Add(pid); }
          }
        } else header=false;
      }
      result.complete=result.queryOk && header && result.assigned==result.listed && result.invalid==0 && result.duplicates==0;
      return result;
    } finally { if(information!=IntPtr.Zero) Marshal.FreeHGlobal(information); }
  }
  static void CaptureFailureInventory(Inventory inventory,Accounting accounting,IntPtr helper,IntPtr child,
    int polls,uint firstActive,uint minActive,uint maxActive) {
    // Preserve the failing native-list snapshot; do not substitute a later read
    // or use diagnostic names/accounting as an acceptance predicate.
    try {
      const int capacity=256; bool ok=inventory.queryOk,complete=inventory.complete,helperListed=inventory.helperListed,childListed=inventory.childListed;
      uint assigned=inventory.assigned,listed=inventory.listed,returned=inventory.returned;
      int error=inventory.error,other=inventory.other,invalid=inventory.invalid,duplicates=inventory.duplicates;
      // Snapshot names are allowlisted hints, not pinned identities or liveness
      // proof. PID reuse can invalidate a hint; no such ID authorizes an effect.
      int consoleHosts,compilers,unclassified,snapshotSeen;
      bool snapshotOk=DiagnosticSnapshotHints(inventory.otherPids,out consoleHosts,out compilers,out unclassified,out snapshotSeen);
      FailureInventoryJson="{\"diagnostic_only\":true,\"native_qualification_proven\":false,\"active_processes\":"+accounting.active.ToString(CultureInfo.InvariantCulture)
        +",\"total_processes\":"+accounting.total.ToString(CultureInfo.InvariantCulture)+",\"limit_terminated_processes\":"+accounting.terminated.ToString(CultureInfo.InvariantCulture)
        +",\"accounting_polls\":"+polls.ToString(CultureInfo.InvariantCulture)+",\"first_active_processes\":"+firstActive.ToString(CultureInfo.InvariantCulture)
        +",\"minimum_active_processes\":"+minActive.ToString(CultureInfo.InvariantCulture)+",\"maximum_active_processes\":"+maxActive.ToString(CultureInfo.InvariantCulture)
        +",\"accounting_struct_bytes\":"+Marshal.SizeOf(typeof(Accounting)).ToString(CultureInfo.InvariantCulture)
        +",\"total_field_offset\":"+Marshal.OffsetOf(typeof(Accounting),"total").ToInt64().ToString(CultureInfo.InvariantCulture)
        +",\"active_field_offset\":"+Marshal.OffsetOf(typeof(Accounting),"active").ToInt64().ToString(CultureInfo.InvariantCulture)
        +",\"pointer_bytes\":"+IntPtr.Size.ToString(CultureInfo.InvariantCulture)+",\"pid_list_capacity\":"+capacity.ToString(CultureInfo.InvariantCulture)+",\"pid_list_query_ok\":"+(ok?"true":"false")
        +",\"pid_list_error\":"+error.ToString(CultureInfo.InvariantCulture)+",\"pid_list_returned_bytes\":"+returned.ToString(CultureInfo.InvariantCulture)
        +",\"pid_list_complete\":"+(complete?"true":"false")+",\"pid_list_assigned_processes\":"+assigned.ToString(CultureInfo.InvariantCulture)
        +",\"pid_list_count\":"+listed.ToString(CultureInfo.InvariantCulture)+",\"helper_listed\":"+(helperListed?"true":"false")+",\"child_listed\":"+(childListed?"true":"false")
        +",\"other_listed_processes\":"+other.ToString(CultureInfo.InvariantCulture)+",\"invalid_pid_entries\":"+invalid.ToString(CultureInfo.InvariantCulture)
        +",\"duplicate_pid_entries\":"+duplicates.ToString(CultureInfo.InvariantCulture)+",\"snapshot_query_ok\":"+(snapshotOk?"true":"false")
        +",\"snapshot_hint_rows\":"+snapshotSeen.ToString(CultureInfo.InvariantCulture)+",\"snapshot_hint_console_hosts\":"+consoleHosts.ToString(CultureInfo.InvariantCulture)
        +",\"snapshot_hint_compilers\":"+compilers.ToString(CultureInfo.InvariantCulture)+",\"snapshot_hint_unclassified\":"+unclassified.ToString(CultureInfo.InvariantCulture)
        +",\"helper_wait_state\":\""+DiagnosticWaitState(helper)+"\",\"child_wait_state\":\""+DiagnosticWaitState(child)+"\"}";
    } catch {
      FailureInventoryJson="{\"diagnostic_only\":true,\"native_qualification_proven\":false,\"capture_failed\":true,\"active_processes\":"
        +accounting.active.ToString(CultureInfo.InvariantCulture)+",\"total_processes\":"+accounting.total.ToString(CultureInfo.InvariantCulture)
        +",\"limit_terminated_processes\":"+accounting.terminated.ToString(CultureInfo.InvariantCulture)+"}";
    }
  }
  static void GuardLimits(IntPtr guard) {
    uint handleFlags; Require(GetHandleInformation(guard,out handleFlags) && (handleFlags&1)==0,"outer_noninherited");
    Limits limits; Require(QueryInformationJobObject(guard,9,out limits,(uint)Marshal.SizeOf(typeof(Limits)),IntPtr.Zero),"outer_limits_readback");
    Require(limits.basic.flags==0x2000 && limits.basic.processTime==0 && limits.basic.jobTime==0 && limits.basic.active==0
      && limits.basic.min==UIntPtr.Zero && limits.basic.max==UIntPtr.Zero && limits.pm==UIntPtr.Zero && limits.jm==UIntPtr.Zero,"outer_limits_exact");
  }
  static bool ParentIs(IntPtr child,uint helperPid) {
    uint childPid=GetProcessId(child); Require(childPid!=0,"child_pid_readback");
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0); Require(snapshot!=new IntPtr(-1),"parent_snapshot");
    try { var entry=new ProcessEntry(); entry.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
      Require(Process32First(snapshot,ref entry),"parent_snapshot_first");
      do { if(entry.pid==childPid) return entry.parent==helperPid; } while(Process32Next(snapshot,ref entry));
      return false;
    } finally { Close(ref snapshot,"parent_snapshot_close"); }
  }
  sealed class Drain {
    public long bytes; public FileStream stream; public Task task;
    public static Drain Start(ref IntPtr handle) {
      var safe=new SafeFileHandle(handle,true); handle=IntPtr.Zero;
      var result=new Drain();
      try { result.stream=new FileStream(safe,FileAccess.Read); }
      catch { safe.Dispose(); throw; }
      try { result.task=Task.Run(()=> { var buffer=new byte[4096]; int n; while((n=result.stream.Read(buffer,0,buffer.Length))>0) Interlocked.Add(ref result.bytes,n); }); }
      catch { result.stream.Dispose(); throw; }
      return result;
    }
  }
  public static void Run(string powershell,string helperPath,string request,string cwd,string channel,string nonce,string childPath,string childSha,string scenario) {
    Require(scenario=="BOUND" || scenario=="UNASSIGNED_CONTROL","fixture_scenario"); bool control=scenario=="UNASSIGNED_CONTROL";
    Require(Path.IsPathRooted(powershell) && Path.IsPathRooted(helperPath) && Path.IsPathRooted(cwd) && Path.IsPathRooted(channel) && Path.IsPathRooted(childPath),"absolute_paths");
    Require(SamePath(Path.GetDirectoryName(helperPath),cwd) && SamePath(Path.GetDirectoryName(channel),cwd),"private_fixture_paths");
    Require(System.Text.RegularExpressions.Regex.IsMatch(nonce,"\\A[a-f0-9]{64}\\z") && System.Text.RegularExpressions.Regex.IsMatch(childSha,"\\A[a-f0-9]{64}\\z"),"fixture_identity");
    Require(!request.Contains("\r") && !request.Contains("\n") && Encoding.UTF8.GetByteCount(request)<=4096 && !File.Exists(channel),"single_request");
    using(var sha=System.Security.Cryptography.SHA256.Create()) using(var file=File.OpenRead(childPath)) {
      Require(BitConverter.ToString(sha.ComputeHash(file)).Replace("-","").ToLowerInvariant()==childSha,"child_digest");
    }
    IntPtr guard=IntPtr.Zero,stdinRead=IntPtr.Zero,stdinWrite=IntPtr.Zero,stdoutRead=IntPtr.Zero,stdoutWrite=IntPtr.Zero,stderrRead=IntPtr.Zero,stderrWrite=IntPtr.Zero,child=IntPtr.Zero;
    var helper=new ProcessInfo(); Drain stdout=null,stderr=null; Inventory inventory=null;
    bool helperBound=false,childOwned=false,childOuterBound=false,outerTerminationRequested=false,observed=false,innerObserved=false,controlSurvived=false,childExitConfirmed=false;
    long helperBirth=0,childBirth=0; uint childPid=0,childCode=0,cleanupChildCode=0;
    Exception primary=null; var cleanupErrors=new List<Exception>();
    try {
      guard=CreateJobObject(IntPtr.Zero,null); Require(guard!=IntPtr.Zero,"outer_create");
      bool observerInside; Require(IsProcessInJob(new IntPtr(-1),guard,out observerInside) && !observerInside,"observer_outside_outer");
      var limits=new Limits(); limits.basic.flags=0x2000;
      Require(SetInformationJobObject(guard,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"outer_limits_set"); GuardLimits(guard);
      var security=new Security(); security.length=Marshal.SizeOf(typeof(Security)); security.inherit=1;
      Pipe(ref stdinRead,ref stdinWrite,ref security,"stdin_pipe");
      Pipe(ref stdoutRead,ref stdoutWrite,ref security,"stdout_pipe");
      Pipe(ref stderrRead,ref stderrWrite,ref security,"stderr_pipe");
      Require(SetHandleInformation(stdinWrite,1,0) && SetHandleInformation(stdoutRead,1,0) && SetHandleInformation(stderrRead,1,0),"observer_pipe_noninheritance");
      IntPtr attributes=IntPtr.Zero,jobValue=IntPtr.Zero,handles=IntPtr.Zero; bool initialized=false;
      try {
        UIntPtr bytes=UIntPtr.Zero; bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes); int sizeError=Marshal.GetLastWin32Error();
        Require(!sized && sizeError==122 && bytes!=UIntPtr.Zero,"outer_attribute_size");
        attributes=Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
        Require(InitializeProcThreadAttributeList(attributes,2,0,ref bytes),"outer_attributes_initialize"); initialized=true;
        jobValue=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue,guard);
        Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x2000d),jobValue,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"outer_job_attribute");
        handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handles,0,stdinRead); Marshal.WriteIntPtr(handles,IntPtr.Size,stdoutWrite); Marshal.WriteIntPtr(handles,IntPtr.Size*2,stderrWrite);
        Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x20002),handles,new UIntPtr((uint)(IntPtr.Size*3)),IntPtr.Zero,IntPtr.Zero),"helper_handle_attribute");
        var startup=new StartupEx(); startup.startup.cb=Marshal.SizeOf(typeof(StartupEx)); startup.startup.flags=0x100|1;
        startup.startup.stdin=stdinRead; startup.startup.stdout=stdoutWrite; startup.startup.stderr=stderrWrite; startup.attributes=attributes;
        var command=new StringBuilder(Quote(powershell)+" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "+Quote(helperPath));
        ProcessInfo created; bool ok=CreateProcess(powershell,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004|0x00080000,IntPtr.Zero,cwd,ref startup,out created);
        Require(ok,"helper_create"); helper=created;
      } finally {
        if(initialized) DeleteProcThreadAttributeList(attributes);
        if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
        if(jobValue!=IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      }
      bool membership; Require(IsProcessInJob(helper.process,guard,out membership) && membership,"helper_outer_membership"); helperBound=true;
      Require(SamePath(Image(helper.process),powershell),"helper_image"); helperBirth=Birth(helper.process);
      Close(ref stdinRead,"stdin_child_close"); Close(ref stdoutWrite,"stdout_child_close"); Close(ref stderrWrite,"stderr_child_close");
      stdout=Drain.Start(ref stdoutRead); stderr=Drain.Start(ref stderrRead);
      Require(ResumeThread(helper.thread)!=0xffffffff,"helper_resume");
      using(var safeInput=new SafeFileHandle(stdinWrite,true)) {
        stdinWrite=IntPtr.Zero;
        using(var input=new FileStream(safeInput,FileAccess.Write)) { var data=Encoding.UTF8.GetBytes(request+"\n"); input.Write(data,0,data.Length); input.Flush(); }
      }
      var deadline=DateTime.UtcNow.AddSeconds(45); string[] fields=null;
      while(DateTime.UtcNow<deadline) {
        Require(Interlocked.Read(ref stdout.bytes)==0 && Interlocked.Read(ref stderr.bytes)==0,"no_pre_ready_output");
        Require(WaitForSingleObject(helper.process,0)==0x102,"helper_live_before_capture");
        if(File.Exists(channel)) {
          try {
            Require(new FileInfo(channel).Length<=4096,"birth_channel_bound");
            string text=File.ReadAllText(channel);
            if(text.EndsWith("\n",StringComparison.Ordinal)) {
              var read=text.Split('\n');
              if(read.Length==7 && read[6]=="") {
                fields=new string[6]; for(int i=0;i<6;i++) fields[i]=read[i].TrimEnd('\r');
                break;
              }
            }
          } catch(IOException) { }
        }
        Thread.Sleep(10);
      }
      Require(fields!=null,"birth_channel_timeout");
      Require(fields[0]==nonce && UInt32.Parse(fields[1],CultureInfo.InvariantCulture)==helper.pid && Int64.Parse(fields[2],CultureInfo.InvariantCulture)==helperBirth,"birth_channel_correlation");
      childPid=UInt32.Parse(fields[3],CultureInfo.InvariantCulture); childBirth=Int64.Parse(fields[4],CultureInfo.InvariantCulture);
      long rawValue=Int64.Parse(fields[5],CultureInfo.InvariantCulture); Require(rawValue!=0 && rawValue!=-1,"child_handle_value");
      IntPtr transferred; Require(DuplicateHandle(helper.process,new IntPtr(rawValue),new IntPtr(-1),out transferred,0,false,2),"child_handle_transfer"); child=transferred;
      Require(GetProcessId(child)==childPid && childPid!=helper.pid && childBirth>0 && Birth(child)==childBirth && childBirth>=helperBirth,"child_kernel_identity");
      Require(SamePath(Image(child),childPath),"child_image"); Require(ParentIs(child,helper.pid),"child_parent"); childOwned=true;
      Require(IsProcessInJob(child,guard,out membership) && membership,"child_outer_membership"); childOuterBound=true;
      GuardLimits(guard); Accounting accounting; var accountingDeadline=DateTime.UtcNow.AddSeconds(2);
      int accountingPolls=0; uint firstActive=0,minActive=UInt32.MaxValue,maxActive=0;
      do {
        Require(QueryInformationJobObject(guard,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"outer_accounting");
        if(accountingPolls++==0) firstActive=accounting.active;
        if(accounting.active<minActive) minActive=accounting.active; if(accounting.active>maxActive) maxActive=accounting.active;
        inventory=ReadInventory(guard,helper.pid,childPid);
        if(inventory.complete && inventory.helperListed && inventory.childListed) break;
        Require(WaitForSingleObject(child,0)==0x102 && WaitForSingleObject(helper.process,0)==0x102,"both_live_during_accounting");
        Thread.Sleep(10);
      } while(DateTime.UtcNow<accountingDeadline);
      if(!inventory.complete || !inventory.helperListed || !inventory.childListed) CaptureFailureInventory(inventory,accounting,helper.process,child,accountingPolls,firstActive,minActive,maxActive);
      Require(inventory.complete && inventory.helperListed && inventory.childListed,"outer_known_identity_inventory");
      Require(GetProcessId(helper.process)==helper.pid && Birth(helper.process)==helperBirth && GetProcessId(child)==childPid && Birth(child)==childBirth,"known_identity_before_helper_kill");
      Require(IsProcessInJob(helper.process,guard,out membership) && membership && IsProcessInJob(child,guard,out membership) && membership,"known_membership_before_helper_kill");
      Require(WaitForSingleObject(child,0)==0x102 && WaitForSingleObject(helper.process,0)==0x102,"both_live_before_helper_kill");
      Require(Interlocked.Read(ref stdout.bytes)==0 && Interlocked.Read(ref stderr.bytes)==0,"never_ready_before_helper_kill");
      Require(TerminateProcess(helper.process,91),"forced_exact_helper_kill");
      Require(WaitForSingleObject(helper.process,5000)==0,"helper_exit_wait"); uint helperCode;
      Require(GetExitCodeProcess(helper.process,out helperCode) && helperCode==91,"forced_helper_exit_code");
      if(!control) {
        Require(WaitForSingleObject(child,5000)==0,"inner_last_close_child_exit");
        Require(GetExitCodeProcess(child,out childCode) && childCode!=259,"child_exit_readback"); innerObserved=true;
      } else {
        Require(WaitForSingleObject(child,5000)==0x102,"unassigned_control_survives_helper_exit");
        Require(GetExitCodeProcess(child,out childCode) && childCode==259,"unassigned_control_still_active"); controlSurvived=true;
      }
      // The OUTER Job is still held, has only KILL_ON_CLOSE limits, and has not
      // been terminated. It cannot supply the observed INNER last-close kill.
      GuardLimits(guard); observed=true;
    } catch(Exception error) { if(Phase=="setup") Phase="observer_exception"; primary=error; }
    finally {
      // On every abort, the independent OUTER guard contains only this helper's
      // inert test tree. No file-supplied PID is ever opened or terminated.
      if(guard!=IntPtr.Zero) Cleanup(cleanupErrors,()=> {
        Require(TerminateJobObject(guard,125),"outer_final_cleanup"); outerTerminationRequested=true;
      });
      if(helper.process!=IntPtr.Zero && !helperBound) Cleanup(cleanupErrors,()=>Require(TerminateProcess(helper.process,125),"unbound_owned_helper_cleanup"));
      // Successful Job termination already requests exit for this verified member.
      // Wait below: a zero-time probe followed by a second TerminateProcess can
      // race that exit and fail with ERROR_ACCESS_DENIED after it has completed.
      // Only an unconfirmed Job request/membership needs the exact-owned fallback;
      // neither request success nor a failed wait is itself cleanup confirmation.
      if(child!=IntPtr.Zero && childOwned && !(outerTerminationRequested && childOuterBound)) {
        uint state=WaitForSingleObject(child,0);
        Cleanup(cleanupErrors,()=>Require(state==0 || state==0x102,"owned_child_cleanup_probe"));
        // A probe error is retained, but cannot stop the already-owned handle's
        // best-effort termination or the unconditional completion wait below.
        if(state!=0) Cleanup(cleanupErrors,()=>Require(TerminateProcess(child,125),"owned_child_final_cleanup"));
      }
      if(helper.process!=IntPtr.Zero) Cleanup(cleanupErrors,()=>Require(WaitForSingleObject(helper.process,5000)==0,"helper_cleanup_wait"));
      if(child!=IntPtr.Zero && childOwned) Cleanup(cleanupErrors,()=>Require(WaitForSingleObject(child,5000)==0,"child_cleanup_wait"));
      if(child!=IntPtr.Zero && childOwned) Cleanup(cleanupErrors,()=> {
        uint code; Require(GetExitCodeProcess(child,out code) && code!=259,"child_cleanup_exit_readback");
        if(control) Require(code==125,"unassigned_control_cleanup_code");
        else if(innerObserved) Require(code==childCode,"child_exit_code_stable");
        cleanupChildCode=code; childExitConfirmed=true;
      });
      foreach(Drain drain in new[]{stdout,stderr}) if(drain!=null) {
        Cleanup(cleanupErrors,()=>Require(drain.task.Wait(5000),"pipe_drain_wait"));
        Cleanup(cleanupErrors,()=>drain.stream.Dispose());
      }
      foreach(IntPtr handle in new[]{stdinRead,stdinWrite,stdoutRead,stdoutWrite,stderrRead,stderrWrite,helper.thread,helper.process,child})
        if(handle!=IntPtr.Zero) Cleanup(cleanupErrors,()=>Require(CloseHandle(handle),"owned_handle_close"));
      if(guard!=IntPtr.Zero) Cleanup(cleanupErrors,()=>Close(ref guard,"outer_guard_close"));
    }
    if(primary!=null) cleanupErrors.Insert(0,primary);
    if(cleanupErrors.Count>0) throw new AggregateException("observer_failed",cleanupErrors);
    Require(observed,"observation_complete");
    Require(childExitConfirmed && inventory!=null,"owned_cleanup_complete");
    Require(stdout!=null && stderr!=null && Interlocked.Read(ref stdout.bytes)==0 && Interlocked.Read(ref stderr.bytes)==0,"helper_never_ready_or_resumed");
    Console.Out.WriteLine("{\"scenario\":\""+scenario+"\",\"nonce\":\""+nonce+"\",\"helper_pid\":"+helper.pid+",\"helper_birth_100ns\":\""+helperBirth+"\",\"child_pid\":"+childPid+",\"child_birth_100ns\":\""+childBirth+
      "\",\"child_image_verified\":true,\"child_parent_verified\":true,\"outer_membership_verified\":true,\"outer_inventory_complete\":true,\"outer_known_helper_listed\":true,\"outer_known_child_listed\":true,\"outer_listed_processes\":"+inventory.listed+
      ",\"outer_auxiliary_entries\":"+inventory.other+",\"auxiliary_authority_granted\":false,\"inner_cleanup_observed\":"+(innerObserved?"true":"false")+",\"unassigned_control_survived\":"+(controlSurvived?"true":"false")+
      ",\"child_exit_before_outer_cleanup\":"+(innerObserved?"true":"false")+",\"helper_exit_confirmed\":true,\"child_exit_confirmed\":true,\"child_code_before_outer_cleanup\":"+childCode+",\"child_exit_code\":"+cleanupChildCode+
      ",\"outer_guard_open_during_observation\":true,\"outer_termination_after_observation\":true,\"handles_closed\":true}"); Console.Out.Flush();
  }
}
'@
$request = [Console]::In.ReadLine() | ConvertFrom-Json
[MetaengineJobBirthObserver]::Run([string]$request.powershell_path,[string]$request.helper_path,[string]$request.helper_request,[string]$request.cwd,
  [string]$request.birth_channel_path,[string]$request.nonce,[string]$request.expected_child_path,[string]$request.expected_child_sha256,[string]$request.scenario)
} catch {
  $phase = 'compile_or_request'
  $inventory = 'null'
  try { $phase = [MetaengineJobBirthObserver]::Phase; $inventory = [MetaengineJobBirthObserver]::FailureInventoryJson } catch { }
  # Phase is a source-controlled constant, never command text or file contents.
  [Console]::Out.WriteLine('{"error":"JOB_BIRTH_OBSERVER_FAILED","phase":"' + $phase + '","inventory":' + $inventory + '}')
  exit 1
}
