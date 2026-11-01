import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const observer=fileURLToPath(new URL('../scripts/observe-clean-machine-prerequisites.ps1',import.meta.url));
const source=await fs.readFile(observer,'utf8');
const tools=['node','npm','npx','git','codex','bun','deno','psql','pg_ctl','initdb','postgres','pg_restore','pg_dump'];

test('observer is read-only OS observation with no external tool execution or caller fixture bypass',()=>{
  assert.match(source,/\[CmdletBinding\(\)\]\s*param\(\)/);
  assert.doesNotMatch(source,/\b(?:Start-Process|Invoke-Expression|Invoke-Command|New-Item|Set-Item|Remove-Item|Set-Content|Add-Content|Out-File|Set-Service|Start-Service|Stop-Service|New-Service|Set-Acl|Add-Type)\b/i);
  assert.doesNotMatch(source,/::(?:CreateDirectory|WriteAllText|WriteAllBytes|CreateSubKey|SetValue|DeleteSubKey|SetEnvironmentVariable)|\.Start\(|\b(?:cmd|sc|reg|where)\.exe\b|(?:^|\n)\s*&/i);
  assert.doesNotMatch(source,/(?:Test-Path|SilentlyContinue|File\]::Exists|Directory\]::Exists)/);
  assert.match(source,/CimCmdlets\\Get-CimInstance -ClassName Win32_Service -ErrorAction Stop/);
  assert.match(source,/Microsoft\.PowerShell\.Core\\Get-Command -Name \$name -All -ListImported -ErrorAction Stop/);
  assert.match(source,/\$script:PSModuleAutoLoadingPreference = 'None'/);
  assert.match(source,/\[IO\.Path\]::Combine\(\$PSHOME, \('Modules\\' \+ \$moduleName\)\)/);
  assert.match(source,/Microsoft\.PowerShell\.Core\\Import-Module -Name \$manifest -Force -PassThru -ErrorAction Stop/);
  assert.match(source,/\$command\.Module\.Path -ine \$manifest/);
  assert.match(source,/if \(-not \$osModulesReady\)[\s\S]*?"state":"BLOCKED"[\s\S]*?"runner":\{"status":"UNKNOWN"/);
  assert.match(source,/Alias\/function bodies are never returned or invoked/);
  assert.match(source,/-NoProfile -NonInteractive -File/);
  assert.match(source,/PSVersion\.Major -eq 5[\s\S]*PSVersion\.Minor -eq 1/);
  assert.match(source,/PSEdition -eq 'Desktop'.*Environment\]::Version\.Major -eq 4/);
  assert.match(source,/System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
});

test('observer refuses inherited module lookup before any OS inventory and emits an explicit incomplete refusal',()=>{
  const disable=source.indexOf("$script:PSModuleAutoLoadingPreference = 'None'");
  const fixedImport=source.indexOf('Microsoft.PowerShell.Core\\Import-Module -Name $manifest -Force -PassThru -ErrorAction Stop');
  const origin=source.indexOf('$command.Module.Path -ine $manifest');
  const inventory=source.indexOf('CimCmdlets\\Get-CimInstance -ClassName Win32_Service');
  assert.ok(disable>=0&&fixedImport>disable&&origin>fixedImport&&inventory>origin);
  const refusal=source.slice(source.indexOf('if (-not $osModulesReady)'),inventory);
  assert.match(refusal,/"state":"BLOCKED"/);
  assert.match(refusal,/"services":\[\],"registrations":\[\],"paths":\[\],"global_tools":\[\]/);
  for(const reason of ['UNSUPPORTED_WINDOWS_HOST','INVENTORY_UNKNOWN','GLOBAL_TOOL_UNKNOWN','RUNNER_UNKNOWN'])assert.ok(refusal.includes('"'+reason+'"'));
  assert.doesNotMatch(refusal,/ConvertTo-Json/);
});

test('observer checks source-derived product roots and both registry hives and views without reading private files',()=>{
  for(const token of ['METAENGINEBrowserGuardian','c32f3891-2b9e-5a4a-bd4f-5173b65b39bb',
    'CurrentUser','LocalMachine','Registry64','Registry32','METAENGINE Browser Test','@metaengine',
    'CommonApplicationData','ProgramFiles','ProgramFilesX86','LocalApplicationData','ApplicationData',
    '.metaengine','.a2\\compute-bridge.json','METAENGINE Browser Test.lnk'])assert.ok(source.includes(token),token);
  for(const tool of tools)assert.ok(source.includes("'"+tool+"'"),tool);
  assert.match(source,/\.OpenSubKey\(\$Key, \$false\)/);
  assert.match(source,/catch \{ return 'UNKNOWN' \}/);
  assert.match(source,/FileNotFoundException.*DirectoryNotFoundException.*return 'ABSENT'/);
  assert.match(source,/ReparsePoint\) -ne 0\) \{ return 'UNKNOWN'/);
  assert.doesNotMatch(source,/ReadAllText|ReadAllBytes|Get-Content/);
  assert.match(source,/GetEnvironmentVariable\(\$name\).*runnerMarkers \+= \$name/);
  assert.match(source,/'GITHUB_ACTIONS'.*'RUNNER_ENVIRONMENT'/);
});

test('observation cannot claim a fresh authenticated machine, installation qualification or readiness',()=>{
  for(const token of ["scope = 'OBSERVATION_ONLY'","inventory_scope = 'CURRENT_USER_AND_FIXED_MACHINE_ROOTS'",
    'machine_baseline_authenticated = $false','authority_effect = $false','clean_install_qualified = $false','runtime_ready = $false'])assert.ok(source.includes(token),token);
  assert.match(source,/if \(\$reasons\.Count\) \{ 'BLOCKED' \} else \{ 'PRECONDITION_CANDIDATE' \}/);
  for(const reason of ['INVENTORY_PRESENT','INVENTORY_UNKNOWN','GLOBAL_TOOL_PRESENT','GLOBAL_TOOL_UNKNOWN','RUNNER_PRESENT','RUNNER_UNKNOWN','UNSUPPORTED_WINDOWS_HOST'])assert.ok(source.includes("'"+reason+"'"),reason);
});

test('native Windows PS5.1 observer emits bounded honest prerequisites using only the fixed OS host',{
  skip:process.platform!=='win32'?'requires real Windows PowerShell 5.1 Desktop, CIM and registry; Linux source checks are not native evidence':false,
  timeout:60000,
},async()=>{
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout,stderr}=await promisify(execFile)(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',observer],{
    windowsHide:true,timeout:55000,maxBuffer:1024*1024,
  });
  assert.equal(stderr.trim(),'');
  const result=JSON.parse(stdout.trim());
  assert.equal(result.schema,'metaengine.qa.clean-machine-prerequisites-observation.v1');
  assert.equal(result.scope,'OBSERVATION_ONLY');
  assert.equal(result.inventory_scope,'CURRENT_USER_AND_FIXED_MACHINE_ROOTS');
  for(const key of ['machine_baseline_authenticated','authority_effect','clean_install_qualified','runtime_ready'])assert.equal(result[key],false,key);
  assert.ok(['BLOCKED','PRECONDITION_CANDIDATE'].includes(result.state));
  for(const group of ['services','registrations','paths','global_tools']){
    assert.ok(Array.isArray(result[group])&&result[group].length>0,group);
    for(const row of result[group])assert.ok(['PRESENT','ABSENT','UNKNOWN'].includes(row.status));
  }
  assert.deepEqual(result.global_tools.map(row=>row.name),tools);
  assert.ok(['PRESENT','ABSENT','UNKNOWN'].includes(result.runner.status));
  if([...result.services,...result.registrations,...result.paths,...result.global_tools,result.runner].some(row=>row.status!=='ABSENT'))assert.equal(result.state,'BLOCKED');
  // This test is launched from Node; such a developer process cannot be used as
  // evidence that the entire machine has no development tooling or runner.
  assert.equal(result.state,'BLOCKED');
});

test('native PS5.1 ignores hostile PSModulePath and discovers applications and imported shadows without executing them',{
  skip:process.platform!=='win32'?'requires actual Windows PS5.1 module loading and Get-Command behavior; not native evidence on Linux':false,
  timeout:60000,
},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-observer-modules-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const sentinel=path.join(directory,'hostile-module-executed');
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  for(const name of ['CimCmdlets','Microsoft.PowerShell.Utility']){
    const root=path.join(directory,name);await fs.mkdir(root);
    await fs.writeFile(path.join(root,name+'.psd1'),"@{RootModule='"+name+".psm1';ModuleVersion='99.0.0';GUID='d77bfaa9-b95b-42aa-aa19-02ea02b5edc2'}\n");
    await fs.writeFile(path.join(root,name+'.psm1'),'[IO.File]::WriteAllText('+quote(sentinel)+",'unexpected module load'); throw 'HOSTILE_MODULE_EXECUTED'\n");
  }
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const command=[
    "$ErrorActionPreference='Stop'",
    "$script:PSModuleAutoLoadingPreference='None'",
    // Application discovery reads metadata only, even for the actual Node host.
    '$app=Microsoft.PowerShell.Core\\Get-Command -Name '+quote(process.execPath)+' -ListImported -ErrorAction Stop',
    "if($app.CommandType -ne 'Application'){throw 'application_discovery_missing'}",
    "function global:git { throw 'GLOBAL_TOOL_MUST_NOT_EXECUTE' }",
    "Microsoft.PowerShell.Utility\\Set-Alias -Name npm -Value Get-Date -Scope Global",
    '& '+quote(observer),
  ].join('; ');
  // Set-Alias is an OS cmdlet needed by this native test only. Import it from
  // the fixed OS path before the hostile lookup path can be consulted.
  const bootstrap="$script:PSModuleAutoLoadingPreference='None'; Microsoft.PowerShell.Core\\Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop; "+command;
  const {stdout,stderr}=await promisify(execFile)(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',bootstrap],{
    windowsHide:true,timeout:55000,maxBuffer:1024*1024,
    env:{...process.env,PSModulePath:directory+path.delimiter+(process.env.PSModulePath||'')},
  });
  assert.equal(stderr.trim(),'');
  await assert.rejects(fs.lstat(sentinel),{code:'ENOENT'});
  const result=JSON.parse(stdout.trim());
  assert.equal(result.global_tools.find(row=>row.name==='git')?.status,'PRESENT');
  assert.equal(result.global_tools.find(row=>row.name==='npm')?.status,'PRESENT');
  assert.equal(result.state,'BLOCKED');
});
