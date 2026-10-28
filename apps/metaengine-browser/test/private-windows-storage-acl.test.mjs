import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';
import {secureAttachedPrivateFile} from '../../../infra/client-state-runtime/attached-postgres-onboarding.mjs';

test('DACL operator is a fixed PowerShell program, never a private path assembled into script or argv',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-contract-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const fakeWindowsEnv={SystemRoot:'C:\\Windows',
    PSModulePath:'C:\\untrusted-modules',PATH:'C:\\untrusted-binaries',
    LOCALAPPDATA:'C:\\Users\\Example\\AppData\\Local',APPDATA:'C:\\Users\\Example\\AppData\\Roaming'};
  const calls=[];
  const run=async(executable,argv,opts)=>{
    calls.push({executable,argv,opts});
    return {stdout:'METAENGINE_OWNER_DACL_VERIFIED\n'};
  };
  const output=await protectOwnerOnlyWindowsDirectory(directory,{platform:'win32',
    env:fakeWindowsEnv,run});
  assert.equal(output.owner_dacl_verified,true);
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.equal(call.executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(call.opts.shell,false);
  assert.equal(call.opts.env.METAENGINE_PRIVATE_ACL_TARGET,directory);
  assert.equal(call.opts.env.METAENGINE_PRIVATE_ACL_ACTION,'PROTECT_DIRECTORY');
  assert.equal(call.opts.env.PSModulePath,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(call.opts.env.DATABASE_URL,undefined);
  assert.equal(JSON.stringify(call.argv).includes(directory),false);
  assert.equal(Buffer.from(call.argv.at(-1),'base64').toString('utf16le').includes(directory),false);
  assert.equal(call.opts.env.DATABASE_URL,undefined);
  assert.equal(call.opts.env.PGPASSWORD,undefined);
  assert.equal(call.opts.env.LOCALAPPDATA,'C:\\Users\\Example\\AppData\\Local');
  assert.notEqual(call.opts.env.PSModulePath,fakeWindowsEnv.PSModulePath);
  assert.equal(call.opts.timeout,120000);
  const script=Buffer.from(call.argv.at(-1),'base64').toString('utf16le');
  assert(script.includes('$final.GetOwner([System.Security.Principal.SecurityIdentifier]).Value'));
  assert(script.includes("if($owner -notin $allowed){Write-Output 'ACL_DENIAL_OWNER_UNAPPROVED';throw 'owner_unapproved'}"));
  assert(script.indexOf('GetOwner(')<script.indexOf('$rules=@($final.GetAccessRules'));
  assert(!script.includes('SetOwner('));
});

test('a cold child taking longer than 15 seconds can complete its ACL receipt within the bounded attempt',{
  timeout:135000,
},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-cold-start-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let attempts=0;
  const result=await protectOwnerOnlyWindowsDirectory(directory,{
    platform:'win32',env:{SystemRoot:'C:\\Windows'},
    // Exercise the actual execFile timer without mutating a DACL or depending
    // on this test runner having a cold .NET cache. The old 15s bound kills it.
    run:async(_executable,_argv,options)=>{
      attempts++;
      return promisify(execFile)(process.execPath,['-e',
        'setTimeout(()=>process.stdout.write("ACL_PHASE_COMPLETED\\nMETAENGINE_OWNER_DACL_VERIFIED\\n"),16000)'],options);
    },
  });
  assert.equal(result.owner_dacl_verified,true);
  assert.equal(attempts,1);
});

test('timeout stays fail-closed with sanitized last-phase evidence and never retries',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-timeout-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  for(const [diagnostics,phase] of [
    ['sensitive user profile','not_started'],
    ['ACL_PHASE_SCRIPT_STARTED\nACL_PHASE_GET_ACL\nprivate path','get_acl'],
    ['ACL_PHASE_SET_ACL\nACL_PHASE_READBACK\nprivate credential','readback'],
  ]){
    let attempts=0;
    await assert.rejects(protectOwnerOnlyWindowsDirectory(directory,{
      platform:'win32',env:{SystemRoot:'C:\\Windows'},run:async()=>{
        attempts++;
        throw Object.assign(Error('private stderr'),{killed:true,signal:'SIGTERM',code:null,stdout:diagnostics});
      },
    }),{message:'private_windows_storage_powershell_timeout_'+phase});
    assert.equal(attempts,1);
  }
  await assert.rejects(protectOwnerOnlyWindowsDirectory(directory,{
    platform:'win32',env:{SystemRoot:'C:\\Windows'},run:async()=>{
      throw Object.assign(Error('private stdout overflow'),{
        killed:true,code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',stdout:'ACL_PHASE_READBACK\nprivate path'});
    },
  }),{message:'private_windows_storage_acl_not_confirmed_readback'});
});

test('Win32 DACL operator rejects unreadable receipt, unsupported platform and unknown operation',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-deny-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'private.json');
  await fs.writeFile(file,'{"secret":"test"}');
  const args={platform:'win32',env:{SystemRoot:'C:\\Windows'}};
  await assert.rejects(protectOwnerOnlyWindowsDirectory(dir,{
    ...args,run:async()=>({stdout:'localized failure text'}),
  }),/private_windows_storage_acl_not_confirmed/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{
    ...args,run:async()=>{throw Error('sensitive win user profile');},
  }),/private_windows_storage_acl_not_confirmed/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,operation:'ARBITRARY_SHELL'}),
    /private_windows_storage_arguments_invalid/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,env:{SystemRoot:'\\\\remote\\Windows'}}),
    /private_windows_storage_windows_root_unverified/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{
    ...args,run:async()=>{throw Object.assign(new Error('contains-private-path'),{killed:true});},
  }),/private_windows_storage_powershell_timeout/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{
    ...args,run:async()=>{throw Object.assign(new Error('C:\\private\\path'),
      {killed:true,stdout:'ACL_PHASE_SCRIPT_STARTED\\nACL_PHASE_GET_ACL\\nC:\\secret'});},
  }),/private_windows_storage_powershell_timeout_get_acl/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,platform:'linux'}),
    /private_windows_storage_arguments_invalid/);
});

test('fixed native denial markers distinguish a rejected grant from timeout without stderr disclosure',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-acl-denial-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const args={platform:'win32',env:{SystemRoot:'C:\\Windows'},operation:'VERIFY_DIRECTORY'};
  for(const reason of ['UNAPPROVED_GRANT','INSUFFICIENT_RIGHTS','DENY_OR_UNKNOWN_ACE','OWNER_UNAPPROVED']){
    let attempts=0;
    await assert.rejects(verifyOwnerOnlyWindowsStorage(directory,{...args,run:async()=>{
      attempts++;
      throw Object.assign(Error('private child error'),{code:1,killed:false,
        stdout:`ACL_PHASE_READBACK\nACL_DENIAL_${reason}\n`,stderr:'C:\\private\\secret credential'});
    }}),{message:`private_windows_storage_acl_not_confirmed_readback_${reason.toLowerCase()}`});
    assert.equal(attempts,1);
  }
  await assert.rejects(verifyOwnerOnlyWindowsStorage(directory,{...args,run:async()=>{
    throw Object.assign(Error('private timeout'),{code:'ETIMEDOUT',killed:true,
      stdout:'ACL_PHASE_READBACK\nACL_DENIAL_UNAPPROVED_GRANT\n',stderr:'private secret'});
  }}),{message:'private_windows_storage_powershell_timeout_readback'});
  await assert.rejects(verifyOwnerOnlyWindowsStorage(directory,{...args,run:async()=>{
    throw Object.assign(Error('private path'),{code:1,stdout:'ACL_PHASE_READBACK\nACL_DENIAL_UNKNOWN_PRIVATE_TEXT\n',
      stderr:'ACL_DENIAL_UNAPPROVED_GRANT\nC:\\private\\secret'});
  }}),{message:'private_windows_storage_acl_not_confirmed_readback'});
});

test('Win32 real ACL protects fresh private directory and verifies inheriting config and copied Vault', {
  skip:process.platform!=='win32',
},async t=>{
  const top=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-acl-physical-'));
  t.after(()=>fs.rm(top,{recursive:true,force:true}));
  const directory=path.join(top,'private-state');
  await fs.mkdir(directory);
  const result=await protectOwnerOnlyWindowsDirectory(directory);
  assert.equal(result.owner_dacl_verified,true);
  const nested=path.join(directory,'data');
  await fs.mkdir(nested);
  assert.equal((await verifyOwnerOnlyWindowsStorage(nested,{operation:'VERIFY_DIRECTORY'})).owner_dacl_verified,true);
  const config=path.join(directory,'runtime-host-config.json');
  await fs.writeFile(config,JSON.stringify({secret:'stays_local'}),{flag:'wx'});
  const vault=path.join(directory,'client-vault.key');
  await fs.writeFile(vault,'a'.repeat(64)+'\n',{flag:'wx'});
  assert.equal((await verifyOwnerOnlyWindowsStorage(config)).owner_dacl_verified,true);
  const attachedConfig=path.join(directory,'onboarded-config.json');
  await fs.writeFile(attachedConfig,'{"secret":"stays_local"}',{flag:'wx'});
  await secureAttachedPrivateFile(attachedConfig);
  assert.equal((await verifyOwnerOnlyWindowsStorage(attachedConfig,{operation:'VERIFY_PRIVATE_FILE'})).owner_dacl_verified,true);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(attachedConfig),/private_windows_storage_acl_not_confirmed/);
  assert.equal((await verifyOwnerOnlyWindowsStorage(vault)).owner_dacl_verified,true);
  // A longer startup allowance must never accept a broader real NTFS grant.
  const windowsRoot=process.env.SystemRoot||process.env.SYSTEMROOT;
  await promisify(execFile)(path.win32.join(windowsRoot,'System32','icacls.exe'),
    [vault,'/grant','*S-1-1-0:(R)'],{shell:false,windowsHide:true,timeout:120000,maxBuffer:8192});
  await assert.rejects(verifyOwnerOnlyWindowsStorage(vault),{
    message:'private_windows_storage_acl_not_confirmed_readback_unapproved_grant',
  });
});

test('Win32 DACL protection can repeat on existing private state without changing owner or group', {
  // Five sequential native calls each have their own 120s cap, plus cleanup.
  skip:process.platform!=='win32',timeout:630000,
},async t=>{
  const top=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-acl-reprotect-'));
  t.after(()=>fs.rm(top,{recursive:true,force:true}));
  const directory=path.join(top,'private-state');
  await fs.mkdir(directory);
  const executable=path.win32.join(process.env.SystemRoot||process.env.SYSTEMROOT,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script="$s=[System.IO.Directory]::GetAccessControl($env:METAENGINE_ACL_TEST_DIRECTORY);@{owner=$s.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;group=$s.GetGroup([System.Security.Principal.SecurityIdentifier]).Value}|ConvertTo-Json -Compress";
  const identity=async()=>JSON.parse((await promisify(execFile)(executable,
    ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,shell:false,timeout:120000,maxBuffer:8192,env:{...process.env,METAENGINE_ACL_TEST_DIRECTORY:directory}})).stdout);
  const before=await identity();
  assert.equal((await protectOwnerOnlyWindowsDirectory(directory)).owner_dacl_verified,true);
  assert.equal((await protectOwnerOnlyWindowsDirectory(directory)).owner_dacl_verified,true);
  assert.deepEqual(await identity(),before,'only DACL changes, owner and group remain intact');
  const privateFile=path.join(directory,'private.json');
  await fs.writeFile(privateFile,'{"test":"private"}',{flag:'wx'});
  assert.equal((await verifyOwnerOnlyWindowsStorage(privateFile)).owner_dacl_verified,true);
});
