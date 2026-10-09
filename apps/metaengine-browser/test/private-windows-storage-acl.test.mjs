import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';

test('DACL operator is a fixed PowerShell program, never a private path assembled into script or argv',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-contract-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const fakeWindowsEnv={SystemRoot:'C:\\Windows',USERPROFILE:'C:\\Users\\fixture',
    TEMP:'C:\\Users\\fixture\\Temp',TMP:'C:\\Users\\fixture\\Temp',HOMEDRIVE:'C:',HOMEPATH:'\\Users\\fixture',
    PSModulePath:'C:\\untrusted-modules',PATH:'C:\\untrusted-bin',DATABASE_URL:'private',PGPASSWORD:'private',GITHUB_TOKEN:'private'};
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
  assert.equal(JSON.stringify(call.argv).includes(directory),false);
  assert.equal(Buffer.from(call.argv.at(-1),'base64').toString('utf16le').includes(directory),false);
  assert.equal(call.opts.env.DATABASE_URL,undefined);
  assert.equal(call.opts.env.PGPASSWORD,undefined);
  assert.equal(call.opts.env.GITHUB_TOKEN,undefined);
  assert.equal(call.opts.env.PATH,undefined);
  assert.equal(call.opts.env.USERPROFILE,fakeWindowsEnv.USERPROFILE);
  assert.equal(call.opts.env.TEMP,fakeWindowsEnv.TEMP);
  assert.equal(call.opts.env.TMP,fakeWindowsEnv.TMP);
  assert.equal(call.opts.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(call.opts.timeout,120000);
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
  }),/private_windows_storage_acl_script_failed/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,operation:'ARBITRARY_SHELL'}),
    /private_windows_storage_arguments_invalid/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,env:{SystemRoot:'\\\\remote\\Windows'}}),
    /private_windows_storage_windows_root_unverified/);
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,platform:'linux'}),
    /private_windows_storage_arguments_invalid/);
});

test('WinPS cold-start timeout is distinguished from script failure without exposing diagnostics',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-timeout-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const args={platform:'win32',env:{SystemRoot:'C:\\Windows',
    USERPROFILE:'\\\\private-host\\profile',TEMP:'\\\\private-host\\temp',TMP:'invalid\npath',HOMEDRIVE:'invalid',HOMEPATH:'\\\\private-host\\profile'}};
  await assert.rejects(protectOwnerOnlyWindowsDirectory(dir,{...args,run:async(_exe,_argv,options)=>{
    for(const key of ['USERPROFILE','TEMP','TMP','HOMEDRIVE','HOMEPATH'])assert.equal(options.env[key],undefined);
    throw Object.assign(new Error('sensitive child stderr'),{killed:true,signal:'SIGTERM',code:null,stderr:'secret fixture diagnostic'});
  }}),{message:'private_windows_storage_acl_timeout'});
  await assert.rejects(protectOwnerOnlyWindowsDirectory(dir,{...args,run:async()=>{
    throw Object.assign(new Error('sensitive ACL failure'),{killed:false,code:1,stderr:'private account or path'});
  }}),{message:'private_windows_storage_acl_script_failed'});
  await assert.rejects(protectOwnerOnlyWindowsDirectory(dir,{...args,run:async()=>{
    throw Object.assign(new Error('bounded diagnostic overflow'),{killed:true,signal:'SIGTERM',code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
  }}),{message:'private_windows_storage_acl_script_failed'});
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
  const nested=path.join(directory,'data','global');
  await fs.mkdir(nested,{recursive:true});
  assert.equal((await verifyOwnerOnlyWindowsStorage(nested,{operation:'VERIFY_DIRECTORY'})).owner_dacl_verified,true);
  const config=path.join(directory,'runtime-host-config.json');
  await fs.writeFile(config,JSON.stringify({secret:'stays_local'}),{flag:'wx'});
  const vault=path.join(directory,'client-vault.key');
  await fs.writeFile(vault,'a'.repeat(64)+'\n',{flag:'wx'});
  assert.equal((await verifyOwnerOnlyWindowsStorage(config)).owner_dacl_verified,true);
  assert.equal((await verifyOwnerOnlyWindowsStorage(vault)).owner_dacl_verified,true);
  // The production copy creates new streamed files, which must inherit the
  // secured destination's actual DACL even when source TEMP rights are broad.
  const {createReadStream,createWriteStream}=await import('node:fs');
  const {pipeline}=await import('node:stream/promises');
  const source=path.join(top,'source-control');
  await fs.writeFile(source,'synthetic private control bytes');
  const control=path.join(nested,'pg_control');
  await pipeline(createReadStream(source),createWriteStream(control,{flags:'wx'}));
  assert.equal((await verifyOwnerOnlyWindowsStorage(control)).owner_dacl_verified,true);
  // Readback must still reject a real NTFS grant to an unapproved principal;
  // longer startup allowance cannot turn broad private-file rights into PASS.
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const grantEveryone="$ErrorActionPreference='Stop'; $p=$env:METAENGINE_ACL_TEST_FILE; $acl=Get-Acl -LiteralPath $p; $sid=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow); [void]$acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl";
  const windowsRoot=process.env.SystemRoot||process.env.SYSTEMROOT;
  await promisify(execFile)(path.win32.join(windowsRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(grantEveryone,'utf16le').toString('base64')],
    {env:{SystemRoot:windowsRoot,SYSTEMROOT:windowsRoot,WINDIR:windowsRoot,
      PSModulePath:path.win32.join(windowsRoot,'System32','WindowsPowerShell','v1.0','Modules'),METAENGINE_ACL_TEST_FILE:control},
      shell:false,windowsHide:true,timeout:120000,maxBuffer:8192});
  await assert.rejects(verifyOwnerOnlyWindowsStorage(control),{message:'private_windows_storage_acl_script_failed'});
});
