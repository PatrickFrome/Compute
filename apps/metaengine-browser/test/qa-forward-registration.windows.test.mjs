import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const helper=fileURLToPath(new URL('../scripts/qa-forward-registration.ps1',import.meta.url));
async function run(args){const p=exec(ps,['-NoLogo','-NoProfile','-NonInteractive',...args],{windowsHide:true,timeout:30000,maxBuffer:4096});p.child.stdin?.end();return (await p).stdout;}
const code=s=>run(['-EncodedCommand',Buffer.from(s,'utf16le').toString('base64')]);
test('real Windows registry retirement preserves captured values and rejects replay', {skip:process.platform!=='win32'},async t=>{
  const id=randomUUID().replaceAll('-',''),state=await fs.mkdtemp(path.join(os.tmpdir(),'qa-forward-reg-'));
  const base='Software\\METAENGINE\\ForwardInstallFixture\\'+id,version='0.7.0-dev.123.1';
  t.after(async()=>{await code(`$b='${base}';if($b -notmatch '^Software\\\\METAENGINE\\\\ForwardInstallFixture\\\\[a-f0-9]{32}$'){throw 'scope'};[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($b,$false)`);await fs.rm(state,{recursive:true,force:true});});
  await code(`$ErrorActionPreference='Stop';$b='${base}';$g='c32f3891-2b9e-5a4a-bd4f-5173b65b39bb';$install=Join-Path $env:LOCALAPPDATA 'Programs\\METAENGINE Browser Test';$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($b+'\\Install\\'+$g);$k.SetValue('InstallLocation',$install);$k.Dispose();$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($b+'\\Uninstall\\'+$g);$k.SetValue('DisplayVersion','${version}');$k.SetValue('DisplayName','METAENGINE Browser Test ${version}');$k.SetValue('UninstallString','"'+(Join-Path $install 'Uninstall METAENGINE Browser Test.exe')+'" /currentuser');$k.Dispose()`);
  const args=['-File',helper,'-StateDirectory',state,'-ExpectedVersion',version,'-FixtureId',id];
  const observation=JSON.parse(await run([...args,'-Mode','Observe']));
  assert.equal(observation.state,'OBSERVED');
  await assert.rejects(run([...args,'-Mode','Retire','-ExpectedDigest','f'.repeat(64)]),/preimage_changed/);
  assert.equal(JSON.parse(await run([...args,'-Mode','Observe'])).digest,observation.digest);
  const r=JSON.parse(await run([...args,'-Mode','Retire','-ExpectedDigest',observation.digest]));
  assert.equal(r.state,'RETIRED_VERIFIED');assert.equal(r.old_uninstaller_executed,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(state,'registration-captured-1.json'),'utf8')).some(v=>v.name==='DisplayVersion'&&v.data===version),true);
  await assert.rejects(run([...args,'-Mode','Retire','-ExpectedDigest',observation.digest]),/key_absent/);
});
