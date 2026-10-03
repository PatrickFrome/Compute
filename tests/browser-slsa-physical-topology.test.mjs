import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workflowRoot = path.join(root, '.github', 'workflows');

async function workflow(name) {
  return readFile(path.join(workflowRoot, name), 'utf8');
}

async function repoFile(name) {
  return readFile(path.join(root, name), 'utf8');
}

const PHYSICAL_BRANCH = 'physical/build-slsa-provenance-v1';

const PHYSICAL_MATRIX = [
  'browser-windows-package-smoke.yml',
  'browser-windows-installed-chat-qualification.yml',
  'browser-final-runtime-activation-v1.yml',
  'browser-windows-autonomous-soak-v1.yml',
  'metaengine-browser-self-update-e2e.yml',
  'metaengine-browser-shell-v1.yml',
  'browser-critical-audit-v1.yml',
  'browser-shell-first-dirty-profile-v1.yml',
  'browser-host-resilience-login-start-v1.yml',
  'browser-workspace-reincarnation-v1.yml',
];

test('physical SLSA line schedules the entire ten-workflow Browser qualification matrix', async () => {
  for (const name of PHYSICAL_MATRIX) {
    const source = await workflow(name);
    assert.equal(source.includes(PHYSICAL_BRANCH), true, name);
  }
});

test('Package Smoke is the only physical installer producer and creates GitHub SLSA provenance on exact push identity', async () => {
  const source = await workflow('browser-windows-package-smoke.yml');
  assert.match(source, /physical\/build-slsa-provenance-v1/);
  assert.match(source, /id-token:\s*write/);
  assert.match(source, /attestations:\s*write/);
  assert.match(source, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
  assert.match(source, /github\.event_name == 'push'/);
  assert.match(source, /github\.ref == 'refs\/heads\/physical\/build-slsa-provenance-v1'/);
  assert.match(source, /slsa_package_oidc_source_head_drift/);
  assert.match(source, /installer-slsa-provenance\.bundle\.json/);
  assert.match(source, /metaengine\.browser\.package-slsa-provenance-receipt\.v1/);
  assert.match(source, /browser-slsa-provenance\/\*\*/);
  assert.match(source, /slsa-provenance-verify:/);
  assert.match(source, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
  assert.match(source, /gh attestation verify/);
  assert.match(source, /--signer-workflow/);
  assert.match(source, /--source-digest/);
  assert.match(source, /--source-ref/);
  assert.match(source, /--deny-self-hosted-runners/);
  assert.match(source, /browser-slsa-provenance-verification\.mjs/);
  assert.match(source, /metaengine\.browser-fabric\.provenance-evidence\.v1/);

  const builderInvocations = source.match(/& \$builder --win nsis --x64 --config electron-builder\.test\.json --publish never/g) || [];
  assert.equal(builderInvocations.length, 1);
});

test('dirty-profile physical qualification consumes Package Smoke instead of rebuilding', async () => {
  const source = await workflow('browser-shell-first-dirty-profile-v1.yml');
  assert.match(source, /qualified-installer-consumer\.ps1 -Mode Acquire/);
  assert.match(source, /qualified-installer-consumer\.ps1 -Mode Wait/);
  assert.match(source, /ExpectedProducerEvent/);
  assert.doesNotMatch(source, /npx\s+--yes\s+electron-builder|electron-builder@26\.15\.7/);
});

test('shared installer consumers automatically fence the dedicated physical line to push producer event', async () => {
  const source = await repoFile('apps/metaengine-browser/scripts/qualified-installer-consumer.ps1');
  assert.match(source, /GITHUB_EVENT_NAME -eq 'push'/);
  assert.match(source, /GITHUB_REF -eq 'refs\/heads\/physical\/build-slsa-provenance-v1'/);
  assert.match(source, /\$ExpectedProducerEvent = 'push'/);
  assert.match(source, /producer_event/);
});

test('physical package identity is exact across package, lock and candidate reservation', async () => {
  const pkg = JSON.parse(await repoFile('apps/metaengine-browser/package.json'));
  const lock = JSON.parse(await repoFile('apps/metaengine-browser/package-lock.json'));
  const doc = await repoFile('apps/metaengine-browser/CONVERGENCE_CANDIDATE.md');
  const reserved = doc.match(/Reserved package identity is `([^`]+)`\./)?.[1];
  assert.match(reserved || '', /^0\.7\.0-dev\.[1-9][0-9]*\.1$/);
  assert.equal(pkg.version, reserved);
  assert.equal(lock.version, reserved);
  assert.equal(lock.packages[''].version, reserved);
});

test('dirty-profile acquire and terminal wait both receive a job-scoped GitHub token', async () => {
  const source = await workflow('browser-shell-first-dirty-profile-v1.yml');
  const steps = source.split(/\r?\n      - name: /);
  for (const mode of ['Acquire', 'Wait']) {
    const step = steps.find(row => row.includes(`qualified-installer-consumer.ps1 -Mode ${mode}`));
    assert.ok(step, mode);
    assert.match(step, /env:[\s\S]*?ME2_GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  }
});
