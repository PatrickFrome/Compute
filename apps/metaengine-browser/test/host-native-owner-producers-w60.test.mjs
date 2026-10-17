import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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

test('W60: Authenticode uses the same pinned OS executable and environment as the kernel probe',async()=>{
  const previous=['PATH','PSModulePath'].map(key=>[key,process.env[key]]);
  try {
    process.env.PATH='C:\\untrusted-native-bin';
    process.env.PSModulePath='C:\\untrusted-native-modules';
    let calls=0;
    const result=await readWindowsSignedExecutableW60('C:\\generated-w60.exe',{
      platform:'win32',readFile:async()=>Buffer.from('fixture bytes'),
      exec:async(program,args,options)=>{
        calls++;
        assert.equal(program,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
        assert.equal(options.shell,false);
        assert.deepEqual(options.env,{
          SystemRoot:'C:\\Windows',SYSTEMROOT:'C:\\Windows',WINDIR:'C:\\Windows',
          PATH:'C:\\Windows\\System32',
          PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
        });
        assert.equal(options.windowsHide,true);
        assert.match(args.at(-1),/Get-AuthenticodeSignature -LiteralPath/);
        return {stdout:JSON.stringify({status:'Valid',thumbprint:'a'.repeat(40)})};
      },
    });
    assert.equal(calls,1);
    assert.equal(result?.native_signature_verified,true);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('W60: Authenticode refuses unverified system roots before executing or reading EXE bytes',async()=>{
  const previous=['SystemRoot','SYSTEMROOT','WINDIR'].map(key=>[key,process.env[key]]);
  let calls=0,reads=0;
  try {
    for(const root of ['', 'C:\\attacker', 'D:\\Windows', 'C:\\Windows\\..\\Windows']) {
      process.env.SystemRoot=root;process.env.SYSTEMROOT=root;process.env.WINDIR=root;
      assert.equal(await readWindowsSignedExecutableW60('C:\\generated-w60.exe',{
        platform:'win32',exec:async()=>{calls++;return {stdout:JSON.stringify({status:'Valid',thumbprint:'a'.repeat(40)})};},
        readFile:async()=>{reads++;return Buffer.from('fixture bytes');},
      }),null);
    }
    assert.equal(calls,0);
    assert.equal(reads,0);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('W60: the existing W68 production export supplies release proof under before/after Owner fences',()=>{
  // A separate interpreter installs test-only ESM hooks before importing W60.
  // No production root/path/signer/reader injection is added; no native process,
  // installed profile, release sidecar, Owner service or database is consulted.
  const target=new URL('../src/host-native-owner-producers-w60.mjs',import.meta.url).href;
  const verifier=new URL('../src/installed-executable-provenance-w68.mjs',import.meta.url).href;
  const code=`
    import assert from 'node:assert/strict';
    import {registerHooks,syncBuiltinESMExports} from 'node:module';
    import childProcess from 'node:child_process';
    childProcess.execFile=()=>{throw Error('unexpected_native_process')};
    childProcess.spawn=()=>{throw Error('unexpected_native_process')};
    syncBuiltinESMExports();
    Object.defineProperty(process,'platform',{value:'win32'});
    Object.defineProperty(process,'execPath',{value:'C:\\\\fixture\\\\browser.exe'});
    process.env.SystemRoot='C:\\\\Windows';process.env.SYSTEMROOT='C:\\\\Windows';process.env.WINDIR='C:\\\\Windows';
    const replacement='data:text/javascript,'+encodeURIComponent(
      'export async function readVerifiedInstalledExecutableW68(app){'+
      'globalThis.fixture.calls++;if(globalThis.fixture.error)throw Error("unavailable");'+
      'globalThis.fixture.during?.();return globalThis.fixture.proof;}');
    registerHooks({resolve(specifier,context,next){
      const resolved=next(specifier,context);
      return resolved.url===${JSON.stringify(verifier)}?{url:replacement,shortCircuit:true}:resolved;
    }});
    const {createHostNativeOwnerReadersW60}=await import(${JSON.stringify(target)});
    const source='a'.repeat(40), birth='2026-10-15T00:00:00.000Z';
    const original={schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
      authority_effect:false,owner_id:'host-w60',device_id:'device-w60',project_id:'project-w60',
      pid:1234,created_at:birth,process_incarnation_id:'incarnation-w60',generation:3,epoch:2,source_sha:source};
    const proof=()=>({source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:source,
      package_version:'0.7.0-dev.1.1',installed_exe_sha256:'b'.repeat(64),signer_thumbprint:'c'.repeat(40),
      proof_identity:'d'.repeat(64),release_root_signature_verified:true,slsa_evidence_digest_bound:true,
      independent_slsa_crypto_verified_at_runtime:false,native_signature_verified:true,
      exact_bytes_verified:true,observed_at:new Date().toISOString(),authority_effect:false});
    let owner={...original},reads=0,fourthReadChange=null,sourceReadback=[];
    const identity={ensure:async()=>{},snapshot:()=>({device_id:'device-w60'}),
      readHostOwnerIncarnation:async()=>{
        reads++;
        const record={...owner,observed_at:new Date().toISOString(),
          ...(reads===4?fourthReadChange:{})};
        sourceReadback.push(record.source_sha);
        return record;
      }};
    const readers=createHostNativeOwnerReadersW60({identity,guardianLauncher:{status:async()=>null},
      app:{isPackaged:true,getVersion:()=> '0.7.0-dev.1.1'},processId:1234,
      exec:async(program,args,options)=>{
        assert.equal(program,'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe');
        assert.equal(options.shell,false);
        assert.match(args.at(-1),/Get-Process -Id/);
        return {stdout:JSON.stringify({pid:1234,created_at:birth,exe_path:process.execPath})};
      }});
    const invoke=async(value=proof(),during=null,error=false,finalReadChange=null)=>{
      owner={...original};reads=0;fourthReadChange=finalReadChange;sourceReadback=[];
      globalThis.fixture={proof:value,during,error,calls:0};
      const result=await readers.readSignedInstalledExecutable('host-w60',3);
      assert.equal(globalThis.fixture.calls,1,'must use the existing W68 production export');
      return result;
    };
    const verified=await invoke();
    assert.ok(verified,'root-authenticated W68 proof must not require nonexistent trust-root fields');
    assert.ok(reads>=4,'must recheck authenticated Owner after W68 completes');
    for(const key of ['source_sha','installed_exe_sha256','proof_identity','observed_at',
      'release_root_signature_verified','slsa_evidence_digest_bound'])
      assert.equal(verified[key],globalThis.fixture.proof[key],key);
    assert.equal(verified.owner_id,original.owner_id);
    assert.equal(verified.owner_epoch,original.epoch);
    assert.equal(verified.owner_generation,original.generation);
    assert.equal(verified.process_incarnation_id,original.process_incarnation_id);
    assert.equal(verified.authority_effect,false);
    assert.ok(Object.isFrozen(verified));
    for(const change of [{fixture_classification:'STAGING'},{synthetic:true},{staging:true},{untrusted:true},
      {release_root_signature_verified:false},{slsa_evidence_digest_bound:false},
      {native_signature_verified:false},{exact_bytes_verified:false},{authority_effect:true},
      {source:'PUBLIC_JSON'},{source_sha:'e'.repeat(40)},{installed_exe_sha256:'invalid'},
      {proof_identity:'invalid'},{observed_at:new Date(Date.now()-60000).toISOString()}])
      assert.equal(await invoke({...proof(),...change}),null,JSON.stringify(change));
    assert.equal(await invoke(null),null);
    assert.equal(await invoke(proof(),null,true),null);
    for(const change of [{owner_id:'other-owner'},{device_id:'other-device'},{project_id:'other-project'},
      {pid:4321},{created_at:'2026-10-15T01:00:00.000Z'},{process_incarnation_id:'other-incarnation'},
      {generation:4},{epoch:3},{source_sha:'e'.repeat(40)},{untrusted:true}])
      assert.equal(await invoke(proof(),()=>{owner={...owner,...change};}),null,JSON.stringify(change));
    // First Owner observation is A,A; the post-W68 observation is A,B.
    // Comparing only the two outer A records would accept a proof for A.
    // Revalidate all custody and freshness fields on that fourth read too.
    const acceptedFinalDrifts=[];
    for(const change of [{source_sha:'e'.repeat(40)},{schema:'wrong-schema'},
      {source:'PUBLIC_JSON'},{authority_effect:true},{owner_id:'other-owner'},
      {device_id:'other-device'},{project_id:'other-project'},{pid:4321},
      {created_at:'2026-10-15T01:00:00.000Z'},{process_incarnation_id:'other-incarnation'},
      {generation:4},{epoch:3},{observed_at:'malformed'},
      {observed_at:new Date(Date.now()-60000).toISOString()},
      {observed_at:new Date(Date.now()+60000).toISOString()},
      {fixture_classification:'STAGING'},{synthetic:true},{staging:true},{untrusted:true}]) {
      const result=await invoke(proof(),null,false,change);
      assert.equal(reads,4,'must reach the final authenticated Owner read');
      assert.deepEqual(sourceReadback,[source,source,source,change.source_sha??source]);
      if(result!==null)acceptedFinalDrifts.push(Object.keys(change)[0]+':'+String(Object.values(change)[0]));
    }
    assert.deepEqual(acceptedFinalDrifts,[],
      'any invalid fourth authenticated Owner read must invalidate proof A');
    process.stdout.write('W60_W68_OWNER_FENCES_PASS');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{
    encoding:'utf8',windowsHide:true,timeout:15000,
  });
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'W60_W68_OWNER_FENCES_PASS');
});
