import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  parseRestoredClientProviderArguments, restoredClientProviderPublicError, runRestoredClientProviderCli,
} from './restored-client-provider-cli.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('./restored-client-provider-cli.mjs', import.meta.url));
const bundlePin = 'a'.repeat(64);
const restorePin = 'b'.repeat(64);
const instanceId = '00112233-4455-6677-8899-aabbccddeeff';
const argsFor = ({ configFile, reportFile, appdata }) => [
  '--config', configFile, '--bundle-sha256', bundlePin,
  '--restore-receipt', reportFile, '--restore-receipt-sha256', restorePin,
  '--appdata', appdata, '--owner-action', 'USE_EXISTING_RESTORED_POSTGRES_17',
];
const receipt = () => ({
  schema: 'compute.restored-client-provider-provisioning.v1', state: 'CONFIGURED', provider: 'LOCAL_POSTGRES',
  existing_restored_database_selected: true, source_restore_receipt_verified: true,
  database_initialized: false, owner_profile_written: true, runtime_ready: false,
  cleanup_confirmed: true, attested_instance_id: instanceId, source_dump_sha256: 'c'.repeat(64),
  source_restore_receipt_sha256: restorePin, bundle_sha256: bundlePin, private_vault_key_preserved: true,
  source_schema_exact: false, authority_effect: false,
});

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-restored-cli-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'private-state');
  const appdata = path.join(root, 'selected-appdata');
  const bundle = path.join(root, 'offline-bundle');
  await fs.mkdir(state); await fs.mkdir(bundle);
  const configFile = path.join(state, 'private-host-config.json');
  const reportFile = path.join(root, 'restore-report.json');
  const config = { schema: 'compute.runtime-host-config.v1', version: 1,
    bundle_directory: bundle, expected_bundle_sha256: bundlePin,
    state_directory: state, pg_data_directory: path.join(state, 'data'),
    database_url: 'postgresql://private_api:never_print_test_password@127.0.0.1:49152/metaengine',
    inspect_database_url: 'postgresql://private_admin:never_print_admin_password@127.0.0.1:49152/metaengine',
    api_port: 49153, edge_port: 49154, startup_timeout_ms: 60000 };
  await fs.writeFile(configFile, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(reportFile, 'private test receipt', { flag: 'wx', mode: 0o600 });
  return { root, state, bundle, appdata, configFile, reportFile, config };
}

test('restored provider CLI requires explicit existing-state action, both pins and appdata', () => {
  const base = { configFile: path.resolve('external-private.json'), reportFile: path.resolve('external-receipt.json'),
    appdata: path.resolve('explicit-appdata') };
  const options = parseRestoredClientProviderArguments(argsFor(base));
  assert.equal(options.ownerChoice, 'LOCAL_POSTGRES');
  assert.equal(options.ownerAction, 'USE_EXISTING_RESTORED_POSTGRES_17');
  assert.equal(options.appDataDirectory, base.appdata);
  assert.equal(options.expectedBundleDigest, bundlePin);
  assert.equal(options.expectedRestoreReceiptSha256, restorePin);
  assert.deepEqual(parseRestoredClientProviderArguments(['--help']), { help: true });
  for (const removed of ['--config', '--bundle-sha256', '--restore-receipt', '--restore-receipt-sha256', '--appdata', '--owner-action']) {
    const argv = argsFor(base);
    argv.splice(argv.indexOf(removed), 2);
    assert.throws(() => parseRestoredClientProviderArguments(argv), /restored_client_cli_arguments_required/);
  }
});

test('CLI refuses credentials, replacement flags, duplicate values and malformed source pins', () => {
  const argv = argsFor({ configFile: path.resolve('private.json'), reportFile: path.resolve('receipt.json'),
    appdata: path.resolve('selected-appdata') });
  for (const extra of [
    ['--password', 'never-print'], ['--database-url', 'postgresql://private:secret@127.0.0.1:49152/db'],
    ['--replace-existing', 'true'], ['--config', path.resolve('second.json')], ['--help'],
  ]) assert.throws(() => parseRestoredClientProviderArguments([...argv, ...extra]));
  for (const [flag, value] of [
    ['--owner-action', 'INITIALIZE_NEW_DATABASE'], ['--bundle-sha256', 'A'.repeat(64)],
    ['--restore-receipt-sha256', 'unpinned'], ['--config', 'relative.json'],
    ['--restore-receipt', '//server/private.json'], ['--appdata', 'relative-appdata'],
    ['--config', path.resolve('private.json') + '\nsecret'],
  ]) {
    const changed = [...argv]; changed[changed.indexOf(flag) + 1] = value;
    assert.throws(() => parseRestoredClientProviderArguments(changed));
  }
  assert.throws(() => parseRestoredClientProviderArguments(['--config']), /argument_value_required/);
});

test('CLI derives private host paths from the exact config and exposes only the sanitized receipt', async t => {
  const f = await fixture(t);
  const originalAppdata = process.env.APPDATA;
  let invoked;
  const privateMarker = 'must_not_escape_in_cli_output';
  try {
    process.env.APPDATA = path.join(f.root, 'unselected-original-appdata');
    const result = await runRestoredClientProviderCli(argsFor(f), { provision: async options => {
      invoked = options;
      return { ...receipt(), private_config: f.config, config_file: f.configFile, secret: privateMarker };
    } });
    assert.equal(invoked.privateConfigFile, f.configFile);
    assert.equal(invoked.restoreReceiptFile, f.reportFile);
    assert.equal(invoked.expectedRestoreReceiptSha256, restorePin);
    assert.equal(invoked.stateDirectory, f.state);
    assert.equal(invoked.pgDataDirectory, f.config.pg_data_directory);
    assert.equal(invoked.bundleDirectory, f.bundle);
    assert.equal(invoked.ownerFile, path.join(f.appdata, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json'));
    assert.equal(Object.hasOwn(invoked, 'databaseUrl'), false);
    assert.equal(Object.hasOwn(invoked, 'password'), false);
    assert.deepEqual(result, receipt());
    const publicText = JSON.stringify(result);
    for (const secret of [privateMarker, f.configFile, f.config.database_url, 'never_print_test_password']) {
      assert.equal(publicText.includes(secret), false);
    }
    await assert.rejects(fs.lstat(f.appdata), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(process.env.APPDATA), { code: 'ENOENT' });
    assert.equal(await fs.readFile(f.configFile, 'utf8'), JSON.stringify(f.config));
  } finally {
    if (originalAppdata === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppdata;
  }
});

test('attached CLI requires a direct-role receipt that preserves external PostgreSQL ownership', async t => {
  const f = await fixture(t);
  const attached = { ...f.config, postgres_mode: 'attached', api_role_mode: 'direct',
    expected_cluster_system_identifier: '7512345678901234567', pg_data_directory: path.join(f.root, 'keeper-data') };
  await fs.writeFile(f.configFile, JSON.stringify(attached));
  const modes = { postgres_mode: 'attached', api_role_mode: 'direct', postgres_lifecycle_owned: false, attached_postmaster_preserved: true };
  const result = await runRestoredClientProviderCli(argsFor(f), { provision: async () => ({ ...receipt(), ...modes }) });
  for (const [key, value] of Object.entries(modes)) assert.equal(result[key], value);
  for (const patch of [{}, { ...modes, api_role_mode: 'service_role' }, { ...modes, postgres_lifecycle_owned: true },
    { ...modes, attached_postmaster_preserved: false }, { ...modes, postgres_mode: 'owned' }]) {
    await assert.rejects(runRestoredClientProviderCli(argsFor(f), { provision: async () => ({ ...receipt(), ...patch }) }), /public_receipt_unconfirmed/);
  }
  await fs.writeFile(f.configFile, JSON.stringify({ ...attached, api_role_mode: 'service_role' }));
  let invoked = false;
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), { provision: async () => { invoked = true; return receipt(); } }), /attached_direct_api_required/);
  assert.equal(invoked, false);
});

test('config drift, unsafe file kinds and unconfirmed result cannot reach owner publication', async t => {
  const f = await fixture(t);
  let calls = 0;
  const provision = async () => { calls += 1; return receipt(); };
  await fs.writeFile(f.configFile, JSON.stringify({ ...f.config, expected_bundle_sha256: 'd'.repeat(64) }));
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), { provision }), /bundle_pin_conflict/);
  assert.equal(calls, 0);
  await fs.writeFile(f.configFile, JSON.stringify({ ...f.config, unexpected: 'must-not-accept' }));
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), { provision }), /runtime_host_config_contract_invalid/);
  assert.equal(calls, 0);
  await fs.writeFile(f.configFile, JSON.stringify(f.config));
  const linked = path.join(f.state, 'hardlinked-config.json');
  await fs.link(f.configFile, linked);
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), { provision }), /private_config_invalid/);
  assert.equal(calls, 0);
  await fs.unlink(linked);
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), {
    provision: async () => ({ ...receipt(), cleanup_confirmed: false }),
  }), /public_receipt_unconfirmed/);
  await assert.rejects(runRestoredClientProviderCli(argsFor(f), {
    provision: async () => ({ ...receipt(), source_restore_receipt_sha256: 'd'.repeat(64) }),
  }), /public_receipt_pin_conflict/);
});

test('subprocess CLI errors contain fixed categories and no private path or credentials', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.configFile, JSON.stringify({ ...f.config, expected_bundle_sha256: 'd'.repeat(64) }));
  try {
    await exec(process.execPath, [cli, ...argsFor(f)], { timeout: 10000, windowsHide: true, maxBuffer: 65536 });
    assert.fail('conflicting package pin must fail before provisioning');
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(JSON.parse(error.stderr.trim()).reason, 'restored_client_cli_bundle_pin_conflict');
    for (const privateValue of [f.root, f.configFile, 'never_print_test_password', 'postgresql://']) {
      assert.equal(error.stderr.includes(privateValue), false);
    }
  }
  assert.deepEqual(await fs.readdir(f.state), ['private-host-config.json']);
  await assert.rejects(fs.lstat(f.appdata), { code: 'ENOENT' });
  const help = await exec(process.execPath, [cli, '--help'], { timeout: 10000, windowsHide: true });
  assert.match(help.stdout, /USE_EXISTING_RESTORED_POSTGRES_17/);
  assert.equal(help.stderr, '');
  assert.equal(restoredClientProviderPublicError(new Error('restored_provider_cleanup_unconfirmed')).reason, 'restored_provider_cleanup_unconfirmed');
  for (const value of [f.configFile, 'postgresql://secret:password@127.0.0.1', 'restored_provider_secret_password_abc']) {
    assert.equal(restoredClientProviderPublicError(new Error(value)).reason, 'restored_client_cli_provisioning_failed');
  }
});

test('importing the operator CLI has no process, private-file or output effects', async () => {
  const code = [
    "import childProcess from 'node:child_process'; import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';",
    "childProcess.spawn=()=>{throw Error('unexpected_process')}; childProcess.execFile=()=>{throw Error('unexpected_process')};",
    "for(const name of ['open','writeFile','mkdir'])fs[name]=async()=>{throw Error('unexpected_private_file')}; syncBuiltinESMExports();",
    "process.argv=[process.execPath,'unrelated-importing-program.mjs','--owner-action','USE_EXISTING_RESTORED_POSTGRES_17'];",
    'await import(' + JSON.stringify(pathToFileURL(cli).href) + "); console.log('IMPORTED_WITHOUT_STARTUP');",
  ].join('\n');
  const result = await exec(process.execPath, ['--input-type=module', '--eval', code],
    { timeout: 10000, windowsHide: true, maxBuffer: 65536 });
  assert.equal(result.stdout.trim(), 'IMPORTED_WITHOUT_STARTUP');
  assert.equal(result.stderr, '');
});
