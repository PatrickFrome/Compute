// Shared, source-trusted contract for the producer's separate forward sidecar.
// A valid manifest is not an installer qualification: consumers must also run
// the existing installer verifier and validate the original terminal producer.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureInstalledTreeFingerprint, INSTALLED_TREE_SCHEMA}
  from './qa-installed-tree-fingerprint.mjs';

export const FORWARD_SIDECAR_SCHEMA = 'metaengine.browser.forward-install-sidecar.v1';
export const FORWARD_UNINSTALLER = 'Uninstall METAENGINE Browser Test.exe';
export const FORWARD_SIDECAR_LIMITS = Object.freeze({
  maxFiles: 25000,
  maxEntries: 50000,
  maxBytes: 12 * 1024 ** 3,
  maxDepth: 40,
  maxFileBytes: 4 * 1024 ** 3,
  maxManifestBytes: 32 * 1024 ** 2,
  maxArchiveBytes: 13 * 1024 ** 3,
});
const REPOSITORY = 'PatrickFrome/Compute';
const WORKFLOW = '.github/workflows/browser-windows-package-smoke.yml';
const SHA = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const VERSION = /^0\.7\.0-dev\.[0-9]+\.1$/;
const EVENTS = new Set(['push', 'pull_request', 'workflow_dispatch']);
const fail = code => { throw new Error('qa_forward_sidecar_' + code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isSha = value => typeof value === 'string' && SHA.test(value);
const positive = n => Number.isSafeInteger(n) && n > 0;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function keys(value, required, optional = []) {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k))
    || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('object_shape_invalid');
}
function id(value, strictString = false) {
  if (!strictString && positive(value)) return String(value);
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) fail('identifier_invalid');
  return value;
}
function limits(input = {}) {
  if (!object(input)) fail('limits_invalid');
  const result = {...FORWARD_SIDECAR_LIMITS};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(result, key) || !positive(value) || value > result[key]) fail('limits_invalid');
    result[key] = value;
  }
  return result;
}

// Validate for Windows even when the source checks run on Linux. No decoding,
// path normalization or silent case folding can turn an unsafe name into a pin.
export function validateForwardRelativePath(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 1024
    || name !== name.normalize('NFC') || /[\uD800-\uDFFF]/u.test(name)
    || /[\\\x00-\x1f\x7f<>:"|?*]/.test(name)) fail('path_invalid');
  const parts = name.split('/');
  if (parts.length > FORWARD_SIDECAR_LIMITS.maxDepth) fail('path_depth_limit');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)
      || Buffer.byteLength(part) > 255
      || /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)
      || /^[^.]{1,6}~[1-9][0-9]*(?:\.|$)/i.test(part)) fail('path_invalid');
  }
  return name;
}

// Windows case aliases include pairs that do not share a lowercase spelling
// (S/long-s, sigma/final-sigma). Uppercase + NFC is deliberately conservative:
// Unicode expansion aliases also reject. Digest rows keep their original names.
export function forwardPathCollisionKey(name) {
  if (typeof name !== 'string') fail('path_invalid');
  return name.toUpperCase().normalize('NFC');
}

export function digestForwardInventory(files) {
  return sha(JSON.stringify({schema: INSTALLED_TREE_SCHEMA, files}));
}

export function validateForwardInventory(files, suppliedLimits = {}) {
  const bounds = limits(suppliedLimits);
  if (!Array.isArray(files) || !files.length || files.length > bounds.maxEntries) fail('inventory_entry_limit');
  const seen = new Map(), folded = new Set();
  let previous = null, count = 0, bytes = 0;
  for (const row of files) {
    if (!Array.isArray(row) || ![2, 3].includes(row.length)) fail('inventory_row_invalid');
    const relative = validateForwardRelativePath(row[0]);
    if (relative.split('/').length > bounds.maxDepth) fail('inventory_depth_limit');
    if (previous !== null && previous >= relative) fail('inventory_order_or_duplicate');
    previous = relative;
    const foldedPath = forwardPathCollisionKey(relative);
    if (folded.has(foldedPath)) fail('inventory_case_collision');
    folded.add(foldedPath);
    const parent = relative.slice(0, relative.lastIndexOf('/'));
    if (relative.includes('/') && seen.get(parent) !== 'DIRECTORY') fail('inventory_parent_invalid');
    if (row.length === 2) {
      if (row[1] !== 'DIRECTORY') fail('inventory_row_invalid');
      seen.set(relative, 'DIRECTORY');
    } else {
      if (!Number.isSafeInteger(row[1]) || row[1] < 0 || row[1] > bounds.maxFileBytes || !isSha(row[2])) fail('inventory_file_invalid');
      count++;
      bytes += row[1];
      if (count > bounds.maxFiles || !Number.isSafeInteger(bytes) || bytes > bounds.maxBytes) fail('inventory_size_limit');
      seen.set(relative, 'FILE');
    }
  }
  if (!count) fail('inventory_empty');
  return Object.freeze({tree_sha256: digestForwardInventory(files), file_count: count, total_bytes: bytes});
}

const identity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const unchanged = (a, b) => identity(a, b) && a.size === b.size && a.nlink === b.nlink
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function regular(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino <= 0n) fail('regular_file_required');
}
function directory(info) {
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino <= 0n) fail('physical_directory_required');
}
async function ancestorCustody(absolute) {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute) || absolute.startsWith('\\\\')) fail('absolute_local_path_required');
  const resolved = path.resolve(absolute), root = path.parse(resolved).root, held = [];
  let current = root;
  for (const part of ['', ...path.relative(root, resolved).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const before = await fs.lstat(current, {bigint: true});
    directory(before);
    const real = await fs.realpath(current), actual = await fs.lstat(real, {bigint: true});
    directory(actual);
    if (!identity(before, actual)) fail('ancestor_alias');
    held.push({file: current, info: before});
  }
  return held;
}
async function recheckAncestors(held) {
  for (const {file, info} of held) {
    const actual = await fs.lstat(file, {bigint: true});
    directory(actual);
    if (!identity(info, actual)) fail('ancestor_changed');
  }
}
async function stableFileHash(file, before, maxBytes) {
  regular(before);
  if (before.size < 0n || before.size > BigInt(maxBytes)) fail('file_size_limit');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({bigint: true});
    regular(opened);
    if (!unchanged(before, opened)) fail('file_changed');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024);
    let consumed = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      consumed += bytesRead;
      if (consumed > maxBytes || BigInt(consumed) > before.size) fail('file_size_limit');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await fs.lstat(file, {bigint: true}), end = await handle.stat({bigint: true});
    regular(after); regular(end);
    if (BigInt(consumed) !== before.size || !unchanged(before, after) || !unchanged(before, end)) fail('file_changed');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

export async function hashForwardFile(file, {maxBytes = FORWARD_SIDECAR_LIMITS.maxFileBytes} = {}) {
  if (!positive(maxBytes) || maxBytes > FORWARD_SIDECAR_LIMITS.maxArchiveBytes) fail('file_limit_invalid');
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('absolute_local_path_required');
  const held = await ancestorCustody(path.dirname(file));
  const before = await fs.lstat(file, {bigint: true});
  const hash = await stableFileHash(file, before, maxBytes);
  await recheckAncestors(held);
  return hash;
}

export async function captureForwardInventory(root, {limits: suppliedLimits = {}} = {}) {
  const bounds = limits(suppliedLimits), held = await ancestorCustody(root), rows = [], folded = new Set(), physical = new Set();
  let files = 0, total = 0;
  async function visit(dir, relative) {
    const before = await fs.lstat(dir, {bigint: true});
    directory(before);
    const key = `${before.dev}:${before.ino}`;
    if (physical.has(key)) fail('physical_alias');
    physical.add(key);
    const entries = await fs.opendir(dir);
    for await (const entry of entries) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      validateForwardRelativePath(name);
      if (name.split('/').length > bounds.maxDepth) fail('inventory_depth_limit');
      if (rows.length >= bounds.maxEntries) fail('inventory_entry_limit');
      if (folded.has(forwardPathCollisionKey(name))) fail('inventory_case_collision');
      folded.add(forwardPathCollisionKey(name));
      const full = path.join(dir, entry.name), info = await fs.lstat(full, {bigint: true});
      if (info.isSymbolicLink()) fail('reparse_forbidden');
      if (info.isDirectory()) {
        rows.push([name, 'DIRECTORY']);
        await visit(full, name);
      } else {
        regular(info);
        const fileKey = `${info.dev}:${info.ino}`;
        if (physical.has(fileKey)) fail('physical_alias');
        physical.add(fileKey);
        if (++files > bounds.maxFiles || info.size > BigInt(bounds.maxFileBytes)) fail('inventory_size_limit');
        total += Number(info.size);
        if (!Number.isSafeInteger(total) || total > bounds.maxBytes) fail('inventory_size_limit');
        rows.push([name, Number(info.size), await stableFileHash(full, info, bounds.maxFileBytes)]);
      }
    }
    const after = await fs.lstat(dir, {bigint: true});
    directory(after);
    if (!unchanged(before, after)) fail('directory_changed');
  }
  await visit(path.resolve(root), '');
  rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const inventory = validateForwardInventory(rows, suppliedLimits);
  // Use the pre-existing source-trusted fingerprint as independent readback.
  const readback = await captureInstalledTreeFingerprint(root);
  if (readback.tree_sha256 !== inventory.tree_sha256 || readback.file_count !== inventory.file_count
    || readback.total_bytes !== inventory.total_bytes) fail('inventory_changed');
  await recheckAncestors(held);
  return Object.freeze({schema: INSTALLED_TREE_SCHEMA, ...inventory, files: rows});
}

function validateArtifactPin(pin, expectedName) {
  keys(pin, ['id', 'name', 'sha256']);
  id(pin.id, true);
  if (pin.name !== expectedName || !isSha(pin.sha256)) fail('artifact_pin_invalid');
}
function subtree(files, prefix) {
  if (!files.some(row => row[0] === prefix && row[1] === 'DIRECTORY')) fail('runtime_directory_missing');
  return files.filter(row => row[0].startsWith(prefix + '/')).map(row => [row[0].slice(prefix.length + 1), ...row.slice(1)]);
}

export function validateForwardSidecar(manifest) {
  keys(manifest, ['schema', 'source_head', 'package_version', 'producer', 'installer_artifact', 'installer',
    'asar_sha256', 'runtime', 'image', 'uninstaller', 'installed_image'], ['schema_fixture']);
  if (manifest.schema !== FORWARD_SIDECAR_SCHEMA || typeof manifest.source_head !== 'string' || !HEAD.test(manifest.source_head)
    || typeof manifest.package_version !== 'string' || !VERSION.test(manifest.package_version)) fail('identity_invalid');
  if (Buffer.byteLength(JSON.stringify(manifest)) > FORWARD_SIDECAR_LIMITS.maxManifestBytes) fail('manifest_size_limit');
  const p = manifest.producer;
  keys(p, ['repository', 'workflow', 'run_id', 'run_number', 'run_attempt', 'event']);
  id(p.run_id, true);
  if (p.repository !== REPOSITORY || p.workflow !== WORKFLOW || !positive(p.run_number)
    || !positive(p.run_attempt) || !EVENTS.has(p.event)) fail('producer_invalid');
  validateArtifactPin(manifest.installer_artifact, `metaengine-browser-windows-candidate-${manifest.source_head}`);
  keys(manifest.installer, ['name', 'sha256']);
  if (manifest.installer.name !== `METAENGINE-Browser-Test-Setup-${manifest.package_version}-x64.exe`
    || !isSha(manifest.installer.sha256)) fail('installer_invalid');
  const image = manifest.image;
  keys(image, ['root', 'schema', 'tree_sha256', 'files'], ['file_count', 'total_bytes']);
  if (image.root !== 'win-unpacked' || image.schema !== INSTALLED_TREE_SCHEMA) fail('image_invalid');
  const summary = validateForwardInventory(image.files);
  if (image.tree_sha256 !== summary.tree_sha256
    || (Object.hasOwn(image, 'file_count') && image.file_count !== summary.file_count)
    || (Object.hasOwn(image, 'total_bytes') && image.total_bytes !== summary.total_bytes)) fail('image_digest_mismatch');
  if (image.files.some(row => forwardPathCollisionKey(row[0]) === forwardPathCollisionKey(FORWARD_UNINSTALLER))) fail('candidate_contains_uninstaller');
  const asar = image.files.find(row => row[0] === 'resources/app.asar');
  if (!asar || asar.length !== 3 || !isSha(manifest.asar_sha256) || asar[2] !== manifest.asar_sha256) fail('asar_mismatch');
  keys(manifest.runtime, ['bundle_sha256', 'tree_sha256', 'postgres_tree_sha256']);
  if (!isSha(manifest.runtime.bundle_sha256)) fail('runtime_bundle_invalid');
  const runtimeFiles = subtree(image.files, 'resources/client-state-runtime');
  const postgresFiles = subtree(runtimeFiles, 'runtime/postgresql');
  const runtimeSummary = validateForwardInventory(runtimeFiles), postgresSummary = validateForwardInventory(postgresFiles);
  if (manifest.runtime.tree_sha256 !== runtimeSummary.tree_sha256
    || manifest.runtime.postgres_tree_sha256 !== postgresSummary.tree_sha256) fail('runtime_digest_mismatch');
  if (!runtimeFiles.some(row => row[0] === 'offline-runtime-bundle.json' && row.length === 3)) fail('runtime_manifest_missing');
  // bundle_sha256 is a semantic offline-bundle digest, not a raw file hash.
  // Materialization must independently invoke verifyOfflineRuntimeBundle.
  const uninstaller = manifest.uninstaller;
  keys(uninstaller, ['name', 'sha256', 'measurement', 'installer_sha256']);
  if (uninstaller.name !== FORWARD_UNINSTALLER || !isSha(uninstaller.sha256)
    || uninstaller.measurement !== 'NSIS_GENERATED_AFTER_FRESH_INSTALL'
    || uninstaller.installer_sha256 !== manifest.installer.sha256) fail('uninstaller_binding_invalid');
  const readback = manifest.installed_image;
  keys(readback, ['schema', 'state', 'candidate_tree_sha256', 'installed_tree_sha256', 'file_count',
    'total_bytes', 'uninstaller_sha256', 'full_tree_verified', 'production_authorized', 'authority_effect']);
  const uninstallerSize = readback.total_bytes - summary.total_bytes;
  if (readback.schema !== 'metaengine.operator.qa-installed-image-readback.v1'
    || readback.state !== 'EXACT_CANDIDATE_IMAGE_VERIFIED'
    || readback.candidate_tree_sha256 !== image.tree_sha256
    || readback.uninstaller_sha256 !== uninstaller.sha256
    || readback.file_count !== summary.file_count + 1 || readback.file_count > FORWARD_SIDECAR_LIMITS.maxFiles
    || !Number.isSafeInteger(readback.total_bytes) || readback.total_bytes > FORWARD_SIDECAR_LIMITS.maxBytes
    || !positive(uninstallerSize) || uninstallerSize > FORWARD_SIDECAR_LIMITS.maxFileBytes
    || readback.full_tree_verified !== true || readback.production_authorized !== false
    || readback.authority_effect !== false) fail('installed_readback_invalid');
  const installedRows = [...image.files, [uninstaller.name, uninstallerSize, uninstaller.sha256]]
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (readback.installed_tree_sha256 !== digestForwardInventory(installedRows)) fail('installed_digest_mismatch');
  if (Object.hasOwn(manifest, 'schema_fixture')) {
    const fixture = manifest.schema_fixture;
    keys(fixture, ['file', 'sha256', 'source_head', 'kind', 'source_data_rows', 'synthetic_rpc_bodies']);
    if (fixture.file !== 'predecessor-empty-schema.dump' || !isSha(fixture.sha256)
      || fixture.source_head !== manifest.source_head || fixture.kind !== 'REVIEWED_OFFLINE_EMPTY_SCHEMA'
      || fixture.source_data_rows !== 0 || fixture.synthetic_rpc_bodies !== false) fail('schema_fixture_invalid');
  }
  return manifest;
}

function verifiedInstaller(evidence, manifest) {
  const p = manifest.producer;
  if (!object(evidence) || evidence.schema !== 'metaengine.browser.installer-provenance-acquired.v1'
    || evidence.source_head !== manifest.source_head || evidence.package_version !== manifest.package_version
    || evidence.installer_name !== manifest.installer.name || evidence.installer_sha256 !== manifest.installer.sha256
    || !positive(evidence.installer_bytes) || evidence.installer_bytes > FORWARD_SIDECAR_LIMITS.maxFileBytes
    || id(evidence.provenance_run_id) !== p.run_id || evidence.provenance_run_number !== p.run_number
    || evidence.provenance_run_attempt !== p.run_attempt || evidence.provenance_workflow !== path.posix.basename(WORKFLOW)
    || !['metaengine.browser.installer-provenance.v2', 'metaengine.browser.installer-provenance.v3'].includes(evidence.provenance_schema)
    || !isSha(evidence.build_identity_sha256) || !isSha(evidence.dependency_resolution_sha256)
    || !['build_identity_verified', 'dependency_resolution_verified', 'blockmap_verified', 'config_verified'].every(key => evidence[key] === true)) fail('installer_evidence_invalid');
  if (evidence.provenance_schema === 'metaengine.browser.installer-provenance.v3'
    && (!isSha(evidence.package_lock_sha256) || !isSha(evidence.me2_ui_bun_lock_sha256)
      || !['npm_version', 'bun_version'].every(key => typeof evidence[key] === 'string' && /^[^\s\x00-\x1f]{1,64}$/.test(evidence[key]))
      || evidence.package_lock_verified !== true || evidence.me2_ui_bun_lock_verified !== true)) fail('installer_v3_evidence_invalid');
}

// The caller supplies a live, complete GitHub response, not receipt assertions.
// Artifact bytes are separately downloaded by pinned ID and SHA256-verified;
// installerEvidence must come from the unchanged existing installer verifier.
export function validateForwardSidecarBinding({manifest, pin, producerRun, artifacts, artifactCount, installerEvidence}) {
  validateForwardSidecar(manifest);
  keys(pin, ['source_head', 'package_version', 'producer_run_id', 'producer_run_attempt', 'installer_artifact', 'sidecar_artifact'],
    ['producer_run_number', 'producer_event']);
  const p = manifest.producer;
  if (pin.source_head !== manifest.source_head || pin.package_version !== manifest.package_version
    || id(pin.producer_run_id, true) !== p.run_id || pin.producer_run_attempt !== p.run_attempt
    || (Object.hasOwn(pin, 'producer_run_number') && pin.producer_run_number !== p.run_number)
    || (Object.hasOwn(pin, 'producer_event') && pin.producer_event !== p.event)) fail('dispatch_binding_mismatch');
  validateArtifactPin(pin.installer_artifact, `metaengine-browser-windows-candidate-${manifest.source_head}`);
  validateArtifactPin(pin.sidecar_artifact, `metaengine-browser-windows-forward-sidecar-${manifest.source_head}`);
  if (pin.installer_artifact.id === pin.sidecar_artifact.id
    || ['id', 'name', 'sha256'].some(key => pin.installer_artifact[key] !== manifest.installer_artifact[key])) fail('candidate_artifact_mismatch');
  if (!object(producerRun) || producerRun.status !== 'completed' || producerRun.conclusion !== 'success') fail('producer_not_terminal_success');
  if (producerRun.repository?.full_name !== REPOSITORY || producerRun.path !== WORKFLOW
    || id(producerRun.id) !== p.run_id || producerRun.head_sha !== manifest.source_head
    || producerRun.run_number !== p.run_number || producerRun.run_attempt !== p.run_attempt
    || producerRun.event !== p.event) fail('producer_run_mismatch');
  if (!Array.isArray(artifacts) || !Number.isSafeInteger(artifactCount) || artifactCount < 2
    || artifactCount > 10000 || artifacts.length !== artifactCount) fail('artifact_collection_incomplete');
  const ids = new Set();
  for (const artifact of artifacts) {
    if (!object(artifact)) fail('artifact_metadata_invalid');
    const key = id(artifact.id);
    if (ids.has(key)) fail('artifact_id_ambiguous');
    ids.add(key);
  }
  for (const expected of [pin.installer_artifact, pin.sidecar_artifact]) {
    const matches = artifacts.filter(artifact => artifact.name === expected.name);
    if (matches.length !== 1) fail('artifact_missing_or_ambiguous');
    const artifact = matches[0];
    if (id(artifact.id) !== expected.id || artifact.digest !== 'sha256:' + expected.sha256 || artifact.expired !== false
      || !object(artifact.workflow_run) || id(artifact.workflow_run.id) !== p.run_id
      || artifact.workflow_run.head_sha !== manifest.source_head) fail('artifact_binding_mismatch');
  }
  verifiedInstaller(installerEvidence, manifest);
  return Object.freeze({schema: 'metaengine.browser.forward-sidecar-binding.v1', source_head: manifest.source_head,
    package_version: manifest.package_version, producer_run_id: p.run_id, producer_run_number: p.run_number,
    producer_run_attempt: p.run_attempt, producer_event: p.event, producer_terminal_success: true,
    installer_artifact_id: pin.installer_artifact.id, sidecar_artifact_id: pin.sidecar_artifact.id,
    sidecar_archive_sha256: pin.sidecar_artifact.sha256, authority_effect: false});
}
