import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';

test('DACL operator is a fixed PowerShell program, never a private path assembled into script or argv',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-dacl-contract-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const fakeWindowsEnv={SystemRoot:'C:\\Windows'};
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
  await assert.rejects(verifyOwnerOnlyWindowsStorage(file,{...args,platform:'linux'}),
    /private_windows_storage_arguments_invalid/);
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
  const config=path.join(directory,'runtime-host-config.json');
  await fs.writeFile(config,JSON.stringify({secret:'stays_local'}),{flag:'wx'});
  const vault=path.join(directory,'client-vault.key');
  await fs.writeFile(vault,'a'.repeat(64)+'\n',{flag:'wx'});
  assert.equal((await verifyOwnerOnlyWindowsStorage(config)).owner_dacl_verified,true);
  assert.equal((await verifyOwnerOnlyWindowsStorage(vault)).owner_dacl_verified,true);
});
