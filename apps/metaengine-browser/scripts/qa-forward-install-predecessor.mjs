// The consumed .178 installer has no producer forward sidecar. Its original
// immutable code manifest remains the code expectation; a separate completed
// qualification supplies only the fresh-install image/uninstaller readback.
// This module never installs, launches package code, or changes an Owner.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyInstaller} from './installer-provenance.mjs';
import {INSTALLED_TREE_SCHEMA} from './qa-installed-tree-fingerprint.mjs';
import {captureForwardInventory, hashForwardFile,
  validateForwardInventory, validateForwardRelativePath, FORWARD_UNINSTALLER,
  FORWARD_SIDECAR_LIMITS} from './qa-forward-candidate-sidecar.mjs';
import {PACKAGE_CODE_FILE_W68, PACKAGE_CODE_MAX_MANIFEST_BYTES_W68,
  serializePackageCodeManifestW68, validatePackageCodeManifestW68, verifyPackageCodeW68}
  from '../src/installed-package-code-w68.mjs';
import {verifyOfflineRuntimeBundle} from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import {ORIGINAL_PREDECESSOR, PREDECESSOR_DETACHED_PROOFS, PREDECESSOR_QUALIFIER_REFS,
  deriveOriginalPredecessorExpectations, assertPredecessorInstalledRows, assertStrictPredecessorVerification}
  from './qualify-predecessor-materialization.mjs';
import {assertNsisEffectsObserved} from './qa-nsis-external-effects.mjs';

export const PREDECESSOR_MATERIALIZATION_SCHEMA = 'metaengine.browser.predecessor-materialization.v1';
export const PREDECESSOR_QUALIFIER_WORKFLOW = '.github/workflows/browser-windows-predecessor-qualification.yml';
export const PREDECESSOR_CONFIG_CONTRACT = Object.freeze({
  source_path: 'apps/metaengine-browser/electron-builder.test.json',
  source_sha256: '001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd',
  source_bytes: 3580,
  materialized_sha256: '021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203',
  materialized_bytes: 3729,
  materialization: 'LF_TO_CRLF_ONLY',
});
export const PREDECESSOR_CONFIG_SHA256 = PREDECESSOR_CONFIG_CONTRACT.materialized_sha256;
export const PREDECESSOR_IMAGE_ROOT = 'win-unpacked';
export const PREDECESSOR_ORIGIN = Object.freeze({
  kind: 'IMMUTABLE_INSTALLER_WITH_INDEPENDENT_QUALIFICATION',
  source_head: '601532ca50db02aa9089783dde157a93f484adf2',
  package_version: '0.7.0-dev.1784381341133.1',
  producer_run_id: '40382079975',
  producer_run_attempt: 1,
  installer_artifact: Object.freeze({id: '12679249312',
    name: 'metaengine-browser-windows-candidate-601532ca50db02aa9089783dde157a93f484adf2',
    sha256: '28126ee94d99c59040b1e2f5f215556d148da3f1933198ced5919323ce0881f4'}),
  installer_sha256: '018cc4a4adf515b5cfc2b829b765aa14d171eaf1bf0e72ebd6e822df1f52d0dd',
  code_manifest_sha256: '6ad0cf0b0af0affd77888c6881e83784027ecd4a6be7711a656169822c8214c9',
});
const REPOSITORY = 'PatrickFrome/Compute';
const PRODUCER_WORKFLOW = '.github/workflows/browser-windows-package-smoke.yml';
const MATERIALIZATION_FILE = 'predecessor-materialization.json';
const ORIGINAL_CONFIG_FILE = 'original-electron-builder.test.json';
const CODE_FILE_COUNT = 3425;
const RUNTIME = 'resources/client-state-runtime';
const POSTGRES = RUNTIME + '/runtime/postgresql';
const SHA = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,19}$/;
const EVENTS = new Set(['push', 'pull_request', 'workflow_dispatch']);
const verifiedDescriptors = new WeakMap();
const strictInstallerInputs = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && SHA.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw new Error('qa_forward_predecessor_' + code); };
const exact = (value, names) => object(value) && names.length === Object.keys(value).length
  && names.every(name => Object.hasOwn(value, name));
const id = value => typeof value === 'string' && ID.test(value);
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const expectedCode = Object.freeze({sourceSha: PREDECESSOR_ORIGIN.source_head,
  version: PREDECESSOR_ORIGIN.package_version, exeName: 'METAENGINE Browser Test.exe'});

function sameArtifact(actual, expected) {
  return exact(actual, ['id', 'name', 'sha256']) && actual.id === expected.id
    && actual.name === expected.name && actual.sha256 === expected.sha256;
}
export function validateForwardPredecessorPin(value) {
  if (!exact(value, [...Object.keys(PREDECESSOR_ORIGIN), 'qualification'])
    || Object.keys(PREDECESSOR_ORIGIN).some(key => key !== 'installer_artifact' && value[key] !== PREDECESSOR_ORIGIN[key])
    || !sameArtifact(value.installer_artifact, PREDECESSOR_ORIGIN.installer_artifact)) fail('original_pin_invalid');
  const q = value.qualification;
  if (!exact(q, ['repository', 'workflow', 'source_head', 'run_id', 'run_attempt', 'artifact'])
    || q.repository !== REPOSITORY || q.workflow !== PREDECESSOR_QUALIFIER_WORKFLOW
    || typeof q.source_head !== 'string' || !HEAD.test(q.source_head) || q.source_head === value.source_head
    || !id(q.run_id) || q.run_id === value.producer_run_id || !positive(q.run_attempt)
    || !exact(q.artifact, ['id', 'name', 'sha256']) || !id(q.artifact.id)
    || q.artifact.id === value.installer_artifact.id || !hash(q.artifact.sha256)
    || q.artifact.name !== `metaengine-browser-predecessor-materialization-${value.source_head}-${q.source_head}`)
    fail('qualification_pin_invalid');
  return structuredClone(value);
}

function assertRun(run, {sourceHead, runId, runAttempt, workflow}, kind) {
  if (!object(run) || (!id(run.id) && !positive(run.id)) || String(run.id) !== runId
    || run.repository?.full_name !== REPOSITORY || run.path !== workflow || run.head_sha !== sourceHead
    || run.run_attempt !== runAttempt || !positive(run.run_number) || !EVENTS.has(run.event)
    || run.status !== 'completed' || run.conclusion !== 'success'
    || !Number.isFinite(Date.parse(run.run_started_at)) || !Number.isFinite(Date.parse(run.updated_at))
    || Date.parse(run.updated_at) < Date.parse(run.run_started_at)) fail(kind + '_not_exact_terminal_success');
}
const sortRows = rows => rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
function declaredInstalledRows(manifest) {
  return sortRows([...manifest.image.files, [manifest.uninstaller.name, manifest.uninstaller.size, manifest.uninstaller.sha256]]);
}
function subtreeDigest(rows, prefix) {
  return validateForwardInventory(rows.filter(row => row[0].startsWith(prefix + '/'))
    .map(row => [row[0].slice(prefix.length + 1), ...row.slice(1)])).tree_sha256;
}
function validateDetachedObservations(rows, codeSha256) {
  if (!Array.isArray(rows) || rows.length !== PREDECESSOR_DETACHED_PROOFS.length) fail('detached_proofs_invalid');
  rows.forEach((row, index) => {
    if (!object(row) || row.name !== PREDECESSOR_DETACHED_PROOFS[index]) fail('detached_proofs_invalid');
    if (row.state === 'ABSENT_FROM_ORIGINAL_ARTIFACT') {
      if (!exact(row, ['name', 'state', 'readback']) || row.readback !== 'ABSENCE_VERIFIED'
        || row.name === PACKAGE_CODE_FILE_W68) fail('detached_proofs_invalid');
    } else if (!exact(row, ['name', 'state', 'original_artifact_path', 'size', 'sha256', 'readback'])
      || row.state !== 'ORIGINAL_BYTES_OR_ABSENT' || !positive(row.size) || row.size > PACKAGE_CODE_MAX_MANIFEST_BYTES_W68
      || !hash(row.sha256) || ![row.name, 'browser-slsa-provenance/' + row.name].includes(row.original_artifact_path)
      || !['PRESENT_ORIGINAL_BYTES_VERIFIED', 'ABSENCE_VERIFIED'].includes(row.readback)
      || (row.name === PACKAGE_CODE_FILE_W68 && (row.original_artifact_path !== row.name || row.sha256 !== codeSha256)))
      fail('detached_proofs_invalid');
  });
}

// Without run arguments this is schema validation for the qualifier writer,
// not evidence of qualification. Every consumer verification below supplies
// both exact terminal runs independently fetched by the acquisition layer.
export function validatePredecessorMaterialization(value, suppliedPin, {producerRun, qualificationRun} = {}) {
  const pin = validateForwardPredecessorPin(suppliedPin), q = pin.qualification;
  if (!exact(value, ['schema', 'state', 'source_head', 'package_version', 'original_producer', 'original_artifact',
    'installer', 'qualification', 'original_builder_config', 'original_package_code', 'image', 'detached_proofs', 'uninstaller', 'asar_sha256', 'runtime',
    'qualification_installed_image', 'bounded_install', 'process_readback', 'registry', 'nsis', 'preflight',
    'source_unchanged', 'copied_tree_verified', 'rebuilt', 'original_producer_modified', 'installed_owner_or_pg_qualified',
    'physical_migration_qualified', 'production_authorized', 'authority_effect', 'automatic_retry_allowed'])
    || value.schema !== PREDECESSOR_MATERIALIZATION_SCHEMA || value.state !== 'DISPOSABLE_PREDECESSOR_MATERIALIZED'
    || value.source_head !== pin.source_head || value.package_version !== pin.package_version
    || !isDeepStrictEqual(value.original_producer, {repository: REPOSITORY, workflow: PRODUCER_WORKFLOW,
      source_head: pin.source_head, run_id: pin.producer_run_id, run_number: ORIGINAL_PREDECESSOR.run_number,
      run_attempt: pin.producer_run_attempt, event: ORIGINAL_PREDECESSOR.event, terminal_success_verified: true})
    || !isDeepStrictEqual(value.original_artifact, {...pin.installer_artifact, bytes: ORIGINAL_PREDECESSOR.artifact_bytes})
    || !isDeepStrictEqual(value.installer, {name: ORIGINAL_PREDECESSOR.installer_name,
      sha256: pin.installer_sha256, bytes: ORIGINAL_PREDECESSOR.installer_bytes})) fail('manifest_original_binding_invalid');
  if (!isDeepStrictEqual(value.original_builder_config, PREDECESSOR_CONFIG_CONTRACT))
    fail('manifest_builder_config_invalid');
  const qualified = value.qualification;
  if (!exact(qualified, ['repository', 'workflow', 'source_head', 'run_id', 'run_attempt', 'run_number', 'event', 'ref', 'terminal_success_required_by_consumer'])
    || ['repository', 'workflow', 'source_head', 'run_id', 'run_attempt'].some(key => qualified[key] !== q[key])
    || !positive(qualified.run_number) || !['push', 'workflow_dispatch'].includes(qualified.event)
    || !PREDECESSOR_QUALIFIER_REFS.includes(qualified.ref) || qualified.terminal_success_required_by_consumer !== true)
    fail('manifest_qualification_binding_invalid');
  if (!isDeepStrictEqual(value.original_package_code, {file: PACKAGE_CODE_FILE_W68, sha256: pin.code_manifest_sha256,
    original_manifest_verified: true, strict_installer_provenance_verified: true}))
    fail('manifest_code_binding_invalid');
  if (!exact(value.image, ['root', 'schema', 'tree_sha256', 'file_count', 'total_bytes', 'files']) || value.image.root !== PREDECESSOR_IMAGE_ROOT
    || value.image.schema !== INSTALLED_TREE_SCHEMA || !hash(value.image.tree_sha256)) fail('manifest_image_invalid');
  const image = validateForwardInventory(value.image.files);
  if (['tree_sha256', 'file_count', 'total_bytes'].some(key => image[key] !== value.image[key])
    || value.image.files.some(row => row[0].toUpperCase() === FORWARD_UNINSTALLER.toUpperCase())) fail('manifest_image_invalid');
  validateDetachedObservations(value.detached_proofs, pin.code_manifest_sha256);
  for (const proof of value.detached_proofs) {
    const actual = value.image.files.filter(row => row[0].toUpperCase() === proof.name.toUpperCase());
    const expected = proof.readback === 'PRESENT_ORIGINAL_BYTES_VERIFIED' ? [[proof.name, proof.size, proof.sha256]] : [];
    if (!isDeepStrictEqual(actual, expected)) fail('manifest_detached_observation_mismatch');
  }
  const uninstaller = value.uninstaller;
  if (!exact(uninstaller, ['name', 'size', 'sha256', 'measurement', 'installer_sha256', 'qualification_run_id'])
    || uninstaller.name !== FORWARD_UNINSTALLER || !positive(uninstaller.size)
    || uninstaller.size > FORWARD_SIDECAR_LIMITS.maxFileBytes || !hash(uninstaller.sha256)
    || uninstaller.measurement !== 'INDEPENDENT_DISPOSABLE_FRESH_INSTALL'
    || uninstaller.installer_sha256 !== pin.installer_sha256 || uninstaller.qualification_run_id !== q.run_id)
    fail('independent_uninstaller_required');
  if (!hash(value.asar_sha256) || !exact(value.runtime,
    ['bundle_sha256', 'semantic_verification', 'tree_sha256', 'postgres_tree_sha256'])
    || value.runtime.bundle_sha256 !== ORIGINAL_PREDECESSOR.bundle_sha256 || value.runtime.semantic_verification !== true
    || !hash(value.runtime.tree_sha256) || !hash(value.runtime.postgres_tree_sha256)
    || value.image.files.find(row => row[0] === 'resources/app.asar')?.[2] !== value.asar_sha256
    || subtreeDigest(value.image.files, RUNTIME) !== value.runtime.tree_sha256
    || subtreeDigest(value.image.files, POSTGRES) !== value.runtime.postgres_tree_sha256) fail('manifest_runtime_invalid');
  const installed = validateForwardInventory(declaredInstalledRows(value));
  if (!isDeepStrictEqual(value.qualification_installed_image, {schema: 'metaengine.browser.predecessor-installed-image.v1',
    installed_tree_sha256: installed.tree_sha256, file_count: installed.file_count, total_bytes: installed.total_bytes,
    candidate_tree_sha256: image.tree_sha256, uninstaller_sha256: uninstaller.sha256,
    original_expected_code_verified: true, detached_proofs_verified: true, full_tree_verified: true}))
    fail('qualification_installed_image_invalid');
  if (!isDeepStrictEqual(value.bounded_install, {schema: 'metaengine.browser.bounded-package-install.v1', installer_exit_code: 0,
    process_tree_scoped_job: true, descendant_cleanup_on_job_close: true, timeout_seconds: 1800})
    || !isDeepStrictEqual(value.process_readback, {installer_process_absent: true, browser_and_postgres_absent: true, guardian_service_absent: true})
    || !isDeepStrictEqual(value.preflight, {empty_profile: true, registration_absent: true, processes_absent: true, guardian_absent: true}))
    fail('qualification_cleanup_unverified');
  if (!exact(value.registry, ['schema', 'state', 'digest', 'key_count', 'mutation'])
    || value.registry.schema !== 'metaengine.operator.forward-registration.v1' || value.registry.state !== 'OBSERVED'
    || !hash(value.registry.digest) || value.registry.key_count !== 2 || value.registry.mutation !== false)
    fail('qualification_registry_unverified');
  if (!exact(value.nsis, ['schema', 'state', 'version', 'registry_entry_count', 'shortcut_count', 'shortcut_target_bound',
    'desktop_shortcut_target_bound', 'uninstaller_present', 'registry_sha256', 'shortcut_sha256', 'desktop_shortcut_sha256', 'mutation', 'authority_effect']))
    fail('qualification_nsis_unverified');
  assertNsisEffectsObserved(value.nsis, pin.package_version);
  if (value.source_unchanged !== true || value.copied_tree_verified !== true
    || ['rebuilt', 'original_producer_modified', 'installed_owner_or_pg_qualified', 'physical_migration_qualified',
      'production_authorized', 'authority_effect', 'automatic_retry_allowed'].some(key => value[key] !== false))
    fail('qualification_scope_invalid');
  if (producerRun !== undefined || qualificationRun !== undefined) {
    assertRun(producerRun, {sourceHead: pin.source_head, runId: pin.producer_run_id,
      runAttempt: pin.producer_run_attempt, workflow: PRODUCER_WORKFLOW}, 'producer');
    assertRun(qualificationRun, {sourceHead: q.source_head, runId: q.run_id,
      runAttempt: q.run_attempt, workflow: q.workflow}, 'qualification');
    if (value.original_producer.run_number !== producerRun.run_number || value.original_producer.event !== producerRun.event
      || qualified.run_number !== qualificationRun.run_number || qualified.event !== qualificationRun.event
      || qualified.ref !== 'refs/heads/' + qualificationRun.head_branch)
      fail('manifest_run_readback_mismatch');
  }
  return value;
}

async function stableBytes(file, maxBytes = PACKAGE_CODE_MAX_MANIFEST_BYTES_W68) {
  const before = await hashForwardFile(file, {maxBytes}), bytes = await fs.readFile(file);
  if (digest(bytes) !== before || await hashForwardFile(file, {maxBytes}) !== before) fail('file_changed');
  return bytes;
}
function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('json_invalid'); }
}

// Hold ancestor identity, not directory mtime: unrelated siblings in a shared
// runner temporary directory are permitted. No junction/symlink is accepted.
async function holdDirectories(absolute) {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute) || /^(?:\\\\|\/\/)/.test(absolute)
    || /[\x00-\x1f]/.test(absolute)) fail('physical_directory_required');
  const resolved = path.resolve(absolute), root = path.parse(resolved).root, held = [];
  let current = root;
  for (const component of ['', ...path.relative(root, resolved).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const before = await fs.lstat(current, {bigint: true}), real = await fs.realpath(current);
    const actual = await fs.lstat(real, {bigint: true});
    if (!before.isDirectory() || before.isSymbolicLink() || !actual.isDirectory() || actual.isSymbolicLink()
      || before.ino <= 0n || !sameIdentity(before, actual)) fail('physical_directory_required');
    held.push({file: current, info: before});
  }
  const fence = async () => {
    for (const {file, info} of held) {
      const currentInfo = await fs.lstat(file, {bigint: true});
      if (!currentInfo.isDirectory() || currentInfo.isSymbolicLink() || !sameIdentity(info, currentInfo)) fail('directory_changed');
    }
  };
  await fence();
  return {root: await fs.realpath(resolved), fence};
}

// Both roles call the unchanged strict verifier. Its acquired.json output is
// isolated in a fresh temporary directory; original downloaded bytes stay read-only.
export async function verifyStrictForwardInstaller({pin, producerRun, installerDirectory, configFile}) {
  if (!object(pin) || typeof pin.source_head !== 'string' || !HEAD.test(pin.source_head)
    || typeof pin.package_version !== 'string' || !/^0\.7\.0-dev\.[1-9][0-9]*\.1$/.test(pin.package_version)
    || !id(pin.producer_run_id) || !positive(pin.producer_run_attempt)) fail('installer_pin_invalid');
  assertRun(producerRun, {sourceHead: pin.source_head, runId: pin.producer_run_id,
    runAttempt: pin.producer_run_attempt, workflow: PRODUCER_WORKFLOW}, 'producer');
  const before = await captureForwardInventory(installerDirectory);
  const provenance = parseJson(await stableBytes(path.join(installerDirectory, 'installer-provenance.json')));
  const name = `METAENGINE-Browser-Test-Setup-${pin.package_version}-x64.exe`;
  if (provenance.installer_name !== name || provenance.blockmap_name !== name + '.blockmap'
    || provenance.schema !== 'metaengine.browser.installer-provenance.v3')
    fail('strict_installer_provenance_required');
  const configSha256 = await hashForwardFile(configFile, {maxBytes: PACKAGE_CODE_MAX_MANIFEST_BYTES_W68});
  const temporaryParent = await holdDirectories(path.resolve(os.tmpdir()));
  const temporary = await fs.mkdtemp(path.join(temporaryParent.root, 'forward-installer-verification-'));
  const temporaryCustody = await holdDirectories(temporary);
  try {
    const acquired = await verifyInstaller({dir: installerDirectory, config: configFile,
      state: path.join(temporary, 'acquired.json'), 'expect-head': pin.source_head,
      'expect-run-id': pin.producer_run_id, 'expect-run-number': String(producerRun.run_number),
      'expect-run-attempt': String(pin.producer_run_attempt), 'expect-workflow': path.posix.basename(PRODUCER_WORKFLOW)});
    if (acquired.schema !== 'metaengine.browser.installer-provenance-acquired.v1'
      || acquired.provenance_schema !== 'metaengine.browser.installer-provenance.v3'
      || acquired.source_head !== pin.source_head || acquired.package_version !== pin.package_version
      || acquired.installer_name !== name || !hash(acquired.installer_sha256) || !positive(acquired.installer_bytes)
      || acquired.provenance_run_id !== pin.producer_run_id || acquired.provenance_run_number !== producerRun.run_number
      || acquired.provenance_run_attempt !== pin.producer_run_attempt
      || acquired.provenance_workflow !== path.posix.basename(PRODUCER_WORKFLOW)
      || !hash(acquired.build_identity_sha256) || !hash(acquired.dependency_resolution_sha256)
      || !['build_identity_verified', 'dependency_resolution_verified', 'blockmap_verified', 'config_verified'].every(k => acquired[k] === true)
      || (pin.installer_sha256 !== undefined && acquired.installer_sha256 !== pin.installer_sha256))
      fail('strict_installer_binding_invalid');
    if (!hash(acquired.package_lock_sha256) || !hash(acquired.me2_ui_bun_lock_sha256)
        || !['npm_version', 'bun_version'].every(k => typeof acquired[k] === 'string' && /^[^\s\x00-\x1f]{1,64}$/.test(acquired[k]))
        || acquired.package_lock_verified !== true || acquired.me2_ui_bun_lock_verified !== true)
      fail('strict_installer_v3_binding_invalid');
    if ((await captureForwardInventory(installerDirectory)).tree_sha256 !== before.tree_sha256
      || await hashForwardFile(configFile, {maxBytes: PACKAGE_CODE_MAX_MANIFEST_BYTES_W68}) !== configSha256)
      fail('installer_inputs_changed');
    strictInstallerInputs.set(acquired, {installerTreeSha256: before.tree_sha256, configSha256});
    return Object.freeze(acquired);
  } finally {
    await temporaryCustody.fence();
    await fs.rm(temporary, {recursive: true});
  }
}

async function readOriginalCode(roleRoot) {
  const file = path.join(roleRoot, 'installer', PACKAGE_CODE_FILE_W68);
  const bytes = await stableBytes(file);
  if (digest(bytes) !== PREDECESSOR_ORIGIN.code_manifest_sha256) fail('original_code_digest_mismatch');
  const manifest = validatePackageCodeManifestW68(parseJson(bytes), expectedCode);
  if (!serializePackageCodeManifestW68(manifest).equals(bytes)) fail('original_code_noncanonical');
  if (manifest.entries.filter(row => row.kind === 'file').length !== CODE_FILE_COUNT) fail('original_code_file_count_mismatch');
  return {file, bytes, manifest};
}

// Read-only ZIP directory allowances come only from the immutable original
// W68 bytes. Neither the qualifier's inventory nor its current disk tree can
// add an exception, and a persisted descriptor cannot supply this list.
export async function readPredecessorArchiveDirectories({pin, roleRoot}) {
  validateForwardPredecessorPin(pin);
  const {manifest} = await readOriginalCode(roleRoot);
  const directories = [PREDECESSOR_IMAGE_ROOT, ...manifest.entries.filter(row => row.kind === 'directory')
    .map(row => PREDECESSOR_IMAGE_ROOT + '/' + row.path)].sort();
  for (const directory of directories) validateForwardRelativePath(directory);
  return Object.freeze(directories);
}

async function originalExpectations(roleRoot, code, expectedInstallerTreeSha256) {
  const original = await captureForwardInventory(path.join(roleRoot, 'installer'));
  if (expectedInstallerTreeSha256 !== undefined && original.tree_sha256 !== expectedInstallerTreeSha256)
    fail('original_installer_inputs_changed');
  return deriveOriginalPredecessorExpectations(code.bytes, original.files);
}
function codeImageBinding(manifest, original) {
  // The writer's own pure validator derives all code/proof expectations from
  // the authenticated original artifact. Manifest inventory is only a claim
  // to compare with that expectation, never its replacement.
  const installedRows = declaredInstalledRows(manifest);
  const verified = assertPredecessorInstalledRows(original, installedRows);
  if (!isDeepStrictEqual(verified.imageRows, manifest.image.files)
    || !isDeepStrictEqual(verified.proofReadbacks, manifest.detached_proofs)
    || !isDeepStrictEqual(verified.uninstaller, {name: manifest.uninstaller.name, size: manifest.uninstaller.size,
      sha256: manifest.uninstaller.sha256, measurement: manifest.uninstaller.measurement}))
    fail('original_code_image_binding_mismatch');
  return {baselineRows: verified.imageRows, installedRows};
}
async function qualificationLayout(roleRoot) {
  const directory = path.join(roleRoot, 'qualification'), custody = await holdDirectories(directory);
  const fence = async () => {
    await custody.fence();
    if (!isDeepStrictEqual((await fs.readdir(directory)).sort(), [MATERIALIZATION_FILE, PREDECESSOR_IMAGE_ROOT].sort()))
      fail('qualification_layout_invalid');
    await custody.fence();
  };
  await fence(); return fence;
}

async function verifyImage({manifest, code, original, imageRoot, installed = false}) {
  const custody = await holdDirectories(imageRoot), canonicalRoot = custody.root;
  const checked = await verifyPackageCodeW68(canonicalRoot, code.bytes, expectedCode);
  const binding = codeImageBinding(manifest, original);
  const expectedRows = installed ? binding.installedRows : binding.baselineRows;
  const image = await captureForwardInventory(canonicalRoot);
  if (installed && !isDeepStrictEqual(image.files.find(row => row[0] === manifest.uninstaller.name),
    [manifest.uninstaller.name, manifest.uninstaller.size, manifest.uninstaller.sha256])) fail('independent_uninstaller_mismatch');
  if (!isDeepStrictEqual(image.files, expectedRows)
    || image.tree_sha256 !== (installed ? manifest.qualification_installed_image.installed_tree_sha256 : manifest.image.tree_sha256))
    fail('installed_image_mismatch');
  await verifyOfflineRuntimeBundle({bundleDirectory: path.join(canonicalRoot, RUNTIME), expectedBundleDigest: manifest.runtime.bundle_sha256});
  await checked.fence();
  await custody.fence();
  return {image, root: canonicalRoot, fence: async () => { await checked.fence(); await custody.fence(); }};
}

// Acquisition alone may restore ZIP-omitted empty directories. The paths come
// from the authenticated ORIGINAL manifest, never a qualifier inventory. No
// regular file is created or overwritten, and no revalidation calls this helper.
export async function materializePredecessorDirectories({pin: suppliedPin, roleRoot}) {
  const pin = validateForwardPredecessorPin(suppliedPin), code = await readOriginalCode(roleRoot);
  const layoutFence = await qualificationLayout(roleRoot);
  const manifestFile = path.join(roleRoot, 'qualification', MATERIALIZATION_FILE);
  const manifestBytes = await stableBytes(manifestFile);
  const manifest = validatePredecessorMaterialization(parseJson(manifestBytes), pin);
  const original = await originalExpectations(roleRoot, code);
  codeImageBinding(manifest, original);
  const imageRoot = path.join(roleRoot, 'qualification', PREDECESSOR_IMAGE_ROOT);
  const custody = await holdDirectories(imageRoot);
  await captureForwardInventory(imageRoot);
  for (const row of code.manifest.entries) {
    if (row.kind !== 'directory') continue;
    validateForwardRelativePath(row.path);
    await custody.fence();
    const target = path.join(custody.root, ...row.path.split('/'));
    const parent = await holdDirectories(path.dirname(target));
    try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await holdDirectories(target);
    await parent.fence();
  }
  await verifyImage({manifest, code, original, imageRoot});
  if (!code.bytes.equals(await stableBytes(code.file)) || !manifestBytes.equals(await stableBytes(manifestFile))) fail('materialization_inputs_changed');
  await custody.fence();
  await layoutFence();
  return {installed_baseline_root: custody.root, code_manifest_sha256: pin.code_manifest_sha256};
}

// The acquisition layer must first bind the original payload to installer.zip,
// the extracted qualifier files to qualification.zip, and both live artifact
// catalogs. materializationSha256 is the authenticated ZIP member digest, not
// a hash freshly derived from the extracted (potentially changed) JSON file.
export async function verifyPredecessorMaterialization({pin: suppliedPin, roleRoot, producerRun, qualificationRun,
  configFile = path.join(roleRoot, ORIGINAL_CONFIG_FILE), materializationSha256}) {
  const pin = validateForwardPredecessorPin(suppliedPin);
  if (!hash(materializationSha256)) fail('authenticated_materialization_digest_required');
  if (!producerRun || !qualificationRun) fail('terminal_runs_required');
  const code = await readOriginalCode(roleRoot), manifestFile = path.join(roleRoot, 'qualification', MATERIALIZATION_FILE);
  const layoutFence = await qualificationLayout(roleRoot);
  const manifestBytes = await stableBytes(manifestFile);
  if (digest(manifestBytes) !== materializationSha256) fail('materialization_archive_binding_mismatch');
  const manifest = validatePredecessorMaterialization(parseJson(manifestBytes), pin, {producerRun, qualificationRun});
  const installerDirectory = path.join(roleRoot, 'installer');
  const configBytes = await stableBytes(configFile, PREDECESSOR_CONFIG_CONTRACT.materialized_bytes);
  if (configBytes.length !== PREDECESSOR_CONFIG_CONTRACT.materialized_bytes || digest(configBytes) !== PREDECESSOR_CONFIG_SHA256)
    fail('original_builder_config_mismatch');
  const installer = await verifyStrictForwardInstaller({pin, producerRun, installerDirectory, configFile});
  assertStrictPredecessorVerification(installer);
  const original = await originalExpectations(roleRoot, code, strictInstallerInputs.get(installer).installerTreeSha256);
  const checked = await verifyImage({manifest, code, original,
    imageRoot: path.join(roleRoot, 'qualification', PREDECESSOR_IMAGE_ROOT)});
  if (!code.bytes.equals(await stableBytes(code.file)) || !manifestBytes.equals(await stableBytes(manifestFile))) fail('verified_inputs_changed');
  await checked.fence();
  await layoutFence();
  const descriptor = Object.freeze({kind: pin.kind, source_head: pin.source_head, package_version: pin.package_version,
    installed_baseline_root: checked.root, installer_file: installer.installer_path, installer_sha256: pin.installer_sha256,
    code_manifest_file: code.file, code_manifest_sha256: pin.code_manifest_sha256, asar_sha256: manifest.asar_sha256,
    uninstaller_sha256: manifest.uninstaller.sha256, bundle_sha256: manifest.runtime.bundle_sha256,
    image_tree_sha256: manifest.image.tree_sha256, runtime_tree_sha256: manifest.runtime.tree_sha256,
    pg_tree_sha256: manifest.runtime.postgres_tree_sha256,
    producer_run_id: pin.producer_run_id, producer_run_attempt: pin.producer_run_attempt,
    producer_run_number: manifest.original_producer.run_number, producer_event: manifest.original_producer.event,
    installer_artifact: Object.freeze({...pin.installer_artifact}), qualification: Object.freeze({...pin.qualification,
      artifact: Object.freeze({...pin.qualification.artifact})})});
  verifiedDescriptors.set(descriptor, {pin, roleRoot, producerRun: structuredClone(producerRun),
    qualificationRun: structuredClone(qualificationRun), configFile, materializationSha256,
    original,
    ...strictInstallerInputs.get(installer)});
  return descriptor;
}

export async function verifyPredecessorInstalledImage({descriptor, installedRoot}) {
  const context = verifiedDescriptors.get(descriptor);
  if (!context) fail('verified_descriptor_required');
  // Revalidate the independent source image and installer after NSIS. A stored
  // JSON descriptor cannot authorize a new current-image uninstaller hash.
  const current = await verifyPredecessorMaterialization(context);
  const currentContext = verifiedDescriptors.get(current);
  if (currentContext.installerTreeSha256 !== context.installerTreeSha256 || currentContext.configSha256 !== context.configSha256)
    fail('original_installer_inputs_changed');
  if (JSON.stringify(current) !== JSON.stringify(descriptor)) fail('descriptor_changed');
  const code = await readOriginalCode(context.roleRoot);
  const manifestFile = path.join(context.roleRoot, 'qualification', MATERIALIZATION_FILE), bytes = await stableBytes(manifestFile);
  if (digest(bytes) !== context.materializationSha256) fail('materialization_archive_binding_mismatch');
  const manifest = validatePredecessorMaterialization(parseJson(bytes), context.pin, context);
  const checked = await verifyImage({manifest, code, original: currentContext.original, imageRoot: installedRoot, installed: true});
  if (!code.bytes.equals(await stableBytes(code.file)) || !bytes.equals(await stableBytes(manifestFile))) fail('installed_readback_inputs_changed');
  await checked.fence();
  return Object.freeze({schema: 'metaengine.browser.predecessor-installed-image-readback.v1',
    state: 'EXACT_ORIGINAL_PREDECESSOR_IMAGE_VERIFIED', source_head: descriptor.source_head,
    package_version: descriptor.package_version, package_code_sha256: descriptor.code_manifest_sha256,
    installed_tree_sha256: checked.image.tree_sha256, file_count: checked.image.file_count, total_bytes: checked.image.total_bytes,
    uninstaller_sha256: descriptor.uninstaller_sha256, full_tree_verified: true,
    qualification_source_head: descriptor.qualification.source_head, qualification_run_id: descriptor.qualification.run_id,
    qualification_run_attempt: descriptor.qualification.run_attempt, production_authorized: false, authority_effect: false});
}
