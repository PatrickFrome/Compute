import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FORWARD_SIDECAR_SCHEMA, FORWARD_SIDECAR_LIMITS, FORWARD_UNINSTALLER,
  validateForwardRelativePath, forwardPathCollisionKey, digestForwardInventory, validateForwardInventory,
  captureForwardInventory, hashForwardFile, validateForwardSidecar, validateForwardSidecarBinding}
  from '../scripts/qa-forward-candidate-sidecar.mjs';
import {captureInstalledTreeFingerprint, INSTALLED_TREE_SCHEMA}
  from '../scripts/qa-installed-tree-fingerprint.mjs';
import {compareQaInstalledImage} from '../scripts/qa-operator-install-recovery.mjs';

// Deliberately synthetic source-only bytes. These fixtures neither run NSIS nor
// assert installed qualification; the real producer remains centrally blocked.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const HEAD = 'a'.repeat(40), VERSION = '0.7.0-dev.37628000001.1';
const copy = value => structuredClone(value);
const sorted = rows => rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const syntheticFiles = {
  'METAENGINE Browser Test.exe': 'synthetic browser',
  'resources/app.asar': 'synthetic asar',
  'resources/client-state-runtime/offline-runtime-bundle.json': '{"synthetic_source_only":true}',
  'resources/client-state-runtime/runtime/postgresql/bin/postgres.exe': 'synthetic postgres',
  'resources/client-state-runtime/runtime/postgresql/lib/plpgsql.dll': 'synthetic lib',
  'resources/client-state-runtime/runtime/postgresql/share/postgres.bki': 'synthetic schema',
};
function fixture() {
  const dirs = new Set(), files = [];
  for (const [relative, bytes] of Object.entries(syntheticFiles)) {
    const parts = relative.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    files.push([relative, Buffer.byteLength(bytes), hash(bytes)]);
  }
  dirs.add('empty-directory');
  files.push(...[...dirs].map(dir => [dir, 'DIRECTORY']));
  sorted(files);
  const sub = prefix => files.filter(row => row[0].startsWith(prefix + '/')).map(row => [row[0].slice(prefix.length + 1), ...row.slice(1)]);
  const bytes = Object.values(syntheticFiles).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  const uninstallerBytes = 'synthetic NSIS-generated test bytes', uninstallerHash = hash(uninstallerBytes);
  const manifest = {
    schema: FORWARD_SIDECAR_SCHEMA, source_head: HEAD, package_version: VERSION,
    producer: {repository: 'PatrickFrome/Compute', workflow: '.github/workflows/browser-windows-package-smoke.yml',
      run_id: '101', run_number: 19, run_attempt: 1, event: 'pull_request'},
    installer_artifact: {id: '201', name: `metaengine-browser-windows-candidate-${HEAD}`, sha256: '1'.repeat(64)},
    installer: {name: `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`, sha256: hash('synthetic installer')},
    asar_sha256: hash(syntheticFiles['resources/app.asar']),
    runtime: {bundle_sha256: '2'.repeat(64), tree_sha256: digestForwardInventory(sub('resources/client-state-runtime')),
      postgres_tree_sha256: digestForwardInventory(sub('resources/client-state-runtime/runtime/postgresql'))},
    image: {root: 'win-unpacked', schema: INSTALLED_TREE_SCHEMA, tree_sha256: digestForwardInventory(files), files},
    uninstaller: {name: FORWARD_UNINSTALLER, sha256: uninstallerHash,
      measurement: 'NSIS_GENERATED_AFTER_FRESH_INSTALL', installer_sha256: hash('synthetic installer')},
    installed_image: {schema: 'metaengine.operator.qa-installed-image-readback.v1', state: 'EXACT_CANDIDATE_IMAGE_VERIFIED',
      candidate_tree_sha256: digestForwardInventory(files),
      installed_tree_sha256: digestForwardInventory(sorted([...files, [FORWARD_UNINSTALLER, Buffer.byteLength(uninstallerBytes), uninstallerHash]])),
      file_count: Object.keys(syntheticFiles).length + 1, total_bytes: bytes + Buffer.byteLength(uninstallerBytes),
      uninstaller_sha256: uninstallerHash, full_tree_verified: true, production_authorized: false, authority_effect: false},
  };
  const pin = {source_head: HEAD, package_version: VERSION, producer_run_id: '101', producer_run_attempt: 1,
    installer_artifact: copy(manifest.installer_artifact),
    sidecar_artifact: {id: '202', name: `metaengine-browser-windows-forward-sidecar-${HEAD}`, sha256: '3'.repeat(64)}};
  const producerRun = {id: 101, run_number: 19, run_attempt: 1, event: 'pull_request', head_sha: HEAD,
    path: manifest.producer.workflow, repository: {full_name: manifest.producer.repository}, status: 'completed', conclusion: 'success'};
  const artifacts = [pin.installer_artifact, pin.sidecar_artifact].map(p => ({id: Number(p.id), name: p.name,
    digest: 'sha256:' + p.sha256, expired: false, workflow_run: {id: 101, head_sha: HEAD}}));
  const installerEvidence = {schema: 'metaengine.browser.installer-provenance-acquired.v1', source_head: HEAD,
    package_version: VERSION, installer_name: manifest.installer.name, installer_sha256: manifest.installer.sha256,
    installer_bytes: Buffer.byteLength('synthetic installer'), provenance_run_id: '101', provenance_run_number: 19,
    provenance_run_attempt: 1, provenance_workflow: 'browser-windows-package-smoke.yml',
    provenance_schema: 'metaengine.browser.installer-provenance.v3', build_identity_sha256: '4'.repeat(64),
    dependency_resolution_sha256: '5'.repeat(64), build_identity_verified: true, dependency_resolution_verified: true,
    blockmap_verified: true, config_verified: true, package_lock_sha256: '6'.repeat(64),
    me2_ui_bun_lock_sha256: '7'.repeat(64), npm_version: '11.19.0', bun_version: '1.3.3',
    package_lock_verified: true, me2_ui_bun_lock_verified: true};
  return {manifest, pin, producerRun, artifacts, artifactCount: artifacts.length, installerEvidence, uninstallerBytes};
}

test('v1 synthetic source fixture and terminal producer binding validate', () => {
  const f = fixture();
  assert.equal(validateForwardSidecar(f.manifest), f.manifest);
  const bound = validateForwardSidecarBinding(f);
  assert.equal(bound.producer_terminal_success, true);
  assert.equal(bound.producer_run_id, '101');
  assert.equal(bound.sidecar_artifact_id, '202');
  assert.equal(bound.authority_effect, false);
});

test('canonical inventory and readback agree with existing strict installed-image APIs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-sidecar-contract-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const candidate = path.join(root, 'candidate'), installed = path.join(root, 'installed');
  await fs.mkdir(candidate);
  for (const [relative, bytes] of Object.entries(syntheticFiles)) {
    const target = path.join(candidate, relative);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes);
  }
  await fs.mkdir(path.join(candidate, 'empty-directory'));
  await fs.cp(candidate, installed, {recursive: true});
  const f = fixture();
  await fs.writeFile(path.join(installed, FORWARD_UNINSTALLER), f.uninstallerBytes);
  const inventory = await captureForwardInventory(candidate);
  assert.deepEqual(inventory.files, f.manifest.image.files);
  assert.equal(inventory.tree_sha256, (await captureInstalledTreeFingerprint(candidate)).tree_sha256);
  const receipt = await compareQaInstalledImage(candidate, installed, {expectedUninstallerSha256: f.manifest.uninstaller.sha256});
  assert.deepEqual(receipt, f.manifest.installed_image);
  f.manifest.image = {root: 'win-unpacked', ...inventory};
  f.manifest.installed_image = receipt;
  assert.equal(validateForwardSidecar(f.manifest), f.manifest);
  assert.equal(await hashForwardFile(path.join(candidate, 'resources', 'app.asar')), f.manifest.asar_sha256);
  await assert.rejects(hashForwardFile(path.join(candidate, 'resources', 'app.asar'), {maxBytes: 2}), /file_size_limit/);
  await assert.rejects(captureForwardInventory(candidate, {limits: {maxFiles: 1}}), /inventory_size_limit/);
});

test('manifest cross-binding rejects payload, ASAR, runtime, uninstaller and receipt substitution', async t => {
  const changes = {
    schema: m => { m.schema = 'unrecognized.v1'; },
    installer: m => { m.installer.sha256 = 'f'.repeat(64); },
    tree: m => { m.image.tree_sha256 = 'f'.repeat(64); },
    asar: m => { m.asar_sha256 = 'f'.repeat(64); },
    runtime: m => { m.runtime.tree_sha256 = 'f'.repeat(64); },
    postgres: m => { m.runtime.postgres_tree_sha256 = 'f'.repeat(64); },
    invalidBundle: m => { m.runtime.bundle_sha256 = 'unknown'; },
    arrayInsteadOfBundleHash: m => { m.runtime.bundle_sha256 = ['2'.repeat(64)]; },
    arrayInsteadOfSource: m => { m.source_head = [HEAD]; },
    arrayInsteadOfVersion: m => { m.package_version = [VERSION]; },
    uninstaller: m => { m.uninstaller.sha256 = 'f'.repeat(64); },
    selfDerivedMeasurement: m => { m.uninstaller.measurement = 'CONSUMER_SUCCESSOR'; },
    wrongInstallerMeasurement: m => { m.uninstaller.installer_sha256 = 'f'.repeat(64); },
    receiptSchema: m => { m.installed_image.schema = 'unknown'; },
    receiptState: m => { m.installed_image.state = 'PENDING'; },
    receiptCandidate: m => { m.installed_image.candidate_tree_sha256 = 'f'.repeat(64); },
    receiptInstalled: m => { m.installed_image.installed_tree_sha256 = 'f'.repeat(64); },
    receiptCount: m => { m.installed_image.file_count++; },
    receiptBytes: m => { m.installed_image.total_bytes++; },
    receiptUninstaller: m => { m.installed_image.uninstaller_sha256 = 'f'.repeat(64); },
    receiptFullTree: m => { m.installed_image.full_tree_verified = false; },
    receiptProduction: m => { m.installed_image.production_authorized = true; },
    receiptAuthority: m => { m.installed_image.authority_effect = true; },
    forgedUninstallerPair: m => { m.uninstaller.sha256 = m.installed_image.uninstaller_sha256 = 'f'.repeat(64); },
    imageCount: m => { m.image.file_count = 999; },
    imageBytes: m => { m.image.total_bytes = 999; },
    unknownField: m => { m.migration_authorized = true; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const m = fixture().manifest; change(m);
    assert.throws(() => validateForwardSidecar(m), /qa_forward_sidecar_/);
  });
});

test('candidate cannot smuggle the generated uninstaller or omit runtime members', async t => {
  const changes = {
    uninstaller: m => { m.image.files.push([FORWARD_UNINSTALLER, 1, hash('x')]); },
    uninstallerCase: m => { m.image.files.push([FORWARD_UNINSTALLER.toLowerCase(), 1, hash('x')]); },
    uninstallerUnicodeAlias: m => { m.image.files.push([FORWARD_UNINSTALLER.replace('s', 'ſ'), 1, hash('x')]); },
    droppedPostgresLib: m => { m.image.files = m.image.files.filter(r => !r[0].endsWith('plpgsql.dll')); },
    droppedAsar: m => { m.image.files = m.image.files.filter(r => r[0] !== 'resources/app.asar'); },
    changedRuntime: m => { m.image.files.find(r => r[0].endsWith('postgres.exe'))[2] = 'f'.repeat(64); },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const m = fixture().manifest; change(m); sorted(m.image.files);
    m.image.tree_sha256 = digestForwardInventory(m.image.files);
    assert.throws(() => validateForwardSidecar(m), /qa_forward_sidecar_/);
  });
});

test('foreign, stale or internally drifting producer never qualifies a valid receipt', async t => {
  const mutations = {
    foreignRun: f => { f.producerRun.id = 102; },
    staleAttempt: f => { f.producerRun.run_attempt = 2; },
    staleHead: f => { f.producerRun.head_sha = 'b'.repeat(40); },
    runNumber: f => { f.producerRun.run_number = 20; },
    event: f => { f.producerRun.event = 'push'; },
    workflow: f => { f.producerRun.path = '.github/workflows/other.yml'; },
    repository: f => { f.producerRun.repository.full_name = 'other/Compute'; },
    missingRun: f => { f.producerRun = undefined; },
    pending: f => { f.producerRun.status = 'in_progress'; f.producerRun.conclusion = null; },
    queued: f => { f.producerRun.status = 'queued'; },
    failed: f => { f.producerRun.conclusion = 'failure'; },
    cancelled: f => { f.producerRun.conclusion = 'cancelled'; },
    missingConclusion: f => { f.producerRun.conclusion = null; },
    pinHead: f => { f.pin.source_head = 'b'.repeat(40); },
    pinVersion: f => { f.pin.package_version = '0.7.0-dev.37628000002.1'; },
    pinRun: f => { f.pin.producer_run_id = '102'; },
    pinAttempt: f => { f.pin.producer_run_attempt = 2; },
    pinNumber: f => { f.pin.producer_run_number = 20; },
    pinEvent: f => { f.pin.producer_event = 'push'; },
    receiptAttempt: f => { f.manifest.producer.run_attempt = 2; },
    receiptRun: f => { f.manifest.producer.run_id = '102'; },
    receiptNumber: f => { f.manifest.producer.run_number = 20; },
    receiptEvent: f => { f.manifest.producer.event = 'push'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => validateForwardSidecarBinding(f), /qa_forward_sidecar_/);
  });
});

test('exact artifact ID/digest and complete unambiguous collection are mandatory', async t => {
  const mutations = {
    missingSidecar: f => { f.artifacts[1].name = 'unrelated'; },
    missingInstaller: f => { f.artifacts[0].name = 'unrelated'; },
    duplicateSidecar: f => { f.artifacts.push({...copy(f.artifacts[1]), id: 203}); f.artifactCount++; },
    duplicateInstaller: f => { f.artifacts.push({...copy(f.artifacts[0]), id: 203}); f.artifactCount++; },
    duplicateID: f => { f.artifacts.push({...copy(f.artifacts[1]), name: 'unrelated'}); f.artifactCount++; },
    wrongSidecarID: f => { f.artifacts[1].id = 203; },
    wrongInstallerID: f => { f.artifacts[0].id = 203; },
    wrongSidecarDigest: f => { f.artifacts[1].digest = 'sha256:' + 'f'.repeat(64); },
    wrongInstallerDigest: f => { f.artifacts[0].digest = 'sha256:' + 'f'.repeat(64); },
    missingDigest: f => { delete f.artifacts[1].digest; },
    expired: f => { f.artifacts[1].expired = true; },
    missingExpiryState: f => { delete f.artifacts[1].expired; },
    foreignArtifactRun: f => { f.artifacts[1].workflow_run.id = 102; },
    foreignArtifactHead: f => { f.artifacts[0].workflow_run.head_sha = 'b'.repeat(40); },
    incompletePages: f => { f.artifactCount++; },
    absentCount: f => { delete f.artifactCount; },
    missingArtifacts: f => { f.artifacts = null; },
    sameIDs: f => { f.pin.sidecar_artifact.id = f.pin.installer_artifact.id; },
    substitutedPin: f => { f.pin.installer_artifact.sha256 = 'f'.repeat(64); },
    leadingZeroID: f => { f.pin.sidecar_artifact.id = '0202'; },
    latestName: f => { f.pin.sidecar_artifact.name = 'latest'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => validateForwardSidecarBinding(f), /qa_forward_sidecar_/);
  });
});

test('sidecar cannot replace or weaken the existing strict installer evidence', async t => {
  const mutations = {
    missing: f => { f.installerEvidence = null; },
    oldSchema: f => { f.installerEvidence.provenance_schema = 'metaengine.browser.installer-provenance.v1'; },
    source: f => { f.installerEvidence.source_head = 'b'.repeat(40); },
    version: f => { f.installerEvidence.package_version = '0.7.0-dev.37628000002.1'; },
    installer: f => { f.installerEvidence.installer_sha256 = 'f'.repeat(64); },
    installerName: f => { f.installerEvidence.installer_name = 'arbitrary.exe'; },
    attempt: f => { f.installerEvidence.provenance_run_attempt = 2; },
    run: f => { f.installerEvidence.provenance_run_id = '102'; },
    number: f => { f.installerEvidence.provenance_run_number = 20; },
    workflow: f => { f.installerEvidence.provenance_workflow = 'other.yml'; },
    identity: f => { f.installerEvidence.build_identity_verified = false; },
    dependency: f => { f.installerEvidence.dependency_resolution_verified = false; },
    blockmap: f => { f.installerEvidence.blockmap_verified = false; },
    config: f => { f.installerEvidence.config_verified = false; },
    identityDigest: f => { f.installerEvidence.build_identity_sha256 = null; },
    lock: f => { f.installerEvidence.package_lock_verified = false; },
    lockDigest: f => { f.installerEvidence.package_lock_sha256 = null; },
    bunLock: f => { f.installerEvidence.me2_ui_bun_lock_verified = false; },
    bunDigest: f => { f.installerEvidence.me2_ui_bun_lock_sha256 = null; },
    npmVersion: f => { f.installerEvidence.npm_version = ''; },
    bunVersion: f => { f.installerEvidence.bun_version = ''; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => validateForwardSidecarBinding(f), /qa_forward_sidecar_/);
  });
  const v2 = fixture();
  v2.installerEvidence.provenance_schema = 'metaengine.browser.installer-provenance.v2';
  for (const key of ['package_lock_verified', 'package_lock_sha256', 'me2_ui_bun_lock_sha256', 'me2_ui_bun_lock_verified', 'npm_version', 'bun_version']) delete v2.installerEvidence[key];
  assert.equal(validateForwardSidecarBinding(v2).producer_terminal_success, true);
});

test('Windows unsafe paths, aliases and inventory collisions are rejected on every host', async t => {
  const invalid = ['', '.', '..', '/absolute', '//server/share', 'C:/absolute', 'C:relative', '../escape',
    'a/../b', 'a/./b', 'a//b', 'a/', 'a\\b', 'a:b', 'a\0b', 'a\nb', 'file.', 'file ', 'a/NUL',
    'CON.txt', 'com1.dll', 'LPT¹', 'CONIN$', 'a?b', 'a*b', 'a|b', 'LONGFI~1.TXT', 'e\u0301.txt', '\uD800',
    'x'.repeat(256), Array(42).fill('a').join('/')];
  for (const name of invalid) await t.test(JSON.stringify(name), () => assert.throws(() => validateForwardRelativePath(name), /qa_forward_sidecar_/));
  for (const name of ['resources/app.asar', '.hidden', 'a/empty-directory', 'café.txt']) assert.equal(validateForwardRelativePath(name), name);
  const h = hash('x');
  for (const files of [
    [['same', 1, h], ['same', 1, h]],
    [['A', 1, h], ['a', 1, h]],
    [['S', 1, h], ['ſ', 1, h]],
    [['ς', 1, h], ['σ', 1, h]],
    [['a', 1, h], ['a/file', 1, h]],
    [['A', 'DIRECTORY'], ['a/file', 1, h]],
    [['missing-parent/file', 1, h]],
    [['b', 1, h], ['a', 1, h]],
    [['only-directory', 'DIRECTORY']],
    [['a', -1, h]], [['a', 1.2, h]], [['a', 1, 'bad']], [['a', 'DIRECTORY', h]],
  ]) assert.throws(() => validateForwardInventory(files), /qa_forward_sidecar_/);
  assert.equal(forwardPathCollisionKey('S'), forwardPathCollisionKey('ſ'));
  assert.equal(forwardPathCollisionKey('ς'), forwardPathCollisionKey('σ'));
});

test('physical source inventory rejects conservative Windows Unicode case aliases', async t => {
  if (process.platform !== 'linux') return t.skip('case-sensitive Linux fixture creates distinct Windows-alias filenames');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-sidecar-unicode-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const [index, pair] of [['S', 'ſ'], ['ς', 'σ']].entries()) {
    const candidate = path.join(root, String(index));
    await fs.mkdir(candidate);
    for (const name of pair) await fs.writeFile(path.join(candidate, name), 'synthetic');
    await assert.rejects(captureForwardInventory(candidate), /inventory_case_collision/);
  }
});

test('inventory budgets cannot be bypassed or expanded by callers', () => {
  const rows = [['a', 2, hash('aa')], ['b', 2, hash('bb')]];
  assert.throws(() => validateForwardInventory(rows, {maxEntries: 1}), /entry_limit/);
  assert.throws(() => validateForwardInventory(rows, {maxFiles: 1}), /size_limit/);
  assert.throws(() => validateForwardInventory(rows, {maxBytes: 3}), /size_limit/);
  assert.throws(() => validateForwardInventory(rows, {maxFileBytes: 1}), /file_invalid/);
  assert.throws(() => validateForwardInventory([['a', 'DIRECTORY'], ['a/b', 1, hash('b')]], {maxDepth: 1}), /depth_limit/);
  assert.throws(() => validateForwardInventory(rows, {maxBytes: FORWARD_SIDECAR_LIMITS.maxBytes + 1}), /limits_invalid/);
  assert.throws(() => validateForwardInventory(rows, {maxEntries: Infinity}), /limits_invalid/);
});

test('physical collector rejects hardlinks, symlinks and reparse ancestors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-sidecar-physical-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const real = path.join(root, 'real');
  await fs.mkdir(real);
  const file = path.join(real, 'file');
  await fs.writeFile(file, 'synthetic');
  await fs.link(file, path.join(real, 'hardlink'));
  await assert.rejects(captureForwardInventory(real), /regular_file_required/);
  await assert.rejects(hashForwardFile(file), /regular_file_required/);
  await fs.unlink(path.join(real, 'hardlink'));
  await t.test('reparse or symlink directory', async st => {
    const alias = path.join(root, 'alias');
    try { await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return st.skip('host disallows disposable link creation'); throw error; }
    await assert.rejects(captureForwardInventory(alias), /physical_directory_required/);
    await assert.rejects(hashForwardFile(path.join(alias, 'file')), /physical_directory_required/);
  });
  await assert.rejects(captureForwardInventory('.'), /absolute_local_path_required/);
});

test('predecessor empty-schema fixture is optional, exact, and cannot claim synthetic RPC bodies', () => {
  const m = fixture().manifest;
  m.schema_fixture = {file: 'predecessor-empty-schema.dump', sha256: hash('synthetic-test-dump-only'), source_head: HEAD,
    kind: 'REVIEWED_OFFLINE_EMPTY_SCHEMA', source_data_rows: 0, synthetic_rpc_bodies: false};
  assert.equal(validateForwardSidecar(m), m);
  for (const [key, value] of [['file', '../outside.dump'], ['source_head', 'b'.repeat(40)], ['source_data_rows', 1],
    ['synthetic_rpc_bodies', true], ['sha256', 'wrong'], ['kind', 'USER_DATABASE']]) {
    const changed = copy(m); changed.schema_fixture[key] = value;
    assert.throws(() => validateForwardSidecar(changed), /schema_fixture_invalid/);
  }
});
