import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {protectOwnerOnlyWindowsDirectory} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {readClientBackupAclNativeW58} from '../../apps/metaengine-browser/src/client-backup-acl-native-w58.mjs';

const run=promisify(execFile);
const windows=process.platform==='win32';
const name='postgresql-17-snapshot.dump';
async function ps(script,variables={}) {
  const exe=path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  return run(exe,['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from("$ErrorActionPreference='Stop';"+script,'utf16le').toString('base64')],{
    env:{...process.env,...variables},windowsHide:true,timeout:120000});
}
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'me-w58-acl-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await protectOwnerOnlyWindowsDirectory(root);
  const file=path.join(root,name);
  await fs.writeFile(file,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(4096,12)]));
  const protectFile=async()=>ps(`$a=Get-Acl -LiteralPath $env:W58_F
$a.SetAccessRuleProtection($true,$true)
Set-Acl -LiteralPath $env:W58_F -AclObject $a`,{W58_F:file});
  await protectFile();
  return {root,file,protectFile};
}
const read=o=>readClientBackupAclNativeW58({backupDirectory:o.root,archivePath:o.file});

test('non-Windows native ACL is explicitly UNKNOWN, never Windows PASS',async()=>{
  const x=await readClientBackupAclNativeW58({platform:'linux',backupDirectory:'/tmp/a',archivePath:'/tmp/a/postgresql-17-snapshot.dump'});
  assert.equal(x.state,'UNKNOWN');
  assert.equal(x.reason,'NATIVE_NTFS_UNSUPPORTED');
  assert.equal(x.native_acl_verified,false);
});
test('caller verified=true never creates OS evidence',async()=>{
  const x=await readClientBackupAclNativeW58({backupDirectory:'C:\\missing',archivePath:'C:\\missing\\postgresql-17-snapshot.dump',verified:true});
  assert.equal(x.native_acl_verified,false);
  assert.equal(x.upgrade_authorized,false);
});
test('Windows physically protected disposable directory and file permit native ACL readback', {skip:!windows},async t=>{
  const o=await fixture(t);
  const x=await read(o);
  assert.equal(x.state,'NATIVE_ACL_VERIFIED',JSON.stringify(x));
  assert.equal(x.native_acl_verified,true);
  assert.match(x.owner_sid,/^S-1-/);
  assert.match(x.archive_file_id_sha256,/^[a-f0-9]{64}$/);
  assert.equal(x.installed_owner_proven,false);
  assert.equal(x.backup_verified,false);
  assert.equal(x.upgrade_authorized,false);
});
test('Windows inherited file DACL fails, even if inherited principals are otherwise allowed',{skip:!windows},async t=>{
  const o=await fixture(t);
  await ps(`$a=Get-Acl -LiteralPath $env:W58_F
$a.SetAccessRuleProtection($false,$true)
Set-Acl -LiteralPath $env:W58_F -AclObject $a`,{W58_F:o.file});
  assert.equal((await read(o)).native_acl_verified,false);
});
test('Windows broad Everyone read ACE fails native policy',{skip:!windows},async t=>{
  const o=await fixture(t);
  await ps(`$a=Get-Acl -LiteralPath $env:W58_F
$s=[Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$r=[Security.AccessControl.FileSystemAccessRule]::new($s,[Security.AccessControl.FileSystemRights]::ReadData,[Security.AccessControl.AccessControlType]::Allow)
[void]$a.AddAccessRule($r)
Set-Acl -LiteralPath $env:W58_F -AclObject $a`,{W58_F:o.file});
  assert.equal((await read(o)).native_acl_verified,false);
});
test('Windows native identity substitution between descriptor reads fails closed',{skip:!windows},async t=>{
  const o=await fixture(t);
  const x=await readClientBackupAclNativeW58({
    backupDirectory:o.root,archivePath:o.file,
    afterFirstRead:async()=>{
      await fs.rename(o.file,path.join(o.root,'old.dump'));
      await fs.writeFile(o.file,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(4096,13)]));
      await o.protectFile();
    },
  });
  assert.equal(x.native_acl_verified,false);
  assert.equal(x.installed_owner_proven,false);
});
test('Windows reparse file or path root is rejected',{skip:!windows},async t=>{
  const o=await fixture(t);
  const link=path.join(o.root,'alias.dump');
  try{await fs.symlink(o.file,link,'file');}catch{t.skip('Symlink creation is unavailable to this Windows runner');return;}
  assert.equal((await readClientBackupAclNativeW58({
    backupDirectory:o.root,archivePath:link})).native_acl_verified,false);
});
test('UNC, ADS, alternate archive root and path traversal never qualify',{skip:!windows},async t=>{
  const o=await fixture(t);
  for(const p of ['\\\\server\\share\\'+name,o.file+':stream',
    path.win32.join(o.root,'..',name),path.join(o.root,'other.dump')]){
    const x=await readClientBackupAclNativeW58({backupDirectory:o.root,archivePath:p});
    assert.equal(x.native_acl_verified,false,p);
  }
});
test('Windows missing archive stays UNKNOWN',{skip:!windows},async t=>{
  const o=await fixture(t);
  await fs.unlink(o.file);
  assert.equal((await read(o)).native_acl_verified,false);
});
