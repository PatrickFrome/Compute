import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pinDisposableWinPsAclFixtureEnv} from './client-winps-fixture-w65.mjs';
const run=promisify(execFile);
test('Linux has no Windows NTFS ACL proof',()=>{
  const r=pinDisposableWinPsAclFixtureEnv({SystemRoot:'C:\\Windows'},'linux');
  assert.equal(r.state,'UNKNOWN');assert.equal(r.reason,'WINDOWS_ACL_UNSUPPORTED');
});
test('untrusted SystemRoot and missing root never run native fixture',()=>{
  for(const root of ['C:\\Temp','\\\\server\\share\\Windows','../../Windows','',undefined]){
    const r=pinDisposableWinPsAclFixtureEnv({SystemRoot:root},'win32');
    assert.equal(r.state,'UNKNOWN');assert.equal(r.exe,undefined);
  }
});
test('PowerShell7 injected module path cannot override pinned WindowsPowerShell5 fixture module',()=>{
  const r=pinDisposableWinPsAclFixtureEnv({SystemRoot:'C:\\Windows',
    PSModulePath:'C:\\untrusted\\ps7\\Modules',
    METAENGINE_W58_FILE:'C:\\untrusted\\archive',
    PATH:'C:\\trusted',TEMP:'C:\\Temp'},'win32');
  assert.equal(r.state,'FIXTURE_ONLY');
  assert.equal(r.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(r.env.METAENGINE_W58_FILE,undefined);
  assert.equal(r.reason,'NO_OWNER_OR_INSTALLED_PROOF');
});
test('real Windows PowerShell fixture loads actual trusted Get-Acl after poisoned inherited PSModulePath',{
  skip:process.platform!=='win32'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'me-w65-winps-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'read-only-w65.txt');
  await fs.writeFile(file,'disposable W65 ACL fixture');
  const cfg=pinDisposableWinPsAclFixtureEnv({...process.env,
    PSModulePath:'C:\\untrusted\\ps7\\Modules'},'win32');
  assert.equal(cfg.state,'FIXTURE_ONLY');
  const script="$ErrorActionPreference='Stop';Import-Module Microsoft.PowerShell.Security -ErrorAction Stop;"+
    "$null=Get-Acl -LiteralPath $env:W65_ACL_FIXTURE_TARGET -ErrorAction Stop;"+
    "Write-Output 'W65_NATIVE_GETACL_PROBE_OK'";
  const result=await run(cfg.exe,['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script,'utf16le').toString('base64')],{
    env:{...cfg.env,W65_ACL_FIXTURE_TARGET:file},windowsHide:true,
    shell:false,timeout:120000,maxBuffer:4096});
  assert.match(result.stdout,/W65_NATIVE_GETACL_PROBE_OK/);
});
