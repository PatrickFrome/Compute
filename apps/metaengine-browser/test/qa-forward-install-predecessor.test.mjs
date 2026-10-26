// Synthetic metadata/unsigned bytes test consumer refusal boundaries only.
// They are never installed, executed, or described as physical qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeProvenance, verifyInstaller} from '../scripts/installer-provenance.mjs';
import {captureForwardInventory, validateForwardInventory} from '../scripts/qa-forward-candidate-sidecar.mjs';
import {INSTALLED_TREE_SCHEMA} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {PACKAGE_CODE_FILE_W68} from '../src/installed-package-code-w68.mjs';
import {ORIGINAL_PREDECESSOR, PREDECESSOR_DETACHED_PROOFS, PREDECESSOR_QUALIFIER_REFS}
  from '../scripts/qualify-predecessor-materialization.mjs';
import {PREDECESSOR_MATERIALIZATION_SCHEMA, PREDECESSOR_QUALIFIER_WORKFLOW,
  PREDECESSOR_CONFIG_CONTRACT, PREDECESSOR_CONFIG_SHA256,
  PREDECESSOR_IMAGE_ROOT, PREDECESSOR_ORIGIN, validateForwardPredecessorPin,
  validatePredecessorMaterialization, verifyStrictForwardInstaller,
  materializePredecessorDirectories, verifyPredecessorMaterialization, verifyPredecessorInstalledImage}
  from '../scripts/qa-forward-install-predecessor.mjs';

const require = createRequire(import.meta.url);
const {canonicalJson, createBuildIdentity, createBuildIdentityV3, sha256String} = require('../scripts/build-identity.cjs');
const {createPackageLockMaterial} = require('../scripts/package-lock-material.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const REPOSITORY = 'PatrickFrome/Compute';
const WORKFLOW = '.github/workflows/browser-windows-package-smoke.yml';
const HASH = 'a'.repeat(64), QUALIFIER = 'b'.repeat(40);
function pin() {
  return {...structuredClone(PREDECESSOR_ORIGIN), qualification: {repository: REPOSITORY,
    workflow: PREDECESSOR_QUALIFIER_WORKFLOW, source_head: QUALIFIER, run_id: '500000001', run_attempt: 2,
    artifact: {id: '500000002', name: `metaengine-browser-predecessor-materialization-${PREDECESSOR_ORIGIN.source_head}-${QUALIFIER}`,
      sha256: HASH}}};
}
function run({sourceHead, runId, attempt, workflow, number = 333, event = 'workflow_dispatch'}) {
  return {id: Number(runId), repository: {full_name: REPOSITORY}, path: workflow, head_sha: sourceHead,
    run_attempt: attempt, run_number: number, event, status: 'completed', conclusion: 'success',
    head_branch: PREDECESSOR_QUALIFIER_REFS[0].slice('refs/heads/'.length),
    run_started_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:10:00Z'};
}
function runs(p = pin()) {
  return {producerRun: run({sourceHead: p.source_head, runId: p.producer_run_id, attempt: p.producer_run_attempt, workflow: WORKFLOW,
    number: ORIGINAL_PREDECESSOR.run_number, event: ORIGINAL_PREDECESSOR.event}),
    qualificationRun: run({sourceHead: p.qualification.source_head, runId: p.qualification.run_id,
      attempt: p.qualification.run_attempt, workflow: p.qualification.workflow, number: 444})};
}
function manifest(p = pin()) {
  const rows = [['METAENGINE Browser Test.exe', 1, HASH], ['resources', 'DIRECTORY'], ['resources/app.asar', 10, HASH],
    ['resources/client-state-runtime', 'DIRECTORY'], ['resources/client-state-runtime/offline-runtime-bundle.json', 10, HASH],
    ['resources/client-state-runtime/runtime', 'DIRECTORY'], ['resources/client-state-runtime/runtime/postgresql', 'DIRECTORY'],
    ['resources/client-state-runtime/runtime/postgresql/bin', 'DIRECTORY'],
    ['resources/client-state-runtime/runtime/postgresql/bin/postgres.exe', 10, HASH]];
  const image = validateForwardInventory(rows);
  const fullRows = [...rows, ['Uninstall METAENGINE Browser Test.exe', 100, HASH]].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const installed = validateForwardInventory(fullRows);
  const subtree = prefix => validateForwardInventory(rows.filter(row => row[0].startsWith(prefix + '/'))
    .map(row => [row[0].slice(prefix.length + 1), ...row.slice(1)])).tree_sha256;
  return {schema: PREDECESSOR_MATERIALIZATION_SCHEMA, state: 'DISPOSABLE_PREDECESSOR_MATERIALIZED',
    source_head: p.source_head, package_version: p.package_version,
    original_producer: {repository: REPOSITORY, workflow: WORKFLOW, run_id: p.producer_run_id,
      source_head: p.source_head, run_attempt: p.producer_run_attempt, run_number: ORIGINAL_PREDECESSOR.run_number,
      event: ORIGINAL_PREDECESSOR.event, terminal_success_verified: true},
    original_artifact: {...p.installer_artifact, bytes: ORIGINAL_PREDECESSOR.artifact_bytes},
    installer: {name: `METAENGINE-Browser-Test-Setup-${p.package_version}-x64.exe`, sha256: p.installer_sha256,
      bytes: ORIGINAL_PREDECESSOR.installer_bytes},
    qualification: {repository: REPOSITORY, workflow: p.qualification.workflow, source_head: p.qualification.source_head,
      run_id: p.qualification.run_id, run_attempt: p.qualification.run_attempt, run_number: 444, event: 'workflow_dispatch',
      ref: PREDECESSOR_QUALIFIER_REFS[0], terminal_success_required_by_consumer: true},
    original_builder_config: structuredClone(PREDECESSOR_CONFIG_CONTRACT),
    original_package_code: {file: PACKAGE_CODE_FILE_W68, sha256: p.code_manifest_sha256,
      original_manifest_verified: true, strict_installer_provenance_verified: true},
    image: {root: PREDECESSOR_IMAGE_ROOT, schema: INSTALLED_TREE_SCHEMA, ...image, files: rows},
    detached_proofs: PREDECESSOR_DETACHED_PROOFS.map(name => name === PACKAGE_CODE_FILE_W68
      ? {name, state: 'ORIGINAL_BYTES_OR_ABSENT', original_artifact_path: name, size: 1234,
        sha256: p.code_manifest_sha256, readback: 'ABSENCE_VERIFIED'}
      : {name, state: 'ABSENT_FROM_ORIGINAL_ARTIFACT', readback: 'ABSENCE_VERIFIED'}),
    uninstaller: {name: 'Uninstall METAENGINE Browser Test.exe', size: 100, sha256: HASH,
      measurement: 'INDEPENDENT_DISPOSABLE_FRESH_INSTALL', installer_sha256: p.installer_sha256, qualification_run_id: p.qualification.run_id},
    asar_sha256: HASH, runtime: {bundle_sha256: ORIGINAL_PREDECESSOR.bundle_sha256, semantic_verification: true,
      tree_sha256: subtree('resources/client-state-runtime'), postgres_tree_sha256: subtree('resources/client-state-runtime/runtime/postgresql')},
    qualification_installed_image: {schema: 'metaengine.browser.predecessor-installed-image.v1', installed_tree_sha256: installed.tree_sha256,
      file_count: installed.file_count, total_bytes: installed.total_bytes, candidate_tree_sha256: image.tree_sha256,
      uninstaller_sha256: HASH, original_expected_code_verified: true, detached_proofs_verified: true, full_tree_verified: true},
    bounded_install: {schema: 'metaengine.browser.bounded-package-install.v1', installer_exit_code: 0,
      process_tree_scoped_job: true, descendant_cleanup_on_job_close: true, timeout_seconds: 1800},
    process_readback: {installer_process_absent: true, browser_and_postgres_absent: true, guardian_service_absent: true},
    registry: {schema: 'metaengine.operator.forward-registration.v1', state: 'OBSERVED', digest: HASH, key_count: 2, mutation: false},
    nsis: {schema: 'metaengine.browser.qa-nsis-external-effects.v2', state: 'OBSERVED', version: p.package_version,
      registry_entry_count: 1, shortcut_count: 2, shortcut_target_bound: true, desktop_shortcut_target_bound: true,
      uninstaller_present: true, registry_sha256: HASH, shortcut_sha256: HASH, desktop_shortcut_sha256: HASH, mutation: false, authority_effect: false},
    preflight: {empty_profile: true, registration_absent: true, processes_absent: true, guardian_absent: true},
    source_unchanged: true, copied_tree_verified: true, rebuilt: false, original_producer_modified: false,
    installed_owner_or_pg_qualified: false, physical_migration_qualified: false, production_authorized: false,
    authority_effect: false, automatic_retry_allowed: false};
}
async function temp(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'forward-predecessor-test-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return root;
}
const json = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

test('only the immutable approved predecessor origin can use independent qualification', () => {
  assert.deepEqual(validateForwardPredecessorPin(pin()), pin());
  for (const change of [p => p.source_head = 'c'.repeat(40), p => p.package_version = '0.7.0-dev.999.1',
    p => p.producer_run_id = '500000000', p => p.producer_run_attempt = 2,
    p => p.installer_artifact.id = '500000003', p => p.installer_artifact.sha256 = HASH,
    p => p.installer_sha256 = HASH, p => p.code_manifest_sha256 = HASH,
    p => delete p.kind, p => p.sidecar_artifact = {...p.installer_artifact},
    p => p.qualification.run_id = p.producer_run_id, p => p.qualification.source_head = p.source_head,
    p => p.qualification.workflow = WORKFLOW, p => delete p.qualification.repository,
    p => p.qualification.artifact.id = p.installer_artifact.id,
    p => p.qualification.artifact.name = p.installer_artifact.name,
    p => p.qualification.run_attempt = 0]) {
    const value = pin(); change(value);
    assert.throws(() => validateForwardPredecessorPin(value), /qa_forward_predecessor_(original|qualification)_pin_invalid/);
  }
});

test('distinct original and qualifier origins bind exact terminal run metadata', () => {
  const p = pin(), m = manifest(p);
  assert.equal(validatePredecessorMaterialization(m, p, runs(p)), m);
  // Every detached name has a verified absence here. No file is injected to
  // satisfy the external original code manifest expectation.
  assert.equal(m.detached_proofs.length, 4);
  assert(m.detached_proofs.every(row => row.readback === 'ABSENCE_VERIFIED'));
  for (const field of ['producerRun', 'qualificationRun']) {
    for (const change of [r => r.status = 'in_progress', r => r.conclusion = 'failure', r => r.run_attempt++,
      r => r.head_sha = 'c'.repeat(40), r => r.id++, r => r.path = WORKFLOW + '.other',
      r => r.run_number++, r => r.event = 'push', r => r.repository.full_name = 'other/repository',
      r => r.updated_at = '2026-10-26T00:00:00Z']) {
      const observed = runs(p); change(observed[field]);
      assert.throws(() => validatePredecessorMaterialization(m, p, observed), /qa_forward_predecessor_/);
    }
  }
  assert.throws(() => validatePredecessorMaterialization(m, p, {producerRun: runs(p).producerRun}), /qualification_not_exact_terminal_success/);
  const otherBranch = runs(p); otherBranch.qualificationRun.head_branch = 'work/unreviewed-qualifier';
  assert.throws(() => validatePredecessorMaterialization(m, p, otherBranch), /manifest_run_readback_mismatch/);
});

test('later qualification cannot impersonate original producer or a producer installed-image receipt', () => {
  const p = pin();
  for (const change of [m => m.qualification.run_id = p.producer_run_id,
    m => m.qualification.source_head = p.source_head, m => m.qualification.workflow = WORKFLOW,
    m => m.original_producer.run_id = p.qualification.run_id,
    m => m.producer_installed_image = {state: 'EXACT_CANDIDATE_IMAGE_VERIFIED'},
    m => m.schema = 'metaengine.browser.forward-install-sidecar.v1', m => m.image.root = 'installed-baseline',
    m => m.qualification.ref = 'refs/heads/main', m => m.qualification.terminal_success_required_by_consumer = false]) {
    const value = manifest(p); change(value);
    assert.throws(() => validatePredecessorMaterialization(value, p, runs(p)), /qa_forward_predecessor_/);
  }
});

test('original builder config binds exact Git LF bytes and only the pinned CRLF materialization', () => {
  assert.deepEqual(PREDECESSOR_CONFIG_CONTRACT, {
    source_path: 'apps/metaengine-browser/electron-builder.test.json',
    source_sha256: '001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd',
    source_bytes: 3580,
    materialized_sha256: '021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203',
    materialized_bytes: 3729,
    materialization: 'LF_TO_CRLF_ONLY',
  });
  assert(Object.isFrozen(PREDECESSOR_CONFIG_CONTRACT));
  assert.equal(PREDECESSOR_CONFIG_SHA256, PREDECESSOR_CONFIG_CONTRACT.materialized_sha256);
  const p = pin(), valid = manifest(p);
  assert.equal(validatePredecessorMaterialization(valid, p, runs(p)), valid);
  for (const field of Object.keys(PREDECESSOR_CONFIG_CONTRACT)) {
    const missing = manifest(p); delete missing.original_builder_config[field];
    assert.throws(() => validatePredecessorMaterialization(missing, p, runs(p)), /manifest_builder_config_invalid/);
  }
  for (const change of [c => c.source_path = 'electron-builder.test.json',
    c => c.source_path = 'apps/metaengine-browser/../metaengine-browser/electron-builder.test.json',
    c => c.source_sha256 = c.materialized_sha256, c => c.materialized_sha256 = c.source_sha256,
    c => c.source_bytes++, c => c.materialized_bytes--, c => c.source_bytes = '3580',
    c => c.materialized_bytes = '3729', c => c.materialization = 'JSON_RESERIALIZED',
    c => c.materialization = 'LF_TO_CRLF', c => c.source_head = p.qualification.source_head]) {
    const value = manifest(p); change(value.original_builder_config);
    assert.throws(() => validatePredecessorMaterialization(value, p, runs(p)), /manifest_builder_config_invalid/);
  }
});

test('prior qualifier manifest without original builder config is refused despite terminal-success metadata', () => {
  const p = pin();
  p.qualification.source_head = '04495c6246160f30e3435f316b4f7db5a5de3c5e';
  p.qualification.artifact.name = `metaengine-browser-predecessor-materialization-${p.source_head}-${p.qualification.source_head}`;
  const value = manifest(p); delete value.original_builder_config;
  const observed = runs(p);
  assert.equal(observed.qualificationRun.status, 'completed');
  assert.equal(observed.qualificationRun.conclusion, 'success');
  assert.throws(() => validatePredecessorMaterialization(value, p, observed), /manifest_original_binding_invalid/);
});

test('same installer does not permit a replaced original code manifest or self-derived inventory', () => {
  const p = pin();
  for (const change of [m => m.original_package_code.sha256 = HASH, m => m.original_package_code.original_manifest_verified = false,
    m => m.original_package_code.file = 'current-image-manifest.json', m => delete m.original_package_code,
    m => m.image.files = [['unexpected.dll', 10, HASH]]]) {
    const value = manifest(p); change(value);
    assert.equal(value.installer.sha256, PREDECESSOR_ORIGIN.installer_sha256);
    assert.throws(() => validatePredecessorMaterialization(value, p), /qa_forward_predecessor_/);
  }
});

test('detached proof exclusions are exact physical root files, without aliases or new exemptions', () => {
  const p = pin();
  for (const name of ['unknown-proof.json', '../metaengine-installed-package-code.v1.json',
    'METAENGINE-installed-package-code.v1.json', 'resources', '*.json', 'resources/extra.dll']) {
    const value = manifest(p); value.detached_proofs[0].name = name;
    assert.throws(() => validatePredecessorMaterialization(value, p), /detached_proofs_invalid/);
  }
  const duplicate = manifest(p); duplicate.detached_proofs.push({...duplicate.detached_proofs[0]});
  assert.throws(() => validatePredecessorMaterialization(duplicate, p), /detached_proofs_invalid/);
  const changedCode = manifest(p); changedCode.detached_proofs.at(-1).sha256 = HASH;
  assert.throws(() => validatePredecessorMaterialization(changedCode, p), /detached_proofs_invalid/);
  const unobserved = manifest(p); unobserved.detached_proofs = [];
  assert.throws(() => validatePredecessorMaterialization(unobserved, p), /detached_proofs_invalid/);
});

test('current-image uninstaller and old producer measurement claims are rejected', () => {
  const p = pin();
  for (const change of [m => m.uninstaller.measurement = 'CURRENT_INSTALLED_READBACK',
    m => m.uninstaller.measurement = 'NSIS_GENERATED_AFTER_FRESH_INSTALL',
    m => m.uninstaller.installer_sha256 = HASH, m => m.uninstaller.size = 0,
    m => m.uninstaller.name = 'different.exe', m => m.uninstaller.qualification_run_id = p.producer_run_id,
    m => m.runtime.upgrade_sources_sha256 = HASH, m => m.runtime.semantic_verification = false,
    m => m.qualification_installed_image.installed_tree_sha256 = HASH]) {
    const value = manifest(p); change(value);
    assert.throws(() => validatePredecessorMaterialization(value, p), /qa_forward_predecessor_/);
  }
});

test('writer qualification requires its exact cleanup, registry, bounded-install and no-promotion observations', () => {
  const p = pin();
  for (const change of [m => m.original_artifact.bytes++, m => m.installer.bytes++,
    m => m.original_producer.event = 'workflow_dispatch', m => m.original_package_code.strict_installer_provenance_verified = false,
    m => m.bounded_install.installer_exit_code = 1, m => m.bounded_install.descendant_cleanup_on_job_close = false,
    m => m.process_readback.installer_process_absent = false, m => m.process_readback.browser_and_postgres_absent = false,
    m => m.preflight.guardian_absent = false, m => m.registry.key_count = 1,
    m => m.qualification_installed_image.detached_proofs_verified = false,
    m => m.physical_migration_qualified = true, m => m.automatic_retry_allowed = true,
    m => m.runtime.bundle_sha256 = HASH]) {
    const value = manifest(p); change(value);
    assert.throws(() => validatePredecessorMaterialization(value, p, runs(p)), /qa_forward_predecessor_/);
  }
});

test('qualifier unpacked image cannot smuggle the generated uninstaller as packaged code', () => {
  const p = pin(), value = manifest(p);
  value.image.files.push([value.uninstaller.name, value.uninstaller.size, value.uninstaller.sha256]);
  value.image.files.sort((a, b) => a[0] < b[0] ? -1 : 1);
  Object.assign(value.image, validateForwardInventory(value.image.files));
  assert.throws(() => validatePredecessorMaterialization(value, p), /manifest_image_invalid/);
});

test('tampered original code bytes fail before directory restoration or image readback', async t => {
  const root = await temp(t), p = pin();
  await fs.mkdir(path.join(root, 'installer'));
  await fs.writeFile(path.join(root, 'installer', PACKAGE_CODE_FILE_W68), 'replacement manifest for unchanged installer\n');
  await assert.rejects(() => materializePredecessorDirectories({pin: p, roleRoot: root}), /original_code_digest_mismatch/);
  await assert.rejects(() => fs.lstat(path.join(root, 'qualification')), {code: 'ENOENT'});
  await assert.rejects(() => verifyPredecessorMaterialization({pin: p, roleRoot: root, ...runs(p),
    materializationSha256: HASH}), /original_code_digest_mismatch/);
});

test('readback cannot promote a serialized descriptor with a hash taken from the current target', async t => {
  const root = await temp(t), file = path.join(root, 'Uninstall METAENGINE Browser Test.exe');
  await fs.writeFile(file, 'current target is not an independent expectation');
  const forged = {...pin(), installed_baseline_root: root, uninstaller_sha256: sha(await fs.readFile(file)),
    code_manifest_file: path.join(root, PACKAGE_CODE_FILE_W68)};
  await assert.rejects(() => verifyPredecessorInstalledImage({descriptor: forged, installedRoot: root}), /verified_descriptor_required/);
  await assert.rejects(() => verifyPredecessorMaterialization({pin: pin(), roleRoot: root, ...runs()}), /authenticated_materialization_digest_required/);
  await assert.rejects(() => verifyPredecessorMaterialization({pin: pin(), roleRoot: root,
    materializationSha256: HASH}), /terminal_runs_required/);
});

async function strictFixture(t, {version3 = true} = {}) {
  const root = await temp(t), directory = path.join(root, 'installer');
  await fs.mkdir(directory);
  const p = {source_head: 'a'.repeat(40), package_version: '0.7.0-dev.999999999.1',
    producer_run_id: '600000001', producer_run_attempt: 2};
  const name = `METAENGINE-Browser-Test-Setup-${p.package_version}-x64.exe`;
  const installer = path.join(directory, name), blockmap = installer + '.blockmap';
  const configFile = path.join(root, 'electron-builder.test.json');
  await fs.writeFile(installer, 'synthetic unsigned NSIS bytes are never executed');
  await fs.writeFile(blockmap, 'synthetic block map');
  await fs.writeFile(configFile, '{"appId":"fixture.original-config"}\n');
  let material;
  const packageJsonFile = path.join(directory, 'package.json'), packageLockFile = path.join(directory, 'package-lock.json');
  const materialFile = path.join(directory, 'package-lock-material.json'), uiLockFile = path.join(directory, 'me2-ui-bun.lock');
  if (version3) {
    const packageJson = {name: '@metaengine/browser-shell', version: p.package_version,
      dependencies: {'electron-updater': '6.8.9'}, devDependencies: {electron: '44.0.0'}};
    const packageLock = {name: packageJson.name, version: packageJson.version, lockfileVersion: 3, requires: true,
      packages: {'': {...packageJson}, 'node_modules/electron-updater': {version: '6.8.9',
        resolved: 'https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.9.tgz', integrity: 'sha512-fixture-updater'},
      'node_modules/electron': {version: '44.0.0', resolved: 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz',
        integrity: 'sha512-fixture-electron', dev: true}}};
    await json(packageJsonFile, packageJson); await json(packageLockFile, packageLock);
    material = createPackageLockMaterial({packageJsonPath: packageJsonFile, packageLockPath: packageLockFile,
      nodeVersion: process.version, npmVersion: '11.19.0'});
    await json(materialFile, material); await fs.writeFile(uiLockFile, '{"lockfileVersion":1,"packages":{}}\n');
  }
  const dependencyPayload = {schema: 'metaengine.browser.dependency-resolution.v1',
    root_name: '@metaengine/browser-shell', root_version: p.package_version,
    node_version: process.version, npm_version: '11.19.0', dependency_count: 1,
    tree: {name: '@metaengine/browser-shell', version: p.package_version,
      dependencies: {'electron-updater': {name: 'electron-updater', version: '6.8.9', dependencies: {}}}}};
  const dependency = {...dependencyPayload, dependency_resolution_sha256: sha256String(canonicalJson(dependencyPayload)), authority_effect: false};
  const dependencyFile = path.join(directory, 'dependency-resolution.json'), identityFile = path.join(directory, 'build-identity.json');
  await json(dependencyFile, dependency);
  const identity = (version3 ? createBuildIdentityV3 : createBuildIdentity)({repository: REPOSITORY, repository_id: '1341371143',
    source_head: p.source_head, workflow: path.posix.basename(WORKFLOW), run_id: p.producer_run_id,
    run_attempt: p.producer_run_attempt, package_version: p.package_version, platform: 'win32', arch: 'x64',
    builder_config_sha256: sha(await fs.readFile(configFile)), dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    electron_builder_version: '26.15.7', node_version: process.version,
    ...(version3 ? {package_lock_sha256: material.package_lock_sha256, npm_version: material.npm_version,
      bun_version: '1.3.3', me2_ui_bun_lock_sha256: sha(await fs.readFile(uiLockFile))} : {})});
  await json(identityFile, identity);
  const producerRun = run({sourceHead: p.source_head, runId: p.producer_run_id, attempt: p.producer_run_attempt, workflow: WORKFLOW});
  const provenanceFile = path.join(directory, 'installer-provenance.json');
  await writeProvenance({installer, out: provenanceFile, 'source-head': p.source_head, workflow: path.posix.basename(WORKFLOW),
    'run-id': p.producer_run_id, 'run-number': String(producerRun.run_number), 'run-attempt': String(p.producer_run_attempt),
    'package-version': p.package_version, config: configFile, blockmap, builder: '26.15.7',
    'build-identity': identityFile, 'dependency-resolution': dependencyFile,
    ...(version3 ? {'package-lock-material': materialFile, 'package-json': packageJsonFile,
      'package-lock': packageLockFile, 'me2-ui-bun-lock': uiLockFile} : {})});
  const verify = () => verifyStrictForwardInstaller({pin: p, producerRun, installerDirectory: directory, configFile});
  return {root, directory, p, producerRun, installer, blockmap, configFile, identityFile, dependencyFile,
    packageJsonFile, packageLockFile, materialFile, uiLockFile, provenanceFile, verify};
}

test('shared strict installer wrapper verifies actual v3 lock materials without modifying original payload', async t => {
  const f = await strictFixture(t), before = await captureForwardInventory(f.directory);
  const acquired = await f.verify();
  assert.equal(acquired.provenance_schema, 'metaengine.browser.installer-provenance.v3');
  for (const key of ['build_identity_verified', 'dependency_resolution_verified', 'blockmap_verified', 'config_verified',
    'package_lock_verified', 'me2_ui_bun_lock_verified'])
    assert.equal(acquired[key], true);
  assert.equal(acquired.installer_sha256, sha(await fs.readFile(f.installer)));
  assert.equal((await captureForwardInventory(f.directory)).tree_sha256, before.tree_sha256);
  await assert.rejects(() => fs.lstat(path.join(f.directory, 'acquired.json')), {code: 'ENOENT'});
});

test('otherwise valid original v2 provenance is explicitly blocked instead of taking a legacy exception', async t => {
  const f = await strictFixture(t, {version3: false});
  const underlying = await verifyInstaller({dir: f.directory, config: f.configFile,
    state: path.join(f.root, 'direct-v2-readback.json'), 'expect-head': f.p.source_head,
    'expect-run-id': f.p.producer_run_id, 'expect-run-number': String(f.producerRun.run_number),
    'expect-run-attempt': String(f.p.producer_run_attempt), 'expect-workflow': path.posix.basename(WORKFLOW)});
  assert.equal(underlying.provenance_schema, 'metaengine.browser.installer-provenance.v2');
  assert.equal(underlying.build_identity_verified, true);
  await assert.rejects(f.verify, /strict_installer_provenance_required/);
});

test('shared wrapper refuses hash/JSON-only claims and actual installer, blockmap or identity tampering', async t => {
  const f = await strictFixture(t);
  for (const [file, expected] of [[f.installer, /size_mismatch|sha_mismatch/], [f.blockmap, /blockmap_sha_mismatch/],
    [f.identityFile, /build_identity_external_invalid/], [f.dependencyFile, /build_identity_external_invalid/],
    [f.configFile, /config_sha_mismatch/], [f.packageLockFile, /package_lock_material_invalid/],
    [f.uiLockFile, /package_lock_material_binding_mismatch/]]) {
    const original = await fs.readFile(file);
    await fs.writeFile(file, 'changed input');
    await assert.rejects(f.verify, expected);
    await fs.writeFile(file, original);
  }
  const original = await fs.readFile(f.provenanceFile);
  const value = JSON.parse(original); value.schema = 'metaengine.browser.installer-provenance.v1';
  await json(f.provenanceFile, value);
  await assert.rejects(f.verify, /strict_installer_provenance_required/);
  await fs.writeFile(f.provenanceFile, original);
  f.producerRun.status = 'in_progress';
  await assert.rejects(f.verify, /producer_not_exact_terminal_success/);
});

test('strict verification rejects installer hardlinks before unchanged provenance is used', async t => {
  const f = await strictFixture(t), alias = path.join(f.root, 'installer-alias.exe');
  await fs.link(f.installer, alias);
  await assert.rejects(f.verify, /regular_file_required|nonregular_or_hardlinked_file/);
  await fs.unlink(alias);
  assert.equal((await f.verify()).build_identity_verified, true);
});
