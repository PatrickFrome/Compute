import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { captureLocalBuildIdentity, assertLocalBuildIdentity } = require('../scripts/local-build-identity.cjs');
const { canonicalJson, sha256String } = require('../scripts/build-identity.cjs');

test('local build binds a clean commit and actual dependencies without claiming GitHub qualification', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'metaengine-local-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'apps/metaengine-browser');
  function write(relative, value) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file;
  }
  write('.gitignore', 'node_modules/\nme2-ui-dist/\ndependency-proof.json\n');
  const version = '0.7.0-dev.37781000050.1';
  write('apps/metaengine-browser/package.json', { name: '@metaengine/browser-shell', version });
  write('apps/metaengine-browser/package-lock.json', { lockfileVersion: 3, version });
  write('apps/metaengine-browser/electron-builder.test.json', { asar: true });
  const tracked = write('apps/metaengine-browser/src/main-entry.mjs', 'export const entry = 1;');
  write('apps/metaengine-browser/node_modules/electron-builder/package.json', { version: '26.15.7' });
  write('apps/metaengine-browser/node_modules/electron/package.json', { version: '44.0.0' });
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Local Build Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const sourceHead = git(['rev-parse', 'HEAD']);
  const uiPath = write('apps/metaengine-browser/me2-ui-dist/me2-ui-manifest.json', { git_sha: sourceHead });
  const depPayload = { schema: 'metaengine.browser.dependency-resolution.v1', root_name: '@metaengine/browser-shell',
    root_version: version, node_version: process.version, npm_version: '11.17.0', dependency_count: 0,
    tree: { name: '@metaengine/browser-shell', version, dependencies: {} } };
  const depPath = write('dependency-proof.json', { ...depPayload,
    dependency_resolution_sha256: sha256String(canonicalJson(depPayload)), authority_effect: false });
  const priorPath = process.env.ME2_DEPENDENCY_RESOLUTION_PATH, priorId = process.env.ME2_LOCAL_BUILD_ID;
  process.env.ME2_DEPENDENCY_RESOLUTION_PATH = depPath; process.env.ME2_LOCAL_BUILD_ID = 'fixture-local-build';
  t.after(() => {
    if (priorPath === undefined) delete process.env.ME2_DEPENDENCY_RESOLUTION_PATH; else process.env.ME2_DEPENDENCY_RESOLUTION_PATH = priorPath;
    if (priorId === undefined) delete process.env.ME2_LOCAL_BUILD_ID; else process.env.ME2_LOCAL_BUILD_ID = priorId;
  });
  const args = { appRoot, repoRoot: root, sourceHead, packageVersion: version };
  const proof = captureLocalBuildIdentity(args);
  assert.equal(proof.build_environment, 'LOCAL'); assert.equal(proof.ci_qualification, false);
  assert.equal(proof.github_synced, false); assert.equal(Object.hasOwn(proof, 'run_id'), false);
  assert.equal(assertLocalBuildIdentity(proof, captureLocalBuildIdentity(args)), proof);
  for (const patch of [{ source_head: 'b'.repeat(40) }, { ci_qualification: true },
    { package_lock_sha256: 'b'.repeat(64) }, { build_identity_sha256: 'b'.repeat(64) }]) {
    assert.throws(() => assertLocalBuildIdentity({ ...proof, ...patch }, proof), /identity_mismatch/);
  }
  fs.appendFileSync(tracked, '\nexport const changed = 2;');
  assert.throws(() => captureLocalBuildIdentity(args), /source_dirty/); git(['checkout', '--', tracked]);
  const untracked = write('apps/metaengine-browser/src/uncommitted.mjs', 'export const newCode = 1;');
  assert.throws(() => captureLocalBuildIdentity(args), /source_dirty/); fs.unlinkSync(untracked);
  fs.writeFileSync(uiPath, JSON.stringify({ git_sha: 'b'.repeat(40) }));
  assert.throws(() => captureLocalBuildIdentity(args), /ui_head_mismatch/);
});
