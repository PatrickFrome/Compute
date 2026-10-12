'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { canonicalJson, sha256String, sha256File, loadDependencyResolutionProof } = require('./build-identity.cjs');

const SCHEMA = 'metaengine.browser.local-build-identity.v1';
const SOURCE_ROOTS = ['apps/metaengine-browser/src', 'apps/metaengine-browser/scripts',
  'apps/metaengine-browser/native', 'apps/metaengine-browser/build', 'apps/metaengine-browser/package.json',
  'apps/metaengine-browser/package-lock.json', 'apps/metaengine-browser/electron-builder.test.json',
  'infra/client-state-runtime', 'supabase/migrations', 'apps/me2-ui', 'apps/me2-daemon',
  'coordination/browser-compute', 'coordination/browser-shared'];

function localBuildSelected() { return process.env.ME2_LOCAL_BUILD === '1'; }

function captureLocalBuildIdentity({ appRoot, repoRoot, sourceHead, packageVersion }) {
  const git = args => String(execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  if (!/^[a-f0-9]{40}$/.test(sourceHead || '') || git(['rev-parse', 'HEAD']) !== sourceHead) throw Error('local_build_head_mismatch');
  if (git(['diff', '--name-only', 'HEAD', '--', ...SOURCE_ROOTS])
    || git(['ls-files', '--others', '--exclude-standard', '--', ...SOURCE_ROOTS])) throw Error('local_build_source_dirty');
  const dependency = loadDependencyResolutionProof(process.env.ME2_DEPENDENCY_RESOLUTION_PATH || '');
  if (dependency.root_version !== packageVersion || dependency.node_version !== process.version) throw Error('local_build_dependency_mismatch');
  const ui = JSON.parse(fs.readFileSync(path.join(appRoot, 'me2-ui-dist/me2-ui-manifest.json'), 'utf8'));
  if (ui.git_sha !== sourceHead) throw Error('local_build_ui_head_mismatch');
  const buildId = process.env.ME2_LOCAL_BUILD_ID;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(buildId || '')) throw Error('local_build_id_invalid');
  const payload = {
    schema: SCHEMA, build_environment: 'LOCAL', build_id: buildId, source_head: sourceHead,
    package_version: packageVersion, platform: process.platform, arch: process.arch,
    package_lock_sha256: sha256File(path.join(appRoot, 'package-lock.json')),
    builder_config_sha256: sha256File(path.join(appRoot, 'electron-builder.test.json')),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    electron_builder_version: require(path.join(appRoot, 'node_modules/electron-builder/package.json')).version,
    electron_version: require(path.join(appRoot, 'node_modules/electron/package.json')).version,
    node_version: process.version, npm_version: dependency.npm_version,
    ui_manifest_sha256: sha256File(path.join(appRoot, 'me2-ui-dist/me2-ui-manifest.json')),
    github_synced: false, ci_qualification: false, production_ready: false, authority_effect: false,
  };
  return Object.freeze({ ...payload, build_identity_sha256: sha256String(canonicalJson(payload)) });
}

function assertLocalBuildIdentity(actual, expected) {
  if (actual?.schema !== SCHEMA || actual?.build_environment !== 'LOCAL'
    || actual?.github_synced !== false || actual?.ci_qualification !== false
    || actual?.production_ready !== false || actual?.authority_effect !== false
    || canonicalJson(actual) !== canonicalJson(expected)) throw Error('local_build_identity_mismatch');
  return actual;
}

module.exports = { SCHEMA, localBuildSelected, captureLocalBuildIdentity, assertLocalBuildIdentity };
