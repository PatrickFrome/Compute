import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workflowPath = path.resolve(appRoot, '..', '..', '.github', 'workflows', 'browser-windows-package-smoke.yml');

test('Package Smoke reserves one source/version before dependency install or physical packaging', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /permissions:\s*[\s\S]*actions: read[\s\S]*contents: read/);
  assert.match(workflow, /package_identity_preflight:/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT" != "1"/);
  assert.match(workflow, /package_identity_rerun_requires_new_source_and_version/);
  assert.match(workflow, /windows-nsis-package-smoke:\s*\n\s*needs: package_identity_preflight/);
  assert.match(
    workflow,
    /group: browser-windows-package-version-\$\{\{ needs\.package_identity_preflight\.outputs\.package_version \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /^concurrency:/m);
  assert.doesNotMatch(workflow, /browser-windows-package-smoke-\$\{\{ github\.ref \}\}/);
  assert.equal((workflow.match(/^\s{4}timeout-minutes:/gm) || []).length, 1);

  const guard = workflow.indexOf('- name: Refuse duplicate source/version physical build');
  const marker = workflow.indexOf('- name: Publish immutable package-version reservation');
  const seal = workflow.indexOf('- name: Seal package-version reservation before physical build');
  const lockMaterial = workflow.indexOf('- name: Prove frozen package-lock material before dependency install');
  const dependencyInstall = workflow.indexOf('- name: Install exact frozen Browser dependency tree');
  const electronBuilder = workflow.indexOf("node_modules\\.bin\\electron-builder.cmd");
  const candidate = workflow.indexOf('- name: Publish immutable candidate for parallel downstream qualification');

  assert.ok(guard >= 0);
  assert.ok(marker > guard);
  assert.ok(seal > marker);
  assert.ok(lockMaterial > seal);
  assert.ok(dependencyInstall > lockMaterial);
  assert.ok(electronBuilder > dependencyInstall);
  assert.ok(candidate > electronBuilder);

  assert.match(workflow, /metaengine-browser-package-version-\$\{\{ needs\.package_identity_preflight\.outputs\.package_version \}\}/);
  assert.match(workflow, /package-version-reservation-seal\.json/);
  assert.match(workflow, /reservation_artifact_id/);
  assert.match(workflow, /reservation_artifact_digest/);
  assert.match(workflow, /artifactDigestRaw -match '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(workflow, /\$artifactDigest = "sha256:\$artifactDigestRaw"/);
  assert.match(workflow, /node-version: '24\.21\.0'/);
  assert.match(workflow, /npm --version\) -ne '11\.19\.0'/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.doesNotMatch(workflow, /npm install --no-audit --no-fund --no-package-lock/);
});

test('Package Smoke has only one physical build and one candidate upload after reservation wiring', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.equal((workflow.match(/windows-nsis-package-smoke:/g) || []).length, 1);
  assert.equal((workflow.match(/node_modules\\\\\.bin\\\\electron-builder\.cmd/g) || []).length, 1);
  assert.equal((workflow.match(/npx\s+--yes\s+electron-builder/g) || []).length, 0);
  assert.equal((workflow.match(/Publish immutable package-version reservation/g) || []).length, 1);
  assert.equal((workflow.match(/Publish immutable candidate for parallel downstream qualification/g) || []).length, 1);
  assert.equal((workflow.match(/Upload exact-head Windows qualification evidence/g) || []).length, 1);
});
