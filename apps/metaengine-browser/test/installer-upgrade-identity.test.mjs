import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { METAENGINE_BROWSER_APP_ID } from '../src/single-instance-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('NSIS upgrade identity remains compatible with installed 0.6.2 development line', async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.test.json'), 'utf8'));

  // Upgrade identity is the stable app/product/per-user installation contract. The
  // installer interaction mode is intentionally not part of that identity: changing
  // assisted -> one-click must not fork the app id, install scope, data root or channel.
  assert.equal(config.appId, 'com.metaengine.browser.test');
  assert.equal(config.appId, METAENGINE_BROWSER_APP_ID);
  assert.equal(config.productName, 'METAENGINE Browser Test');
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.publish?.[0]?.channel, 'dev');
});

test('manual installer interaction mode is one-click without changing upgrade identity', async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.test.json'), 'utf8'));
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.runAfterFinish, true);
});
