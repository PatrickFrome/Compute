import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ORIGINAL_PREDECESSOR as PIN, PREDECESSOR_QUALIFIER_WORKFLOW, PREDECESSOR_UNINSTALLER,
  PREDECESSOR_DETACHED_PROOFS, assertPredecessorHostedEnvironment,
  assertOriginalPredecessorMetadata, assertStrictPredecessorVerification,
  deriveOriginalPredecessorExpectations, assertPredecessorInstalledRows,
  validatePredecessorRows, predecessorPhysicalPath, capturePredecessorRows,
  materializeVerifiedPredecessor, assertPredecessorBoundedInstall, qualifyPredecessorMaterialization,
  predecessorFailureSummary,
} from '../scripts/qualify-predecessor-materialization.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sort = rows => rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const fileRow = (name, content) => [name, Buffer.byteLength(content), hash(content)];
const clone = value => JSON.parse(JSON.stringify(value));
function environment() {
  return { GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: PIN.repository, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40),
    GITHUB_REF: 'refs/heads/work/preinstall-closure-20261027',
    GITHUB_RUN_ID: '40420000111', GITHUB_RUN_NUMBER: '4', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: PIN.repository + '/' + PREDECESSOR_QUALIFIER_WORKFLOW + '@refs/heads/work/preinstall-closure-20261027',
    SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local', RUNNER_TEMP: 'D:\\a\\_temp', GITHUB_WORKSPACE: 'D:\\a\\Compute\\Compute' };
}
function metadata() {
  const run = { id: Number(PIN.run_id), repository: { full_name: PIN.repository }, head_sha: PIN.source_head,
    path: PIN.workflow, run_attempt: PIN.run_attempt, run_number: PIN.run_number, event: PIN.event,
    status: 'completed', conclusion: 'success', run_started_at: '2026-10-26T19:01:00Z', updated_at: '2026-10-26T19:24:02Z' };
  const artifact = { id: Number(PIN.artifact_id), name: PIN.artifact_name, expired: false, digest: 'sha256:' + PIN.artifact_sha256,
    size_in_bytes: PIN.artifact_bytes, workflow_run: { id: Number(PIN.run_id), head_sha: PIN.source_head }, created_at: '2026-10-26T19:15:01Z' };
  return { run, artifact, artifacts: [artifact] };
}
function fixture() {
  const files = {
    'METAENGINE Browser Test.exe': Buffer.from('original executable'),
    'resources/app.asar': Buffer.from('original asar bytes'),
    'resources/client-state-runtime/offline-runtime-bundle.json': Buffer.from('{"fixture":true}'),
  };
  const rows = sort([['resources', 'DIRECTORY'], ['resources/client-state-runtime', 'DIRECTORY'],
    ...Object.entries(files).map(([name, bytes]) => fileRow(name, bytes))]);
  const doc = { schema: 'metaengine.browser.installed-package-code.v1', source_sha: PIN.source_head,
    package_version: PIN.package_version, exe_name: 'METAENGINE Browser Test.exe', entries: rows.map(row => row.length === 2
      ? { path: row[0], kind: 'directory' } : { path: row[0], kind: 'file', size: row[1], sha256: row[2] }) };
  const bytes = Buffer.from(JSON.stringify(doc) + '\n');
  const pin = { ...PIN, package_code_sha256: hash(bytes) };
  const archive = [fileRow('metaengine-installed-package-code.v1.json', bytes)];
  const expected = deriveOriginalPredecessorExpectations(bytes, archive, pin);
  const installed = sort([...rows, fileRow(PREDECESSOR_UNINSTALLER, 'generated uninstaller')]);
  return { files, rows, bytes, pin, archive, expected, installed };
}
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'predecessor-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
async function writeInstalled(root, fx, { includeManifest = false } = {}) {
  await fs.mkdir(root);
  for (const row of fx.rows.filter(r => r.length === 2)) await fs.mkdir(path.join(root, ...row[0].split('/')));
  for (const [name, bytes] of Object.entries(fx.files)) await fs.writeFile(path.join(root, ...name.split('/')), bytes);
  await fs.writeFile(path.join(root, PREDECESSOR_UNINSTALLER), 'generated uninstaller');
  if (includeManifest) await fs.writeFile(path.join(root, 'metaengine-installed-package-code.v1.json'), fx.bytes);
}

test('physical entry requires distinct exact-source hosted Windows on approved push/dispatch refs', () => {
  const env = environment();
  const result = assertPredecessorHostedEnvironment({ env, platform: 'win32', expectedHead: env.GITHUB_SHA });
  assert.equal(result.terminal_success_required_by_consumer, true);
  assert.notEqual(result.run_id, PIN.run_id);
  for (const ref of ['refs/heads/work/preinstall-closure-20261027', 'refs/heads/work/preinstall-shared-inputs-20261027']) {
    const push = { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_REF: ref,
      GITHUB_WORKFLOW_REF: PIN.repository + '/' + PREDECESSOR_QUALIFIER_WORKFLOW + '@' + ref };
    const observed = assertPredecessorHostedEnvironment({ env: push, platform: 'win32', expectedHead: env.GITHUB_SHA });
    assert.equal(observed.event, 'push'); assert.equal(observed.ref, ref);
    assert.throws(() => assertPredecessorHostedEnvironment({ env: { ...push, GITHUB_SHA: 'b'.repeat(40) }, platform: 'win32', expectedHead: env.GITHUB_SHA }), /disposable_hosted_windows_required/);
  }
  for (const [key, value] of [['RUNNER_ENVIRONMENT', 'self-hosted'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REPOSITORY', 'fork/Compute'],
    ['GITHUB_REF', 'refs/heads/main'],
    ['GITHUB_RUN_ID', PIN.run_id], ['GITHUB_SHA', 'b'.repeat(40)], ['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_WORKFLOW_REF', 'wrong/workflow']])
    assert.throws(() => assertPredecessorHostedEnvironment({ env: { ...env, [key]: value }, platform: 'win32', expectedHead: env.GITHUB_SHA }), /disposable_hosted_windows_required/);
  assert.throws(() => assertPredecessorHostedEnvironment({ env, platform: 'linux', expectedHead: env.GITHUB_SHA }), /disposable_hosted_windows_required/);
});

test('original artifact remains tied to its own successful producer and complete unique listing', () => {
  const { run, artifact, artifacts } = metadata();
  assert.equal(assertOriginalPredecessorMetadata(run, artifact, artifacts), true);
  for (const patch of [{ status: 'in_progress' }, { conclusion: 'failure' }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) },
    { path: PREDECESSOR_QUALIFIER_WORKFLOW }, { event: 'workflow_dispatch' }])
    assert.throws(() => assertOriginalPredecessorMetadata({ ...run, ...patch }, artifact, artifacts), /original_producer_unqualified/);
  for (const patch of [{ expired: true }, { digest: 'sha256:' + '0'.repeat(64) }, { size_in_bytes: 1 },
    { workflow_run: { id: 123, head_sha: PIN.source_head } }, { created_at: '2026-10-25T19:15:00Z' }])
    assert.throws(() => assertOriginalPredecessorMetadata(run, { ...artifact, ...patch }, artifacts), /original_artifact_unqualified/);
  assert.throws(() => assertOriginalPredecessorMetadata(run, artifact, [artifact, { ...artifact, id: 7 }]), /original_artifact_ambiguous/);
});

test('strict existing provenance receipt cannot be replaced by just an installer hash', () => {
  const result = { schema: 'metaengine.browser.installer-provenance-acquired.v1', source_head: PIN.source_head,
    package_version: PIN.package_version, installer_sha256: PIN.installer_sha256, installer_name: PIN.installer_name,
    installer_bytes: PIN.installer_bytes, provenance_run_id: PIN.run_id, provenance_run_number: PIN.run_number,
    provenance_run_attempt: PIN.run_attempt, provenance_workflow: 'browser-windows-package-smoke.yml',
    provenance_schema: 'metaengine.browser.installer-provenance.v3', build_identity_verified: true,
    dependency_resolution_verified: true, package_lock_verified: true, me2_ui_bun_lock_verified: true,
    blockmap_verified: true, config_verified: true };
  assert.equal(assertStrictPredecessorVerification(result), true);
  for (const field of ['build_identity_verified', 'dependency_resolution_verified', 'package_lock_verified', 'me2_ui_bun_lock_verified', 'blockmap_verified', 'config_verified'])
    assert.throws(() => assertStrictPredecessorVerification({ ...result, [field]: false }), /strict_installer_verification_required/);
  assert.throws(() => assertStrictPredecessorVerification({ ...result, provenance_run_id: '40420000111' }), /strict_installer_verification_required/);
});

test('all four detached exclusions receive prior original-artifact expectations', () => {
  const fx = fixture();
  assert.deepEqual(fx.expected.proofBindings.map(p => p.name), PREDECESSOR_DETACHED_PROOFS);
  assert.equal(fx.expected.proofBindings.filter(p => p.state === 'ABSENT_FROM_ORIGINAL_ARTIFACT').length, 3);
  const absent = assertPredecessorInstalledRows(fx.expected, fx.installed);
  assert(absent.proofReadbacks.every(p => p.readback === 'ABSENCE_VERIFIED'));
  const presentRows = sort([...fx.installed, fileRow('metaengine-installed-package-code.v1.json', fx.bytes)]);
  const present = assertPredecessorInstalledRows(fx.expected, presentRows);
  assert.equal(present.proofReadbacks.at(-1).readback, 'PRESENT_ORIGINAL_BYTES_VERIFIED');
  assert.equal(present.uninstaller.measurement, 'INDEPENDENT_DISPOSABLE_FRESH_INSTALL');
});

test('detached files cannot use arbitrary observed bytes or hide behind an allowed filename', () => {
  const fx = fixture();
  for (const name of PREDECESSOR_DETACHED_PROOFS.slice(0, 3))
    assert.throws(() => assertPredecessorInstalledRows(fx.expected, sort([...fx.installed, fileRow(name, 'invented')])), /unbound_detached_proof/);
  assert.throws(() => assertPredecessorInstalledRows(fx.expected, sort([...fx.installed,
    fileRow('metaengine-installed-package-code.v1.json', 'forged manifest')])), /detached_proof_changed/);
  const incomplete = { ...fx.expected, proofBindings: fx.expected.proofBindings.slice(1) };
  assert.throws(() => assertPredecessorInstalledRows(incomplete, fx.installed), /detached_proof_contract/);
});

test('original manifest tampering, source substitution, and duplicate proof origins reject', () => {
  const fx = fixture();
  assert.throws(() => deriveOriginalPredecessorExpectations(Buffer.concat([fx.bytes, Buffer.from(' ')]), fx.archive, fx.pin), /original_code_manifest_digest/);
  assert.throws(() => deriveOriginalPredecessorExpectations(fx.bytes, fx.archive, { ...fx.pin, source_head: 'a'.repeat(40) }), /original_code_manifest_binding/);
  const duplicate = sort([['browser-slsa-provenance', 'DIRECTORY'], ...fx.archive,
    fileRow('browser-slsa-provenance/metaengine-installed-package-code.v1.json', fx.bytes)]);
  assert.throws(() => deriveOriginalPredecessorExpectations(fx.bytes, duplicate, fx.pin), /detached_proof_original_ambiguous/);
});

test('full running-code inventory rejects altered, missing and extra payload files', () => {
  const fx = fixture();
  for (const rows of [fx.installed.filter(r => r[0] !== 'resources/app.asar'),
    sort([...fx.installed, fileRow('unexpected.dll', 'extra')]),
    fx.installed.map(r => r[0] === 'resources/app.asar' ? fileRow(r[0], 'changed') : r)])
    assert.throws(() => assertPredecessorInstalledRows(fx.expected, rows), /installed_original_image_mismatch/);
  assert.throws(() => assertPredecessorInstalledRows(fx.expected, fx.installed.filter(r => r[0] !== PREDECESSOR_UNINSTALLER)), /uninstaller_readback_missing/);
});

test('inventory rejects traversal, Unicode Windows aliases and file-directory ambiguity', () => {
  const h = 'a'.repeat(64);
  for (const rows of [[['../escape', 1, h]], [['C:/escape', 1, h]], [['S', 1, h], ['ſ', 1, h]],
    [['ς', 1, h], ['σ', 1, h]], [['resources', 1, h], ['resources/file', 1, h]], [['a/file', 1, h]],
    [['NUL.txt', 1, h]], [['a.', 1, h]], [['a', 1, h], ['a', 1, h]]])
    assert.throws(() => validatePredecessorRows(rows), /inventory_/);
});

test('physical paths reject symlink ancestors and hardlinked inputs', async t => {
  const root = await temp(t), real = path.join(root, 'real'); await fs.mkdir(real);
  const file = path.join(real, 'input'); await fs.writeFile(file, 'bytes');
  const alias = path.join(root, 'alias');
  await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(predecessorPhysicalPath(path.join(alias, 'input')), /path_alias_or_type/);
  const linked = path.join(root, 'linked'); await fs.link(file, linked);
  await assert.rejects(predecessorPhysicalPath(linked), /path_alias_or_type/);
  await assert.rejects(capturePredecessorRows(real), /tree_file_type/);
});

test('materialization copies only independently matched bytes and excludes the measured uninstaller', async t => {
  const root = await temp(t), fx = fixture(), installed = path.join(root, 'installed'), destination = path.join(root, 'image');
  await writeInstalled(installed, fx, { includeManifest: true });
  const result = await materializeVerifiedPredecessor({ installedRoot: installed, destination, expected: fx.expected });
  assert.equal(result.source_unchanged, true); assert.equal(result.copied_tree_verified, true);
  await assert.rejects(fs.lstat(path.join(destination, PREDECESSOR_UNINSTALLER)), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(destination, 'resources', 'app.asar')), fx.files['resources/app.asar']);
  assert.equal(result.proofReadbacks.at(-1).readback, 'PRESENT_ORIGINAL_BYTES_VERIFIED');
  await assert.rejects(materializeVerifiedPredecessor({ installedRoot: installed, destination, expected: fx.expected }), /prior_attempt_or_state/);
});

test('mismatched predecessor rejects before creating any image output', async t => {
  const root = await temp(t), fx = fixture(), installed = path.join(root, 'installed'), destination = path.join(root, 'image');
  await writeInstalled(installed, fx);
  await fs.writeFile(path.join(installed, 'resources', 'app.asar'), 'altered bytes');
  await assert.rejects(materializeVerifiedPredecessor({ installedRoot: installed, destination, expected: fx.expected }), /installed_original_image_mismatch/);
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
});

test('materialization refuses descendant destinations but permits a path-prefix lookalike', async t => {
  const root = await temp(t), fx = fixture(), installed = path.join(root, 'installed'); await writeInstalled(installed, fx);
  await assert.rejects(materializeVerifiedPredecessor({ installedRoot: installed, destination: path.join(installed, 'copy'), expected: fx.expected }), /materialization_roots_overlap/);
  const result = await materializeVerifiedPredecessor({ installedRoot: installed, destination: path.join(root, 'installed-copy'), expected: fx.expected });
  assert.equal(result.copied_tree_verified, true);
});

test('bounded process result requires success and cleanup contract, never an unknown effect', () => {
  const good = { schema: 'metaengine.browser.bounded-package-install.v1', installer_sha256: PIN.installer_sha256,
    installer_exit_code: 0, installer_pid: 12345, process_tree_scoped_job: true, descendant_cleanup_on_job_close: true,
    installed_payload_qualification_required: true, authority_effect: false };
  assert.equal(assertPredecessorBoundedInstall(good), true);
  for (const patch of [{ installer_exit_code: 23 }, { installer_pid: null }, { process_tree_scoped_job: false },
    { descendant_cleanup_on_job_close: false }, { installer_sha256: '0'.repeat(64) }])
    assert.throws(() => assertPredecessorBoundedInstall({ ...good, ...patch }), /bounded_install_unconfirmed/);
});

test('unsupported physical entry refuses before acquisition, output creation or install', { skip: process.platform === 'win32' }, async t => {
  const root = await temp(t), work = path.join(root, 'work'), out = path.join(root, 'artifact');
  await assert.rejects(qualifyPredecessorMaterialization({ workDirectory: work, outputDirectory: out, expectedQualifierHead: 'a'.repeat(40) }), /disposable_hosted_windows_required/);
  await assert.rejects(fs.lstat(work), { code: 'ENOENT' }); await assert.rejects(fs.lstat(out), { code: 'ENOENT' });
});

test('shared CLI failure projection emits no token, raw path or child error detail', () => {
  const marker = 'private-path-and-token-marker';
  const error = Object.assign(new Error('/private/' + marker), { code: 'ENOENT', stderr: marker,
    env: { ME2_GITHUB_TOKEN: marker }, path: '/private/' + marker });
  const value = predecessorFailureSummary(error);
  assert(!JSON.stringify(value).includes(marker)); assert.equal(value.state, 'BLOCKED');
  assert.equal(value.automatic_retry_allowed, false); assert.equal(value.hold_recorded, false);
  const unrecorded = predecessorFailureSummary({ ...error, effectStarted: true });
  assert.equal(unrecorded.state, 'HOLD_EFFECT_OUTCOME_UNQUALIFIED'); assert.equal(unrecorded.hold_recorded, false);
  assert.equal(predecessorFailureSummary({ effectStarted: true, holdRecorded: true }).hold_recorded, true);
});
