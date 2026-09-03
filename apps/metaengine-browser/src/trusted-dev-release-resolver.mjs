import crypto from 'node:crypto';

const OWNER = 'PatrickFrome';
const REPO = 'Compute';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DOWNLOAD_ROOT = `https://github.com/${OWNER}/${REPO}/releases/download`;
const DEV_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.1$/;
const SHA256_RE = /^sha256:([0-9a-f]{64})$/;
const SHA512_B64_RE = /^[A-Za-z0-9+/]{86}==$/;
const MAX_RELEASES_BYTES = 2 * 1024 * 1024;
const MAX_SMALL_ASSET_BYTES = 128 * 1024;
// The newest dev releases can push an older immutable baseline (for example the
// 0.6.3-dev line used by the physical self-update E2E) beyond the first listing
// page. Resolution therefore scans a bounded number of newest-first pages and
// stops as soon as the newest same-family candidate is found. Fail-closed: if
// no candidate exists within the window, resolution returns null.
const RELEASES_PAGE_SIZE = 30;
const MAX_RELEASE_PAGES = 10;
// Read-only GET retry for shared-IP anonymous rate limits (GitHub-hosted runner
// IPs are pooled). Only 403/429 responses are retried, with bounded backoff.
const LIST_RETRY_ATTEMPTS = 2;
const LIST_RETRY_DELAYS_MS = [1000, 3000];

function clip(value, max = 300) { return String(value ?? '').slice(0, max); }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

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

function assertReadableResponse(response, maxBytes, label) {
  if (!response?.ok) throw new Error(`${label}_http_${Number(response?.status || 0)}`);
  const lengthText = response.headers?.get?.('content-length');
  if (lengthText) {
    const length = Number(lengthText);
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`${label}_too_large`);
  }
}

async function readBoundedText(response, maxBytes, label) {
  assertReadableResponse(response, maxBytes, label);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`${label}_too_large`);
  return text;
}

async function readBoundedBytes(response, maxBytes, label) {
  assertReadableResponse(response, maxBytes, label);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${label}_too_large`);
  return bytes;
}

function decodeUtf8Strict(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label}_utf8_invalid`);
  }
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

function sleep(ms, label) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t?.unref === 'function') t.unref();
    void label;
  });
}

async function fetchReleaseListPage(fetchImpl, page) {
  const url = page === 1
    ? `${API_ROOT}/releases?per_page=${RELEASES_PAGE_SIZE}`
    : `${API_ROOT}/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`;
  for (let attempt = 0; attempt <= LIST_RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (response && (response.status === 403 || response.status === 429)) {
      if (attempt < LIST_RETRY_ATTEMPTS) {
        await sleep(LIST_RETRY_DELAYS_MS[attempt], 'trusted_release_list_rate_limited');
        continue;
      }
    }
    const text = await readBoundedText(response, MAX_RELEASES_BYTES, 'trusted_release_list');
    try { return JSON.parse(text); }
    catch { throw new Error('trusted_release_list_json_invalid'); }
  }
  throw new Error('trusted_release_list_unreachable');
}

async function fetchVerifiedAssetText(fetchImpl, asset, label) {
  const response = await fetchImpl(asset.url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  const bytes = await readBoundedBytes(response, MAX_SMALL_ASSET_BYTES, label);
  if (sha256Bytes(bytes) !== asset.sha256) throw new Error(`${label}_sha256_mismatch`);
  return decodeUtf8Strict(bytes, label);
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

export async function resolveTrustedMetaengineDevRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('trusted_release_fetch_required');
  const current = parseMetaengineDevVersion(currentVersion);
  if (!current) throw new Error('trusted_release_current_version_invalid');

  let selected = null;
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const releases = await fetchReleaseListPage(fetchImpl, page);
    if (!Array.isArray(releases)) throw new Error('trusted_release_list_invalid');
    const candidate = pickNewestRelease(releases, current.version);
    if (candidate) { selected = candidate; break; }
    // Releases are listed newest-first: an empty or short page means the
    // listing is exhausted, so scanning deeper cannot find a newer candidate.
    if (releases.length < RELEASES_PAGE_SIZE) break;
  }
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
    authority_effect: false,
  };
}
