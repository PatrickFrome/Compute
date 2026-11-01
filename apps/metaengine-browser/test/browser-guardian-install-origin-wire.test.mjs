import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import { captureVcvarsEnvironment } from './helpers/msvc-environment.mjs';

const source = fileURLToPath(new URL('./native/browser-guardian-install-origin-wire-tests.cpp', import.meta.url));
const cases = [
  'fixed_independent_binary_contract', 'all_zero_challenge_cannot_be_used',
  'every_single_bit_mutation_is_refused', 'partial_concatenated_and_trailing_frames_are_refused',
  'wrong_challenge_and_role_are_refused', 'caller_identity_json_and_other_purposes_are_refused',
  'transport_order_is_required_before_one_claim', 'cancel_is_terminal_at_every_stage',
  'concurrent_claim_has_exactly_one_winner', 'cancel_before_claim_deterministically_wins',
  'claim_before_cancel_never_authorizes_a_later_stage', 'cancel_vs_claim_race_cannot_revive_scope',
];

function msvcEnvironment() {
  const available = spawnSync('cl.exe', ['/nologo', '/?'], {encoding:'utf8'});
  if (!available.error) return process.env;
  assert.equal(available.error.code, 'ENOENT');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {encoding:'utf8'}).trim();
  assert.ok(installation, 'portable production C++ test requires the build-host MSVC compiler');
  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return captureVcvarsEnvironment(vcvars);
}

test('actual production portable framing and terminal cancellation refuse replay and caller identity claims', {
  skip: !['linux', 'win32'].includes(process.platform) ? 'build harness supports Linux and Windows; no kernel identity claim' : false,
  timeout:60_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-install-origin-portable-'));
  try {
    const binary = path.join(temporary, process.platform === 'win32' ? 'origin-wire-tests.exe' : 'origin-wire-tests');
    if (process.platform === 'win32') {
      execFileSync('cl.exe', ['/nologo', '/std:c++20', '/EHsc', '/MT', '/W4', '/WX', source, `/Fe:${binary}`],
        {cwd:temporary, env:msvcEnvironment(), encoding:'utf8', timeout:30_000});
    } else {
      execFileSync('c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-pthread', source, '-o', binary],
        {cwd:temporary, encoding:'utf8', timeout:30_000});
    }
    const result = spawnSync(binary, [], {encoding:'utf8', timeout:15_000});
    assert.ifError(result.error);
    const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.status, 0, JSON.stringify(rows.filter(row => row.state === 'FAIL')) + result.stderr);
    const summary = rows.find(row => row.name === 'summary');
    assert.ok(summary);
    assert.equal(summary.schema, 'metaengine.guardian.install-origin-portable-tests.v1');
    assert.equal(summary.state, 'PASS');
    assert.equal(summary.tests_passed, cases.length);
    assert.equal(summary.tests_failed, 0);
    assert.equal(summary.authority_effect, false);
    assert.equal(summary.windows_identity_execution, 'UNQUALIFIED');
    assert.equal(summary.classification, 'ACTUAL_PRODUCTION_PORTABLE_PROTOCOL_NOT_INSTALL_SCOPE');
    for (const name of cases) assert.equal(rows.find(row => row.name === name)?.state, 'PASS', name);
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
});
