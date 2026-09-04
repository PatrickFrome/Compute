import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { resolveTrustedMetaengineDevRelease } from '../src/trusted-dev-release-resolver.mjs';

const OWNER = 'PatrickFrome';
const REPO = 'Compute';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DOWNLOAD_ROOT = `https://github.com/${OWNER}/${REPO}/releases/download`;
const CURRENT = '0.6.6-dev.1.1';
const TARGET = '0.6.6-dev.2.1';
const TAG = `v${TARGET}`;
const GIT_SHA = '1'.repeat(40);
const INSTALLED_SHA256 = 'b'.repeat(64);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function response(body, { json = false } = {}) {
  const bytes = Buffer.from(json ? JSON.stringify(body) : body);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.length) },
  });
}

function asset(name, bytes = Buffer.from(name), overrides = {}) {
  return {
    name,
    digest: `sha256:${sha256(bytes)}`,
    state: 'uploaded',
    size: bytes.length || 1,
    browser_download_url: `${DOWNLOAD_ROOT}/${TAG}/${name}`,
    ...overrides,
  };
}

function makeFixture({ installedDigest = INSTALLED_SHA256, mutateAssets } = {}) {
  const installerName = `METAENGINE-Browser-Test-Setup-${TARGET}-x64.exe`;
  const installerBytes = Buffer.from('exact-installer-bytes');
  const installer = asset(installerName, installerBytes);
  const sha512 = crypto.createHash('sha512').update(installerBytes).digest('base64');
  const devYmlBytes = Buffer.from([
    `version: ${TARGET}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    'files:',
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.size}`,
    '',
  ].join('\n'));

  const manifest = {
    schema: 'metaengine.browser.self-update-e2e-manifest.v2',
    version: TARGET,
    git_sha: GIT_SHA,
    update_channel: 'dev',
    development_channel: true,
    production_safe: false,
    physical_n_to_n_plus_1: true,
    durable_successor_binding: true,
    forced_successor: true,
    profile_continuity: true,
    single_install_directory: true,
    physical_singleton: true,
    installer_name: installerName,
    installer_sha256: installer.digest.slice('sha256:'.length),
  };
  if (installedDigest !== undefined) manifest.installed_executable_sha256 = installedDigest;
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);

  let assets = [
    asset('dev.yml', devYmlBytes),
    installer,
    asset(`${installerName}.blockmap`),
    asset('verified-self-update-manifest.json', manifestBytes),
    asset('guardian-native-staging-manifest.json'),
    asset('METAENGINEBrowserGuardian.exe'),
    asset('METAENGINEBrowserGuardianConfigure.exe'),
  ];
  if (mutateAssets) assets = mutateAssets(assets.map((row) => ({ ...row })));

  const release = {
    draft: false,
    prerelease: true,
    tag_name: TAG,
    name: `METAENGINE Browser ${TAG}`,
    assets,
  };

  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === `${API_ROOT}/releases?per_page=30`) return response([release], { json: true });
    if (href === `${API_ROOT}/git/ref/tags/${encodeURIComponent(TAG)}`) {
      return response({ object: { type: 'commit', sha: GIT_SHA } }, { json: true });
    }
    if (href === `${DOWNLOAD_ROOT}/${TAG}/verified-self-update-manifest.json`) return response(manifestBytes);
    if (href === `${DOWNLOAD_ROOT}/${TAG}/dev.yml`) return response(devYmlBytes);
    throw new Error(`unexpected_fetch:${href}`);
  };

  return { fetchImpl };
}

test('trusted resolver accepts the exact seven-asset current release and exports installed executable evidence', async () => {
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion: CURRENT, fetchImpl: makeFixture().fetchImpl });
  assert.equal(result.version, TARGET);
  assert.equal(result.git_sha, GIT_SHA);
  assert.equal(result.installed_executable_sha256, INSTALLED_SHA256);
  assert.equal(result.target_present_proof_supported, true);
  assert.equal(result.authority_effect, false);
});

test('legacy manifest without installed executable digest remains discoverable but cannot prove target presence', async () => {
  const result = await resolveTrustedMetaengineDevRelease({
    currentVersion: CURRENT,
    fetchImpl: makeFixture({ installedDigest: undefined }).fetchImpl,
  });
  assert.equal(result.version, TARGET);
  assert.equal(result.installed_executable_sha256, null);
  assert.equal(result.target_present_proof_supported, false);
  assert.equal(result.authority_effect, false);
});

test('malformed installed executable digest fails closed', async () => {
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({
      currentVersion: CURRENT,
      fetchImpl: makeFixture({ installedDigest: 'not-a-sha256' }).fetchImpl,
    }),
    /trusted_release_manifest_installed_executable_sha256_invalid/,
  );
});

test('unknown eighth release asset fails closed instead of widening the allowlist', async () => {
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({
      currentVersion: CURRENT,
      fetchImpl: makeFixture({ mutateAssets: (assets) => [...assets, asset('unexpected.bin')] }).fetchImpl,
    }),
    /trusted_release_asset_count_invalid/,
  );
});

test('replacing a required Guardian artifact with an unknown asset fails the exact set check', async () => {
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({
      currentVersion: CURRENT,
      fetchImpl: makeFixture({
        mutateAssets: (assets) => assets.map((row) => row.name === 'METAENGINEBrowserGuardian.exe' ? asset('unexpected-guardian.exe') : row),
      }).fetchImpl,
    }),
    /trusted_release_asset_set_invalid/,
  );
});

test('duplicate release names fail closed even when raw asset cardinality remains seven', async () => {
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({
      currentVersion: CURRENT,
      fetchImpl: makeFixture({
        mutateAssets: (assets) => assets.map((row) => row.name === 'METAENGINEBrowserGuardianConfigure.exe' ? { ...assets[5] } : row),
      }).fetchImpl,
    }),
    /trusted_release_asset_set_invalid/,
  );
});
