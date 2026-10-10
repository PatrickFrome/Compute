import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { persistPreInstallReceipt, selfUpdateHandoffPaths } from '../src/self-update-handoff.mjs';
import { readSelfUpdateTransaction } from '../src/self-update-transaction-journal.mjs';

const execute = promisify(execFile);
const runner = fileURLToPath(new URL('./fixtures/local-provider-entrypoint-runner.mjs', import.meta.url));
const version = '0.7.0-dev.37781000050.1';

async function fixture(t, { mode = 'PROBE_ONLY', missing = false, stale = false, wrongVersion = false, malformedOwner = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-offline-successor-entry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const userData = path.join(root, 'profile'), appData = path.join(root, 'appdata');
  await fs.mkdir(userData); await fs.mkdir(appData);
  const app = { isPackaged: true, hasSingleInstanceLock: () => true, getPath: () => userData, getVersion: () => version };
  if (!missing) await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: wrongVersion ? '0.7.0-dev.37781000049.1' : version,
    available_version: wrongVersion ? '0.7.0-dev.37781000049.1' : version,
    metadata_verified: true, restart_gate_safe: true, successor_startup: mode,
    recorded_at: new Date(Date.now() - (stale ? 3600000 : 1000)).toISOString(), authority_effect: false,
  });
  if (malformedOwner) {
    const owner = path.join(appData, '@metaengine', 'browser-shell', 'metaengine-state-provider-v1.json');
    await fs.mkdir(path.dirname(owner), { recursive: true });
    await fs.writeFile(owner, 'malformed-private-owner');
  }
  return { app, root, userData, appData };
}

async function launch(f, { entry, primary = true, extraEnv = {} }) {
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'PATH', 'Path', 'TEMP', 'TMP']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  let result;
  try {
    result = await execute(process.execPath, [runner], { windowsHide: true, timeout: 15000,
      env: { ...env, APPDATA: f.appData, XDG_CONFIG_HOME: f.appData, ME2_INTEGRATION: '0', ...extraEnv,
        METAENGINE_SINGLETON_TEST_OPTIONS: JSON.stringify({ entry, primary, packaged: true, packageVersion: version,
          userData: f.userData, flags: ['--updated'], emitReady: false }) } });
    result.code = 0;
  } catch (error) {
    if (!Number.isInteger(error.code)) throw error;
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  const trace = result.stdout.split(/\r?\n/).find(line => line.startsWith('SINGLETON_TEST_TRACE='));
  assert(trace, result.stderr || result.stdout);
  return { ...result, ...JSON.parse(trace.slice('SINGLETON_TEST_TRACE='.length)) };
}

const imported = result => result.events.filter(row => row[0] === 'module').map(row => row[1]);
const receipt = async f => fs.readFile(selfUpdateHandoffPaths(f.app).successor, 'utf8').then(JSON.parse);

for (const entry of ['main-entry.mjs', 'final-runtime-entry.mjs']) {
  test(entry + ': exact durable PROBE_ONLY successor binds its receipt before local owner or runtime admission', async t => {
    const f = await fixture(t, { malformedOwner: true });
    const result = await launch(f, { entry });
    assert.equal(result.code, 0, result.stderr);
    const successor = await receipt(f);
    assert.equal(successor.version, version); assert.equal(successor.successor_startup, 'PROBE_ONLY');
    assert.equal(successor.primary_instance, true); assert.equal(successor.app_id, 'com.metaengine.browser.test');
    assert.match(successor.pre_install_receipt_sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'SUCCESSOR_BOOTED');
    for (const module of ['local-runtime-host-controller.mjs', 'local-state-provider-bootstrap.mjs',
      'native-supervisor-endpoints.mjs', 'host-resilience-runtime.mjs', 'main.mjs', 'me2-integration-entry.mjs']) {
      assert.equal(imported(result).includes(module), false, module + ' must remain unloaded on offline successor');
    }
    assert.equal(result.events.some(row => row[0] === 'fetch'), false);
    assert(result.events.some(row => row[0] === 'release-lock'));
  });

  test(entry + ': NORMAL and missing durable receipts preserve packaged Owner admission despite environment claims', async t => {
    for (const mode of ['NORMAL', 'MISSING']) {
      const f = await fixture(t, { mode: 'NORMAL', missing: mode === 'MISSING' });
      const result = await launch(f, { entry, extraEnv: { METAENGINE_SELF_UPDATE_SUCCESSOR_STARTUP: 'PROBE_ONLY' } });
      assert.equal(result.code, 1);
      assert(result.events.some(row => row[0] === 'entry-failed' && row[1] === 'local_state_packaged_owner_not_ready'));
      assert.equal(imported(result).includes('main.mjs'), false);
      await assert.rejects(receipt(f), { code: 'ENOENT' });
    }
  });

  test(entry + ': stale, different-version and missing-transaction probe receipts cannot manufacture a boot', async t => {
    for (const options of [{ stale: true }, { wrongVersion: true }, { missingTransaction: true }]) {
      const f = await fixture(t, options);
      if (options.missingTransaction) {
        const files = await fs.readdir(f.userData);
        const transaction = files.find(name => /transaction/.test(name));
        assert(transaction); await fs.unlink(path.join(f.userData, transaction));
      }
      const result = await launch(f, { entry });
      assert.equal(result.code, 1);
      await assert.rejects(receipt(f), { code: 'ENOENT' });
      assert.equal(imported(result).includes('main.mjs'), false);
    }
  });

  test(entry + ': a secondary updater process cannot write a successor receipt', async t => {
    const f = await fixture(t);
    const result = await launch(f, { entry, primary: false });
    assert.equal(result.code, 0);
    await assert.rejects(receipt(f), { code: 'ENOENT' });
    assert.equal(imported(result).includes('self-update-handoff.mjs'), false);
  });
}
