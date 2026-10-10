import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertInstalledLaunchIdentity, assertFirstRunDomContract, assertOwnerStartupGrace,
  assertOfflineSuccessorBinding, qualifyInstalledOfflineSuccessor,
  isolatedLaunchEnvironment } from '../scripts/qualify-installed-client-launch.mjs';
import { persistUpdatedSuccessorReceipt, selfUpdateHandoffPaths } from '../src/self-update-handoff.mjs';

const expectedHead = 'a'.repeat(40), expectedVersion = '0.7.0-dev.37781000050.1';
const identity = () => ({ version: expectedVersion, main: 'src/final-runtime-entry.mjs',
  metaengineEmergencyTrustRoot: { build_sha: expectedHead },
  metaengineBuildIdentity: { source_head: expectedHead, package_version: expectedVersion },
  metaengineClientStateRuntime: { source_head_sha: expectedHead, package_version: expectedVersion, bundle_sha256: 'b'.repeat(64) } });

test('installed launch refuses a stale executable package or a differently pinned runtime', () => {
  assert.equal(assertInstalledLaunchIdentity(identity(), { expectedHead, expectedVersion }).bundle_sha256, 'b'.repeat(64));
  for (const changed of [
    value => { value.version = '0.7.0-dev.37781000048.1'; },
    value => { value.metaengineBuildIdentity.source_head = 'c'.repeat(40); },
    value => { value.metaengineClientStateRuntime.source_head_sha = 'c'.repeat(40); },
    value => { value.metaengineClientStateRuntime.package_version = 'old'; },
    value => { value.metaengineClientStateRuntime.bundle_sha256 = 'unsealed'; },
    value => { value.main = 'src/main.mjs'; },
  ]) {
    const value = identity(); changed(value);
    assert.throws(() => assertInstalledLaunchIdentity(value, { expectedHead, expectedVersion }), /package_identity_mismatch/);
  }
});

test('isolated launch drops all inherited credentials, owner endpoint, module loaders and UI adoption overrides', () => {
  const env = isolatedLaunchEnvironment({ appData: 'qa/roaming', localAppData: 'qa/local', temporaryDirectory: 'qa/temp',
    uiPort: 19000, gatewayPort: 19001, daemonPort: 19002 }, { PATH: 'system-path', APPDATA: 'production-profile',
    LOCALAPPDATA: 'production-local', SUPABASE_URL: 'https://hosted.invalid', GH_TOKEN: 'test-secret',
    METAENGINE_SUPERVISOR_BASE_URL: 'https://hosted.invalid', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--import=hostile',
    ME2_UI_ALLOW_EXTERNAL_ADOPT: '1', ME2_UI_DIR: 'source-tree', ME2_UI_BIN: 'external-bun' });
  assert.equal(env.APPDATA, 'qa/roaming'); assert.equal(env.LOCALAPPDATA, 'qa/local');
  assert.equal(env.ME2_UI_ALLOW_EXTERNAL_ADOPT, '0'); assert.equal(env.HOSTNAME, '0.0.0.0');
  assert.equal(env.ME2_DAEMON_REST, 'http://127.0.0.1:19002'); assert.equal(env.NODE_USE_ENV_PROXY, '1');
  for (const key of ['SUPABASE_URL', 'GH_TOKEN', 'METAENGINE_SUPERVISOR_BASE_URL', 'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS', 'ME2_UI_DIR', 'ME2_UI_BIN']) assert.equal(Object.hasOwn(env, key), false, key);
});

const dom = () => ({ config: true, receipt: true, connect: true, digest: true, consent_preload: true,
  node_in_page: false, csp: "default-src 'none'; connect-src 'none'", heading: 'Connect your existing PostgreSQL 17',
  url: 'file:///test/resources/app.asar/src/local-restored-pg17-setup.html', resources: [] });

test('installed first-run DOM must retain local-only consent and an isolated renderer', () => {
  assert.equal(assertFirstRunDomContract(dom()), true);
  for (const [key, value] of [['connect', false], ['consent_preload', false], ['node_in_page', true],
    ['csp', "connect-src *"], ['url', 'https://hosted.invalid/setup'], ['resources', ['https://hosted.invalid/script.js']]]) {
    assert.throws(() => assertFirstRunDomContract({ ...dom(), [key]: value }), /first_run_dom_contract_invalid/);
  }
});

const now = Date.parse('2026-10-10T12:00:00Z');
function grace() {
  return { before: { current_boot_id: 'boot-qa' }, after: { current_boot_id: 'boot-qa' }, pid: 712,
    sentinelBefore: { token: 'token-qa', parent_pid: 712, worker_pid: 714, worker_recovery_generation: 0 },
    sentinelAfter: { token: 'token-qa', parent_pid: 712, worker_pid: 714, worker_recovery_generation: 0,
      relaunch_attempted: false, worker_released: false },
    progressBefore: { token: 'token-qa', parent_pid: 712, progress_seq: 12 },
    progressAfter: { token: 'token-qa', parent_pid: 712, progress_seq: 13, progress_at: '2026-10-10T11:59:59Z' }, now };
}

test('Owner startup grace requires the same real incarnation and advancing fresh progress', () => {
  assert.equal(assertOwnerStartupGrace(grace()), true);
  for (const change of [
    value => { value.after.current_boot_id = 'restarted-boot'; },
    value => { value.sentinelAfter.worker_pid = 715; },
    value => { value.sentinelAfter.parent_pid = 713; },
    value => { value.sentinelAfter.relaunch_attempted = true; },
    value => { value.sentinelAfter.worker_recovery_generation = 1; },
    value => { value.progressAfter.progress_seq = 12; },
    value => { value.progressAfter.progress_at = 'malformed'; },
    value => { value.progressAfter.progress_at = '2026-10-10T11:59:20Z'; },
    value => { value.progressAfter.progress_at = '2026-10-10T12:00:20Z'; },
    value => { value.progressAfter.token = 'unrelated-owner'; },
  ]) {
    const value = grace(); change(value);
    assert.throws(() => assertOwnerStartupGrace(value), /normal_startup_grace_survival_unproven/);
  }
});

function offlineBinding() {
  const preInstall = { schema: 'metaengine.self-update.pre-install-receipt.v1', version: expectedVersion,
    available_version: expectedVersion, resolved_git_sha: expectedHead, successor_startup: 'PROBE_ONLY',
    metadata_verified: true, restart_gate_safe: true, authority_effect: false, recorded_at: new Date(now).toISOString() };
  const preInstallBytes = Buffer.from(JSON.stringify(preInstall));
  const transactionBefore = { state: 'PREPARED', transaction_id: 'transaction-qa', source_version: expectedVersion,
    created_at: new Date(now).toISOString(), attempt_count: 1 };
  const transaction = { ...transactionBefore, schema: 'metaengine.self-update.transaction.v1', state: 'SUCCESSOR_BOOTED',
    target_version: expectedVersion, resolved_git_sha: expectedHead, qualified: false, quarantined: false,
    automatic_retry_allowed: false, authority_effect: false,
    evidence: { updated_argv: true, primary_instance: true, boot_version_match: true } };
  const successor = { schema: 'metaengine.self-update.successor-receipt.v1', version: expectedVersion,
    pid: 712, app_id: 'com.metaengine.browser.test', primary_instance: true, successor_startup: 'PROBE_ONLY',
    qualification_state: 'BOOT_VERIFIED', authority_effect: false, recorded_at: new Date(now).toISOString(),
    pre_install_recorded_at: preInstall.recorded_at,
    pre_install_receipt_sha256: createHash('sha256').update(preInstallBytes).digest('hex') };
  return { preInstall, preInstallBytes, transactionBefore, transaction, successor,
    expectedVersion, expectedHead, pid: successor.pid, appId: successor.app_id };
}

test('offline successor proof requires the exact durable head/version/PID and original transaction', () => {
  assert.equal(assertOfflineSuccessorBinding(offlineBinding()).transaction_id, 'transaction-qa');
  for (const change of [
    value => { value.successor.version = 'stale'; },
    value => { value.successor.pid += 1; },
    value => { value.successor.app_id = 'another-app'; },
    value => { value.successor.primary_instance = false; },
    value => { value.successor.successor_startup = 'NORMAL'; },
    value => { value.successor.pre_install_receipt_sha256 = 'b'.repeat(64); },
    value => { value.transaction.resolved_git_sha = 'b'.repeat(40); },
    value => { value.transaction.transaction_id = 'unrelated'; },
    value => { value.transaction.state = 'QUALIFIED'; },
    value => { value.transaction.evidence.physical_effect_attempted = true; },
    value => { value.transaction.evidence.effect_barrier_crossed = true; },
    value => { value.transactionBefore.state = 'INSTALLING'; },
    value => { value.preInstall.resolved_git_sha = 'b'.repeat(40); },
  ]) {
    const value = offlineBinding(); change(value);
    assert.throws(() => assertOfflineSuccessorBinding(value), /offline_successor_binding_invalid/);
  }
});

async function offlineExercise(t, { mutate, result = { code: 0 }, profileChange } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-installed-offline-proof-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const executable = path.join(root, 'exact-installed-executable'), archive = path.join(root, 'exact-installed-app.asar');
  await fs.writeFile(executable, 'inert-executable-boundary-fixture');
  await fs.writeFile(archive, 'inert-installed-archive-boundary-fixture');
  let probeCount = 0, stopped = false;
  // Only the Electron process boundary is doubled. The qualifier creates real
  // fixtures and calls production receipt/journal functions, then reads files.
  const probeProfile = async (_executable, env) => {
    probeCount += 1;
    const user_data_path = path.join(env.APPDATA, 'BrowserProfile');
    await fs.mkdir(user_data_path, { recursive: true });
    const profile = { user_data_path, version: expectedVersion, app_id: 'com.metaengine.browser.test', primary_instance: true };
    if (profileChange) await profileChange(profile, probeCount, root);
    return profile;
  };
  const launchProcess = (launchedExecutable, args, env, cwd) => {
    assert.equal(launchedExecutable, executable);
    assert.equal(args[0], '--updated'); assert.equal(args.length, 2);
    assert.equal(cwd.startsWith(root + path.sep), true);
    for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'METAENGINE_STATE_PROVIDER', 'GH_TOKEN']) {
      assert.equal(Object.hasOwn(env, key), false, key);
    }
    const userData = args[1].slice('--user-data-dir='.length);
    const app = { isPackaged: true, getPath: () => userData, getVersion: () => expectedVersion, hasSingleInstanceLock: () => true };
    let output = '';
    const closed = (async () => {
      const receipt = await persistUpdatedSuccessorReceipt(app, { argv: ['--updated'], appId: 'com.metaengine.browser.test', primaryInstance: true });
      output = JSON.stringify(receipt.row) + '\n';
      const context = { app, root, executable, archive, userData, env, cwd, paths: selfUpdateHandoffPaths(app),
        setOutput: value => { output = value; } };
      if (mutate) await mutate(context);
      return result;
    })();
    return { child: { pid: process.pid, exitCode: 0, signalCode: null }, closed, output: () => output };
  };
  const run = () => qualifyInstalledOfflineSuccessor({ executable, archive, directory: root,
    identity: { source_head: expectedHead, package_version: expectedVersion, bundle_sha256: 'b'.repeat(64) } },
    { probeProfile, launchProcess, stopProcess: async () => { stopped = true; } });
  return { run, stopped: () => stopped, probeCount: () => probeCount };
}

test('installed offline exercise persists and reads a real durable handoff then reacquires the isolated profile', async t => {
  const fixture = await offlineExercise(t), proof = await fixture.run();
  assert.equal(proof.source_head, expectedHead); assert.equal(proof.package_version, expectedVersion);
  assert.equal(proof.offline_successor_probe_qualified, true); assert.equal(proof.transaction_state, 'SUCCESSOR_BOOTED');
  assert.equal(proof.singleton_reacquisition_verified, true); assert.equal(fixture.probeCount(), 2);
  assert.equal(fixture.stopped(), true); assert.equal(proof.synthetic_handoff, true);
  assert.equal(proof.physical_update_qualified, false); assert.equal(proof.owner_boot_qualified, false);
  assert.equal(proof.production_ready, false); assert.match(proof.installed_asar_sha256, /^[a-f0-9]{64}$/);
});

test('installed offline exercise rejects exit 0 without an exact receipt/output or original transaction', async t => {
  for (const [mutate, error] of [
    [async f => fs.unlink(f.paths.successor), /ENOENT/],
    [async f => f.setOutput('{}\n'), /offline_successor_output_readback_mismatch/],
    [async f => {
      const receipt = JSON.parse(await fs.readFile(f.paths.successor, 'utf8'));
      receipt.version = 'old'; await fs.writeFile(f.paths.successor, JSON.stringify(receipt));
    }, /offline_successor_binding_invalid/],
    [async f => {
      const file = path.join(f.userData, 'metaengine-self-update-transaction-v1.json');
      const transaction = JSON.parse(await fs.readFile(file, 'utf8'));
      transaction.transaction_id = 'unrelated-transaction'; await fs.writeFile(file, JSON.stringify(transaction));
    }, /offline_successor_binding_invalid/],
  ]) {
    const fixture = await offlineExercise(t, { mutate });
    await assert.rejects(fixture.run(), error); assert.equal(fixture.stopped(), true); assert.equal(fixture.probeCount(), 1);
  }
});

test('installed offline exercise rejects provider/runtime artifacts and any fixture or installed payload mutation', async t => {
  for (const [mutate, error] of [
    [async f => f.setOutput(JSON.stringify(JSON.parse(await fs.readFile(f.paths.successor, 'utf8'))) + '\nRUNTIME_IMPORT_OK\n'), /offline_successor_runtime_admitted/],
    [async f => fs.appendFile(f.paths.pre_install, ' '), /offline_pre_install_receipt_modified/],
    [async f => fs.writeFile(path.join(f.env.APPDATA, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json'), 'changed-owner'), /offline_owner_fixture_modified/],
    [async f => fs.writeFile(path.join(f.cwd, 'protected-storage', 'pg-data', 'unexpected-write'), 'changed'), /offline_fixture_storage_modified/],
    [async f => fs.writeFile(path.join(f.userData, 'metaengine-browser-startup-journal-v1.json'), '{}'), /offline_successor_runtime_artifact_created/],
    [async f => fs.appendFile(f.archive, 'changed'), /offline_installed_artifacts_modified/],
  ]) {
    const fixture = await offlineExercise(t, { mutate });
    await assert.rejects(fixture.run(), error); assert.equal(fixture.stopped(), true);
  }
});

test('installed offline exercise rejects abnormal exit and failed exact-profile singleton reacquisition', async t => {
  const failed = await offlineExercise(t, { result: { code: 1 } });
  await assert.rejects(failed.run(), /offline_successor_exit_invalid/); assert.equal(failed.stopped(), true);
  const secondary = await offlineExercise(t, { profileChange: (profile, count) => { if (count === 2) profile.primary_instance = false; } });
  await assert.rejects(secondary.run(), /offline_singleton_reacquisition_invalid/);
  const escaped = await offlineExercise(t, { profileChange: (profile, count, root) => { if (count === 1) profile.user_data_path = root; } });
  await assert.rejects(escaped.run(), /offline_profile_binding_invalid/);
});
