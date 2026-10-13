// W11: release-identity comparison is observation only. Callers must obtain
// independent trusted witnesses; JSON equality cannot authenticate a signer,
// a Git checkout, installed bytes, or the executable currently in memory.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const RELEASE_IDENTITY_SCHEMA = 'metaengine.release-evidence-identity.v1';
const GIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OWNER_ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const INCARNATION = /^[a-zA-Z0-9_.:-]{1,128}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_SKEW_MS = 5000;
const DEFAULT_MAX_AGE_MS = 30000;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const required = Object.freeze({
  expected: ['git_sha', 'owner_id', 'process_incarnation', 'observed_at'],
  source: ['git_sha', 'observed_at'],
  build: ['source_sha', 'artifact_sha256', 'observed_at'],
  package: ['source_sha', 'artifact_sha256', 'observed_at'],
  runtime: ['source_sha', 'artifact_sha256', 'owner_id', 'process_incarnation', 'observed_at'],
  owner: ['owner_id', 'process_incarnation', 'observed_at'],
  artifact: ['sha256', 'observed_at'],
});

const shape = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isoTime = value => typeof value === 'string' && ISO_UTC.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const valid = (key, value) => key === 'observed_at' ? isoTime(value)
  : (key === 'git_sha' || key === 'source_sha') ? typeof value === 'string' && GIT_SHA.test(value)
  : (key === 'sha256' || key === 'artifact_sha256') ? typeof value === 'string' && SHA256.test(value)
  : key === 'owner_id' ? typeof value === 'string' && OWNER_ID.test(value)
  : key === 'process_incarnation' ? typeof value === 'string' && INCARNATION.test(value)
  : false;

const result = (state, reasons) => Object.freeze({
  schema: RELEASE_IDENTITY_SCHEMA, state, reasons: Object.freeze([...new Set(reasons)].sort()),
  proof: state === 'MATCH' ? 'STRUCTURAL_AND_ARTIFACT_DIGEST_CONSISTENCY_ONLY' : 'NONE',
  release_ready: false, installed_runtime_proven: false, process_code_attested: false,
  authority_effect: false, scheduler_authority: false, automatic_retry_allowed: false,
  remote_fallback_allowed: false,
});

/**
 * Fail closed on contradictory, malformed or stale witnesses. Incomplete but
 * otherwise non-conflicting witnesses remain UNKNOWN. All observed_at fields
 * describe one comparison snapshot (NOT build completion times).
 * No raw evidence, credentials, paths or untrusted strings are returned.
 */
export function verifyReleaseEvidenceIdentity(witnesses = {}, { nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1000 || maxAgeMs > 86_400_000) return result('BLOCKED', ['VERIFIER_POLICY_INVALID']);
  const missing = [];
  const blocked = [];
  if (!shape(witnesses)) return result('BLOCKED', ['WITNESSES_INVALID']);
  const observations = {};
  // Accessors/proxies from another producer must not crash the observer or
  // smuggle attacker-controlled fields into the response.
  try {
    for (const [label, fields] of Object.entries(required)) {
      const entry = witnesses[label];
      if (entry === undefined || entry === null) { missing.push('MISSING_' + label.toUpperCase()); continue; }
      if (!shape(entry)) { blocked.push('INVALID_' + label.toUpperCase()); continue; }
      observations[label] = {};
      for (const key of fields) {
        const value = entry[key];
        if (value === undefined || value === null || value === '') missing.push('MISSING_' + label.toUpperCase() + '_' + key.toUpperCase());
        else if (!valid(key, value)) blocked.push('INVALID_' + label.toUpperCase() + '_' + key.toUpperCase());
        else observations[label][key] = value;
      }
    }
    // Compare present independent witnesses even when the expected anchor is
    // missing. A missing anchor never hides an already observable conflict.
    const sources = [observations.expected?.git_sha, observations.source?.git_sha,
      observations.build?.source_sha, observations.package?.source_sha,
      observations.runtime?.source_sha].filter(Boolean);
    if (new Set(sources).size > 1) blocked.push('SOURCE_GIT_SHA_MISMATCH');
    for (const field of ['owner_id', 'process_incarnation']) {
      const values = [observations.expected?.[field], observations.owner?.[field],
        observations.runtime?.[field]].filter(Boolean);
      if (new Set(values).size > 1) blocked.push(field === 'owner_id' ? 'OWNER_ID_MISMATCH' : 'OWNER_INCARNATION_MISMATCH');
    }
    const observedTimes = Object.values(observations).map(x => x.observed_at).filter(Boolean);
    if (new Set(observedTimes).size > 1) blocked.push('OBSERVED_AT_MISMATCH');
    for (const value of observedTimes) {
      const observedMs = Date.parse(value);
      if (observedMs > nowMs + MAX_SKEW_MS || nowMs - observedMs > maxAgeMs)
        blocked.push('OBSERVATION_OUTSIDE_FRESHNESS_WINDOW');
    }
    const digestValues = [observations.build?.artifact_sha256, observations.package?.artifact_sha256,
      observations.runtime?.artifact_sha256, observations.artifact?.sha256].filter(Boolean);
    if (new Set(digestValues).size > 1) blocked.push('ARTIFACT_DIGEST_MISMATCH');
  } catch {
    return result('BLOCKED', ['WITNESS_ACCESS_FAILED']);
  }
  if (blocked.length) return result('BLOCKED', blocked);
  if (missing.length) return result('UNKNOWN', missing);
  return result('MATCH', []);
}

// Hash only an explicit regular local file, never execute it. File metadata is
// checked both via the open handle and path to fence replacement during read.
export async function hashRegularReleaseArtifact(filePath) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new Error('ARTIFACT_PATH_INVALID');
  const path = resolve(filePath);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_ARTIFACT_BYTES)
    throw new Error('ARTIFACT_NOT_REGULAR_OR_OVERSIZE');
  // Windows realpath may rewrite drive/8.3 names even for an ordinary file;
  // use open-handle + path inode fences there instead of string equality.
  if (process.platform !== 'win32' && (await realpath(path)) !== path) throw new Error('ARTIFACT_PATH_ALIAS');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !same(before, opened)) throw new Error('ARTIFACT_CHANGED_DURING_READ');
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > MAX_ARTIFACT_BYTES) throw new Error('ARTIFACT_TOO_LARGE');
      digest.update(chunk);
    }
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (bytes !== opened.size || !same(opened, after) || !same(after, pathAfter) || pathAfter.isSymbolicLink())
      throw new Error('ARTIFACT_CHANGED_DURING_READ');
    return digest.digest('hex');
  } finally { await handle.close(); }
}

/** An optional local-file adapter; unlike the pure reducer it hashes bytes. */
export async function verifyReleaseEvidenceFile({ artifactPath, witnesses } = {}, policy) {
  if (artifactPath === undefined || artifactPath === null) return result('UNKNOWN', ['MISSING_ARTIFACT_PATH']);
  try {
    const sha256 = await hashRegularReleaseArtifact(artifactPath);
    // Never overwrite the independently supplied package/artifact witness.
    // The byte digest must ALSO agree with it, not silently replace it.
    if (witnesses?.artifact?.sha256 && witnesses.artifact.sha256 !== sha256)
      return result('BLOCKED', ['ARTIFACT_DIGEST_MISMATCH']);
    return verifyReleaseEvidenceIdentity(witnesses, policy);
  } catch { return result('BLOCKED', ['ARTIFACT_READBACK_FAILED']); }
}
