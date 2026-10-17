import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertOwnerConsumerKind, assertOwnerConsumerFixture, assertOwnerConsumerProfile,
  assertFinalRuntimeConsumerActivation, assertOwnerConsumerRuntime, assertOwnerConsumerStopped,
  assertOwnerConsumerProof, qualifyInstalledOwnerConsumer } from '../scripts/qualify-installed-owner-consumer.mjs';

const root = path.join(os.tmpdir(), 'compute-attached-bundle-unit-only');
const resourcesDir = path.join(os.tmpdir(), 'installed-owner-consumer-unit-package/resources');
const sourceHead = 'a'.repeat(40), version = '0.7.0-dev.1117000000.1', bundleSha256 = 'b'.repeat(64);
const identity = { source_head: sourceHead, package_version: version, bundle_sha256: bundleSha256 };
const previousId = '11111111-1111-4111-8111-111111111111', currentId = '22222222-2222-4222-8222-222222222222';
const owner = { schema: 'metaengine.browser.local-state-provider-config.v1', version: 1,
  profile: 'CLIENT_LOCAL_POSTGRES_V1', provider: 'LOCAL_POSTGRES',
  base_url: 'http://127.0.0.1:58002/a2-browser-native-supervisor-v1',
  runtime_identity_file: path.join(root, 'runtime-state/runtime-instance.json'), authority_effect: false,
  runtime_host: { bundle_directory: path.join(resourcesDir, 'client-state-runtime'), expected_bundle_sha256: bundleSha256,
    config_file: path.join(root, 'runtime-state/attached-runtime.json') } };
const config = { postgres_mode: 'attached', api_role_mode: 'direct', pg_data_directory: path.join(root, 'pgdata'),
  state_directory: path.join(root, 'runtime-state'), bundle_directory: owner.runtime_host.bundle_directory,
  expected_bundle_sha256: bundleSha256, database_url: 'postgres://unit_fixture_role:unit_fixture_password@127.0.0.1:58000/postgres' };
const marker = { schema: 'metaengine.browser.isolated-owner-launch-fixture.v1', production_profile: false,
  source_data_rows_restored: 0, source_head: sourceHead };
const fixture = () => ({ consumer: 'FINAL_RUNTIME_ACTIVATION', root, identity: structuredClone(identity),
  marker: structuredClone(marker), owner: structuredClone(owner), config: structuredClone(config), resourcesDir });
const activation = () => ({ state: 'READY', host_agent_state: 'READY', signer_state: 'READY',
  browser_execution_via_typed_ipc: true, verified_execution_outcomes_active: true, fast_control_read_side_active: true,
  fast_control_production_mutation_authority: false, production_authority_fabricated: false,
  second_scheduler: false, automatic_effect_retry_allowed: false, authority_effect: false });
const activationRow = () => ({ schema: 'metaengine.browser.final-runtime-activation.lifecycle.v1', state: 'READY',
  generation: 3, second_scheduler: false, authority_effect: false, activation: activation() });
const runtime = () => ({ previous: { instance_id: previousId, state: 'STOPPED', runtime_ready: false, children_stopped: true },
  current: { schema: 'metaengine.client-state.runtime-status.v1', instance_id: currentId, state: 'READY', runtime_ready: true,
    bundle_sha256: bundleSha256, postgres_mode: 'attached', api_role_mode: 'direct',
    state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false, automatic_cloud_fallback: false, authority_effect: false,
    capability_health: { state: 'ATTESTED', authority_effect: false }, endpoint: owner.base_url,
    host_pid: 420, children: [{ name: 'api', pid: 421 }, { name: 'edge', pid: 422 }] },
  health: { ok: true, instance_id: currentId, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
    runtime_ready: true, capability_health: { state: 'ATTESTED', authority_effect: false } }, owner, pid: 410, postgresPid: 400 });

test('only two fixed consumers are accepted before paths, processes or provider reads', async () => {
  for (const kind of ['FINAL_RUNTIME_ACTIVATION', 'SHELL_FIRST_DIRTY_PROFILE']) assert.equal(assertOwnerConsumerKind(kind), kind);
  for (const kind of [undefined, '', 'READY', 'node arbitrary.mjs', '../external-consumer.mjs', 'FINAL_RUNTIME_ACTIVATION\n']) {
    assert.throws(() => assertOwnerConsumerKind(kind), /kind_invalid/);
    await assert.rejects(qualifyInstalledOwnerConsumer({ consumer: kind }), /kind_invalid/);
  }
});

test('Owner mount binds source, installed bundle and a disposable attached profile, never a production or hosted target', () => {
  assert.equal(assertOwnerConsumerFixture(fixture()), true);
  for (const mutate of [
    x => { x.marker.production_profile = true; }, x => { x.marker.source_data_rows_restored = 1; },
    x => { x.marker.source_head = 'c'.repeat(40); }, x => { x.owner.runtime_host.expected_bundle_sha256 = 'c'.repeat(64); },
    x => { x.owner.runtime_host.bundle_directory = path.join(root, 'other-package'); },
    x => { x.owner.runtime_host.config_file = path.join(os.tmpdir(), 'user-config.json'); },
    x => { x.owner.runtime_identity_file = path.join(os.tmpdir(), 'user-status.json'); },
    x => { x.config.pg_data_directory = path.join(root, '..', 'user-pgdata'); },
    x => { x.config.state_directory = root; }, x => { x.config.postgres_mode = 'owned'; },
    x => { x.config.api_role_mode = 'service_role'; }, x => { x.config.expected_bundle_sha256 = 'c'.repeat(64); },
    x => { x.config.database_url = 'postgres://unit:unit@remote.invalid:58000/postgres'; },
    x => { x.owner.authority_effect = true; },
  ]) { const changed = fixture(); mutate(changed); assert.throws(() => assertOwnerConsumerFixture(changed)); }
});

test('packaged profile probe must select the exact isolated APPDATA path and current version', () => {
  const appData = path.join(root, 'Roaming');
  const profile = { schema: 'metaengine.browser.profile-probe.v1', primary_instance: true,
    version, app_id: 'com.metaengine.browser.test', user_data_path: path.join(appData, 'BrowserProfile') };
  assert.equal(assertOwnerConsumerProfile(profile, { appData, expectedVersion: version }), profile);
  for (const patch of [{ version: 'older' }, { primary_instance: false }, { app_id: 'com.metaengine.browser' },
    { user_data_path: path.join(os.tmpdir(), 'user-profile') }, { user_data_path: appData },
    { schema: 'metaengine.browser.profile-probe.v0' }]) {
    assert.throws(() => assertOwnerConsumerProfile({ ...profile, ...patch }, { appData, expectedVersion: version }), /profile_binding_invalid/);
  }
});

test('independent runtime readback rejects stale READY, wrong health incarnation, hosted authority and Keeper PID substitution', () => {
  assert.equal(assertOwnerConsumerRuntime(runtime()).instance_id, currentId);
  for (const mutate of [
    x => { x.previous.state = 'READY'; }, x => { x.current.instance_id = previousId; },
    x => { x.health.instance_id = previousId; }, x => { x.health.runtime_ready = false; },
    x => { x.current.capability_health.state = 'UNKNOWN'; }, x => { x.current.hosted_supabase_required = true; },
    x => { x.current.authority_effect = true; }, x => { x.current.host_pid = x.postgresPid; },
    x => { x.current.children[0].pid = x.postgresPid; }, x => { x.current.children[0].pid = x.pid; },
    x => { x.current.children[1].pid = x.current.children[0].pid; }, x => { x.current.children.reverse(); },
    x => { delete x.current.bundle_sha256; }, x => { x.current.bundle_sha256 = 'f'.repeat(64); },
    x => { delete x.current.postgres_mode; }, x => { x.current.postgres_mode = 'owned'; },
    x => { delete x.current.api_role_mode; }, x => { x.current.api_role_mode = 'service_role'; },
  ]) { const changed = runtime(); mutate(changed); assert.throws(() => assertOwnerConsumerRuntime(changed)); }
});

test('Final Runtime readback requires actual READY and preserves all no-authority constraints while discarding unknown log fields', () => {
  const row = activationRow(); row.activation.private_test_field = 'unit-not-for-artifact';
  assert.deepEqual(assertFinalRuntimeConsumerActivation(row), activation());
  for (const mutate of [
    x => { x.state = 'STARTING'; }, x => { x.generation = 0; }, x => { x.second_scheduler = true; },
    x => { x.activation.host_agent_state = 'WAITING'; }, x => { x.activation.signer_state = 'WAITING'; },
    x => { x.activation.verified_execution_outcomes_active = false; },
    x => { x.activation.fast_control_production_mutation_authority = true; },
    x => { x.activation.production_authority_fabricated = true; },
    x => { x.activation.automatic_effect_retry_allowed = true; }, x => { x.activation.authority_effect = true; },
  ]) { const changed = activationRow(); mutate(changed); assert.throws(() => assertFinalRuntimeConsumerActivation(changed), /activation_unproven/); }
});

test('Final Runtime final stable sample rejects READY followed by STOPPED, FAILED, or a replacement generation', () => {
  const before = activationRow();
  assert.deepEqual(assertFinalRuntimeConsumerActivation(before, { expectedGeneration: before.generation }), activation());
  for (const patch of [{ state: 'STOPPED' }, { state: 'FAILED' }, { generation: before.generation + 1 }]) {
    assert.throws(() => assertFinalRuntimeConsumerActivation({ ...activationRow(), ...patch },
      { expectedGeneration: before.generation }), /activation_unproven/);
  }
});

test('shutdown qualification requires both actual close statuses and exact stopped runtime incarnation', () => {
  const current = runtime().current;
  const input = () => ({ current, stopped: { ...current, state: 'STOPPED', runtime_ready: false, children_stopped: true },
    primaryClose: { code: 0, signal: null }, shutdownClose: { code: 0, signal: null } });
  assert.equal(assertOwnerConsumerStopped(input()), true);
  for (const mutate of [
    x => { x.primaryClose.code = null; }, x => { x.primaryClose.code = 1; },
    x => { x.shutdownClose.code = 1; }, x => { x.shutdownClose.signal = 'SIGTERM'; },
    x => { x.stopped.instance_id = previousId; }, x => { x.stopped.host_pid += 1; },
    x => { x.stopped.state = 'READY'; }, x => { x.stopped.children_stopped = false; },
  ]) { const changed = input(); mutate(changed); assert.throws(() => assertOwnerConsumerStopped(changed), /cleanup_unconfirmed/); }
});

test('consumer receipt cannot promote fixture evidence, change artifact identity, or omit actual cleanup', () => {
  const expected = { consumer: 'FINAL_RUNTIME_ACTIVATION', sourceHead, version, bundleSha256,
    installedAsarSha256: 'c'.repeat(64), installedExecutableSha256: 'd'.repeat(64) };
  const proof = () => ({ schema: 'metaengine.browser.installed-owner-consumer-proof.v1', state: 'PASSED_ISOLATED_REAL_RUNTIME',
    consumer: expected.consumer, ...identity, installed_asar_sha256: expected.installedAsarSha256,
    installed_executable_sha256: expected.installedExecutableSha256, qualifier_sha256: 'e'.repeat(64), runtime_instance_id: currentId,
    real_local_runtime_attested: true, profile_isolated: true, fixture_source_rows_restored: 0,
    current_os_window_visible: true, stable_window_verified: true, primary_exit_code: 0, shutdown_exit_code: 0,
    process_cleanup_confirmed: true, runtime_host_lock_released: true, runtime_ports_closed: true,
    attached_postgres_incarnation_preserved: true, installed_source_bytes_verified: true,
    shutdown_method: 'EXISTING_INSTALLER_SHUTDOWN_BARRIER', live_agent_execution: false,
    production_ready: false, promotion_authorized: false, automatic_retry_allowed: false, authority_effect: false,
    activation: activation(), fleet_degraded: false });
  assert.equal(assertOwnerConsumerProof(proof(), expected).source_head, sourceHead);
  const shell = { ...proof(), consumer: 'SHELL_FIRST_DIRTY_PROFILE', activation: null, fleet_degraded: true };
  assert.equal(assertOwnerConsumerProof(shell, { ...expected, consumer: shell.consumer }), shell);
  for (const patch of [{ source_head: 'f'.repeat(40) }, { package_version: 'old' }, { bundle_sha256: 'f'.repeat(64) },
    { installed_asar_sha256: 'f'.repeat(64) }, { consumer: shell.consumer }, { runtime_instance_id: '' },
    { runtime_ports_closed: false }, { primary_exit_code: null }, { live_agent_execution: true }, { production_ready: true },
    { promotion_authorized: true }, { authority_effect: true }, { fixture_source_rows_restored: 1 }]) {
    assert.throws(() => assertOwnerConsumerProof({ ...proof(), ...patch }, expected), /proof_invalid/);
  }
  assert.throws(() => assertOwnerConsumerProof({ ...shell, fleet_degraded: false }, { ...expected, consumer: shell.consumer }), /proof_invalid/);
});

test('physical FinalRuntime and ShellDirty consumers mount a live disposable Owner instead of launching an unprovisioned profile', async () => {
  for (const [name, consumer] of [
    ['browser-final-runtime-activation-v1.yml', 'FINAL_RUNTIME_ACTIVATION'],
    ['browser-shell-first-dirty-profile-v1.yml', 'SHELL_FIRST_DIRTY_PROFILE'],
  ]) {
    const source = await fs.readFile(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8');
    assert.match(source, /working-directory: infra\/client-state-runtime/);
    assert.match(source, /npm ci --no-audit --no-fund/);
    assert.match(source, /LOCAL_STATE_TEST_GENERATED_SCHEMA_DIRECTORY/);
    assert.match(source, /LOCAL_STATE_TEST_ATTACHED_INSTALL_SOURCE_HEAD/);
    assert.match(source, /LOCAL_STATE_TEST_ATTACHED_INSTALL_VERSION/);
    assert.match(source, /LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP_SHA256/);
    assert.match(source, new RegExp('LOCAL_STATE_TEST_ATTACHED_CONSUMER = [\x27\x22]' + consumer));
    assert.match(source, /node --test --test-concurrency=1 attached-bundled-runtime\.integration\.test\.mjs/);
    assert.match(source, /disposable_pg_cleanup_confirmed/);
    assert.doesNotMatch(source, /METAENGINE_LOCAL_PROVIDER_BOOT_STATE\s*=\s*['"]READY/);
    assert.doesNotMatch(source, /Start-Process -FilePath \$app[^\n]*RedirectStandard/);
  }
});

test('fixture publishes consumer receipt only after all qualification checks and physical PG cleanup, without exporting private Owner', async () => {
  const source = await fs.readFile(new URL('../../../infra/client-state-runtime/attached-bundled-runtime.integration.test.mjs', import.meta.url), 'utf8');
  const ownerPassed = source.indexOf("t.diagnostic('real installed Owner UI/socket qualification passed");
  const consumerCall = source.indexOf('const consumer = spawnBundled', ownerPassed);
  const finalBundle = source.lastIndexOf('await verifyOfflineRuntimeBundle');
  const completed = source.indexOf('fixtureQualificationCompleted = true', finalBundle);
  assert.ok(ownerPassed > 0 && consumerCall > ownerPassed && finalBundle > consumerCall && completed > finalBundle);
  const cleanup = source.indexOf('await fs.rm(root, { recursive: true, force: false });');
  const receipt = source.indexOf('if (consumerProof && fixtureQualificationCompleted)');
  assert.ok(cleanup > source.indexOf('await owned.stop()') && receipt > cleanup);
  assert.match(source.slice(receipt, receipt + 450), /disposable_pg_cleanup_confirmed: true/);
  assert.doesNotMatch(source.slice(receipt, receipt + 450), /ownerBytes|configBytes|database_url|password/);
});
