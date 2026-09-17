'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const DEVOS_REPO_FILE_READ_SCHEMA = 'metaengine.development-plane.repo-file-read.v1';
const DEVOS_REPO_FILE_SAVE_SCHEMA = 'metaengine.development-plane.repo-file-save.v1';
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function zeroAuthority() {
  return {
    scheduler_authority: false,
    browser_actuation_authority: false,
    page_model_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function exactSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('devos_repo_file_source_invalid');
  const repository = String(source.repository || '').trim();
  const head = String(source.head || '').toLowerCase();
  const ref = source.ref == null ? null : String(source.ref).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('devos_repo_file_repository_invalid');
  if (!SOURCE_SHA_RE.test(head)) throw new Error('devos_repo_file_head_invalid');
  if (ref != null && (!ref || ref.length > 400 || /[\u0000-\u001f\u007f]/.test(ref))) throw new Error('devos_repo_file_ref_invalid');
  return Object.freeze({ repository, head, ref });
}

function sourceMatches(expected, actual) {
  return expected.repository === actual.repository
    && expected.head === actual.head
    && expected.ref === actual.ref;
}

function normalizeRelativePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 4096 || raw.includes('\0') || raw.includes('\\')) throw new Error('devos_repo_file_path_invalid');
  if (path.posix.isAbsolute(raw) || raw.startsWith('/')) throw new Error('devos_repo_file_path_absolute');
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('devos_repo_file_path_escape');
  }
  if (normalized === '.git' || normalized.startsWith('.git/')) throw new Error('devos_repo_file_path_reserved');
  if (normalized === '.metaengine-source-provenance.json') throw new Error('devos_repo_file_path_reserved');
  return normalized;
}

function digest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function assertContained(root, candidate) {
  const rel = path.relative(root, candidate);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('devos_repo_file_path_escape');
  }
}

async function resolveExistingFile(repoRoot, relativePath) {
  const root = await fs.realpath(path.resolve(String(repoRoot || '')));
  const parts = relativePath.split('/');
  let cursor = root;
  for (const segment of parts) {
    cursor = path.join(cursor, segment);
    const entry = await fs.lstat(cursor);
    if (entry.isSymbolicLink()) throw new Error('devos_repo_file_symlink_denied');
  }
  const stat = await fs.stat(cursor);
  if (!stat.isFile()) throw new Error('devos_repo_file_not_regular');
  if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error('devos_repo_file_too_large');
  const real = await fs.realpath(cursor);
  assertContained(root, real);
  return Object.freeze({ root, absolute: cursor, real, stat });
}

function workspaceFingerprint(root, source) {
  return `sha256:${crypto.createHash('sha256').update(`${source.repository}\n${root}`).digest('hex')}`;
}

function decodeUtf8(bytes) {
  try { return UTF8.decode(bytes); }
  catch { throw new Error('devos_repo_file_not_utf8'); }
}

async function readDevOSRepoTextFile({ repoRoot, source, payload } = {}) {
  const exact = exactSource(source);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('devos_repo_file_read_payload_invalid');
  const relativePath = normalizeRelativePath(payload.relative_path);
  const file = await resolveExistingFile(repoRoot, relativePath);
  const bytes = await fs.readFile(file.absolute);
  if (bytes.length > MAX_TEXT_FILE_BYTES) throw new Error('devos_repo_file_too_large');
  const text = decodeUtf8(bytes);
  return Object.freeze({
    schema: DEVOS_REPO_FILE_READ_SCHEMA,
    source: exact,
    workspace_fingerprint_sha256: workspaceFingerprint(file.root, exact),
    relative_path: relativePath,
    file_sha256: digest(bytes),
    bytes: bytes.length,
    text,
    text_encoding: 'utf-8',
    existing_file_only: true,
    symlink_components_allowed: false,
    repository_effect: false,
    ...zeroAuthority(),
  });
}

async function saveDevOSRepoTextFile({
  repoRoot,
  currentSource,
  payload,
  readCurrentSource = null,
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('devos_repo_file_save_payload_invalid');
  const expectedSource = exactSource(payload.source);
  const observedSource = exactSource(currentSource);
  if (!sourceMatches(expectedSource, observedSource)) throw new Error('devos_repo_file_source_stale');

  const relativePath = normalizeRelativePath(payload.relative_path);
  const expectedFileSha = String(payload.expected_file_sha256 || '').toLowerCase();
  if (!SHA256_RE.test(expectedFileSha)) throw new Error('devos_repo_file_expected_sha256_invalid');
  if (typeof payload.text !== 'string') throw new Error('devos_repo_file_text_invalid');
  const replacement = Buffer.from(payload.text, 'utf8');
  if (replacement.length > MAX_TEXT_FILE_BYTES) throw new Error('devos_repo_file_save_too_large');

  let file = await resolveExistingFile(repoRoot, relativePath);
  const expectedWorkspace = workspaceFingerprint(file.root, expectedSource);
  if (String(payload.workspace_fingerprint_sha256 || '').toLowerCase() !== expectedWorkspace) {
    throw new Error('devos_repo_file_workspace_mismatch');
  }

  const before = await fs.readFile(file.absolute);
  decodeUtf8(before);
  const beforeSha = digest(before);
  if (beforeSha !== expectedFileSha) throw new Error('devos_repo_file_digest_mismatch');
  const replacementSha = digest(replacement);

  if (replacementSha === beforeSha) {
    return Object.freeze({
      schema: DEVOS_REPO_FILE_SAVE_SCHEMA,
      state: 'NO_CHANGE',
      source: expectedSource,
      workspace_fingerprint_sha256: expectedWorkspace,
      relative_path: relativePath,
      previous_file_sha256: beforeSha,
      file_sha256: beforeSha,
      bytes: replacement.length,
      repository_effect: false,
      readback_verified: true,
      ...zeroAuthority(),
    });
  }

  if (readCurrentSource != null) {
    if (typeof readCurrentSource !== 'function') throw new Error('devos_repo_file_source_reader_invalid');
    const precommitSource = exactSource(await readCurrentSource());
    if (!sourceMatches(expectedSource, precommitSource)) throw new Error('devos_repo_file_source_changed_before_commit');
  }

  file = await resolveExistingFile(repoRoot, relativePath);
  const precommit = await fs.readFile(file.absolute);
  decodeUtf8(precommit);
  if (digest(precommit) !== expectedFileSha) throw new Error('devos_repo_file_changed_before_commit');

  const tempName = `.metaengine-save-${crypto.randomUUID()}.tmp`;
  const tempPath = path.join(path.dirname(file.absolute), tempName);
  let handle = null;
  let renamed = false;
  try {
    const mode = Number(file.stat.mode || 0) & 0o777;
    handle = await fs.open(tempPath, 'wx', mode || 0o600);
    await handle.writeFile(replacement);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, file.absolute);
    renamed = true;

    const after = await fs.readFile(file.absolute);
    decodeUtf8(after);
    const afterSha = digest(after);
    if (afterSha !== replacementSha) throw new Error('devos_repo_file_save_postcondition_ambiguous');
    return Object.freeze({
      schema: DEVOS_REPO_FILE_SAVE_SCHEMA,
      state: 'VERIFIED',
      source: expectedSource,
      workspace_fingerprint_sha256: expectedWorkspace,
      relative_path: relativePath,
      previous_file_sha256: beforeSha,
      file_sha256: afterSha,
      bytes: after.length,
      repository_effect: true,
      readback_verified: true,
      ...zeroAuthority(),
    });
  } finally {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    if (!renamed) {
      try { await fs.unlink(tempPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = Object.freeze({
  DEVOS_REPO_FILE_READ_SCHEMA,
  DEVOS_REPO_FILE_SAVE_SCHEMA,
  MAX_TEXT_FILE_BYTES,
  readDevOSRepoTextFile,
  saveDevOSRepoTextFile,
});
