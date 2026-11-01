import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {codexCliPermissionOverrides} from '../src/codex-cli-execution-policy.mjs';
import {buildCodexCliArgv} from '../src/codex-cli-runner.mjs';
import {buildCodexSandboxProbeArgs} from '../src/codex-cli-sandbox-probe.mjs';

// Literal expectations are independent of the production helper.
// Generated argument data only: no process launch or native qualification.
const expectedOverrides=mode=>[
  '-c','windows.sandbox="elevated"','-c',`sandbox_mode="${mode}"`,
  '-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false',
  '-c','allow_login_shell=false'
];
function assertSingleLoginShellOverride(args){
  assert.deepEqual(args.filter(arg=>arg.startsWith('allow_login_shell=')),['allow_login_shell=false']);
  assert.equal(args[args.indexOf('allow_login_shell=false')-1],'-c');
}
const root=path.resolve('codex-login-shell-argv-fixture');
const worktreePath=path.join(root,'work'),schemaPath=path.join(root,'journal','schema.json'),
  resultPath=path.join(root,'journal','result.json');
const policyNonce='a'.repeat(64),promptSha256=createHash('sha256').update('generated argv-only prompt').digest('hex');

test('shared permission bounds disable login shells exactly once for both modes',()=>{
  for(const mode of ['workspace-write','read-only']){
    const args=codexCliPermissionOverrides(mode);
    assertSingleLoginShellOverride(args);
    assert.deepEqual(args,expectedOverrides(mode));
  }
});

test('production exec builder supplies the no-login-shell default and preserves role and policy bindings',()=>{
  for(const [role,mode] of [['IMPLEMENTER','workspace-write'],['CRITIC','read-only']]){
    const args=buildCodexCliArgv({role,worktreePath,schemaPath,resultPath,policyNonce,promptSha256});
    assertSingleLoginShellOverride(args);
    assert.deepEqual(args,[
      '-a','never','--no-daemon',...expectedOverrides(mode),
      'exec','--ignore-user-config','--sandbox',mode,'--json','--color','never',
      '--output-schema',schemaPath,'--output-last-message',resultPath,'-C',worktreePath,
      '--metaengine-effective-policy',policyNonce,'--metaengine-prompt-sha256',promptSha256,'-'
    ]);
  }
});

test('production probe builder preserves the managed-config selector and no-login-shell bound',()=>{
  const scriptPath=path.join(root,'scratch','probe.ps1'),powershellPath=path.join(root,'bin','powershell.exe');
  for(const [mode,profile] of [['workspace-write',':workspace'],['read-only',':read-only']]){
    const args=buildCodexSandboxProbeArgs({mode,workspaceRoot:worktreePath,scriptPath,powershellPath});
    assertSingleLoginShellOverride(args);
    assert.deepEqual(args,[
      '-a','never','--no-daemon',...expectedOverrides(mode),
      'sandbox','--include-managed-config','--permission-profile',profile,'-C',worktreePath,
      '--',powershellPath,'-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath
    ]);
  }
});
