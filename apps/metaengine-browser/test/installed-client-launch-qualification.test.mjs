import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInstalledLaunchIdentity, assertFirstRunDomContract, assertOwnerStartupGrace,
  isolatedLaunchEnvironment } from '../scripts/qualify-installed-client-launch.mjs';

const expectedHead = 'a'.repeat(40), expectedVersion = '0.7.0-dev.37781000049.1';
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
