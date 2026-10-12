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
  assert.match(workflow, /windows-nsis-package-smoke:\s*\n(?:\s*#[^\n]*\n|\s*if:[^\n]*\n)*\s*needs: package_identity_preflight/);
  assert.match(
    workflow,
    /group: browser-windows-package-version-\$\{\{ needs\.package_identity_preflight\.outputs\.package_version \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /^concurrency:/m);
  assert.doesNotMatch(workflow, /browser-windows-package-smoke-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /windows-nsis-package-smoke:[\s\S]*?timeout-minutes:\s*60/);
  assert.match(workflow, /slsa-provenance-verify:[\s\S]*?timeout-minutes:\s*10/);

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
  assert.equal((workflow.match(/electron-builder\.cmd/g) || []).length, 1);
  assert.equal((workflow.match(/npx\s+--yes\s+electron-builder/g) || []).length, 0);
  assert.equal((workflow.match(/Publish immutable package-version reservation/g) || []).length, 1);
  assert.equal((workflow.match(/Publish immutable candidate for parallel downstream qualification/g) || []).length, 1);
  assert.equal((workflow.match(/Upload exact-head Windows qualification evidence/g) || []).length, 1);
});

test('offline resource evidence travels with the candidate after clean-source gates', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const stage = workflow.indexOf('- name: Stage pinned offline client state runtime resources');
  const beforeBuild = workflow.indexOf('- name: Verify tracked source is unchanged before physical packaging');
  const build = workflow.indexOf('- name: Build exact-head unsigned NSIS package');
  const beforePublish = workflow.indexOf('- name: Verify tracked source is unchanged before candidate publication');
  const publish = workflow.indexOf('- name: Publish immutable candidate for parallel downstream qualification');
  const install = workflow.indexOf('- name: Install exact-head package and prove Browser');
  assert.ok(stage >= 0 && beforeBuild > stage && build > beforeBuild);
  assert.ok(beforePublish > build && publish > beforePublish && install > publish);
  for (const begin of [beforeBuild, beforePublish]) {
    assert.match(workflow.slice(begin, workflow.indexOf('\n      - name:', begin + 1)), /git diff --exit-code HEAD -- \./);
  }
  const candidate = workflow.slice(publish, install);
  assert.match(candidate, /packaged-client-state-runtime-proof\.json/);
  assert.match(candidate, /offline-runtime-bundle\.json/);
  assert.match(workflow, /offline_runtime_packaged_resources_verified -ne \$true/);
});
