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
  const builder = source.indexOf('node_modules\\.bin\\electron-builder.cmd');

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


test('Package Smoke uses only the locally locked electron-builder toolchain', () => {
  const source = fs.readFileSync(path.join(workflows, 'browser-windows-package-smoke.yml'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'metaengine-browser', 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'metaengine-browser', 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.devDependencies?.['electron-builder'], '26.15.7');
  assert.equal(lock.packages?.['']?.devDependencies?.['electron-builder'], '26.15.7');
  assert.equal(lock.packages?.['node_modules/electron-builder']?.version, '26.15.7');
  assert.match(source, /require\('electron-builder\/package\.json'\)\.version/);
  assert.match(source, /node_modules\\\.bin\\electron-builder\.cmd/);
  assert.doesNotMatch(source, /npx\s+--yes\s+electron-builder/);
});


test('Package Smoke pins Bun and consumes the committed ME2 UI lock', () => {
  const source = fs.readFileSync(path.join(workflows, 'browser-windows-package-smoke.yml'), 'utf8');
  const uiAttributes = fs.readFileSync(path.join(repoRoot, 'apps', 'me2-ui', '.gitattributes'), 'utf8');

  assert.match(source, /oven-sh\/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6/);
  assert.match(source, /bun-version: '1\.3\.3'/);
  assert.match(source, /bun ci/);
  assert.doesNotMatch(source, /npm install --no-audit --no-fund --global bun/);
  assert.match(source, /ME2_BUN_VERSION: '1\.3\.3'/);
  assert.match(source, /ME2_UI_BUN_LOCK_PATH/);
  assert.match(source, /me2-ui-bun\.lock/);
  assert.match(uiAttributes, /^bun\.lock text eol=lf$/m);
});


test('source qualification isolates the ME2 UI build from the tracked checkout', () => {
  const source = fs.readFileSync(path.join(workflows, 'browser-build-identity-v3-source-qualification.yml'), 'utf8');
  assert.match(source, /\$uiRoot = Join-Path \$env:RUNNER_TEMP 'me2-ui-source'/);
  assert.match(source, /Copy-Item -Recurse -Force apps\/me2-ui \$uiRoot/);
  assert.match(source, /Push-Location \$uiRoot/);
  assert.doesNotMatch(source, /Push-Location apps\/me2-ui/);
});


test('physical Package Smoke isolates ME2 UI build from the tracked checkout', () => {
  const source = fs.readFileSync(path.join(workflows, 'browser-windows-package-smoke.yml'), 'utf8');
  assert.match(source, /\$uiRoot = Join-Path \$env:RUNNER_TEMP 'me2-ui-package-source'/);
  assert.match(source, /Copy-Item -Recurse -Force \$sourceUi \$uiRoot/);
  assert.match(source, /me2_ui_temp_lock_copy_drift/);
  assert.match(source, /me2_ui_bun_ci_lock_mutation/);
  assert.match(source, /me2_ui_bun_ci_failed/);
  assert.match(source, /me2_ui_build_failed/);
  assert.match(source, /me2_ui_pack_failed/);
  assert.doesNotMatch(source, /Push-Location apps\/me2-ui/);
});
