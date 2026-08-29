import { createHash } from 'node:crypto';
import { compileSkillDocument } from './skill-manifest-v1.mjs';

const PACKAGE_SCHEMA = 'metaengine.a2-browser-operator.skill-package-identity.v1';
const MAX_RESOURCE_FILES = 64;
const MAX_PACKAGE_FILES = MAX_RESOURCE_FILES + 1;
const MAX_PACKAGE_BYTES = (2 * 1024 * 1024) + (96 * 1024);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILENAME = 128;
const RESOURCE_DIRS = new Set(['references', 'assets', 'scripts']);

function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateSkillName(value) {
  const name = String(value || '');
  if (!name || name.length > 64 || !/^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('skill_package_name_invalid');
  return name;
}

function snapshotFiles(files) {
  if (!Array.isArray(files)) throw new Error('skill_package_files_invalid');
  const length = files.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PACKAGE_FILES) throw new Error('skill_package_file_count_invalid');
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) snapshot[index] = files[index];
  return Object.freeze(snapshot);
}

function snapshotFileSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('skill_package_file_invalid');
  const rawPath = source.path;
  const rawType = source.type;
  const rawExecutable = source.executable;
  const rawBytes = source.bytes;
  return Object.freeze({ rawPath, rawType, rawExecutable, rawBytes });
}

function validateRelativePath(rawPath) {
  const path = String(rawPath || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) throw new Error('skill_package_path_invalid');
  if (path === 'SKILL.md') return path;
  const parts = path.split('/');
  if (parts.length !== 2 || !RESOURCE_DIRS.has(parts[0])) throw new Error('skill_package_path_invalid');
  const filename = parts[1];
  if (!filename || filename.length > MAX_FILENAME || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename.includes('..')) {
    throw new Error('skill_package_filename_invalid');
  }
  return path;
}

function copyBytes(rawBytes) {
  if (!(rawBytes instanceof Uint8Array)) throw new Error('skill_package_bytes_invalid');
  const bytes = Buffer.from(rawBytes);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('skill_package_file_too_large');
  return bytes;
}

function normalizeFile(source) {
  const { rawPath, rawType, rawExecutable, rawBytes } = snapshotFileSource(source);
  if (rawType !== 'file') throw new Error('skill_package_file_type_invalid');
  if (typeof rawExecutable !== 'boolean') throw new Error('skill_package_executable_state_missing');
  const path = validateRelativePath(rawPath);
  const bytes = copyBytes(rawBytes);
  return Object.freeze({
    path,
    executable: rawExecutable,
    bytes,
    byte_length: bytes.length,
    raw_sha256: sha256(bytes)
  });
}

function normalizePackageFiles(files) {
  const sourceSnapshot = snapshotFiles(files);
  const seen = new Set();
  let totalBytes = 0;
  let skillFile = null;
  let resourceCount = 0;
  const normalized = new Array(sourceSnapshot.length);
  for (let index = 0; index < sourceSnapshot.length; index += 1) {
    const file = normalizeFile(sourceSnapshot[index]);
    if (seen.has(file.path)) throw new Error('skill_package_path_duplicate');
    seen.add(file.path);
    if (file.path === 'SKILL.md') {
      if (skillFile) throw new Error('skill_package_skill_file_duplicate');
      skillFile = file;
    } else {
      resourceCount += 1;
      if (resourceCount > MAX_RESOURCE_FILES) throw new Error('skill_package_resources_too_many');
    }
    totalBytes += file.byte_length;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('skill_package_too_large');
    normalized[index] = file;
  }
  if (!skillFile) throw new Error('skill_package_skill_file_missing');
  return Object.freeze({ files: Object.freeze(normalized), skillFile, resourceCount, totalBytes });
}

function decodeSkillFile(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('skill_package_skill_utf8_invalid');
  }
}

function manifestFiles(normalizedFiles) {
  return normalizedFiles.map((file) => Object.freeze({
    relative_path: file.path,
    raw_sha256: file.raw_sha256,
    raw_bytes: file.byte_length,
    source_executable_bit: file.executable,
    content_embedded: false,
    execution_eligible: false
  })).sort((a, b) => codeUnitCompare(a.relative_path, b.relative_path));
}

export function compileSkillPackageIdentity(skillNameInput, files) {
  const skillName = validateSkillName(skillNameInput);
  const normalized = normalizePackageFiles(files);
  const skillText = decodeSkillFile(normalized.skillFile.bytes);
  const semanticDocument = compileSkillDocument({ path: `${skillName}/SKILL.md`, content: skillText });
  const fileManifest = manifestFiles(normalized.files);
  const packageMaterial = JSON.stringify({
    format: 'a2-skill-package-directory-v1',
    skill_name: skillName,
    files: fileManifest
  });
  const packageManifestDigest = `sha256:${sha256(packageMaterial)}`;
  return Object.freeze({
    schema: PACKAGE_SCHEMA,
    skill_name: skillName,
    semantic_skill_fingerprint: semanticDocument.skill_fingerprint,
    package_manifest_digest: packageManifestDigest,
    file_count: fileManifest.length,
    resource_count: normalized.resourceCount,
    total_raw_bytes: normalized.totalBytes,
    exact_raw_file_digests: true,
    semantic_and_raw_identity_separate: true,
    source_snapshot_once: true,
    raw_bytes_copied_before_hash: true,
    signature_verified: false,
    provenance_verified: false,
    trust_state: 'CONTENT_IDENTITY_ONLY',
    content_embedded: false,
    scripts_inert: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false,
    files: Object.freeze(fileManifest)
  });
}

export function revalidateSkillPackageIdentity(skillName, files, {
  expectedPackageManifestDigest,
  expectedSemanticSkillFingerprint
} = {}) {
  const identity = compileSkillPackageIdentity(skillName, files);
  if (typeof expectedPackageManifestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(expectedPackageManifestDigest)) {
    throw new Error('skill_package_expected_digest_invalid');
  }
  if (identity.package_manifest_digest !== expectedPackageManifestDigest) throw new Error('skill_package_digest_stale');
  if (expectedSemanticSkillFingerprint != null && identity.semantic_skill_fingerprint !== expectedSemanticSkillFingerprint) {
    throw new Error('skill_package_semantic_fingerprint_stale');
  }
  return identity;
}

export const SKILL_PACKAGE_LIMITS = Object.freeze({
  maxResourceFiles: MAX_RESOURCE_FILES,
  maxPackageFiles: MAX_PACKAGE_FILES,
  maxPackageBytes: MAX_PACKAGE_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
  maxFilename: MAX_FILENAME
});
