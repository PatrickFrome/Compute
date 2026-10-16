import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { createHostNativeOwnerReadersW60, readWindowsKernelProcessW60,
  readWindowsSignedExecutableW60 } from '../src/host-native-owner-producers-w60.mjs';
import { missingNativeOwnerProtocolsW52, createNativeOwnerVerifierW52 } from '../src/native-owner-verifier-w52.mjs';

const iso = '2026-10-15T00:00:00.000Z';
// Windows-shaped unit inputs are fixture-only on other operating systems.
// The real subprocess proof below is always restricted to Windows.
const originalWindowsRoot = process.env.SystemRoot;
if (process.platform !== 'win32') process.env.SystemRoot = 'C:\\Windows';
test.after(()=>{
  if (process.platform !== 'win32') {
    if (originalWindowsRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalWindowsRoot;
  }
});
const ident = {
  ensure: async()=>({device_id:'device-w60'}),
  snapshot:()=>({device_id:'device-w60'}),
};
const guardian = {status:async()=>({
  schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  state:'READY', owner_binding_proven:true,device_binding_proven:true,
})};
const app={isPackaged:false,getVersion:()=> '0.7.0-dev.1.1'};
const proc = (pid=1234,birth=iso)=>({pid,created_at:birth,exe_path:process.execPath});
const absent = (pid=1234)=>({pid,state:'NOT_RUNNING',
  native_error_id:'NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.GetProcessCommand',
  native_error_category:'ObjectNotFound',
  native_error_type:'Microsoft.PowerShell.Commands.ProcessCommandException',native_target_pid:pid});
const fakeExec = (x=proc())=>async (program,args,options)=>{
  assert.equal(program,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(options.shell,false);
  assert.equal(options.env.PATH,'C:\\Windows\\System32');
  assert.equal(options.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.deepEqual(args.slice(0,4),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass']);
  assert.equal(options.windowsHide,true);
  return {stdout:JSON.stringify(x)};
};
const record=()=>({
  schema:'metaengine.host.owner-incarnation.v1',
  source:'LOCAL_HOST_OWNER', authority_effect:false,
  owner_id:'host-w60',device_id:'device-w60',project_id:'project-w60',
  pid:1234,created_at:iso,process_incarnation_id:'incarnation-w60',
  generation:3,epoch:2,observed_at:new Date().toISOString(),
});
const make=(identity=ident, options={})=>createHostNativeOwnerReadersW60({
  identity,guardianLauncher:guardian,app,processId:1234,exec:fakeExec(),...options,
});

test('W60: production composition supplies six concrete methods, W61 birth remains unproven', async()=>{
  const r=make();
  assert.deepEqual(missingNativeOwnerProtocolsW52(r),[]);
  for(const key of ['readHostOwner','readKernelProcess','readGuardianOwner',
    'readSignedInstalledExecutable','readOwnerSecretStore','readOwnPostgresBirth'])
    assert.equal(typeof r[key],'function',key);
  assert.equal(await r.readHostOwner(),null);
  assert.equal(await r.readKernelProcess(1234),null);
  assert.equal(await r.readGuardianOwner('host-w60',3),null);
  assert.equal(await r.readSignedInstalledExecutable('host-w60',3),null);
  assert.equal(await r.readOwnerSecretStore('host-w60',3),null);
  assert.equal(await r.readOwnPostgresBirth('host-w60',2),null);
  const verifier=createNativeOwnerVerifierW52(r);
  assert.ok(verifier);
  assert.equal(await verifier.readOwner(),null);
});
test('W60: genuine fixed kernel census is not a forged caller process field', async()=>{
  const k=await readWindowsKernelProcessW60(1234,{platform:'win32',exec:fakeExec()});
  assert.equal(k?.state,'PRESENT');
  assert.equal(k?.created_at,iso);
  assert.equal(k?.source,'OS_PROCESS_INVENTORY');
  assert.equal(k?.authority_effect,false);
  assert.ok(!('process_incarnation_id' in k));
});
test('W60: kernel read rejects nonnumeric, negative, oversized and non-Windows', async()=>{
  for(const id of ['1234',0,-1,2147483648,NaN]) assert.equal(
    await readWindowsKernelProcessW60(id,{platform:'win32',exec:fakeExec()}),null);
  assert.equal(await readWindowsKernelProcessW60(1234,{platform:'linux',exec:fakeExec()}),null);
});
test('W60: kernel rejects PID reuse and malformed OS birth',async()=>{
  for(const v of [{...proc(),pid:1235},{...proc(),created_at:'INVALID'},null]){
    const got=await readWindowsKernelProcessW60(1234,{platform:'win32',
      exec:fakeExec(v)});
    assert.equal(got,null);
  }
});
test('W60: typed native PID absence is a verified negative without a process birth or Owner claim',async()=>{
  const result=await readWindowsKernelProcessW60(1234,{platform:'win32',exec:fakeExec(absent())});
  assert.equal(result?.state,'NOT_RUNNING');
  assert.equal(result?.pid,1234);
  assert.equal(result?.source,'OS_PROCESS_INVENTORY');
  assert.equal(result?.native_verified,true);
  assert.equal(result?.authority_effect,false);
  assert.ok(Number.isFinite(Date.parse(result?.observed_at)));
  for(const field of ['created_at','exe_path','owner_id','generation','process_incarnation_id'])
    assert.ok(!(field in result),field);
});

test('W60: malformed absence, wrong PID and permission errors cannot prove a dead Owner',async()=>{
  for(const row of [
    {...absent(),pid:1235}, {...absent(),native_target_pid:1235},
    {...absent(),native_error_id:'AccessDenied,Microsoft.PowerShell.Commands.GetProcessCommand'},
    {...absent(),native_error_category:'PermissionDenied'},
    {...absent(),native_error_type:'System.UnauthorizedAccessException'},
    {pid:1234,state:'NOT_RUNNING',native_verified:true},
    {...absent(),native_verified:true}, {...absent(),created_at:iso},
  ]) assert.equal(await readWindowsKernelProcessW60(1234,{platform:'win32',exec:fakeExec(row)}),null);
  for(const code of ['EPERM','EACCES','ENOENT','ETIMEDOUT','ABORT_ERR']) {
    const error=Object.assign(new Error('native read unconfirmed'),{code,stdout:JSON.stringify(absent())});
    assert.equal(await readWindowsKernelProcessW60(1234,{platform:'win32',exec:async()=>{throw error;}}),null,code);
  }
});

test('W60: actual disposable Windows child is PRESENT before exit and verified absent after exit',{
  skip:process.platform!=='win32',timeout:60000,
},async t=>{
  const child=spawn(process.execPath,['--input-type=module','-e',
    "process.stdin.resume(); process.stdout.write('READY\\n');"],
  {windowsHide:true,stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  let timer;
  try {
    await Promise.race([
      once(child.stdout,'data'),
      once(child,'error').then(([error])=>{throw error;}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('disposable_child_start_timeout')),15000);}),
    ]);
  } finally {clearTimeout(timer);}
  const pid=child.pid;
  const present=await readWindowsKernelProcessW60(pid);
  assert.equal(present?.state,'PRESENT');
  assert.equal(present?.pid,pid);
  const exited=once(child,'exit');
  child.stdin.end();
  const [code,signal]=await exited;
  assert.equal(code,0);assert.equal(signal,null);
  const missing=await readWindowsKernelProcessW60(pid);
  assert.equal(missing?.state,'NOT_RUNNING');
  assert.equal(missing?.native_verified,true);
  assert.equal(missing?.pid,pid);
  assert.equal(missing?.authority_effect,false);
});

test('W60: failed native command remains UNKNOWN',async()=>{
  assert.equal(await readWindowsKernelProcessW60(1234,{platform:'win32',
    exec:async()=>{throw new Error('no OS authority')}}),null);
});

test('W60: kernel probe ignores PATH and user module replacements without a fallback executable',async()=>{
  const previousPath=process.env.PATH, previousModules=process.env.PSModulePath;
  try {
    process.env.PATH=path.resolve('untrusted-native-bin');
    process.env.PSModulePath=path.resolve('untrusted-native-modules');
    const result=await readWindowsKernelProcessW60(1234,{platform:'win32',exec:fakeExec(absent())});
    assert.equal(result?.state,'NOT_RUNNING');
  } finally {
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
    if(previousModules===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=previousModules;
  }
});

test('W60: missing or unverified Windows root cannot fall back to PATH',async()=>{
  const keys=['SystemRoot','SYSTEMROOT','WINDIR','PATH'];
  const previous=keys.map(key=>[key,process.env[key]]);
  let calls=0;
  try {
    process.env.PATH=path.resolve('untrusted-native-bin');
    process.env.WINDIR='C:\\Windows';
    for(const root of ['', 'relative', 'C:\\attacker', '\\\\server\\Windows', 'D:\\Windows', 'C:\\Windows\\..\\Windows']) {
      if(root){process.env.SystemRoot=root;process.env.SYSTEMROOT=root;}
      else {delete process.env.SystemRoot;delete process.env.SYSTEMROOT;}
      assert.equal(await readWindowsKernelProcessW60(1234,{platform:'win32',exec:async()=>{calls++;return {stdout:JSON.stringify(absent())};}}),null);
    }
    assert.equal(calls,0);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
test('W60: native Authenticode and full-file bytes are both required',async()=>{
  const payload=Buffer.from('generated-test-exe');
  const hash=crypto.createHash('sha256').update(payload).digest('hex');
  const out=await readWindowsSignedExecutableW60('C:\\generated-w60.exe',{
    platform:'win32', readFile:async()=>payload,
    exec:async(_,args)=>({stdout:JSON.stringify({status:'Valid',thumbprint:'a'.repeat(40)})}),
  });
  assert.equal(out?.installed_exe_sha256,hash);
  assert.equal(out?.native_signature_verified,true);
  assert.equal(out?.authority_effect,false);
});
test('W60: unsigned, malformed cert, invalid executable and non-Windows fail closed',async()=>{
  for(const sig of [{status:'NotSigned',thumbprint:'a'.repeat(40)},
    {status:'Valid',thumbprint:'INVALID'}]){
    assert.equal(await readWindowsSignedExecutableW60('C:\\generated-w60.exe',{
      platform:'win32',readFile:async()=>Buffer.from('bytes'),
      exec:async()=>({stdout:JSON.stringify(sig)})}),null);
  }
  for(const name of ['','\\\\server\\evil.exe','x\0.exe'])
    assert.equal(await readWindowsSignedExecutableW60(name,{platform:'win32'}),null);
  assert.equal(await readWindowsSignedExecutableW60('C:\\dummy.exe',{platform:'linux'}),null);
});
test('W60: malformed constructor refuses untrusted composition',()=>{
  assert.throws(()=>make({},{}),/identity_required/);
  assert.throws(()=>createHostNativeOwnerReadersW60({identity:ident,app}),/guardian_reader_required/);
});
test('W60: Device enrollment and Guardian status do not become Owner proof',async()=>{
  assert.equal(await make({...ident,readHostOwnerIncarnation:async()=>({verified:true,
    owner_id:'host-w60',pid:1234})}).readHostOwner(),null);
});
test('W60: explicitly STAGING or replayed Host custody cannot promote Owner',async()=>{
  for(const ext of [{fixture_classification:'STAGING'}, {synthetic:true},
    {device_id:'another-device'},{pid:4321},{created_at:'2026-10-14T00:00:00.000Z'}]){
    const r=make({...ident,readHostOwnerIncarnation:async()=>({...record(),...ext})});
    assert.equal(await r.readHostOwner(),null);
  }
});
test('W60: validated Host birth can read, Guardian shape still has no bound epoch',async()=>{
  const r=make({...ident,readHostOwnerIncarnation:async()=>record()},{});
  // A Linux runner is never allowed to promote a mocked Windows census to
  // trusted local Host birth; only the Windows lane exercises that contract.
  if (process.platform === 'win32') {
    assert.equal((await r.readHostOwner())?.owner_id,'host-w60');
    assert.equal((await r.readKernelProcess(1234))?.process_incarnation_id,'incarnation-w60');
  } else {
    assert.equal(await r.readHostOwner(),null);
    assert.equal(await r.readKernelProcess(1234),null);
  }
  assert.equal(await r.readGuardianOwner('host-w60',3),null);
  assert.equal(await r.readOwnerSecretStore('host-w60',3),null);
  assert.equal(await r.readSignedInstalledExecutable('host-w60',3),null);
});
test('W60: PG hook never upgrades an unverified owner even with forged provider',async()=>{
  let count=0;
  const r=make(ident,{postgresBirth:async()=>{count++;return {source:'OWN_PG_POSTMASTER_READBACK'}}});
  assert.equal(await r.readOwnPostgresBirth('host-w60',2),null);
  assert.equal(count,0);
});
test('W60: in-flight Owner generation transfer cannot survive kernel birth readback',async()=>{
  let counter=0;
  const r=make({...ident,readHostOwnerIncarnation:async()=>({
    ...record(),generation:++counter===1?3:4,
  })});
  assert.equal(await r.readHostOwner(),null);
});
test('W60: stale Host receipt does not get refreshed by local clock',async()=>{
  const r=make({...ident,readHostOwnerIncarnation:async()=>({
    ...record(),observed_at:new Date(Date.now()-60000).toISOString(),
  })});
  assert.equal(await r.readHostOwner(),null);
});
test('W60: HOST secret is never returned without current Owner incarnation',async()=>{
  let called=0;
  const r=make({...ident,readPrivateOwnerGatewayCredential:async()=>{
    called++;return {api_key:'S'.repeat(64)};
  }});
  assert.equal(await r.readOwnerSecretStore('host-w60',3),null);
  assert.equal(called,0);
});
