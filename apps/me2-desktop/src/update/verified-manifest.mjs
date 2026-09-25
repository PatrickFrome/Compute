/**
 * Verified update manifest — ME2 Desktop's own schema (me2.desktop-update-manifest.v1).
 * Zero-trust: every file entry must carry a sha256; the manifest itself must be
 * internally consistent before the updater will ever touch the network for bytes.
 */
import { createHash } from 'node:crypto';
import { UPDATE } from '../shared/me2-constants.mjs';

export const MANIFEST_SCHEMA = UPDATE.MANIFEST_SCHEMA;

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Validate the manifest shape (pure). Returns {ok, manifest|reason}. */
export function verifyManifest(raw) {
  let m;
  try {
    m = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, reason: 'manifest_not_json' };
  }
  if (!m || m.schema !== MANIFEST_SCHEMA) return { ok: false, reason: 'schema_mismatch', seen: m?.schema ?? null };
  if (typeof m.version !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(m.version)) {
    return { ok: false, reason: 'version_invalid', seen: m?.version ?? null };
  }
  if (!Array.isArray(m.files) || m.files.length === 0) return { ok: false, reason: 'files_missing' };
  const names = new Set();
  for (const f of m.files) {
    if (!f || typeof f.name !== 'string' || typeof f.url !== 'string') return { ok: false, reason: 'file_entry_invalid' };
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.name) || names.has(f.name.toLowerCase())) return { ok: false, reason: 'file_name_invalid' };
    names.add(f.name.toLowerCase());
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
      return { ok: false, reason: 'file_sha256_invalid', file: f.name ?? null };
    }
    if (!Number.isFinite(f.size) || f.size <= 0) return { ok: false, reason: 'file_size_invalid', file: f.name ?? null };
  }
  if (typeof m.min_previous_version === 'string' && !/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(m.min_previous_version)) {
    return { ok: false, reason: 'min_previous_version_invalid' };
  }
  return { ok: true, manifest: m };
}

/** Semver-ish compare for the dev line (v0.8.0-dev.<run>.1): numeric tuple compare. */
export function compareVersions(a, b) {
  const norm = (s) => s.replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const [pa, pb] = [norm(a), norm(b)];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const xa = pa[i];
    const xb = pb[i];
    if (xa === xb) continue;
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    if (typeof xa === 'number' && typeof xb === 'number') return xa < xb ? -1 : 1;
    return String(xa) < String(xb) ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether an update should be taken (pure).
 * forceExactSha: when the manifest pins source_sha and the running build reports
 * its own source sha, an identical pair means "this exact build is already live" —
 * skip even if a naive re-publish bumped only the run id.
 */
export function shouldTakeUpdate({ current, candidate, minPrevious, sourceSha, runningSourceSha } = {}) {
  if (sourceSha && runningSourceSha && String(sourceSha).toLowerCase() === String(runningSourceSha).toLowerCase()) {
    return { take: false, reason: 'exact_sha_match' };
  }
  if (minPrevious && compareVersions(current, minPrevious) < 0) {
    return { take: false, reason: 'current_below_min_previous' };
  }
  const cmp = compareVersions(current, candidate);
  if (cmp >= 0) return { take: false, reason: cmp === 0 ? 'same_version' : 'candidate_older' };
  return { take: true };
}

/** Verify downloaded bytes against the manifest entry (pure-ish, streaming caller hashes). */
export function verifyFileEntry(entry, actualSha256, actualSize) {
  if (entry.sha256 !== actualSha256) return { ok: false, reason: 'sha256_mismatch', file: entry.name };
  if (actualSize !== entry.size) return { ok: false, reason: 'size_mismatch', file: entry.name };
  return { ok: true };
}
