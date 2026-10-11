import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPackage, uncache } from '@electron/asar';
import { assertInstalledLaunchIdentity, assertMissingDescriptorAdmissionContract, assertOwnerStartupGrace,
  assertInstalledPrimaryWindowJournal, assertInstalledPrimaryCdpWindow,
  assertInstalledVisibleWindow,
  prepareIsolatedAttachedAutoConnect, assertAutomaticAttachedOwnerBinding, ISOLATED_OWNER_MARKER,
  REMOVED_DATABASE_WIZARD_FILES,
  assertOfflineSuccessorBinding, qualifyInstalledOfflineSuccessor,
  isolatedLaunchEnvironment, INSTALLED_LAUNCH_SOURCE_FILES,
  qualifyInstalledClientLaunch } from '../scripts/qualify-installed-client-launch.mjs';
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

test('installed launch reads actual nested ASAR bytes on Windows before enforcing the runtime binding',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-installed-asar-paths-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const installRoot = path.join(root, 'installed'), resources = path.join(installRoot, 'resources');
    const archiveSource = path.join(root, 'archive-source'), sourceRoot = path.join(root, 'source');
    const sourceApp = path.join(sourceRoot, 'apps', 'metaengine-browser');
    await fs.mkdir(resources, { recursive: true });
    await fs.mkdir(archiveSource, { recursive: true });
    await fs.writeFile(path.join(installRoot, 'METAENGINE Browser Test.exe'), 'inert-unlaunchable-fixture');
    await fs.writeFile(path.join(archiveSource, 'package.json'), JSON.stringify(identity()));
    for (const relative of INSTALLED_LAUNCH_SOURCE_FILES) {
      const bytes = Buffer.from('exact nested source fixture: ' + relative);
      for (const directory of [archiveSource, sourceApp]) {
        const target = path.join(directory, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes);
      }
    }
    const verifier = path.join(archiveSource, 'infra', 'client-state-runtime', 'offline-runtime-bundle.mjs');
    await fs.mkdir(path.dirname(verifier), { recursive: true });
    await fs.writeFile(verifier, 'inert runtime verifier fixture');
    const staleWizard = path.join(archiveSource, REMOVED_DATABASE_WIZARD_FILES[0]);
    await fs.writeFile(staleWizard, 'stale database chooser');
    await createPackage(archiveSource, path.join(resources, 'app.asar'));
    await assert.rejects(qualifyInstalledClientLaunch({ installRoot, sourceRoot, expectedHead, expectedVersion,
      evidenceDirectory: root }), /database_wizard_still_packaged/);
    await fs.unlink(staleWizard);
    uncache(path.join(resources, 'app.asar'));
    await createPackage(archiveSource, path.join(resources, 'app.asar'));
    // The inert executable must never run. Successful nested source/verifier
    // reads reach the real runtime admission gate, which denies this fixture.
    await assert.rejects(qualifyInstalledClientLaunch({ installRoot, sourceRoot, expectedHead, expectedVersion,
      evidenceDirectory: root }), /packaged_client_state_runtime_binding_missing/);
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('isolated-launch-')), false);
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
  assert.equal(env.METAENGINE_GITHUB_CONNECTION_OFFLINE, '1'); assert.equal(env.METAENGINE_DISABLE_SELF_UPDATE, '1');
  for (const key of ['SUPABASE_URL', 'GH_TOKEN', 'METAENGINE_SUPERVISOR_BASE_URL', 'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS', 'ME2_UI_DIR', 'ME2_UI_BIN']) assert.equal(Object.hasOwn(env, key), false, key);
});

test('missing automatic descriptor must deny runtime admission without a database wizard or cloud fallback', () => {
  const row = { schema: 'metaengine.browser.provider-startup.v1', state: 'LOCAL_PROVIDER_STARTUP_BLOCKED',
    reason: 'local_state_packaged_owner_not_ready', browser_runtime_started: false, automatic_cloud_fallback: false, authority_effect: false };
  assert.equal(assertMissingDescriptorAdmissionContract(row), true);
  for (const [key, value] of [['schema', 'untrusted'], ['state', 'READY'], ['reason', 'arbitrary'],
    ['browser_runtime_started', true], ['automatic_cloud_fallback', true], ['authority_effect', true]]) {
    assert.throws(() => assertMissingDescriptorAdmissionContract({ ...row, [key]: value }), /missing_descriptor_admission_contract_invalid/);
  }
  for (const output of ['RUNTIME_IMPORT_OK', 'ME2_INTEGRATION_START', 'DAEMON_HEALTHY', 'ME2_PRIMARY_SHELL_VISIBLE']) {
    assert.throws(() => assertMissingDescriptorAdmissionContract(row, output), /missing_descriptor_admission_contract_invalid/);
  }
});

async function automaticFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-installed-autoconnect-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ownerFile = path.join(root, 'Roaming', '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json');
  const configFile = path.join(root, 'state', 'original.json');
  const config = { schema: 'compute.runtime-host-config.v1', version: 1, postgres_mode: 'attached', api_role_mode: 'direct',
    bundle_directory: path.join(root, 'resources', 'client-state-runtime'), expected_bundle_sha256: 'b'.repeat(64),
    state_directory: path.join(root, 'state'), pg_data_directory: path.join(root, 'data'), expected_cluster_system_identifier: '1234567890123456789',
    database_url: 'postgres://restricted:fixture_api@127.0.0.1:19000/postgres',
    inspect_database_url: 'postgres://inspector:fixture_owner@127.0.0.1:19000/postgres', api_port: 19001, edge_port: 19002, startup_timeout_ms: 90000 };
  const owner = { base_url: 'http://127.0.0.1:19002/a2-browser-native-supervisor-v1', runtime_identity_file: path.join(root, 'state', 'runtime-instance.json'),
    runtime_host: { bundle_directory: config.bundle_directory, expected_bundle_sha256: 'b'.repeat(64), config_file: configFile } };
  const ownerBytes = Buffer.from(JSON.stringify(owner));
  await fs.mkdir(path.dirname(ownerFile), { recursive: true });
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(ownerFile, ownerBytes);
  await fs.writeFile(configFile, JSON.stringify(config));
  await fs.writeFile(path.join(root, ISOLATED_OWNER_MARKER), JSON.stringify({ schema: 'metaengine.browser.isolated-owner-launch-fixture.v1',
    production_profile: false, source_data_rows_restored: 0, source_head: expectedHead }));
  await fs.writeFile(path.join(root, 'schema-only-restore-report.json'), JSON.stringify({ schema: 'metaengine.database-restore-report.v1',
    schema_verified: true, data_verified: true, schema_only: true, disposable: true, source_data_rows_restored: 0,
    source_dump_sha256: 'c'.repeat(64), errors: [] }));
  return { root, ownerFile, ownerBytes, owner, config, localAppData: path.join(root, 'Local') };
}
const automaticIdentity = { source_head: expectedHead, bundle_sha256: 'b'.repeat(64) };
const privateFixtureStorage = { protectStorage: async () => ({ owner_dacl_verified: true, operation: 'PROTECT_DIRECTORY' }),
  verifyStorage: async (_target, { operation }) => ({ owner_dacl_verified: true, operation }) };

test('automatic installed fixture creates a path-only descriptor and retires only its isolated Owner after verified ACL', async t => {
  const fixture = await automaticFixture(t);
  const before = await fs.readFile(fixture.owner.runtime_host.config_file);
  const prepared = await prepareIsolatedAttachedAutoConnect(fixture, automaticIdentity, privateFixtureStorage);
  await assert.rejects(fs.stat(fixture.ownerFile), { code: 'ENOENT' });
  assert.equal((await fs.readFile(path.join(fixture.root, 'owner-before-autoconnect.json'))).equals(fixture.ownerBytes), true);
  const descriptor = JSON.parse(await fs.readFile(prepared.descriptorFile, 'utf8'));
  assert.equal(descriptor.postgres_mode, 'attached'); assert.equal(descriptor.config_file, fixture.owner.runtime_host.config_file);
  assert.equal(Object.keys(descriptor).length, 7);
  assert.equal(JSON.stringify(descriptor).includes('fixture_api'), false);
  assert.equal((await fs.readFile(prepared.originalConfigFile)).equals(before), true);
  assert.equal(prepared.sourceConfigBytes.equals(before), true);
});

test('automatic installed fixture rejects production markers and unverified private descriptor before retiring Owner', async t => {
  for (const mode of ['production', 'unverified']) {
    const fixture = await automaticFixture(t);
    const options = { ...privateFixtureStorage };
    if (mode === 'production') await fs.writeFile(path.join(fixture.root, ISOLATED_OWNER_MARKER), JSON.stringify({
      schema: 'metaengine.browser.isolated-owner-launch-fixture.v1', production_profile: true, source_data_rows_restored: 0, source_head: expectedHead }));
    else options.verifyStorage = async () => ({ owner_dacl_verified: false });
    await assert.rejects(prepareIsolatedAttachedAutoConnect(fixture, automaticIdentity, options),
      mode === 'production' ? /owner_fixture_marker_invalid/ : /automatic_attached_descriptor_acl_unverified/);
    assert.equal((await fs.readFile(fixture.ownerFile)).equals(fixture.ownerBytes), true);
  }
});

test('automatic Owner binding requires a new config but preserves exact Keeper, credentials, ports and bundle', async t => {
  const fixture = await automaticFixture(t);
  const current = structuredClone(fixture.owner);
  current.runtime_host.config_file = path.join(fixture.root, 'state', 'new-installed.json');
  const input = { previous: fixture.owner, current, config: fixture.config, expectedConfig: structuredClone(fixture.config),
    resourcesDir: path.join(fixture.root, 'resources'), identity: automaticIdentity, fixtureRoot: fixture.root };
  assert.equal(assertAutomaticAttachedOwnerBinding(input), true);
  for (const change of [
    value => { value.current.runtime_host.config_file = value.previous.runtime_host.config_file; },
    value => { value.current.base_url = 'http://127.0.0.1:20000/a2-browser-native-supervisor-v1'; },
    value => { value.current.runtime_host.expected_bundle_sha256 = 'd'.repeat(64); },
    value => { value.config.expected_cluster_system_identifier = '9999999999999999999'; },
    value => { value.config.database_url = 'postgres://different:fixture_api@127.0.0.1:19000/postgres'; },
    value => { value.config.pg_data_directory = path.join(fixture.root, 'different-data'); },
    value => { value.config.edge_port += 1; },
  ]) {
    const candidate = structuredClone(input); change(candidate);
    assert.throws(() => assertAutomaticAttachedOwnerBinding(candidate), /automatic_attached_(?:owner|config)_binding_invalid/);
  }
});

const now = Date.parse('2026-10-10T12:00:00Z');
function grace() {
  const journal = { current_boot_id: 'boot-qa', current_pid: 712, current_version: expectedVersion,
    events: [
      { boot_id: 'boot-qa', pid: 712, version: expectedVersion, sequence: 1, state: 'RUNTIME_IMPORT_OK', details: {} },
      { boot_id: 'boot-qa', pid: 712, version: expectedVersion, sequence: 2, state: 'PRIMARY_WINDOW_STABLE_TIMEOUT', details: { window_id: 47, window_count: 1 } },
      { boot_id: 'boot-qa', pid: 712, version: expectedVersion, sequence: 3, state: 'PRIMARY_WINDOW_STABLE', details: { visible: true, window_id: 47, stable_ms: 1500 } },
    ] };
  return { before: structuredClone(journal), after: structuredClone(journal), pid: 712, version: expectedVersion,
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
    assert.throws(() => assertOwnerStartupGrace(value), /normal_(?:startup_grace_survival_unproven|primary_window_)/);
  }
});

test('installed primary journal accepts a later stable proof only for the exact timed-out window and incarnation', () => {
  const fixture = grace();
  const validate = journal => assertInstalledPrimaryWindowJournal(journal, { pid: fixture.pid, version: expectedVersion });
  assert.equal(validate(fixture.before).window_id, 47);
  assert.equal(validate(fixture.before).bootstrap_timeout_superseded, true);
  for (const change of [
    row => { row.current_version = 'old'; },
    row => { row.current_pid += 1; },
    row => { row.events[1].sequence = 4; },
    row => { row.events[1].details.window_id = 48; },
    row => { row.events[1].details.window_id = null; },
    row => { row.events[1].details.window_count = 0; },
    row => { row.events[1].state = 'OTHER_TIMEOUT'; },
    row => { row.events[1].state = 'PRIMARY_WINDOW_OBSERVER_FAILED'; },
    row => { row.events[2].details.visible = false; },
    row => { row.events[2].details.stable_ms = 1499; },
    row => { delete row.events[2].details.stable_ms; },
    row => { row.events[2].pid += 1; },
    row => { row.events[2].boot_id = 'stale-boot'; },
    row => { row.events[0].sequence = 4; },
  ]) {
    const journal = structuredClone(fixture.before); change(journal);
    assert.throws(() => validate(journal), /normal_primary_window_/);
  }
  assert.throws(() => assertInstalledPrimaryWindowJournal(fixture.after,
    { pid: fixture.pid, version: expectedVersion, expectedWindowId: 48 }), /normal_primary_window_stability_unproven/);
});

test('current CDP window proof requires the same visible-sized unminimized native browser window after grace', () => {
  const before = { window_id: 37, window_state: 'normal', width: 1200, height: 800 };
  assert.equal(assertInstalledPrimaryCdpWindow(before, { ...before, window_state: 'maximized' }), true);
  for (const patch of [{ window_id: 38 }, { window_state: 'minimized' }, { width: 0 }, { height: 200 }]) {
    assert.throws(() => assertInstalledPrimaryCdpWindow(before, { ...before, ...patch }), /normal_primary_cdp_window_unproven/);
  }
});

test('current OS window proof requires one visible primary PID window and the same native handle after grace', () => {
  const row = { pid: 712, handle: '45678', width: 1200, height: 800, visible: true, minimized: false,
    class_name: 'Chrome_WidgetWin_1', title: 'METAENGINE Browser' };
  assert.equal(assertInstalledVisibleWindow([row], { pid: 712, expectedHandle: '45678' }).visible, true);
  for (const rows of [[], [{ ...row, pid: 713 }], [{ ...row, visible: false }], [{ ...row, handle: 'invalid' }],
    [{ ...row, minimized: true }], [{ ...row, title: 'METAENGINE Browser startup error' }], [{ ...row, class_name: 'Chrome_WidgetWin_0' }],
    [{ ...row, width: 399 }], [{ ...row, height: 0 }], [row, { ...row, handle: '98765' }], [{ ...row, handle: '98765' }]]) {
    assert.throws(() => assertInstalledVisibleWindow(rows, { pid: 712, expectedHandle: '45678' }), /normal_primary_os_window_unproven/);
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
