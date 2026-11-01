import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const native = fileURLToPath(new URL('../native/browser-guardian-scm/', import.meta.url));
const probe = fileURLToPath(new URL('./native/browser-guardian-original-install-user-probe.cpp', import.meta.url));
const mandatoryCases = [
  'actual_current_process_and_token_policy_oracle', 'thread_impersonation_never_falls_back_to_process_identity',
  'request_cancel_hides_facts_before_recheck', 'close_is_idempotent_and_cannot_rearm',
  'invalid_null_and_nonpipe_handles_are_refused', 'unconnected_pipe_cannot_bind_original_user',
  'wrong_pipe_side_cannot_bind_original_user', 'concurrent_cancel_leaves_no_current_identity',
];
const interactiveCases = [
  'actual_connected_server_identity_matches_original_token', 'completed_client_message_token_is_original_and_reverted',
  'original_client_handle_is_retained_after_caller_close', 'disconnected_original_client_never_rechecks',
  'same_name_pid_and_birth_reconnect_cannot_revive_original_client', 'observed_server_disconnect_is_permanently_latched',
  'thread_impersonation_revokes_current_observation', 'original_child_server_exit_revokes_retained_process',
];

function compilerEnvironment() {
  const available = spawnSync('cl.exe', ['/nologo', '/?'], {encoding:'utf8'});
  if (!available.error) return process.env;
  assert.equal(available.error.code, 'ENOENT');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {encoding:'utf8'}).trim();
  assert.ok(installation, 'actual Windows original-user test requires MSVC');
  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  assert.ok(fs.existsSync(vcvars)); assert.doesNotMatch(vcvars, /[%"&|<>\r\n]/);
  const result = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `call "${vcvars}" >nul && set`], {encoding:'utf8'});
  return Object.fromEntries(result.split(/\r?\n/).filter(line => line.indexOf('=') > 0).map(line => {
    const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
  }));
}

test('actual Windows original-user token/process/pipe custody and revocation stay SOURCE_ONLY', {
  skip:process.platform !== 'win32' ? 'requires actual Windows process/token/messagepipe kernel; Linux is not Windows qualification' : false,
  timeout:180_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-original-install-user-'));
  try {
    const binary = path.join(temporary, 'original-install-user-probe.exe');
    execFileSync('cl.exe', ['/nologo', '/std:c++20', '/EHsc', '/MT', '/W4', '/WX', '/DUNICODE', '/D_UNICODE',
      '/DMETAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST', '/I', native, probe,
      path.join(native, 'browser-guardian-original-install-user.cpp'), `/Fe:${binary}`, '/link', 'advapi32.lib'],
    {cwd:temporary, env:compilerEnvironment(), encoding:'utf8', timeout:120_000});
    const result = spawnSync(binary, [], {encoding:'utf8', timeout:45_000});
    assert.ifError(result.error);
    const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.status, 0, JSON.stringify(rows.filter(row => row.state === 'FAIL')) + result.stderr);
    const summary = rows.find(row => row.name === 'summary');
    const context = rows.find(row => row.name === 'actual_context');
    assert.ok(summary); assert.ok(context);
    assert.equal(summary.schema, 'metaengine.guardian.original-install-user-mechanics.v1');
    assert.equal(summary.state, 'PASS'); assert.equal(summary.tests_failed, 0);
    assert.equal(summary.tests_passed + summary.tests_skipped, mandatoryCases.length + interactiveCases.length);
    assert.equal(summary.runtime, 'WINDOWS_NATIVE_PROCESS_TOKEN_PIPE');
    assert.equal(summary.qualification, 'MECHANICS_ONLY_NOT_AUTHORIZED_INSTALLATION');
    assert.equal(summary.authority_effect, false); assert.equal(context.authority_effect, false);
    assert.equal(typeof context.eligible_unelevated_interactive, 'boolean');
    for (const name of mandatoryCases) assert.equal(rows.find(row => row.name === name)?.state, 'PASS', name);
    for (const name of interactiveCases) {
      const row = rows.find(row => row.name === name); assert.ok(row, name);
      assert.equal(row.state, context.eligible_unelevated_interactive ? 'PASS' : 'SKIP', name);
      if (row.state === 'SKIP') assert.equal(row.reason, 'NO_ACTUAL_UNELEVATED_INTERACTIVE_TOKEN');
    }
    assert.equal(summary.tests_skipped, context.eligible_unelevated_interactive ? 0 : interactiveCases.length);
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
});
