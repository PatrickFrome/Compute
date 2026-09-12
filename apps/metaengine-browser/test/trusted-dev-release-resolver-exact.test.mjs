import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { resolveExactTrustedMetaengineDevRelease } from '../src/trusted-dev-release-resolver.mjs';

const API = 'https://api.github.com/repos/PatrickFrome/Compute';
const DL = 'https://github.com/PatrickFrome/Compute/releases/download';
const VERSION = '0.7.0-dev.4.1';
const TAG = `v${VERSION}`;
const GIT_SHA = '1'.repeat(40);
const INSTALLER_SHA = '2'.repeat(64);
const INSTALLED_EXE_SHA = '3'.repeat(64);
const SERVICE_SHA = '4'.repeat(64);
const CONFIGURATOR_SHA = '5'.repeat(64);
const BLOCKMAP_SHA = '6'.repeat(64);
const GUARDIAN_MANIFEST_SHA = '7'.repeat(64);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha512 = Buffer.alloc(64, 9).toString('base64');

function buildFixture({ tag = TAG, version = VERSION, releaseName = `METAENGINE Browser v${VERSION}`, installedExeSha = INSTALLED_EXE_SHA } = {}) {
  const installer = `METAENGINE-Browser-Test-Setup-${version}-x64.exe`;
  const installerSize = 123456789;
  const manifest = JSON.stringify({
    schema: 'metaengine.browser.self-update-e2e-manifest.v2',
    version,
    git_sha: GIT_SHA,
    installer_name: installer,
    installer_sha256: INSTALLER_SHA,
    installed_executable_sha256: installedExeSha,
    update_channel: 'dev',
    development_channel: true,
    production_safe: false,
    physical_n_to_n_plus_1: true,
    durable_successor_binding: true,
    forced_successor: true,
    profile_continuity: true,
    single_install_directory: true,
    physical_singleton: true,
  });
  const devYml = [
    `version: ${version}`,
    'files:',
    `  - url: ${installer}`,
    `    sha512: ${sha512}`,
    `    size: ${installerSize}`,
    `path: ${installer}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-09-12T00:00:00.000Z'",
    'stagingPercentage: 100',
    '',
  ].join('\n');
  const rawAssets = [
    ['dev.yml', sha256(devYml), Buffer.byteLength(devYml)],
    [installer, INSTALLER_SHA, installerSize],
    [`${installer}.blockmap`, BLOCKMAP_SHA, 999],
    ['verified-self-update-manifest.json', sha256(manifest), Buffer.byteLength(manifest)],
    ['guardian-native-staging-manifest.json', GUARDIAN_MANIFEST_SHA, 888],
    ['METAENGINEBrowserGuardian.exe', SERVICE_SHA, 777],
    ['METAENGINEBrowserGuardianConfigure.exe', CONFIGURATOR_SHA, 666],
  ];
  const assets = rawAssets.map(([name, digest, size]) => ({
    name,
    digest: `sha256:${digest}`,
    size,
    state: 'uploaded',
    browser_download_url: `${DL}/${tag}/${name}`,
  }));
  return {
    version,
    tag,
    installer,
    manifest,
    devYml,
    release: { tag_name: tag, name: releaseName, draft: false, prerelease: true, assets },
  };
}

function response(body, status = 200) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return new Response(bytes, { status, headers: { 'content-length': String(bytes.length) } });
}

function exactFetch(fixture) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === `${API}/releases/tags/${encodeURIComponent(fixture.tag)}`) return response(fixture.release);
    if (url === `${API}/git/ref/tags/${encodeURIComponent(fixture.tag)}`) {
      return response({ ref: `refs/tags/${fixture.tag}`, object: { type: 'commit', sha: GIT_SHA } });
    }
    if (url === `${DL}/${fixture.tag}/verified-self-update-manifest.json`) return response(fixture.manifest);
    if (url === `${DL}/${fixture.tag}/dev.yml`) return response(fixture.devYml);
    return response({ error: 'unexpected' }, 404);
  };
  return { fetchImpl, calls };
}

test('exact resolver verifies the requested release through the shared immutable-release trust path', async () => {
  const fixture = buildFixture();
  const { fetchImpl, calls } = exactFetch(fixture);
  const out = await resolveExactTrustedMetaengineDevRelease({ version: VERSION, fetchImpl });
  assert.equal(out.version, VERSION);
  assert.equal(out.tag, TAG);
  assert.equal(out.git_sha, GIT_SHA);
  assert.equal(out.installer_sha256, INSTALLER_SHA);
  assert.equal(out.installed_executable_sha256, INSTALLED_EXE_SHA);
  assert.equal(out.target_present_proof_supported, true);
  assert.equal(out.authority_effect, false);
  assert.ok(calls.includes(`${API}/releases/tags/${encodeURIComponent(TAG)}`));
  assert.ok(calls.includes(`${API}/git/ref/tags/${encodeURIComponent(TAG)}`));
  assert.equal(calls.some((url) => url.includes('/releases?per_page=')), false, 'exact recovery must not scan newest-release listings');
});

test('exact resolver rejects a release whose tag does not bind to the requested version', async () => {
  const fixture = buildFixture();
  fixture.release.tag_name = 'v0.7.0-dev.999.1';
  const { fetchImpl } = exactFetch(fixture);
  await assert.rejects(
    resolveExactTrustedMetaengineDevRelease({ version: VERSION, fetchImpl }),
    /trusted_release_tag_invalid/,
  );
});

test('exact resolver rejects manifest installed executable digest drift before recovery can trust disk state', async () => {
  const fixture = buildFixture({ installedExeSha: 'z'.repeat(64) });
  const manifestAsset = fixture.release.assets.find((asset) => asset.name === 'verified-self-update-manifest.json');
  manifestAsset.digest = `sha256:${sha256(fixture.manifest)}`;
  manifestAsset.size = Buffer.byteLength(fixture.manifest);
  const { fetchImpl } = exactFetch(fixture);
  await assert.rejects(
    resolveExactTrustedMetaengineDevRelease({ version: VERSION, fetchImpl }),
    /trusted_release_manifest_installed_executable_sha256_invalid/,
  );
});

test('exact resolver rejects legacy release as installed-successor proof when manifest tries to carry an unbound executable digest', async () => {
  const fixture = buildFixture();
  fixture.release.assets = fixture.release.assets.filter((asset) => ![
    'guardian-native-staging-manifest.json',
    'METAENGINEBrowserGuardian.exe',
    'METAENGINEBrowserGuardianConfigure.exe',
  ].includes(asset.name));
  const { fetchImpl } = exactFetch(fixture);
  await assert.rejects(
    resolveExactTrustedMetaengineDevRelease({ version: VERSION, fetchImpl }),
    /trusted_release_manifest_installed_executable_sha256_unbound/,
  );
});

test('exact resolver validates requested dev version before any network access', async () => {
  let calls = 0;
  await assert.rejects(
    resolveExactTrustedMetaengineDevRelease({ version: '0.7.0', fetchImpl: async () => { calls += 1; return response({}); } }),
    /trusted_release_exact_version_invalid/,
  );
  assert.equal(calls, 0);
});
