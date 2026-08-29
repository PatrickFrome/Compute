import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { METAENGINE_BROWSER_APP_ID } from '../src/single-instance-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('NSIS identity remains compatible with installed 0.6.2 development line', async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.test.json'), 'utf8'));
  assert.equal(config.appId, 'com.metaengine.browser.test');
  assert.equal(config.appId, METAENGINE_BROWSER_APP_ID);
  assert.equal(config.productName, 'METAENGINE Browser Test');
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.publish?.[0]?.channel, 'dev');
});
