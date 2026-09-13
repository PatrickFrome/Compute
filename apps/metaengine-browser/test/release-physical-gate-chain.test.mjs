import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const readWorkflow = (name) => fs.readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');
const readBrowserFile = (name) => fs.readFileSync(path.join(repoRoot, 'apps', 'metaengine-browser', name), 'utf8');

test('verified dev release is transitively fenced by exact-SHA bootstrap autostart physical proof', () => {
  const bootstrap = readWorkflow('metaengine-browser-bootstrap-autostart-e2e.yml');
  const fast = readWorkflow('metaengine-browser-self-update-fast-e2e.yml');
  const release = readWorkflow('metaengine-browser-release-evidence-gate.yml');
  const publisher = readWorkflow('metaengine-browser-fast-autorelease.yml');

  // Bootstrap must be an unconditional release-SHA proof. The fast physical gate
  // waits for that exact-SHA run, central evidence requires both gates, and the
  // publisher waits for central convergence before touching release assets.
  assert.match(bootstrap, /release\/self-update-ambiguity-live-v2/);
  assert.doesNotMatch(bootstrap, /\n\s+paths(?:-ignore)?:/);
  assert.doesNotMatch(bootstrap, /METAENGINE_DISABLE_CRASH_SENTINEL\s*:/);

  assert.match(fast, /actions:\s*read/);
  assert.match(fast, /metaengine-browser-bootstrap-autostart-e2e\.yml/);
  assert.match(fast, /head_sha="\$EXPECTED_SHA"/);
  assert.match(fast, /exact_bootstrap_autostart_failed/);
  assert.match(fast, /exact_bootstrap_autostart_success_missing/);
  assert.match(fast, /needs:\s*\n\s*- contract\s*\n\s*- windows-published-n-to-one-build-target/);

  assert.match(release, /metaengine-browser-bootstrap-autostart-e2e\.yml/);
  assert.match(release, /metaengine-browser-self-update-fast-e2e\.yml/);
  assert.match(publisher, /metaengine-browser-release-evidence-gate\.yml/);
  assert.match(publisher, /metaengine-browser-self-update-fast-e2e\.yml/);
  assert.match(publisher, /head_sha="\$EXPECTED_SHA"/);
  assert.match(publisher, /exact_release_evidence_gate_success_missing/);
  assert.match(publisher, /exact_fast_e2e_success_missing/);
});

test('release publisher is blocked on the complete exact-SHA evidence gate without optional external analysis services', () => {
  const release = readWorkflow('metaengine-browser-release-evidence-gate.yml');
  const publisher = readWorkflow('metaengine-browser-fast-autorelease.yml');
  const releaseBranch = /release\/self-update-ambiguity-live-v2/;

  for (const workflow of [release, publisher]) assert.match(workflow, releaseBranch);
  const requiredWorkflows = [
    'metaengine-browser-bootstrap-autostart-e2e.yml',
    'metaengine-browser-self-update-fast-e2e.yml',
    'metaengine-browser-self-update-e2e.yml',
    'browser-critical-audit-v1.yml',
    'browser-developer-emergency-update-v1.yml',
    'browser-parent-progress-durability-gate.yml',
    'browser-self-update-durability-gate.yml',
    'browser-windows-package-smoke.yml',
    'browser-windows-autonomous-soak-v1.yml',
    'browser-final-runtime-activation-v1.yml',
    'browser-windows-installed-chat-qualification.yml',
  ];
  for (const required of requiredWorkflows) {
    assert.ok(release.includes(required), `missing_release_gate:${required}`);
    assert.match(readWorkflow(required), releaseBranch, `release_push_missing:${required}`);
  }

  assert.match(release, /head_sha=\{source_head\}/);
  assert.match(release, /all_required_gates_passed': True/);
  assert.match(release, /old_ambiguous_transaction_reused': False/);
  assert.doesNotMatch(release, /sonar(?:qube)?/i);
  assert.doesNotMatch(publisher, /sonar(?:qube)?/i);

  const fullGate = publisher.indexOf('Wait for exact release evidence gate success');
  const physicalGate = publisher.indexOf('Wait for exact fast physical E2E success');
  const publish = publisher.indexOf('Create draft from exact tested bytes');
  assert.ok(fullGate >= 0 && physicalGate > fullGate && publish > physicalGate);
  assert.match(publisher, /exact_release_evidence_gate_success_missing/);
  assert.match(publisher, /d80a0292-212b-40ec-a79b-6182a29057b4/);
  assert.match(publisher, /forbidden_ambiguous_transaction_reused/);
});

test('release gates physically cover the live restart boundary and native emergency actuator', () => {
  const packaged = readWorkflow('browser-windows-package-smoke.yml');
  const emergency = readWorkflow('browser-developer-emergency-update-v1.yml');
  const progress = readWorkflow('browser-parent-progress-durability-gate.yml');
  const physical = readBrowserFile('test/self-update-fast-physical.ps1');

  assert.match(packaged, /Start-Sleep -Seconds 190/);
  assert.match(packaged, /normal_ui_primary_died_across_sentinel_startup_grace/);
  assert.match(packaged, /normal_ui_parent_progress_did_not_advance/);
  assert.match(packaged, /sentinel_relaunch_attempted -NotePropertyValue \$false/);
  assert.match(emergency, /build-guardian-native-staging\.ps1/);
  assert.match(emergency, /update_actuator_native_write_ahead_effect_barrier/);
  assert.match(emergency, /update_actuator_at_most_one_dispatch_per_effect_id/);
  assert.match(progress, /host-resilience-runtime\.test\.mjs/);
  assert.match(physical, /old_ambiguous_transaction_reused/);
  assert.match(physical, /transaction_id/);
});
