import test,{describe,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCodexCliWindowsProcessController,resolveCodexCliJobHelperSource} from '../src/codex-cli-windows-process-controller.mjs';
import {prepareCodexCliJobRuntime} from '../scripts/prepare-codex-cli-job-runtime.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';
import {codexCliEnvironment} from '../src/codex-cli-runner.mjs';
const attribute='Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x00020002),handleList,new UIntPtr((uint)(IntPtr.Size*3)),IntPtr.Zero,IntPtr.Zero),"handle_attribute_failed");';
const jobAttribute='Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x0002000d),jobList,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job_attribute_failed");';
const terminal='Emit(Terminal("exit",launch,helperIdentity,runId,process,birth,code,reason,false,null,accounting));';
// This generated variant adds one OWNED unnamed inheritable event. The child
// attempts to signal that exact event handle. Only the fixture creates it;
// native production helper bytes and machine policy are never modified.
function variant(source,control){
 for(const marker of [attribute,jobAttribute,terminal,'var security=new Security(); security.length=Marshal.SizeOf(typeof(Security)); security.inherit=1;'])
  assert.equal(source.split(marker).length,2,marker);
 let result=source.replace('  static readonly object outputLock',
  '  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateEvent(ref Security s,bool manual,bool initial,string name);\n  static readonly object outputLock');
 result=result.replace('var process=new ProcessInfo(); bool assigned=false;','var process=new ProcessInfo(); bool assigned=false; IntPtr fixtureEvent=IntPtr.Zero;');
 result=result.replace('security.inherit=1;',`security.inherit=1;
      fixtureEvent=CreateEvent(ref security,true,false,null); Require(fixtureEvent!=IntPtr.Zero,"fixture_event_create");
      Environment.SetEnvironmentVariable("METAENGINE_FIXTURE_INHERITANCE_HANDLE",fixtureEvent.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture));`);
 if(control)result=result.replace(attribute,'Require(true,"fixture_handle_list_omitted");');
 result=result.replace(terminal,`Require(WaitForSingleObject(fixtureEvent,0)==${control?'0':'0x102'},"fixture_inheritance_counterfactual");
      CloseChecked(ref fixtureEvent,"fixture_event_close");
      ${terminal}`);
 result=result.replace('foreach(IntPtr h in new[]{job,','foreach(IntPtr h in new[]{fixtureEvent,job,');return result;
}
test('handle-list counterfactual changes only the explicit inheritance restriction, retaining pre-birth Job containment',async()=>{
 const source=await fs.readFile(resolveCodexCliJobHelperSource(),'utf8'),bound=variant(source,false),control=variant(source,true);
 assert.ok(bound.includes(attribute));assert.ok(!control.includes(attribute));
 for(const text of [bound,control]){assert.ok(text.includes(jobAttribute));assert.match(text,/fixture_event_close/);assert.match(text,/new\[\]\{fixtureEvent,job,/);}
 assert.equal(bound.replace(attribute,'Require(true,"fixture_handle_list_omitted");').replace('fixtureEvent,0)==0x102','fixtureEvent,0)==0'),control);
});
const childScript=String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Sentinel { [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetEvent(IntPtr h); }'
$handle=[IntPtr]::new([long]$env:METAENGINE_FIXTURE_INHERITANCE_HANDLE)
$value=[Sentinel]::SetEvent($handle)
[Console]::Out.WriteLine('{"set_event":'+$value.ToString().ToLowerInvariant()+'}')`;
describe('actual Windows inheritance counterfactual (UNKNOWN unless executed on Windows)',{skip:process.platform!=='win32'},()=>{
 let directory,temporary,preparation,rows,powershell,executableSha;
 before(()=>{preparation=(async()=>{
  temporary=await fs.realpath(os.tmpdir());directory=await fs.realpath(await fs.mkdtemp(path.join(temporary,'metaengine-handle-list-')));
  powershell=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
  executableSha=createHash('sha256').update(await fs.readFile(powershell)).digest('hex');
  const source=await fs.readFile(resolveCodexCliJobHelperSource(),'utf8');rows=[];
  for(const control of [false,true]){const helperSourcePath=path.join(directory,control?'control.ps1':'bound.ps1');
   await fs.writeFile(helperSourcePath,variant(source,control),{flag:'wx'});
   const built=await prepareCodexCliJobRuntime({helperSourcePath,outputDirectory:path.join(directory,control?'control':'bound')});rows.push({control,built});}
 })();return preparation;},{timeout:420000});
 after(async()=>{
  if(preparation)await preparation.catch(()=>{});if(!directory)return;
  assert.equal(await fs.realpath(directory),directory);assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('metaengine-handle-list-'));
  await fs.rm(directory,{recursive:true,force:false});
 });
 test('only the no-HANDLE_LIST control can signal the helper-owned unrelated inheritable event',{timeout:180000},async()=>{
  for(const {control,built} of rows){
   const controller=createCodexCliWindowsProcessController({helperPath:built.helperPath,expectedHelperSha256:built.manifest.helper_sha256});
   const env={...codexCliEnvironment(path.join(directory,'unused-auth')),TEMP:directory,TMP:directory};
   await withOwnedCodexCliProcess(controller,{executablePath:powershell,expectedExecutableSha256:executableSha,
    args:['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(childScript,'utf16le').toString('base64')],
    cwd:directory,env,timeoutMs:60000,runId:randomUUID()},async handle=>{
     let output='';handle.stdout.on('data',value=>{output+=value.toString();});handle.stderr.resume();await handle.resume('');
     const terminal=await handle.completion;assert.equal(terminal.exit_code,0);assert.equal(terminal.tree_cleanup_confirmed,true);
     assert.equal(terminal.joined_settlement.scope,'WINDOWS_HELPER_TREE');assert.equal(JSON.parse(output.trim()).set_event,control);
   });
  }
 });
});
