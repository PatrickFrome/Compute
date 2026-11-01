import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import { captureVcvarsEnvironment } from './helpers/msvc-environment.mjs';

const directory = fileURLToPath(new URL('../native/browser-guardian-scm/', import.meta.url));
const probe = fileURLToPath(new URL('./native/browser-guardian-install-origin-link-probe.cpp', import.meta.url));
const header = fs.readFileSync(path.join(directory, 'browser-guardian-install-origin-link.hpp'), 'utf8');
const source = fs.readFileSync(probe, 'utf8');
const cases = [
  'routing_accepts_no_identity_json_path_or_zero_nonce', 'cancel_before_listen_never_opens_route',
  'actual_pending_connect_cancel_joins_before_close', 'actual_pending_read_cancel_joins_before_close',
  'premature_pending_event_wake_still_joins_original_io',
  'peer_close_before_message_is_not_origin_absence_or_binding', 'wrong_purpose_hello_refused_before_identity',
  'wrong_role_hello_refused_before_identity', 'wrong_nonce_hello_refused_before_identity',
  'oversized_hello_refused_before_identity', 'forged_identity_json_refused_before_identity',
  'failed_observer_cannot_rearm_or_substitute_route', 'observer_and_source_only_coordinator_cannot_authorize_uac',
  'initial_availability_wait_precedes_real_observer_creation',
  'initial_availability_cancel_consumes_attempt_and_joins_close', 'initial_availability_real_timeout_cannot_rearm',
  'actual_kernel_binding_retains_original_user_but_never_execution_proof',
  'bound_original_pending_close_read_cancel_still_joins',
  'wrong_role_reply_cannot_authenticate_bootstrap', 'wrong_nonce_reply_cannot_authenticate_bootstrap',
  'oversized_reply_cannot_authenticate_80_byte_prefix', 'nonprocess_original_handle_cannot_become_bootstrap',
];

test('origin link keeps original-process access private and mechanics friends compile guarded', () => {
  assert.match(header, /captureCoordinatorBeforeElevation\(\)/);
  assert.match(header, /private:[\s\S]*connectOriginalBootstrap\(HANDLE original_bootstrap_process\)/);
  assert.match(header, /#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST[\s\S]*friend struct GuardianInstallOriginLinkTest/);
  assert.match(source, /#ifndef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST\s+#error/);
});

test('origin link probe covers native pending cancellation and exact bounded messages without effects', () => {
  for (const name of cases) assert.ok(source.includes(`run("${name}"`), `native case missing: ${name}`);
  assert.match(source, /BCryptGenRandom/);
  assert.match(source, /pendingOperationForTest\(\)/);
  assert.match(source, /SECURITY_SQOS_PRESENT \| SECURITY_IDENTIFICATION/);
  assert.match(source, /GetProcessTimes/);
  assert.doesNotMatch(source, /\b(?:ShellExecute\w*|CreateService\w*|StartService\w*|ControlService|AdjustTokenPrivileges|LogonUser\w*|CryptProtectData|CreateProcess\w*)\s*\(/);
});

function compilerEnvironment() {
  const available = spawnSync('cl.exe', ['/nologo', '/?'], {encoding:'utf8'});
  if (!available.error) return process.env;
  assert.equal(available.error.code, 'ENOENT');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const install = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {encoding:'utf8'}).trim();
  assert.ok(install, 'actual Windows origin-link tests require MSVC');
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return captureVcvarsEnvironment(vcvars);
}

test('actual Windows original-origin pipe transcript refuses forged frames and joins cancellation', {
  skip: process.platform !== 'win32' ? 'requires actual Windows pipe/token/process APIs; crossbuild is separate evidence' : false,
  timeout:240_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-install-origin-link-'));
  try {
    const binary = path.join(temporary, 'guardian-install-origin-link-probe.exe');
    execFileSync('cl.exe', ['/nologo', '/std:c++20', '/EHsc', '/MT', '/W4', '/WX', '/DUNICODE', '/D_UNICODE',
      '/DMETAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST', '/I', directory, probe,
      path.join(directory, 'browser-guardian-install-origin-link.cpp'),
      path.join(directory, 'browser-guardian-original-install-user.cpp'),
      path.join(directory, 'browser-guardian-owner-enrollment-observer.cpp'), `/Fe:${binary}`, '/link', 'advapi32.lib', 'bcrypt.lib'],
    {cwd:temporary, env:compilerEnvironment(), encoding:'utf8', timeout:120_000});
    const result = spawnSync(binary, [], {encoding:'utf8', timeout:90_000});
    assert.ifError(result.error);
    const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.status, 0, JSON.stringify(rows.filter(row => row.state === 'FAIL')) + result.stderr);
    const summary = rows.find(row => row.name === 'summary');
    assert.ok(summary, 'native summary missing');
    assert.equal(summary.schema, 'metaengine.guardian.install-origin-link-mechanics.v1');
    assert.equal(summary.state, 'PASS'); assert.equal(summary.tests_failed, 0);
    assert.equal(summary.tests_passed + summary.tests_skipped, cases.length);
    assert.equal(summary.runtime, 'WINDOWS_NATIVE_PIPE_KERNEL');
    assert.equal(summary.qualification, 'MECHANICS_ONLY_NOT_INSTALL_AUTHORITY');
    assert.equal(summary.release_binding, 'UNQUALIFIED');
    for (const name of ['uac_exercised','scm_exercised','main_launch_exercised','authority_effect']) assert.equal(summary[name], false);
    const conditional = new Set([
      'initial_availability_wait_precedes_real_observer_creation',
      'initial_availability_cancel_consumes_attempt_and_joins_close', 'initial_availability_real_timeout_cannot_rearm',
      'actual_kernel_binding_retains_original_user_but_never_execution_proof',
      'bound_original_pending_close_read_cancel_still_joins',
      'wrong_role_reply_cannot_authenticate_bootstrap', 'wrong_nonce_reply_cannot_authenticate_bootstrap',
      'oversized_reply_cannot_authenticate_80_byte_prefix', 'nonprocess_original_handle_cannot_become_bootstrap',
    ]);
    for (const name of cases) {
      const row = rows.find(row => row.name === name); assert.ok(row, `case missing: ${name}`);
      if (row.state === 'SKIP') {
        assert.ok(conditional.has(name), `mandatory mechanics skipped: ${name}`);
        assert.equal(row.reason, 'NO_ACTUAL_UNELEVATED_INTERACTIVE_ORIGIN');
      } else assert.equal(row.state, 'PASS', `case failed: ${name}`);
    }
    const actual = rows.find(row => row.name === 'actual_original_user');
    if (actual) {
      assert.equal(actual.snapshot.kernel_binding, 'EXACT');
      assert.equal(actual.snapshot.original_user.identity_binding, 'RETAINED');
      assert.equal(typeof actual.snapshot.original_user.original_creation_time_100ns, 'string');
      assert.ok(BigInt(actual.snapshot.original_user.original_creation_time_100ns) > BigInt(Number.MAX_SAFE_INTEGER));
      assert.equal(actual.snapshot.authority_effect, false);
    }
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
});
