import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { parseMetaengineDevVersion, parseStrictDevYml, resolveTrustedMetaengineDevRelease } from '../src/trusted-dev-release-resolver.mjs';

const OWNER = 'PatrickFrome';
const REPO = 'Compute';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DL = `https://github.com/${OWNER}/${REPO}/releases/download`;
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sha256Bytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha512 = Buffer.alloc(64, 7).toString('base64');

function fixture(version = '0.6.3-dev.66.1', gitSha = 'a'.repeat(40)) {
  const tag = `v${version}`;
  const installer = `METAENGINE-Browser-Test-Setup-${version}-x64.exe`;
  const installerSha256 = 'b'.repeat(64);
  const installerSize = 119997999;
  const manifest = JSON.stringify({
    schema:'metaengine.browser.self-update-e2e-manifest.v2', version, git_sha:gitSha,
    installer_name:installer, installer_sha256:installerSha256,
    update_channel:'dev', development_channel:true, production_safe:false,
    physical_n_to_n_plus_1:true, durable_successor_binding:true, forced_successor:true,
    profile_continuity:true, single_install_directory:true, physical_singleton:true,
  });
  const devYml = [
    `version: ${version}`,
    'files:',
    `  - url: ${installer}`,
    `    sha512: ${sha512}`,
    `    size: ${installerSize}`,
    `path: ${installer}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-29T19:40:00.000Z'",
    'stagingPercentage: 100',
    '',
  ].join('\n');
  const assets = [
    { name:'dev.yml', digest:`sha256:${sha256(devYml)}`, size:Buffer.byteLength(devYml), state:'uploaded' },
    { name:installer, digest:`sha256:${installerSha256}`, size:installerSize, state:'uploaded' },
    { name:`${installer}.blockmap`, digest:`sha256:${'c'.repeat(64)}`, size:126999, state:'uploaded' },
    { name:'verified-self-update-manifest.json', digest:`sha256:${sha256(manifest)}`, size:Buffer.byteLength(manifest), state:'uploaded' },
  ].map((asset) => ({ ...asset, browser_download_url:`${DL}/${tag}/${asset.name}` }));
  return {
    version, tag, gitSha, installer, manifest, devYml, installerSha256, installerSize,
    release:{ tag_name:tag, name:`METAENGINE Browser v${version}`, draft:false, prerelease:true, assets },
  };
}

function response(body, status = 200) {
  const bytes = Buffer.isBuffer(body) || body instanceof Uint8Array
    ? Buffer.from(body)
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return new Response(bytes, { status, headers:{ 'content-type':'application/json', 'content-length':String(bytes.length) } });
}

function fetchFor({ releases, selected }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === `${API}/releases?per_page=30`) return response(releases);
    if (url === `${API}/git/ref/tags/${encodeURIComponent(selected.tag)}`) return response({ ref:`refs/tags/${selected.tag}`, object:{ type:'commit', sha:selected.gitSha } });
    if (url === `${DL}/${selected.tag}/verified-self-update-manifest.json`) return response(selected.manifest);
    if (url === `${DL}/${selected.tag}/dev.yml`) return response(selected.devYml);
    return response({ error:'unexpected' }, 404);
  };
  return { fetchImpl, calls };
}

test('METAENGINE dev versions are strict and expose a monotonic build number', () => {
  assert.deepEqual(parseMetaengineDevVersion('0.6.3-dev.65.1'), { version:'0.6.3-dev.65.1', core:'0.6.3', build:65 });
  assert.equal(parseMetaengineDevVersion('0.6.3-dev.65.0'), null);
  assert.equal(parseMetaengineDevVersion('0.6.4-dev.65.1+meta'), null);
});

test('resolver ignores unrelated releases and verifies the newest same-family dev release end to end', async () => {
  const r65 = fixture('0.6.3-dev.65.1', '1'.repeat(40));
  const r66 = fixture('0.6.3-dev.66.1', '2'.repeat(40));
  const unrelated = fixture('0.6.4-dev.999.1', '3'.repeat(40)).release;
  const draft = { ...fixture('0.6.3-dev.67.1', '4'.repeat(40)).release, draft:true };
  const stable = { ...fixture('0.6.3-dev.68.1', '5'.repeat(40)).release, prerelease:false };
  const { fetchImpl, calls } = fetchFor({ releases:[unrelated, draft, stable, r65.release, r66.release], selected:r66 });
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl });
  assert.equal(result.version, '0.6.3-dev.66.1');
  assert.equal(result.tag, 'v0.6.3-dev.66.1');
  assert.equal(result.git_sha, '2'.repeat(40));
  assert.equal(result.feed_url, `${DL}/v0.6.3-dev.66.1/`);
  assert.equal(result.installer_name, r66.installer);
  assert.equal(result.installer_sha256, r66.installerSha256);
  assert.equal(result.installer_sha512, sha512);
  assert.equal(result.authority_effect, false);
  assert.ok(calls.includes(`${API}/git/ref/tags/${encodeURIComponent(r66.tag)}`));
});

test('resolver verifies raw metadata bytes before decoding, including a UTF-8 BOM', async () => {
  const r66 = fixture('0.6.3-dev.66.1', '2'.repeat(40));
  const bomDevYml = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(r66.devYml, 'utf8')]);
  r66.devYml = bomDevYml;
  const devAsset = r66.release.assets.find((asset) => asset.name === 'dev.yml');
  devAsset.digest = `sha256:${sha256Bytes(bomDevYml)}`;
  devAsset.size = bomDevYml.length;
  const { fetchImpl } = fetchFor({ releases:[r66.release], selected:r66 });
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl });
  assert.equal(result.version, r66.version);
  assert.equal(result.dev_yml_sha256, sha256Bytes(bomDevYml));
});

test('resolver fails closed when digest-valid metadata is not valid UTF-8', async () => {
  const r66 = fixture('0.6.3-dev.66.1', '2'.repeat(40));
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd, 0xfc]);
  r66.devYml = invalidUtf8;
  const devAsset = r66.release.assets.find((asset) => asset.name === 'dev.yml');
  devAsset.digest = `sha256:${sha256Bytes(invalidUtf8)}`;
  devAsset.size = invalidUtf8.length;
  const { fetchImpl } = fetchFor({ releases:[r66.release], selected:r66 });
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl }),
    /trusted_release_dev_yml_utf8_invalid/,
  );
});

test('resolver fails closed on malformed newest candidate instead of falling back to an older release', async () => {
  const r65 = fixture('0.6.3-dev.65.1', '1'.repeat(40));
  const r66 = fixture('0.6.3-dev.66.1', '2'.repeat(40));
  r66.release.assets = r66.release.assets.filter((asset) => asset.name !== 'verified-self-update-manifest.json');
  const { fetchImpl } = fetchFor({ releases:[r65.release, r66.release], selected:r66 });
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl }),
    /trusted_release_asset_count_invalid/,
  );
});

test('resolver rejects a manifest whose git sha does not bind to the release tag target', async () => {
  const r66 = fixture('0.6.3-dev.66.1', '2'.repeat(40));
  const badManifest = JSON.parse(r66.manifest);
  badManifest.git_sha = '9'.repeat(40);
  r66.manifest = JSON.stringify(badManifest);
  const manifestAsset = r66.release.assets.find((asset) => asset.name === 'verified-self-update-manifest.json');
  manifestAsset.digest = `sha256:${sha256(r66.manifest)}`;
  manifestAsset.size = Buffer.byteLength(r66.manifest);
  const { fetchImpl } = fetchFor({ releases:[r66.release], selected:r66 });
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl }),
    /trusted_release_manifest_git_sha_mismatch/,
  );
});

test('strict dev.yml parser requires one installer record and one identical SHA512 binding', () => {
  const r66 = fixture();
  const parsed = parseStrictDevYml(r66.devYml);
  assert.equal(parsed.version, r66.version);
  assert.equal(parsed.path, r66.installer);
  assert.equal(parsed.file_url, r66.installer);
  assert.equal(parsed.sha512, sha512);
  assert.throws(() => parseStrictDevYml(`${r66.devYml}  - url: duplicate.exe\n    sha512: ${sha512}\n    size: 1\n`), /shape_invalid/);
});

test('resolver returns null without touching tag or assets when no newer same-family candidate exists', async () => {
  const r64 = fixture('0.6.3-dev.64.1', '1'.repeat(40));
  const { fetchImpl, calls } = fetchFor({ releases:[r64.release], selected:r64 });
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.64.1', fetchImpl });
  assert.equal(result, null);
  assert.deepEqual(calls, [`${API}/releases?per_page=30`]);
});
