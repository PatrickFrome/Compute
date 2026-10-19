import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const source=new URL('./installer-resident-upgrade-physical.ps1',import.meta.url);
const run=promisify(execFile);
test('real resident upgrade must bind profile before launching legacy primary',async()=>{
  const text=await fs.readFile(source,'utf8');
  assert.match(text,/\$legacyProfile = Read-VersionProbe \$app '--metaengine-profile-probe'/);
  assert.ok(text.indexOf('$legacyProfile = Read-VersionProbe $app') < text.indexOf('$legacyPrimary = Start-Process'));
  assert.match(text,/legacy_profile_custody_unverified/);
  assert.match(text,/Read-DetachedSentinelByCustody/);
  assert.match(text,/qa-resident-sentinel-readback\.mjs/);
  assert.match(text,/sentinel_child_missing_for_parent/);
  assert.match(text,/Write-ResidentStartupFailureEvidence/);
  assert.match(text,/qa-resident-startup-failure\.ps1/);
  assert.match(text,/-RedirectStandardOutput \$legacyStdout -RedirectStandardError \$legacyStderr/);
  assert.match(text,/-RedirectStandardOutput \$newStdout -RedirectStandardError \$newStderr/);
  assert.match(text,/Write-ResidentStartupFailureEvidence[^\r\n]+-Phase \$Phase/);
  assert.ok(text.lastIndexOf('Write-ResidentStartupFailureEvidence -ParentPid $ParentPid') <
    text.indexOf('throw "sentinel_child_missing_for_parent:$ParentPid"'));
  assert.match(text,/SENTINEL_NATIVE_OR_CUSTODY_READBACK_MISSING/);
  assert.match(text,/\$legacySentinel = Wait-SentinelChild[^\r\n]+-ProfilePath/);
  assert.match(text,/\$newSentinel = Wait-SentinelChild[^\r\n]+-ProfilePath/);
  assert.match(text,/Wait-ProcessGone -ProcessId \$legacySentinelPid/);
  assert.match(text,/Wait-ProcessGone -ProcessId \$newSentinelPid/);
  assert.doesNotMatch(text,/automatic_retry_allowed\s*=\s*\$true/);
});
test('Windows PowerShell parser accepts real resident installer physical exercise',{
  skip:process.platform!=='win32'
},async()=>{
  const file=fileURLToPath(source);
  const powershell=path.win32.join(process.env.SystemRoot||process.env.SYSTEMROOT||'C:\\Windows',
    'System32','WindowsPowerShell','v1.0','powershell.exe');
  const ps='$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:METAENGINE_QA_RESIDENT_SCRIPT_PATH,[ref]$t,[ref]$e);if($e.Count -ne 0){exit 9};Write-Output "parser_pass"';
  const {stdout}=await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(ps,'utf16le').toString('base64')],
    {windowsHide:true,shell:false,timeout:120000,maxBuffer:4096,
      env:{...process.env,METAENGINE_QA_RESIDENT_SCRIPT_PATH:file}});
  assert.match(stdout,/parser_pass/);
});
