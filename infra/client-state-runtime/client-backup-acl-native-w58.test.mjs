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
  const psRoot=path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0');
  const exe=path.win32.join(psRoot,'powershell.exe');
  const bootstrap="$ErrorActionPreference='Stop';Import-Module Microsoft.PowerShell.Security -ErrorAction Stop;";
  return run(exe,['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(bootstrap+script,'utf16le').toString('base64')],{
    env:{...process.env,...variables,PSModulePath:path.win32.join(psRoot,'Modules')},
    windowsHide:true,timeout:120000});
}
async function fixture(t) {
  const generatedRoot=await fs.mkdtemp(path.join(os.tmpdir(),'me-w58-acl-'));
  // Canonicalize only newly disposable TEMP fixture spelling.
  const root=process.platform==='win32'?await fs.realpath(generatedRoot):generatedRoot;
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
  // icacls modifies ONLY the uniquely generated fixture; no owner/group reapply.
  await run(path.win32.join(process.env.SystemRoot,'System32','icacls.exe'),
    [o.file,'/inheritance:e'],{windowsHide:true,timeout:15000});
  assert.equal((await read(o)).native_acl_verified,false);
});
test('Windows broad Everyone read ACE fails native policy',{skip:!windows},async t=>{
  const o=await fixture(t);
  // Add a real Everyone read ACE to the already private temporary file.
  await run(path.win32.join(process.env.SystemRoot,'System32','icacls.exe'),
    [o.file,'/grant','*S-1-1-0:(R)'],{windowsHide:true,timeout:15000});
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

test('Windows root broad read ACE fails even when archive DACL remains private',{skip:!windows},async t=>{
  const o=await fixture(t);
  await run(path.win32.join(process.env.SystemRoot,'System32','icacls.exe'),
    [o.root,'/grant','*S-1-1-0:(R)'],{windowsHide:true,timeout:15000});
  assert.equal((await read(o)).native_acl_verified,false);
});
test('Windows junction reparse root cannot alias a protected archive',{skip:!windows},async t=>{
  const o=await fixture(t);
  const junction=o.root+'-junction';
  try{await fs.symlink(o.root,junction,'junction');}
  catch{t.skip('Windows runner cannot create a disposable junction');return;}
  t.after(()=>fs.rm(junction,{force:true}).catch(()=>{}));
  const x=await readClientBackupAclNativeW58({
    backupDirectory:junction,archivePath:path.join(junction,name)});
  assert.equal(x.native_acl_verified,false);
  assert.equal(x.installed_owner_proven,false);
});

test('Windows Owner generation changes across two native ACL samples and remains UNKNOWN',{skip:!windows},async t=>{
  const o=await fixture(t);
  let generation=0;
  const x=await readClientBackupAclNativeW58({
    backupDirectory:o.root,archivePath:o.file,
    readOwnerIncarnation:async()=>({
      schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
      authority_effect:false,pid:1048,generation:++generation,
      created_at:'2026-10-15T00:00:00.000Z',owner_id:'owner-w58-0001',
      device_id:'device-w58-0001',process_incarnation_id:'incarnation-w58-0001',
    }),
  });
  assert.equal(generation,2);
  assert.equal(x.state,'UNKNOWN');
  assert.equal(x.reason,'OWNER_INCAR_CHANGED_DURING_ACL_READ');
  assert.equal(x.native_acl_verified,false);
  assert.equal(x.installed_owner_proven,false);
  assert.equal(x.upgrade_authorized,false);
});
test('Windows no native Owner reader never fabricates installed authority',{skip:!windows},async t=>{
  const o=await fixture(t);
  const x=await readClientBackupAclNativeW58({backupDirectory:o.root,archivePath:o.file});
  assert.equal(x.native_acl_verified,true);
  assert.equal(x.owner_incarnation_continuity_only,false);
  assert.equal(x.installed_owner_proven,false);
});

// Physical same-inode multi-link is an independently executable alias negative on
// Windows runners without symlink privileges. It NEVER substitutes for the separate
// symlink/reparse negative: that gate stays UNKNOWN when skipped.
test('Windows hardlink aliases cannot qualify single-link archive file identity',{skip:!windows},async t=>{
  const o=await fixture(t);
  const alias=path.join(o.root,'other-hardlink.dump');
  await fs.link(o.file,alias);
  const x=await read(o);
  assert.equal(x.native_acl_verified,false);
  assert.equal(x.installed_owner_proven,false);
  assert.equal(x.upgrade_authorized,false);
});

test('Windows missing archive stays UNKNOWN',{skip:!windows},async t=>{
  const o=await fixture(t);
  await fs.unlink(o.file);
  assert.equal((await read(o)).native_acl_verified,false);
});
