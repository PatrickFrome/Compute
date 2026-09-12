import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;

function exactRelease(release) {
  if (!release || release.schema !== 'metaengine.trusted-dev-release.v1') throw new Error('guardian_intake_trusted_release_required');
  const version = String(release.version || '');
  const tag = String(release.tag || '');
  const installerName = String(release.installer_name || '');
  const installerSha = String(release.installer_sha256 || '').toLowerCase();
  const manifestSha = String(release.manifest_sha256 || '').toLowerCase();
  const installedSha = String(release.installed_executable_sha256 || '').toLowerCase();
  const feedUrl = String(release.feed_url || '');
  if (!DEV_VERSION.test(version) || tag !== `v${version}`) throw new Error('guardian_intake_release_version_invalid');
  if (installerName !== `METAENGINE-Browser-Test-Setup-${version}-x64.exe`) throw new Error('guardian_intake_installer_name_invalid');
  if (!HEX64.test(installerSha) || !HEX64.test(manifestSha) || !HEX64.test(installedSha)) throw new Error('guardian_intake_release_digest_invalid');
  const exactFeed = `https://github.com/PatrickFrome/Compute/releases/download/${tag}/`;
  if (feedUrl !== exactFeed) throw new Error('guardian_intake_feed_url_invalid');
  return Object.freeze({ version, tag, installerName, installerSha, manifestSha, installedSha, feedUrl });
}

function intakeRoot(localAppData, installerSha) {
  const root = path.resolve(String(localAppData || ''));
  if (!root || !path.isAbsolute(root)) throw new Error('guardian_intake_localappdata_invalid');
  return path.join(root, 'METAENGINE', 'Guardian', 'update-intake-v1', installerSha);
}

async function hashFile(filePath, maxBytes) {
  const file = await fs.open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('guardian_intake_file_size_invalid');
    const hash = crypto.createHash('sha256');
    const stream = file.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk);
    return { sha256: hash.digest('hex'), size: stat.size };
  } finally {
    await file.close().catch(() => {});
  }
}

async function existingExact(filePath, expectedSha, maxBytes) {
  try {
    const observed = await hashFile(filePath, maxBytes);
    return observed.sha256 === expectedSha ? observed : null;
  } catch {
    return null;
  }
}

async function downloadExact({ fetchImpl, url, finalPath, expectedSha, maxBytes, label }) {
  const existing = await existingExact(finalPath, expectedSha, maxBytes);
  if (existing) return { ...existing, reused: true };

  const response = await fetchImpl(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  if (!response?.ok || !response.body) throw new Error(`${label}_http_${Number(response?.status || 0)}`);
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`${label}_too_large`);

  const temporary = `${finalPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const file = await fs.open(temporary, 'wx', 0o600);
  let total = 0;
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      total += chunk.length;
      if (total > maxBytes) throw new Error(`${label}_too_large`);
      hash.update(chunk);
      await file.write(chunk);
    }
    if (total <= 0) throw new Error(`${label}_empty`);
    await file.sync();
  } catch (error) {
    await file.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await file.close();
  const digest = hash.digest('hex');
  if (digest !== expectedSha) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw new Error(`${label}_sha256_mismatch`);
  }
  try {
    await fs.rename(temporary, finalPath);
  } catch (error) {
    const raced = await existingExact(finalPath, expectedSha, maxBytes);
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (!raced) throw error;
    return { ...raced, reused: true };
  }
  const readback = await existingExact(finalPath, expectedSha, maxBytes);
  if (!readback) throw new Error(`${label}_durable_readback_mismatch`);
  return { ...readback, reused: false };
}

export async function stageGuardianUpdateIntake({
  release,
  localAppData = process.env.LOCALAPPDATA,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (process.platform !== 'win32') throw new Error('guardian_intake_windows_required');
  if (typeof fetchImpl !== 'function') throw new Error('guardian_intake_fetch_required');
  const exact = exactRelease(release);
  const root = intakeRoot(localAppData, exact.installerSha);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const installerPath = path.join(root, 'METAENGINEBrowserUpdateCandidate.exe');
  const manifestPath = path.join(root, 'verified-self-update-manifest.json');
  const installer = await downloadExact({
    fetchImpl,
    url: `${exact.feedUrl}${exact.installerName}`,
    finalPath: installerPath,
    expectedSha: exact.installerSha,
    maxBytes: MAX_INSTALLER_BYTES,
    label: 'guardian_intake_installer',
  });
  const manifest = await downloadExact({
    fetchImpl,
    url: `${exact.feedUrl}verified-self-update-manifest.json`,
    finalPath: manifestPath,
    expectedSha: exact.manifestSha,
    maxBytes: MAX_MANIFEST_BYTES,
    label: 'guardian_intake_manifest',
  });
  return Object.freeze({
    schema: 'metaengine.browser-guardian.update-intake.v1',
    release_version: exact.version,
    installer_sha256: installer.sha256,
    manifest_sha256: manifest.sha256,
    installed_executable_sha256: exact.installedSha,
    installer_size: installer.size,
    manifest_size: manifest.size,
    fixed_intake_layout: true,
    caller_supplied_path_used: false,
    caller_supplied_url_used: false,
    authority_effect: false,
  });
}
