import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureVcvarsEnvironment } from './helpers/msvc-environment.mjs';

const directory = fileURLToPath(new URL('../native/browser-guardian-scm/', import.meta.url));
const header = fs.readFileSync(path.join(directory, 'browser-guardian-connected-peer.hpp'), 'utf8');
const probe = fileURLToPath(new URL('./native/browser-guardian-connected-peer-probe.cpp', import.meta.url));
const probeSource = fs.readFileSync(probe, 'utf8');
const cases = [
  'cancel_before_connect_never_opens_fixed_pipe', 'cancelled_connect_cannot_be_rearmed_or_replaced',
  'actual_connected_server_pid_and_full_birth', 'duplicate_retains_original_client_handle',
  'invalid_and_null_handles_refused', 'nonpipe_handle_refused',
  'unconnected_server_end_refused', 'connected_server_end_refused',
  'disconnected_original_pipe_refused', 'recheck_never_substitutes_another_connection',
  'same_name_same_process_reconnection_does_not_revive_original',
  'fixture_cannot_qualify_guardian_or_launch', 'close_is_idempotent_and_revokes_kernel_observation',
  'child_server_exit_invalidates_original_process_handle',
  'identification_client_message_binds_original_observer_token',
];

test('connected peer production factory accepts no caller path, PID, handle or verified object', () => {
  assert.match(header, /static std::unique_ptr<GuardianConnectedPeer> connect\(\);/);
  assert.match(header, /private:[\s\S]*#ifdef METAENGINE_GUARDIAN_PEER_TEST\s+friend struct GuardianConnectedPeerTest;/);
  assert.match(header, /#ifdef METAENGINE_GUARDIAN_PEER_TEST[\s\S]*observeTestConnection\(HANDLE original_connected_pipe\)/);
  assert.match(probeSource, /#ifndef METAENGINE_GUARDIAN_PEER_TEST\s+#error/);
});

test('Windows mechanics probe uses disposable pipes and its own child without SCM or credential mutations', () => {
  for (const name of cases) assert.ok(probeSource.includes(`run("${name}"`), `native case missing: ${name}`);
  assert.match(probeSource, /METAENGINEGuardianPeerTest-/);
  assert.match(probeSource, /SECURITY_SQOS_PRESENT \| SECURITY_IDENTIFICATION/);
  assert.match(probeSource, /GetProcessTimes/);
  assert.match(probeSource, /CreateProcessW\(executable\.c_str\(\), command\.data\(\)/);
  assert.match(probeSource, /PROC_THREAD_ATTRIBUTE_JOB_LIST/);
  assert.match(probeSource, /server\.observeClientIdentity\(true\)/);
  assert.match(probeSource, /level == SecurityIdentification/);
  assert.doesNotMatch(probeSource, /CreateService|ChangeServiceConfig|StartService|ControlService|AdjustTokenPrivileges|CryptProtectData|guardianOwnerChallenge|verified\s*:\s*true/);
});

function compilerEnvironment() {
  const available = spawnSync('cl.exe', ['/nologo', '/?'], { encoding: 'utf8' });
  if (!available.error) return process.env;
  assert.equal(available.error.code, 'ENOENT');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  assert.ok(installation, 'actual Windows peer test requires the MSVC x64 compiler');
  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return captureVcvarsEnvironment(vcvars);
}

test('actual Windows original pipe and process references survive caller close and refuse stale/replaced peers', {
  skip: process.platform !== 'win32' ? 'requires actual Windows named pipes, process handles and SCM readback' : false,
  timeout: 180_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-connected-peer-native-'));
  try {
    const binary = path.join(temporary, 'guardian-connected-peer-probe.exe');
    execFileSync('cl.exe', ['/nologo', '/std:c++20', '/EHsc', '/MT', '/W4', '/WX', '/DUNICODE', '/D_UNICODE',
      '/DMETAENGINE_GUARDIAN_PEER_TEST', '/I', directory, probe,
      path.join(directory, 'browser-guardian-connected-peer.cpp'),
      path.join(directory, 'browser-guardian-owner-enrollment-observer.cpp'),
      path.join(directory, 'browser-guardian-installed-namespace.cpp'), `/Fe:${binary}`,
      '/link', 'advapi32.lib', 'bcrypt.lib', 'shell32.lib', 'ole32.lib'],
    { cwd: temporary, env: compilerEnvironment(), encoding: 'utf8', timeout: 120_000 });
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 40_000 });
    assert.ifError(result.error);
    const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.status, 0, JSON.stringify(rows.filter(row => row.state === 'FAIL')) + result.stderr);
    const summary = rows.find(row => row.name === 'summary');
    assert.ok(summary, 'native summary missing');
    assert.equal(summary.schema, 'metaengine.browser-guardian.connected-peer-mechanical-tests.v1');
    assert.equal(summary.state, 'PASS');
    assert.equal(summary.runtime, 'WINDOWS_NATIVE_PIPE_KERNEL');
    assert.equal(summary.tests_passed, cases.length);
    assert.equal(summary.tests_failed, 0);
    assert.equal(summary.tests_skipped, 0);
    assert.equal(summary.authority_effect, false);
    assert.equal(summary.loaded_runtime_code_attested, false);
    assert.equal(summary.launch_admission, 'UNAVAILABLE');
    assert.equal(summary.qualification, 'MECHANICS_ONLY_NOT_APPROVED_GUARDIAN');
    for (const name of cases) assert.equal(rows.find(row => row.name === name)?.state, 'PASS', `case did not pass: ${name}`);
    const oracle = rows.find(row => row.name === 'kernel_oracle');
    assert.ok(oracle);
    const peer = oracle.snapshot;
    assert.equal(peer.schema, 'metaengine.browser-guardian.connected-peer-observation.v1');
    assert.equal(peer.server_pid, oracle.server_pid);
    assert.equal(typeof peer.server_creation_time_100ns, 'string');
    assert.equal(peer.server_creation_time_100ns, oracle.server_creation_time_100ns);
    assert.ok(BigInt(peer.server_creation_time_100ns) > BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(peer.kernel_binding, 'EXACT');
    assert.equal(peer.launch_admission, 'UNAVAILABLE');
    assert.equal(peer.authority_effect, false);
    assert.equal(peer.loaded_runtime_code_attested, false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
