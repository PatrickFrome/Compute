import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  autoConnectInstalledAttachedProvider,
  LOCAL_ATTACHED_AUTOCONNECT_SCHEMA,
  LOCAL_ATTACHED_AUTOCONNECT_FILE,
  localAttachedProviderAutoConnectFile,
} from '../src/local-restored-pg17-setup.mjs';

const sha = 'a'.repeat(64);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-autoconnect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const localAppData = path.join(root, 'LocalAppData');
  const appData = path.join(root, 'AppData');
  const state = path.join(localAppData, 'METAENGINE', 'client-state-attached-50');
  await fs.mkdir(state, { recursive: true });
  const configFile = path.join(state, 'attached-runtime.json');
  const restoreReceiptFile = path.join(root, 'restore-report.json');
  await fs.writeFile(configFile, '{}');
  await fs.writeFile(restoreReceiptFile, '{}');
  const descriptorFile = localAttachedProviderAutoConnectFile({
    platform: 'win32', env: { LOCALAPPDATA: localAppData },
  });
  await fs.writeFile(descriptorFile, JSON.stringify({
    schema: LOCAL_ATTACHED_AUTOCONNECT_SCHEMA, version: 1, postgres_mode: 'attached',
    config_file: configFile, restore_receipt_file: restoreReceiptFile,
    restore_receipt_sha256: sha, authority_effect: false,
  }) + '\n', { flag: 'wx' });
  return { root, localAppData, appData, configFile, restoreReceiptFile, descriptorFile };
}

test('automatic attached admission consumes only the path and receipt digest descriptor', async t => {
  const f = await fixture(t);
  let call;
  const result = await autoConnectInstalledAttachedProvider({
    platform: 'win32', resourcesPath: f.root, appDataDirectory: f.appData,
    env: { LOCALAPPDATA: f.localAppData, APPDATA: f.appData },
    operator: async options => {
      call = options;
      return { state: 'CONFIGURED', owner_profile_written: true, postgres_mode: 'attached',
        automatic_cloud_fallback: false, authority_effect: false };
    },
  });
  assert.equal(result.state, 'CONFIGURED');
  assert.equal(result.postgres_mode, 'attached');
  assert.deepEqual({ configFile: call.configFile, restoreReceiptFile: call.restoreReceiptFile,
    restoreReceiptSha256: call.restoreReceiptSha256, expectedPostgresMode: call.expectedPostgresMode,
    autoPrepareSource: call.autoPrepareSource }, {
    configFile: f.configFile, restoreReceiptFile: f.restoreReceiptFile,
    restoreReceiptSha256: sha, expectedPostgresMode: 'attached', autoPrepareSource: true,
  });
});

test('missing descriptor leaves a hard admission result without guessing a database', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-autoconnect-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await autoConnectInstalledAttachedProvider({ platform: 'win32', resourcesPath: root,
    appDataDirectory: path.join(root, 'AppData'), env: { LOCALAPPDATA: path.join(root, 'LocalAppData'), APPDATA: path.join(root, 'AppData') } });
  assert.deepEqual(result, { state: 'NO_DESCRIPTOR', authority_effect: false });
});

test('descriptor rejects extra fields and non-attached mode', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.descriptorFile, JSON.stringify({
    schema: LOCAL_ATTACHED_AUTOCONNECT_SCHEMA, version: 1, postgres_mode: 'owned',
    config_file: f.configFile, restore_receipt_file: f.restoreReceiptFile,
    restore_receipt_sha256: sha, authority_effect: false, secret: 'nope',
  }));
  await assert.rejects(autoConnectInstalledAttachedProvider({ platform: 'win32', resourcesPath: f.root,
    appDataDirectory: f.appData, env: { LOCALAPPDATA: f.localAppData, APPDATA: f.appData } }),
  /installed_restored_setup_autoconnect_descriptor_invalid/);
  assert.equal(path.basename(f.descriptorFile), LOCAL_ATTACHED_AUTOCONNECT_FILE);
});
