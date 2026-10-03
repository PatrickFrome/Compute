import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workflows = path.resolve(root, '..', '..', '.github', 'workflows');

async function source(file) {
  return readFile(path.join(root, file), 'utf8');
}

async function workflow(file) {
  return readFile(path.join(workflows, file), 'utf8');
}

test('R91 qualified installer consumer helper centralizes exact acquire and terminal producer fencing', async () => {
  const script = await source('scripts/qualified-installer-consumer.ps1');
  assert.match(script, /ValidateSet\('Acquire', 'Verify', 'Wait'\)/);
  assert.match(script, /installer-provenance\.mjs/);
  assert.match(script, /'acquire'/);
  assert.match(script, /'--allow-in-progress', 'true'/);
  assert.match(script, /ValidateSet\('push', 'pull_request', 'workflow_dispatch'\)/);
  assert.match(script, /ExpectedProducerEvent/);
  assert.match(script, /'--event'/);
  assert.match(script, /producer_event/);
  assert.match(script, /'verify'/);
  assert.match(script, /'--expect-run-id'/);
  assert.match(script, /'--expect-run-number'/);
  assert.match(script, /'--expect-run-attempt'/);
  assert.match(script, /'--expect-workflow'/);
  assert.match(script, /blockmap_verified -ne \$true/);
  assert.match(script, /config_verified -ne \$true/);
  assert.match(script, /'wait'/);
  assert.match(script, /producer_terminal_success/);
  assert.match(script, /qualified_installer_terminal_binding_drift/);
  assert.doesNotMatch(script, /Invoke-Expression|Start-Process|cmd\.exe|powershell\.exe/i);
});

test('dedicated physical SLSA branch auto-fences acquire/wait but not local reverify', async () => {
  const script = await source('scripts/qualified-installer-consumer.ps1');
  assert.match(script, /\$Mode -ne 'Verify'/);
  assert.match(script, /GITHUB_EVENT_NAME -eq 'push'/);
  assert.match(script, /GITHUB_REF -eq 'refs\/heads\/physical\/build-slsa-provenance-v1'/);
  assert.match(script, /\$ExpectedProducerEvent = 'push'/);
});

test('producer-event fencing is optional for legacy consumers but exact when requested', async () => {
  const script = await source('scripts/qualified-installer-consumer.ps1');
  assert.match(script, /if \(\$ExpectedProducerEvent\) \{/);
  assert.match(script, /\$acquireArgs \+= @\('--event', \$ExpectedProducerEvent\)/);
  assert.match(script, /\$waitArgs \+= @\('--event', \$ExpectedProducerEvent\)/);
  assert.match(script, /\[string\]\$resolved\.producer_event -ne \$ExpectedProducerEvent/);
  assert.match(script, /\[string\]\$binding\.producer_event -ne \$ExpectedProducerEvent/);
  assert.doesNotMatch(script, /Mandatory\s*=\s*\$true[^\n]*ExpectedProducerEvent/);
});

test('R91 installer consumers use one binding file instead of duplicating low-level provenance plumbing', async () => {
  const cases = [
    'browser-windows-installed-chat-qualification.yml',
    'browser-final-runtime-activation-v1.yml',
    'browser-windows-autonomous-soak-v1.yml',
    'metaengine-browser-self-update-e2e.yml',
    'browser-shell-first-dirty-profile-v1.yml',
  ];

  for (const file of cases) {
    const text = await workflow(file);
    assert.match(text, /qualified-installer-consumer\.ps1 -Mode Acquire/);
    assert.match(text, /qualified-installer-consumer\.ps1 -Mode Wait/);
    assert.match(text, /ME2_INSTALLER_BINDING_PATH/);
    assert.doesNotMatch(text, /installer-provenance\.mjs acquire/);
    assert.doesNotMatch(text, /installer-provenance\.mjs verify/);
    assert.doesNotMatch(text, /installer-provenance\.mjs wait/);
    assert.doesNotMatch(text, /ME2_PACKAGE_PRODUCER_RUN_ID|ME2_PACKAGE_PRODUCER_RUN_NUMBER|ME2_PACKAGE_PRODUCER_RUN_ATTEMPT/);
  }
});

test('R91 consumer proof schemas still persist exact producer identity and terminal qualification', async () => {
  const installed = await workflow('browser-windows-installed-chat-qualification.yml');
  const finalRuntime = await workflow('browser-final-runtime-activation-v1.yml');
  const soak = await workflow('browser-windows-autonomous-soak-v1.yml');

  for (const text of [installed, finalRuntime, soak]) {
    assert.match(text, /producer_run_id/);
    assert.match(text, /producer_run_number/);
    assert.match(text, /producer_run_attempt/);
    assert.match(text, /producer_completed_at_acquire/);
  }

  assert.match(installed, /installed-chat-proof\.json/);
  assert.match(finalRuntime, /final-runtime-activation-proof\.json/);
  assert.match(soak, /windows-autonomous-soak-proof\.json/);
});

test('shell-first dirty-profile qualification consumes the one-built Package Smoke artifact', async () => {
  const text = await workflow('browser-shell-first-dirty-profile-v1.yml');
  assert.match(text, /qualified-installer-consumer\.ps1 -Mode Acquire/);
  assert.match(text, /qualified-installer-consumer\.ps1 -Mode Wait/);
  assert.match(text, /ExpectedProducerEvent/);
  assert.match(text, /producer_event/);
  assert.match(text, /ME2_INSTALLER_BINDING_PATH/);
  assert.match(text, /shell-first-dirty-profile-proof\.json/);
  assert.doesNotMatch(text, /npx\s+--yes\s+electron-builder|electron-builder@/);
  assert.doesNotMatch(text, /Build exact-head NSIS candidate/);

  const producer = await workflow('browser-windows-package-smoke.yml');
  assert.match(producer, /browser-shell-first-dirty-profile-v1\.yml/);
});

test('R91 shared consumer helper changes schedule every workflow that executes it', async () => {
  const finalRuntime = await workflow('browser-final-runtime-activation-v1.yml');
  const soak = await workflow('browser-windows-autonomous-soak-v1.yml');
  const installed = await workflow('browser-windows-installed-chat-qualification.yml');

  assert.match(finalRuntime, /apps\/metaengine-browser\/scripts\/qualified-installer-consumer\.ps1/);
  assert.match(soak, /apps\/metaengine-browser\/scripts\/qualified-installer-consumer\.ps1/);
  assert.match(installed, /apps\/metaengine-browser\/\*\*/);
});

test('R91 Package Smoke trigger closure guarantees an exact-head producer whenever consumers are scheduled', async () => {
  const source = await workflow('browser-windows-package-smoke.yml');
  assert.match(source, /apps\/metaengine-browser\/\*\*/);
  assert.match(source, /browser-windows-installed-chat-qualification\.yml/);
  assert.match(source, /browser-final-runtime-activation-v1\.yml/);
  assert.match(source, /browser-windows-autonomous-soak-v1\.yml/);
  assert.match(source, /metaengine-browser-self-update-e2e\.yml/);
});

test('full physical self-update consumes the shared artifact and seals its producer before publication', async () => {
  const text = await workflow('metaengine-browser-self-update-e2e.yml');
  assert.match(text, /ME2_REQUIRE_QUALIFIED_INSTALLER: '1'/);
  assert.match(text, /actions: read/);
  assert.doesNotMatch(text, /npm pkg set|npx .*electron-builder|Build and stage exact-head ME2 UI/);
  const acquire = text.indexOf('- name: Acquire immutable Package Smoke installer');
  const effect = text.indexOf('- name: Published baseline to one-built exact candidate');
  const resident = text.indexOf('- name: Reproduce reported resident installer upgrade');
  const terminal = text.indexOf('- name: Require bound Package Smoke producer terminal success');
  const publish = text.indexOf('- name: Upload self-update evidence');
  assert.ok(acquire > 0 && effect > acquire && resident > effect && terminal > resident && publish > terminal);
  assert.match(text, /consumer_target_build_count -ne 0/);
  assert.match(text, /target_installer_source -ne 'PACKAGE_SMOKE_ARTIFACT'/);
  assert.match(text, /Prove exact source checkout unchanged/);

  const physical = await source('test/self-update-fast-physical.ps1');
  assert.match(physical, /-Mode Verify -ExpectedHead \$head/);
  assert.match(physical, /self_update_qualified_installer_binding_required/);
  assert.match(physical, /self_update_qualified_target_not_monotonic/);
  assert.match(physical, /self_update_qualified_target_name_mismatch/);
  assert.match(physical, /source_head = \$head/);
  assert.match(physical, /producer_run_attempt = if \(\$qualifiedBinding\)/);
});


test('qualified consumer carries and re-verifies Build Identity V3 lockfile material', async () => {
  const script = await source('scripts/qualified-installer-consumer.ps1');
  assert.match(script, /installer-provenance\.v3/);
  assert.match(script, /package_lock_sha256/);
  assert.match(script, /npm_version/);
  assert.match(script, /bun_version/);
  assert.match(script, /me2_ui_bun_lock_sha256/);
  assert.match(script, /package_lock_verified/);
  assert.match(script, /me2_ui_bun_lock_verified/);
  assert.match(script, /package_lock_sha256 -notmatch '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(script, /package_lock_verified -ne \$true/);
});
