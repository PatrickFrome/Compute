import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../../../.github/workflows/browser-windows-autonomous-soak-v1.yml', import.meta.url), 'utf8');

test('failed Owner soak uploads the nested finite diagnostics and proof where the consumer writes them', () => {
  const upload = workflow.split('- name: Upload optimized exact-head installer and soak evidence')[1];
  assert.ok(upload);
  assert.match(upload, /if: always\(\)/);
  for (const name of ['windows-autonomous-soak-proof.json', 'soak-diagnostics.json',
    'soak-terminal-diagnostics.json', 'soak-normal-ui-readback.json']) {
    assert.ok(upload.includes('${{ runner.temp }}/soak-owner-evidence-*/' + name), name);
  }
  assert.doesNotMatch(upload, /soak-owner-evidence-\*\/(?:\*|\*\*)\s*$/m);
  assert.doesNotMatch(upload, /soak-(?:profile|normal-ui|secondary-\*|burst-\*)\.(?:out|err)/);
  assert.doesNotMatch(upload, /browser-startup-journal-soak\.json/);
});

test('soak PowerShell and terminal regressions run on exact-source Windows without requiring an installer', () => {
  const job = workflow.split('  soak-harness-regression:')[1]?.split('\n  continuous-brain:')[0];
  assert.ok(job, 'independent source regression job must exist');
  assert.match(job, /runs-on: windows-2025/);
  assert.match(job, /ref: \$\{\{ env\.EXACT_HEAD \}\}/);
  assert.match(job, /POWERSHELL_EXE: powershell\.exe/);
  for (const name of ['windows-autonomous-soak-diagnostics.test.mjs', 'installed-owner-soak-diagnostics.test.mjs',
    'installed-owner-soak-failure-code.test.mjs', 'installed-owner-soak-workflow.test.mjs',
    'installed-owner-consumer.test.mjs', 'browser-windows-autonomous-soak-contract.test.mjs']) {
    assert.ok(job.includes('test/' + name), name);
  }
  assert.match(job, /node --test --test-concurrency=1 --test-reporter=tap/);
  assert.doesNotMatch(job, /qualified-installer-consumer|electron-builder|npm (?:ci|install)|Start-Process/);
  assert.match(job, /if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(job, /if: always\(\)/);
});

test('workflow merges physical proof only after normal boot, 72 activations, cleanup and post-exit integrity', () => {
  const step = workflow.split('- name: Prove 72 activations with a real disposable Owner and attached PostgreSQL')[1]
    .split('\n      - name:')[0];
  const failedExit = step.indexOf("if ($LASTEXITCODE -ne 0) { throw 'soak_owner_physical_qualification_failed' }");
  const guard = step.indexOf("throw 'soak_owner_consumer_unproven'");
  const merge = step.indexOf('foreach ($property in $consumer.session_soak.PSObject.Properties)');
  assert.ok(failedExit > 0 && guard > failedExit && merge > guard);
  const beforeMerge = step.slice(failedExit, merge);
  for (const field of ['normal_ui_boot_verified', 'post_exit_ui_integrity_verified', 'post_exit_runtime_integrity_verified',
    'process_cleanup_confirmed', 'disposable_pg_cleanup_confirmed']) {
    assert.match(beforeMerge, new RegExp('\\.' + field + ' -ne \\$true'), field);
  }
  assert.match(beforeMerge, /second_instance_activations_verified -ne 72/);
});

test('Stream 1 source-only PR cannot start the physical consumer before the integrated installer is issued', () => {
  const physical = workflow.split('  package-session-soak:')[1];
  assert.match(physical, /if: github\.event_name != 'pull_request' \|\| \(github\.head_ref != 'work\/preinstall-soak-20261027'/);
  assert.match(physical, /qualified-installer-consumer\.ps1 -Mode Acquire -ExpectedHead \$expectedHead/);
  assert.match(physical, /qualified-installer-consumer\.ps1 -Mode Wait -ExpectedHead \$env:EXACT_HEAD/);
  assert.match(physical, /needs: \[soak-harness-regression,/);
});
