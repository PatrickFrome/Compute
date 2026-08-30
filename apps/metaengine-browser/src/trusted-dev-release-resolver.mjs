import crypto from 'node:crypto';

const OWNER = 'PatrickFrome';
const REPO = 'Compute';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DOWNLOAD_ROOT = `https://github.com/${OWNER}/${REPO}/releases/download`;
const RAW_ROOT = `https://raw.githubusercontent.com/${OWNER}/${REPO}`;
const PUBLIC_CHANNEL_BRANCH = 'browser-dev-channel';
const PUBLIC_CHANNEL_PATH = 'coordination/browser-dev-public-channel.json';
const TRUSTED_E2E_WORKFLOW_BLOB = 'b1b5dfbd63cf659560b5bb232f1555de7351ed77';
const TRUSTED_SHELL_WORKFLOW_BLOB = '766834e8a92f62d5da778392686fd5f535a5948e';
const TRUSTED_E2E_WORKFLOW_PATH = '.github/workflows/metaengine-browser-self-update-e2e.yml';
const TRUSTED_SHELL_WORKFLOW_PATH = '.github/workflows/metaengine-browser-shell-v1.yml';
const DEV_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.1$/;
const SHA256_RE = /^sha256:([0-9a-f]{64})$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const SHA1_HEX_RE = /^[0-9a-f]{40}$/;
const SHA512_B64_RE = /^[A-Za-z0-9+/]{86}==$/;
const MAX_RELEASES_BYTES = 2 * 1024 * 1024;
const MAX_SMALL_ASSET_BYTES = 128 * 1024;
const MAX_CHANNEL_BYTES = 32 * 1024;
const MAX_WORKFLOW_BYTES = 256 * 1024;

function clip(value, max = 300) { return String(value ?? '').slice(0, max); }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256Text(value) { return sha256Bytes(Buffer.from(value, 'utf8')); }
function gitBlobSha1(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

export function parseMetaengineDevVersion(value) {
  const text = String(value || '').trim();
  const m = DEV_VERSION_RE.exec(text);
  if (!m) return null;
  return {
    version: text,
    core: `${m[1]}.${m[2]}.${m[3]}`,
    build: Number(m[4]),
  };
}

function expectedAssetNames(version) {
  const installer = `METAENGINE-Browser-Test-Setup-${version}-x64.exe`;
  return {
    metadata: 'dev.yml',
    installer,
    blockmap: `${installer}.blockmap`,
    manifest: 'verified-self-update-manifest.json',
  };
}

function exactDownloadUrl(tag, name) {
  return `${DOWNLOAD_ROOT}/${tag}/${name}`;
}

function normalizeAsset(asset, tag) {
  const name = String(asset?.name || '');
  const digestText = String(asset?.digest || '').toLowerCase();
  const digestMatch = SHA256_RE.exec(digestText);
  if (!name || !digestMatch) throw new Error(`trusted_release_asset_digest_invalid:${clip(name, 100)}`);
  if (String(asset?.state || '') !== 'uploaded') throw new Error(`trusted_release_asset_not_uploaded:${clip(name, 100)}`);
  const size = Number(asset?.size || 0);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`trusted_release_asset_size_invalid:${clip(name, 100)}`);
  const url = String(asset?.browser_download_url || '');
  if (url !== exactDownloadUrl(tag, name)) throw new Error(`trusted_release_asset_url_invalid:${clip(name, 100)}`);
  return { name, sha256: digestMatch[1], size, url };
}

function pickNewestRelease(releases, currentVersion) {
  const current = parseMetaengineDevVersion(currentVersion);
  if (!current) throw new Error('trusted_release_current_version_invalid');
  if (!Array.isArray(releases)) throw new Error('trusted_release_list_invalid');
  const candidates = releases.flatMap((release) => {
    if (!release || release.draft === true || release.prerelease !== true) return [];
    const tag = String(release.tag_name || '');
    if (!tag.startsWith('v')) return [];
    const parsed = parseMetaengineDevVersion(tag.slice(1));
    if (!parsed || parsed.core !== current.core || parsed.build <= current.build) return [];
    return [{ release, parsed, tag }];
  });
  candidates.sort((a, b) => b.parsed.build - a.parsed.build);
  return candidates[0] || null;
}

function validateTrustedResponseUrl(response, label, { rawOnly = false } = {}) {
  const value = String(response?.url || '');
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label}_response_url_invalid`);
  const host = url.hostname.toLowerCase();
  if (rawOnly) {
    if (host !== 'raw.githubusercontent.com') throw new Error(`${label}_response_host_invalid`);
    return;
  }
  if (host !== 'github.com' && host !== 'raw.githubusercontent.com' && !host.endsWith('.githubusercontent.com')) {
    throw new Error(`${label}_response_host_invalid`);
  }
}

async function readBoundedBytes(response, maxBytes, label, options = {}) {
  if (!response?.ok) throw new Error(`${label}_http_${Number(response?.status || 0)}`);
  validateTrustedResponseUrl(response, label, options);
  const lengthText = response.headers?.get?.('content-length');
  if (lengthText) {
    const length = Number(lengthText);
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`${label}_too_large`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${label}_too_large`);
  return bytes;
}

async function readBoundedText(response, maxBytes, label, options = {}) {
  const bytes = await readBoundedBytes(response, maxBytes, label, options);
  return bytes.toString('utf8');
}

async function fetchJson(fetchImpl, url, maxBytes, label) {
  const response = await fetchImpl(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  const text = await readBoundedText(response, maxBytes, label);
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}_json_invalid`); }
}

async function fetchVerifiedAssetText(fetchImpl, asset, label) {
  const response = await fetchImpl(asset.url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  const bytes = await readBoundedBytes(response, MAX_SMALL_ASSET_BYTES, label);
  if (sha256Bytes(bytes) !== asset.sha256) throw new Error(`${label}_sha256_mismatch`);
  return bytes.toString('utf8');
}

function verifyManifest(manifest, { version, gitSha, assets }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('trusted_release_manifest_invalid');
  if (manifest.schema !== 'metaengine.browser.self-update-e2e-manifest.v2') throw new Error('trusted_release_manifest_schema_invalid');
  if (String(manifest.version || '') !== version) throw new Error('trusted_release_manifest_version_mismatch');
  if (String(manifest.git_sha || '').toLowerCase() !== gitSha) throw new Error('trusted_release_manifest_git_sha_mismatch');
  if (String(manifest.update_channel || '') !== 'dev' || manifest.development_channel !== true) throw new Error('trusted_release_manifest_channel_invalid');
  if (manifest.production_safe !== false) throw new Error('trusted_release_manifest_production_flag_invalid');
  for (const key of ['physical_n_to_n_plus_1','durable_successor_binding','forced_successor','profile_continuity','single_install_directory','physical_singleton']) {
    if (manifest[key] !== true) throw new Error(`trusted_release_manifest_proof_missing:${key}`);
  }
  if (String(manifest.installer_name || '') !== assets.installer.name) throw new Error('trusted_release_manifest_installer_name_mismatch');
  if (String(manifest.installer_sha256 || '').toLowerCase() !== assets.installer.sha256) throw new Error('trusted_release_manifest_installer_sha256_mismatch');
}

export function parseStrictDevYml(text) {
  const value = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = value.split('\n').filter((line) => line.trim() !== '');
  const version = lines.find((line) => /^version:\s*/.test(line))?.replace(/^version:\s*/, '').trim() || '';
  const path = lines.find((line) => /^path:\s*/.test(line))?.replace(/^path:\s*/, '').trim() || '';
  const topSha512 = lines.find((line) => /^sha512:\s*/.test(line))?.replace(/^sha512:\s*/, '').trim() || '';
  const urlLines = lines.filter((line) => /^\s+- url:\s*/.test(line));
  const nestedShaLines = lines.filter((line) => /^\s+sha512:\s*/.test(line));
  const sizeLines = lines.filter((line) => /^\s+size:\s*/.test(line));
  if (!version || !path || !topSha512 || urlLines.length !== 1 || nestedShaLines.length !== 1 || sizeLines.length !== 1) {
    throw new Error('trusted_release_dev_yml_shape_invalid');
  }
  const fileUrl = urlLines[0].replace(/^\s+- url:\s*/, '').trim();
  const fileSha512 = nestedShaLines[0].replace(/^\s+sha512:\s*/, '').trim();
  const size = Number(sizeLines[0].replace(/^\s+size:\s*/, '').trim());
  if (!SHA512_B64_RE.test(topSha512) || fileSha512 !== topSha512) throw new Error('trusted_release_dev_yml_sha512_invalid');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('trusted_release_dev_yml_size_invalid');
  return { version, path, file_url: fileUrl, sha512: topSha512, size };
}

function strictPublicChannel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('trusted_channel_invalid');
  if (value.schema !== 'metaengine.browser.dev-public-channel.v1') throw new Error('trusted_channel_schema_invalid');
  if (value.authority_effect !== false) throw new Error('trusted_channel_authority_invalid');
  if (value.enabled !== true) return null;
  const expectedKeys = new Set([
    'schema','enabled','version','tag','source_sha','feed_url','installer_name','installer_sha256','installer_size',
    'dev_yml_sha256','manifest_sha256','blockmap_sha256','trusted_e2e_workflow_blob','trusted_shell_workflow_blob','authority_effect',
  ]);
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.has(key)) || keys.length !== expectedKeys.size) throw new Error('trusted_channel_shape_invalid');
  const version = String(value.version || '').trim();
  const parsed = parseMetaengineDevVersion(version);
  if (!parsed) throw new Error('trusted_channel_version_invalid');
  const tag = String(value.tag || '');
  const sourceSha = String(value.source_sha || '').toLowerCase();
  const installerName = String(value.installer_name || '');
  const installerSha256 = String(value.installer_sha256 || '').toLowerCase();
  const installerSize = Number(value.installer_size || 0);
  const devYmlSha256 = String(value.dev_yml_sha256 || '').toLowerCase();
  const manifestSha256 = String(value.manifest_sha256 || '').toLowerCase();
  const blockmapSha256 = String(value.blockmap_sha256 || '').toLowerCase();
  const feedUrl = String(value.feed_url || '');
  const names = expectedAssetNames(version);
  if (tag !== `v${version}`) throw new Error('trusted_channel_tag_invalid');
  if (!SHA1_HEX_RE.test(sourceSha)) throw new Error('trusted_channel_source_sha_invalid');
  if (feedUrl !== `${DOWNLOAD_ROOT}/${tag}/`) throw new Error('trusted_channel_feed_url_invalid');
  if (installerName !== names.installer) throw new Error('trusted_channel_installer_name_invalid');
  if (![installerSha256, devYmlSha256, manifestSha256, blockmapSha256].every((item) => SHA256_HEX_RE.test(item))) {
    throw new Error('trusted_channel_digest_invalid');
  }
  if (!Number.isSafeInteger(installerSize) || installerSize <= 0) throw new Error('trusted_channel_installer_size_invalid');
  if (String(value.trusted_e2e_workflow_blob || '') !== TRUSTED_E2E_WORKFLOW_BLOB) throw new Error('trusted_channel_e2e_blob_invalid');
  if (String(value.trusted_shell_workflow_blob || '') !== TRUSTED_SHELL_WORKFLOW_BLOB) throw new Error('trusted_channel_shell_blob_invalid');
  return {
    parsed,
    version,
    tag,
    source_sha: sourceSha,
    feed_url: feedUrl,
    installer_name: installerName,
    installer_sha256: installerSha256,
    installer_size: installerSize,
    dev_yml_sha256: devYmlSha256,
    manifest_sha256: manifestSha256,
    blockmap_sha256: blockmapSha256,
  };
}

async function fetchRawBytes(fetchImpl, url, maxBytes, label) {
  const response = await fetchImpl(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  return readBoundedBytes(response, maxBytes, label, { rawOnly: true });
}

async function verifyPinnedWorkflowBlobs(fetchImpl, sourceSha) {
  for (const [path, expected, label] of [
    [TRUSTED_E2E_WORKFLOW_PATH, TRUSTED_E2E_WORKFLOW_BLOB, 'trusted_channel_e2e_workflow'],
    [TRUSTED_SHELL_WORKFLOW_PATH, TRUSTED_SHELL_WORKFLOW_BLOB, 'trusted_channel_shell_workflow'],
  ]) {
    const bytes = await fetchRawBytes(fetchImpl, `${RAW_ROOT}/${sourceSha}/${path}`, MAX_WORKFLOW_BYTES, label);
    if (gitBlobSha1(bytes) !== expected) throw new Error(`${label}_blob_mismatch`);
  }
}

export async function resolveTrustedMetaengineDevReleaseFromChannel({
  currentVersion,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('trusted_release_fetch_required');
  const current = parseMetaengineDevVersion(currentVersion);
  if (!current) throw new Error('trusted_release_current_version_invalid');
  const bucket = Math.floor(Number(clock()) / 60_000);
  const channelUrl = `${RAW_ROOT}/${PUBLIC_CHANNEL_BRANCH}/${PUBLIC_CHANNEL_PATH}?v=${bucket}`;
  const channelBytes = await fetchRawBytes(fetchImpl, channelUrl, MAX_CHANNEL_BYTES, 'trusted_channel');
  let channelJson;
  try { channelJson = JSON.parse(channelBytes.toString('utf8')); }
  catch { throw new Error('trusted_channel_json_invalid'); }
  const channel = strictPublicChannel(channelJson);
  if (!channel) return null;
  if (channel.parsed.core !== current.core || channel.parsed.build <= current.build) return null;

  await verifyPinnedWorkflowBlobs(fetchImpl, channel.source_sha);

  const assets = {
    installer: { name: channel.installer_name, sha256: channel.installer_sha256, size: channel.installer_size },
  };
  const manifestUrl = exactDownloadUrl(channel.tag, 'verified-self-update-manifest.json');
  const manifestResponse = await fetchImpl(manifestUrl, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  const manifestBytes = await readBoundedBytes(manifestResponse, MAX_SMALL_ASSET_BYTES, 'trusted_channel_manifest');
  if (sha256Bytes(manifestBytes) !== channel.manifest_sha256) throw new Error('trusted_channel_manifest_sha256_mismatch');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw new Error('trusted_channel_manifest_json_invalid'); }
  verifyManifest(manifest, { version: channel.version, gitSha: channel.source_sha, assets });

  const devYmlUrl = exactDownloadUrl(channel.tag, 'dev.yml');
  const devYmlResponse = await fetchImpl(devYmlUrl, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  const devYmlBytes = await readBoundedBytes(devYmlResponse, MAX_SMALL_ASSET_BYTES, 'trusted_channel_dev_yml');
  if (sha256Bytes(devYmlBytes) !== channel.dev_yml_sha256) throw new Error('trusted_channel_dev_yml_sha256_mismatch');
  const devYml = parseStrictDevYml(devYmlBytes.toString('utf8'));
  if (devYml.version !== channel.version || devYml.path !== channel.installer_name || devYml.file_url !== channel.installer_name) {
    throw new Error('trusted_channel_dev_yml_binding_invalid');
  }
  if (devYml.size !== channel.installer_size) throw new Error('trusted_channel_installer_size_mismatch');

  return {
    schema: 'metaengine.trusted-dev-release.v1',
    version: channel.version,
    tag: channel.tag,
    git_sha: channel.source_sha,
    feed_url: channel.feed_url,
    installer_name: channel.installer_name,
    installer_sha256: channel.installer_sha256,
    installer_sha512: devYml.sha512,
    manifest_sha256: channel.manifest_sha256,
    dev_yml_sha256: channel.dev_yml_sha256,
    discovery_transport: 'RAW_PUBLIC_CHANNEL',
    authority_effect: false,
  };
}

async function resolveTrustedMetaengineDevReleaseFromApi({ currentVersion, fetchImpl }) {
  const current = parseMetaengineDevVersion(currentVersion);
  const releases = await fetchJson(fetchImpl, `${API_ROOT}/releases?per_page=10`, MAX_RELEASES_BYTES, 'trusted_release_list');
  const selected = pickNewestRelease(releases, current.version);
  if (!selected) return null;

  const { release, parsed, tag } = selected;
  if (String(release.name || '') !== `METAENGINE Browser v${parsed.version}`) throw new Error('trusted_release_name_invalid');
  const rawAssets = Array.isArray(release.assets) ? release.assets : [];
  const names = expectedAssetNames(parsed.version);
  if (rawAssets.length !== 4) throw new Error('trusted_release_asset_count_invalid');
  const byName = new Map(rawAssets.map((asset) => [String(asset?.name || ''), normalizeAsset(asset, tag)]));
  if (byName.size !== 4 || Object.values(names).some((name) => !byName.has(name))) throw new Error('trusted_release_asset_set_invalid');
  const assets = {
    metadata: byName.get(names.metadata),
    installer: byName.get(names.installer),
    blockmap: byName.get(names.blockmap),
    manifest: byName.get(names.manifest),
  };

  const tagRef = await fetchJson(fetchImpl, `${API_ROOT}/git/ref/tags/${encodeURIComponent(tag)}`, MAX_SMALL_ASSET_BYTES, 'trusted_release_tag_ref');
  const gitSha = String(tagRef?.object?.sha || '').toLowerCase();
  if (tagRef?.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(gitSha)) throw new Error('trusted_release_tag_target_invalid');

  const manifestText = await fetchVerifiedAssetText(fetchImpl, assets.manifest, 'trusted_release_manifest');
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch { throw new Error('trusted_release_manifest_json_invalid'); }
  verifyManifest(manifest, { version: parsed.version, gitSha, assets });

  const devYmlText = await fetchVerifiedAssetText(fetchImpl, assets.metadata, 'trusted_release_dev_yml');
  const devYml = parseStrictDevYml(devYmlText);
  if (devYml.version !== parsed.version || devYml.path !== assets.installer.name || devYml.file_url !== assets.installer.name) {
    throw new Error('trusted_release_dev_yml_binding_invalid');
  }
  if (devYml.size !== assets.installer.size) throw new Error('trusted_release_dev_yml_installer_size_mismatch');

  return {
    schema: 'metaengine.trusted-dev-release.v1',
    version: parsed.version,
    tag,
    git_sha: gitSha,
    feed_url: `${DOWNLOAD_ROOT}/${tag}/`,
    installer_name: assets.installer.name,
    installer_sha256: assets.installer.sha256,
    installer_sha512: devYml.sha512,
    manifest_sha256: assets.manifest.sha256,
    dev_yml_sha256: assets.metadata.sha256,
    discovery_transport: 'GITHUB_REST_API',
    authority_effect: false,
  };
}

export async function resolveTrustedMetaengineDevRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('trusted_release_fetch_required');
  if (!parseMetaengineDevVersion(currentVersion)) throw new Error('trusted_release_current_version_invalid');
  let channelError = null;
  try {
    return await resolveTrustedMetaengineDevReleaseFromChannel({ currentVersion, fetchImpl, clock });
  } catch (error) {
    channelError = error;
  }
  try {
    return await resolveTrustedMetaengineDevReleaseFromApi({ currentVersion, fetchImpl });
  } catch (apiError) {
    throw new Error(`trusted_release_discovery_failed:channel=${clip(channelError)};api=${clip(apiError)}`);
  }
}
