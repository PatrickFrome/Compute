import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildCodexSandboxProbeArgs,evaluateCodexSandboxProbe,windowsSandboxBootIdentity,readWindowsSandboxHostBoot} from '../src/codex-cli-sandbox-probe.mjs';

const denied = () => ({ outcome: 'ERROR', access_denied: true, error_type: 'System.UnauthorizedAccessException' });
const written = () => ({ outcome: 'WRITTEN', access_denied: false });
function input(mode = 'workspace-write') {
  return {
    mode, hostUserSid: 'S-1-5-21-111-1001',hostBootIdentity:{schema:'metaengine.windows.kernel-boot.v1',kernel_boot_id:29,
      system_process:{pid:4,created_at:'2026-10-22T03:00:00.000Z',created_100ns:String(BigInt(Date.parse('2026-10-22T03:00:00.000Z'))*10000n+116444736000000000n)},
      last_boot_at:'2026-10-22T02:59:56.000Z',os_version:'10.0.19045'},
    report: { schema: 'metaengine.codex-cli.sandbox-canary.v1', mode, pid: 1234, started_at: '2026-10-22T04:00:00.123Z', user_sid: 'S-1-5-21-111-1002',
      inside_append: mode === 'workspace-write' ? written() : denied(), inside_create: mode === 'workspace-write' ? written() : denied(),
      outside_append: denied(), outside_create: denied() },
    nativeProcess: { pid: 1234, started_at: '2026-10-22T04:00:00.123Z', user_sid: 'S-1-5-21-111-1002' },
    hostReadback: { inside_existing_unchanged: mode === 'read-only', inside_existing_appended: mode === 'workspace-write',
      inside_new_written: mode === 'workspace-write', inside_new_absent: mode === 'read-only', outside_existing_unchanged: true, outside_new_absent: true },
    completion: { exit_code: 0, signal: null, tree_cleanup_confirmed: true },
  };
}

test('writer and critic require different physical write outcomes and never confer authority', () => {
  for (const mode of ['workspace-write', 'read-only']) {
    const result = evaluateCodexSandboxProbe(input(mode));
    assert.equal(result.state, 'OBSERVED');
    assert.equal(result.boundary_observed, true);
    assert.equal(result.execution_authorized, false);
    assert.equal(result.authority_effect, false);
  }
});

test('a no-op or fake writer without an actual allowed workspace write fails', () => {
  const row = input();
  row.hostReadback.inside_new_written = false;
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_WORKSPACE_WRITE_POLICY_FAILED');
});

test('critic write denial must be verified by host file readback', () => {
  const row = input('read-only');
  row.hostReadback.inside_existing_unchanged = false;
  assert.equal(evaluateCodexSandboxProbe(row).state, 'BLOCKED');
});

test('a creator which wrote outside the workspace cannot pass by claiming access denied', () => {
  const row = input();
  row.hostReadback.outside_new_absent = false;
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_OUTSIDE_WRITE_BOUNDARY_FAILED');
});

test('an unchanged outside file alone does not prove an access-denied boundary', () => {
  const row = input();
  row.report.outside_create = { outcome: 'ERROR', access_denied: false, error_type: 'System.IO.DirectoryNotFoundException' };
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_OUTSIDE_WRITE_BOUNDARY_FAILED');
});

test('native PID reuse and birth mismatch fail closed', () => {
  for (const change of [{ pid: 1235 }, { started_at: '2026-10-22T04:00:01.123Z' }]) {
    const row = input(); Object.assign(row.nativeProcess, change);
    assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_NATIVE_INCARNATION_UNVERIFIED');
  }
});

test('a former boot process cannot be reused as current sandbox evidence', () => {
  const row = input();row.hostBootIdentity.system_process={pid:4,created_at:'2026-10-23T01:02:44.500Z',
    created_100ns:String(BigInt(Date.parse('2026-10-23T01:02:44.500Z'))*10000n+116444736000000000n)};
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_OBSERVATION_BEFORE_CURRENT_BOOT');
  delete row.hostBootIdentity;
  assert.equal(evaluateCodexSandboxProbe(row).state, 'BLOCKED');
});

test('kernel boot identity survives diagnostic wall-clock drift, rejects missing boot sequence or replaced System process',()=>{
  const boot=input().hostBootIdentity,key=windowsSandboxBootIdentity(boot);
  assert.equal(windowsSandboxBootIdentity({...boot,last_boot_at:'2026-10-21T22:00:00.000Z'}),key);
  assert.notEqual(windowsSandboxBootIdentity({...boot,kernel_boot_id:30}),key);
  assert.notEqual(windowsSandboxBootIdentity({...boot,system_process:{...boot.system_process,created_100ns:String(BigInt(boot.system_process.created_100ns)+1n)}}),key);
  for(const old of [{last_boot_at:boot.last_boot_at},{...boot,kernel_boot_id:undefined},{...boot,system_process:{...boot.system_process,pid:8}}])
    assert.throws(()=>windowsSandboxBootIdentity(old),/host_boot_unverified/);
});

test('actual current Windows boot sequence and PID4 kernel creation are stable across independent native reads',{
  skip:process.platform!=='win32',timeout:35000,
},async()=>{
  const before=await readWindowsSandboxHostBoot(),after=await readWindowsSandboxHostBoot();
  assert.equal(windowsSandboxBootIdentity(before),windowsSandboxBootIdentity(after));assert.equal(before.system_process.pid,4);
  assert.ok(before.kernel_boot_id>0);assert.ok(Date.parse(before.system_process.created_at)<=Date.now());
});

test('self-reported identity and same-user process cannot prove the elevated sandbox account', () => {
  for (const change of [null, { pid: 1234, started_at: '2026-10-22T04:00:00.123Z', user_sid: 'S-1-5-21-111-1001' }]) {
    const row = input(); row.nativeProcess = change;
    if (change) row.report.user_sid = row.hostUserSid;
    assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_NATIVE_INCARNATION_UNVERIFIED');
  }
});

test('an unconfirmed process tree exit blocks even after the canary succeeded', () => {
  const row = input(); row.completion.tree_cleanup_confirmed = false;
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_COMMAND_TERMINATION_UNVERIFIED');
});

test('wrong mode or missing report cannot be reused as evidence for a critic', () => {
  const row = input('read-only'); row.report.mode = 'workspace-write';
  assert.equal(evaluateCodexSandboxProbe(row).reason, 'SANDBOX_CANARY_REPORT_INVALID');
  row.report = null;
  assert.equal(evaluateCodexSandboxProbe(row).state, 'BLOCKED');
});

test('probe CLI forces bounded sandbox permissions without a model request or bypass flags', () => {
  const root = path.resolve('workspace');
  const args = buildCodexSandboxProbeArgs({ mode: 'workspace-write', workspaceRoot: root, scriptPath: path.join(root, 'probe.ps1'), powershellPath: path.resolve('powershell.exe') });
  assert(args.includes('windows.sandbox="elevated"'));
  assert(args.includes('sandbox_mode="workspace-write"'));
  assert(args.includes('sandbox_workspace_write.writable_roots=[]'));
  assert(args.includes('--include-managed-config'));
  assert(args.includes(':workspace'));
  assert(!args.includes('exec'));
  assert(!args.some(value => value.includes('dangerously') || value === '--ignore-rules'));
});

test('unsupported sandbox modes and relative executable paths are refused', () => {
  const row = { mode: 'danger-full-access', workspaceRoot: path.resolve('workspace'), scriptPath: path.resolve('probe.ps1'), powershellPath: path.resolve('powershell.exe') };
  assert.throws(() => buildCodexSandboxProbeArgs(row), /arguments_invalid/);
  assert.throws(() => buildCodexSandboxProbeArgs({ ...row, mode: 'read-only', powershellPath: 'powershell.exe' }), /arguments_invalid/);
});
