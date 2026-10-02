import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const workflows = path.join(repoRoot, '.github', 'workflows');

const cases = [
  ['browser-windows-package-smoke.yml', 1],
  ['browser-windows-installed-chat-qualification.yml', 1],
  ['browser-final-runtime-activation-v1.yml', 1],
  ['browser-windows-autonomous-soak-v1.yml', 5],
  ['metaengine-browser-self-update-e2e.yml', 2],
];

test('qualified physical Browser chain uses frozen npm ci installs', () => {
  for (const [file, expectedCi] of cases) {
    const source = fs.readFileSync(path.join(workflows, file), 'utf8');
    assert.equal(
      (source.match(/npm ci --no-audit --no-fund/g) || []).length,
      expectedCi,
      `${file} must keep the expected frozen Browser install count`,
    );
    assert.doesNotMatch(source, /npm install --no-audit --no-fund --no-package-lock/);
    assert.doesNotMatch(source, /run: npm install --no-audit --no-fund\s*$/m);
    assert.doesNotMatch(source, /node-version: '24'\s*$/m);
  }
});

test('Package Smoke binds frozen lock input separately from installed tree output', () => {
  const source = fs.readFileSync(path.join(workflows, 'browser-windows-package-smoke.yml'), 'utf8');
  const reservation = source.indexOf('- name: Publish immutable package-version reservation');
  const lockMaterial = source.indexOf('- name: Prove frozen package-lock material before dependency install');
  const npmCi = source.indexOf('- name: Install exact frozen Browser dependency tree');
  const resolution = source.indexOf('- name: Capture exact installed dependency resolution');
  const identity = source.indexOf('- name: Compute expected Build Identity V3 before packaging');
  const builder = source.indexOf('npx --yes electron-builder@26.15.7');

  assert.ok(reservation >= 0);
  assert.ok(lockMaterial > reservation);
  assert.ok(npmCi > lockMaterial);
  assert.ok(resolution > npmCi);
  assert.ok(identity > resolution);
  assert.ok(builder > identity);

  assert.match(source, /package_lock_sha256/);
  assert.match(source, /ME2_PACKAGE_LOCK_MATERIAL_PATH/);
  assert.match(source, /ME2_BUILD_IDENTITY_VERSION: '3'/);
  assert.match(source, /package-lock-material\.json/);
  assert.match(source, /package-lock\.json/);
  assert.match(source, /dependency-resolution\.json/);
});
