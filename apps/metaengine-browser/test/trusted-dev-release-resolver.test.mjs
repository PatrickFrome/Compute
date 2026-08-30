import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  parseMetaengineDevVersion,
  parseStrictDevYml,
  resolveTrustedMetaengineDevRelease,
  resolveTrustedMetaengineDevReleaseFromChannel,
} from '../src/trusted-dev-release-resolver.mjs';

const OWNER = 'PatrickFrome';
const REPO = 'Compute';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DL = `https://github.com/${OWNER}/${REPO}/releases/download`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}`;
const CHANNEL_PREFIX = `${RAW}/browser-dev-channel/coordination/browser-dev-public-channel.json?v=`;
const E2E_PATH = '.github/workflows/metaengine-browser-self-update-e2e.yml';
const SHELL_PATH = '.github/workflows/metaengine-browser-shell-v1.yml';
const E2E_BLOB = 'b1b5dfbd63cf659560b5bb232f1555de7351ed77';
const SHELL_BLOB = '766834e8a92f62d5da778392686fd5f535a5948e';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const gitBlobSha1 = (value) => {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
};
const sha512 = Buffer.alloc(64, 7).toString('base64');
const e2eWorkflow = fs.readFileSync(new URL(`../../../${E2E_PATH}`, import.meta.url));
const shellWorkflow = fs.readFileSync(new URL(`../../../${SHELL_PATH}`, import.meta.url));

function fixture(version = '0.6.3-dev.80.1', gitSha = 'a'.repeat(40)) {
  const tag = `v${version}`;
  const installer = `METAENGINE-Browser-Test-Setup-${version}-x64.exe`;
  const installerSha256 = 'b'.repeat(64);
  const installerSize = 119997999;
  const blockmapSha256 = 'c'.repeat(64);
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
    "releaseDate: '2026-08-30T05:00:00.000Z'",
    'stagingPercentage: 100',
    '',
  ].join('\n');
  const assets = [
    { name:'dev.yml', digest:`sha256:${sha256(devYml)}`, size:Buffer.byteLength(devYml), state:'uploaded' },
    { name:installer, digest:`sha256:${installerSha256}`, size:installerSize, state:'uploaded' },
    { name:`${installer}.blockmap`, digest:`sha256:${blockmapSha256}`, size:126999, state:'uploaded' },
    { name:'verified-self-update-manifest.json', digest:`sha256:${sha256(manifest)}`, size:Buffer.byteLength(manifest), state:'uploaded' },
  ].map((asset) => ({ ...asset, browser_download_url:`${DL}/${tag}/${asset.name}` }));
  const channel = {
    schema:'metaengine.browser.dev-public-channel.v1',
    enabled:true,
    version,
    tag,
    source_sha:gitSha,
    feed_url:`${DL}/${tag}/`,
    installer_name:installer,
    installer_sha256:installerSha256,
    installer_size:installerSize,
    dev_yml_sha256:sha256(devYml),
    manifest_sha256:sha256(manifest),
    blockmap_sha256:blockmapSha256,
    trusted_e2e_workflow_blob:E2E_BLOB,
    trusted_shell_workflow_blob:SHELL_BLOB,
    authority_effect:false,
  };
  return { version, tag, gitSha, installer, manifest, devYml, installerSha256, installerSize, release:{ tag_name:tag, name:`METAENGINE Browser v${version}`, draft:false, prerelease:true, assets }, channel };
}

function response(body, status = 200) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Response(bytes, { status, headers:{ 'content-length':String(bytes.length) } });
}

function apiFallbackFetch({ releases, selected }) {
  const calls = [];
  const fetchImpl = async (url) => {
    const text = String(url); calls.push(text);
    if (text.startsWith(CHANNEL_PREFIX)) return response({ error:'channel_unavailable' }, 404);
    if (text === `${API}/releases?per_page=10`) return response(releases);
    if (text === `${API}/git/ref/tags/${encodeURIComponent(selected.tag)}`) return response({ ref:`refs/tags/${selected.tag}`, object:{ type:'commit', sha:selected.gitSha } });
    if (text === `${DL}/${selected.tag}/verified-self-update-manifest.json`) return response(selected.manifest);
    if (text === `${DL}/${selected.tag}/dev.yml`) return response(selected.devYml);
    return response({ error:'unexpected' }, 404);
  };
  return { fetchImpl, calls };
}

function channelFetch(selected, { mutateE2e = false, manifestDigestMismatch = false, apiStatus = 503 } = {}) {
  const calls = [];
  const channel = structuredClone(selected.channel);
  if (manifestDigestMismatch) channel.manifest_sha256 = '9'.repeat(64);
  const fetchImpl = async (url) => {
    const text = String(url); calls.push(text);
    if (text.startsWith(CHANNEL_PREFIX)) return response(channel);
    if (text === `${RAW}/${selected.gitSha}/${E2E_PATH}`) return response(mutateE2e ? Buffer.concat([e2eWorkflow, Buffer.from('\n# mutation\n')]) : e2eWorkflow);
    if (text === `${RAW}/${selected.gitSha}/${SHELL_PATH}`) return response(shellWorkflow);
    if (text === `${DL}/${selected.tag}/verified-self-update-manifest.json`) return response(selected.manifest);
    if (text === `${DL}/${selected.tag}/dev.yml`) return response(selected.devYml);
    if (text === `${API}/releases?per_page=10`) return response({ error:'api_unavailable' }, apiStatus);
    return response({ error:'unexpected' }, 404);
  };
  return { fetchImpl, calls };
}

test('trusted workflow files still match the immutable blob pins used by release authority', () => {
  assert.equal(gitBlobSha1(e2eWorkflow), E2E_BLOB);
  assert.equal(gitBlobSha1(shellWorkflow), SHELL_BLOB);
});

test('METAENGINE dev versions are strict and expose monotonic build numbers', () => {
  assert.deepEqual(parseMetaengineDevVersion('0.6.3-dev.78.1'), { version:'0.6.3-dev.78.1', core:'0.6.3', build:78 });
  assert.equal(parseMetaengineDevVersion('0.6.3-dev.78.0'), null);
  assert.equal(parseMetaengineDevVersion('0.6.4-dev.78.1+meta'), null);
});

test('raw public channel resolves an exact verified successor without touching GitHub REST', async () => {
  const selected = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl, calls } = channelFetch(selected);
  const result = await resolveTrustedMetaengineDevReleaseFromChannel({ currentVersion:'0.6.3-dev.79.1', fetchImpl, clock:() => 0 });
  assert.equal(result.version, selected.version);
  assert.equal(result.git_sha, selected.gitSha);
  assert.equal(result.installer_sha256, selected.installerSha256);
  assert.equal(result.discovery_transport, 'RAW_PUBLIC_CHANNEL');
  assert.ok(calls.some((url) => url.startsWith(CHANNEL_PREFIX)));
  assert.ok(!calls.some((url) => url.startsWith(`${API}/releases`)));
});

test('top-level resolver prefers verified raw channel and never asks REST on channel success', async () => {
  const selected = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl, calls } = channelFetch(selected);
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.79.1', fetchImpl, clock:() => 0 });
  assert.equal(result.discovery_transport, 'RAW_PUBLIC_CHANNEL');
  assert.ok(!calls.some((url) => url.startsWith(`${API}/releases`)));
});

test('workflow-blob mutation cannot be laundered through the public channel', async () => {
  const selected = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl } = channelFetch(selected, { mutateE2e:true });
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.79.1', fetchImpl, clock:() => 0 }),
    /trusted_release_discovery_failed:channel=.*workflow_blob_mismatch.*api=/,
  );
});

test('manifest digest mutation fails closed and cannot fall through to an unavailable API', async () => {
  const selected = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl } = channelFetch(selected, { manifestDigestMismatch:true });
  await assert.rejects(
    resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.79.1', fetchImpl, clock:() => 0 }),
    /trusted_release_discovery_failed:channel=.*manifest_sha256_mismatch.*api=/,
  );
});

test('REST remains a verified fallback when the public channel is unavailable', async () => {
  const r80 = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl, calls } = apiFallbackFetch({ releases:[r80.release], selected:r80 });
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.79.1', fetchImpl, clock:() => 0 });
  assert.equal(result.version, r80.version);
  assert.equal(result.discovery_transport, 'GITHUB_REST_API');
  assert.ok(calls.some((url) => url.startsWith(CHANNEL_PREFIX)));
  assert.ok(calls.includes(`${API}/releases?per_page=10`));
});

test('malformed newest REST candidate fails closed rather than falling back to an older release', async () => {
  const r79 = fixture('0.6.3-dev.79.1', '1'.repeat(40));
  const r80 = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  r80.release.assets = r80.release.assets.filter((asset) => asset.name !== 'verified-self-update-manifest.json');
  const { fetchImpl } = apiFallbackFetch({ releases:[r79.release, r80.release], selected:r80 });
  await assert.rejects(resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.78.1', fetchImpl, clock:() => 0 }), /trusted_release_asset_count_invalid/);
});

test('strict dev.yml parser requires one installer record and one identical SHA512 binding', () => {
  const selected = fixture();
  const parsed = parseStrictDevYml(selected.devYml);
  assert.equal(parsed.version, selected.version);
  assert.equal(parsed.path, selected.installer);
  assert.equal(parsed.file_url, selected.installer);
  assert.equal(parsed.sha512, sha512);
  assert.throws(() => parseStrictDevYml(`${selected.devYml}  - url: duplicate.exe\n    sha512: ${sha512}\n    size: 1\n`), /shape_invalid/);
});

test('same-version verified public channel returns null without using REST', async () => {
  const selected = fixture('0.6.3-dev.80.1', '2'.repeat(40));
  const { fetchImpl, calls } = channelFetch(selected);
  const result = await resolveTrustedMetaengineDevRelease({ currentVersion:'0.6.3-dev.80.1', fetchImpl, clock:() => 0 });
  assert.equal(result, null);
  assert.ok(!calls.some((url) => url.startsWith(`${API}/releases`)));
});
