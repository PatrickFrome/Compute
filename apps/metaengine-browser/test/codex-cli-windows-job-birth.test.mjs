import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolveCodexCliJobHelperSource} from '../src/codex-cli-windows-process-controller.mjs';

// Source contracts and their generated negative controls only. These tests do
// not compile PowerShell/C#, create native processes, or qualify crash cleanup.
const markers = {
  job: 'job=CreateJobObject(IntPtr.Zero,null);',
  limits: 'Require(SetInformationJobObject(job,9,ref limits,',
  sizing: 'bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref attributeBytes);',
  sizingRefusal: 'if(sized || sizeError!=122 || attributeBytes==UIntPtr.Zero) throw new InvalidOperationException(',
  allocation: 'attributes=Marshal.AllocHGlobal(checked((int)attributeBytes.ToUInt64()));',
  initialization: 'Require(InitializeProcThreadAttributeList(attributes,2,0,ref attributeBytes),"attributes_initialize_failed"); attributesInitialized=true;',
  value: 'jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);',
  attribute: 'Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x0002000d),jobList,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job_attribute_failed");',
  handleAllocation: 'handleList=Marshal.AllocHGlobal(checked(IntPtr.Size*3));',
  handleValues: 'Marshal.WriteIntPtr(handleList,0,stdinRead); Marshal.WriteIntPtr(handleList,IntPtr.Size,stdoutWrite); Marshal.WriteIntPtr(handleList,IntPtr.Size*2,stderrWrite);',
  handleAttribute: 'Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x00020002),handleList,new UIntPtr((uint)(IntPtr.Size*3)),IntPtr.Zero,IntPtr.Zero),"handle_attribute_failed");',
  startup: 'extended.startup.cb=Marshal.SizeOf(typeof(StartupEx)); extended.attributes=attributes;',
  create: 'bool created=CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004|0x00080000,IntPtr.Zero,cwd,ref extended,out createdProcess);',
  creationSuccess: 'Require(created,"create_process_failed");',
  ownership: 'process=createdProcess;',
  deletion: 'if(attributesInitialized) DeleteProcThreadAttributeList(attributes);',
  freeValue: 'if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);',
  freeHandles: 'if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);',
  freeList: 'if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);',
  membership: 'Require(IsProcessInJob(process.process,job,out inJob)&&inJob,"membership_readback_failed"); assigned=true;',
  birth: 'Require(GetProcessTimes(process.process,out birth,out exit,out kernel,out user),"birth_readback_failed");',
  image: 'Require(QueryFullProcessImageName(process.process,0,image,ref imageSize),"image_readback_failed");',
  ready: 'Emit("{\\"type\\":\\"ready\\",',
  authorization: 'string resume=Console.In.ReadLine();',
  resume: 'Require(ResumeThread(process.thread)!=0xffffffff,"resume_failed");',
};

function assertJobBirthContract(source) {
  let previous = -1;
  for (const [name, marker] of Object.entries(markers)) {
    assert.equal(source.split(marker).length, 2, `${name} must occur exactly once`);
    const position = source.indexOf(marker);
    assert.ok(position > previous, `${name} must follow the preceding native custody stage`);
    previous = position;
  }
  assert.match(source, /\[StructLayout\(LayoutKind\.Sequential,CharSet=CharSet\.Unicode\)\] struct StartupEx \{ public Startup startup; public IntPtr attributes; \}/);
  assert.match(source, /IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process\);/);
  assert.match(source, /UpdateProcThreadAttribute\(IntPtr list,uint flags,UIntPtr attribute,IntPtr value,UIntPtr size,IntPtr previous,IntPtr returned\);/);
  assert.match(source, /IntPtr attributes=IntPtr\.Zero,jobList=IntPtr\.Zero,handleList=IntPtr\.Zero; bool attributesInitialized=false;\s*try \{/);
  const creationScope = source.slice(source.indexOf(markers.sizing), source.indexOf(markers.membership));
  assert.match(creationScope, /\} finally \{/);
  assert.doesNotMatch(creationScope, /\bcatch\b/, 'attribute refusal cannot recover into a fallback creation');
  assert.equal(source.match(/\bCreateProcess\s*\(/g)?.length, 2, 'only the P/Invoke declaration and one guarded creation call are permitted');
  assert.doesNotMatch(source, /\bAssignProcessToJobObject\s*\(/, 'sequential assignment would reopen the birth window');
  assert.match(source, /limits\.basic\.flags=0x2000\|0x8;/, 'retain kill-on-close without enabling breakaway');
}

test('native child is created suspended with a checked Job-list attribute before any ready or resume', async () => {
  assertJobBirthContract(await fs.readFile(resolveCodexCliJobHelperSource(), 'utf8'));
});

for (const [name, mutate] of [
  ['omitted HANDLE_LIST',source=>source.replace(markers.handleAttribute,'')],
  ['control pipe substituted for child stdout',source=>source.replace(markers.handleValues,markers.handleValues.replace('IntPtr.Size,stdoutWrite','IntPtr.Size,stdinWrite'))],
  ['HANDLE_LIST value freed before attributes',source=>source.replace(markers.freeHandles,'').replace(markers.deletion,markers.freeHandles+'\n'+markers.deletion)],
  ['unchecked capability refusal', source => source.replace(markers.attribute, markers.attribute.replace('Require(', 'Unchecked('))],
  ['creation before Job-list setup', source => source.replace(markers.create, '').replace(markers.attribute, markers.create + '\n' + markers.attribute)],
  ['unchecked native creation', source => source.replace(markers.creationSuccess, 'Unchecked(created,"create_process_failed");')],
  ['ownership transfer before successful creation', source => source.replace(markers.ownership, '').replace(markers.creationSuccess, markers.ownership + '\n' + markers.creationSuccess)],
  ['sequential fallback', source => source + '\nAssignProcessToJobObject(job,process.process);'],
  ['additional bare creation fallback', source => source.replace(markers.ownership, markers.ownership + '\nCreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref extended,out process);')],
  ['missing extended-startup flag', source => source.replace('true,0x08000004|0x00080000,', 'true,0x08000004,')],
  ['wrong native startup size', source => source.replace('extended.startup.cb=Marshal.SizeOf(typeof(StartupEx))', 'extended.startup.cb=Marshal.SizeOf(typeof(Startup))')],
  ['freed Job-list value before attribute deletion', source => source.replace(markers.freeValue, '').replace(markers.deletion, markers.freeValue + '\n' + markers.deletion)],
  ['early ready before membership readback', source => source.replace(markers.membership, '').replace(markers.authorization, markers.membership + '\n' + markers.authorization)],
]) test(`native birth contract rejects ${name}`, async () => {
  const source = await fs.readFile(resolveCodexCliJobHelperSource(), 'utf8');
  assert.notEqual(mutate(source), source, 'negative control must alter the source');
  assert.throws(() => assertJobBirthContract(mutate(source)), assert.AssertionError);
});
