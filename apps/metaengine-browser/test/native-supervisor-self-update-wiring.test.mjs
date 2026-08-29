import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/native-supervisor-client.mjs');

test('native supervisor uses the shared durable handoff before singleton release', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.match(source, /import \{ persistPreInstallReceipt \} from '\.\/self-update-handoff\.mjs';/);
  assert.doesNotMatch(source, /fs\.open|fs\.rename|metaengine-self-update-pre-install-receipt-v1\.json/);

  const persistAt = source.indexOf('await persistPreInstallReceipt(app, receipt);');
  const installerHookAt = source.indexOf('beforeInstallerLaunch: async () =>');
  const stopAt = source.indexOf('this.stop();', installerHookAt);
  const releaseAt = source.indexOf('app.releaseSingleInstanceLock();', installerHookAt);
  const readbackAt = source.indexOf("if (app.hasSingleInstanceLock()) throw new Error('native_supervisor_self_update_singleton_release_failed');", installerHookAt);

  assert.ok(persistAt >= 0, 'shared durable receipt missing');
  assert.ok(installerHookAt > persistAt, 'installer hook must follow durable receipt phase');
  assert.ok(stopAt > installerHookAt, 'supervisor must quiesce in installer hook');
  assert.ok(releaseAt > stopAt, 'singleton release must follow supervisor quiescence');
  assert.ok(readbackAt > releaseAt, 'singleton release must be read back before NSIS is permitted');
});
