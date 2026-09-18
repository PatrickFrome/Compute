import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  persistPreInstallReceipt,
  persistUpdatedSuccessorReceipt,
  selfUpdateHandoffPaths,
} from '../src/self-update-handoff.mjs';
import { SELF_UPDATE_TRANSACTION_FILE } from '../src/self-update-transaction-journal.mjs';

function fakeApp(userData) {
  return {
    isPackaged: true,
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return userData;
    },
    getVersion() { return '0.6.6-dev.901.1'; },
    hasSingleInstanceLock() { return true; },
  };
}

test('successor receipt is never created without its write-ahead transaction authority', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-authority-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: app.getVersion(),
    available_version: app.getVersion(),
    metadata_verified: true,
    restart_gate_safe: true,
    recorded_at: '2026-09-02T20:00:01.000Z',
    authority_effect: false,
  });

  await fs.unlink(path.join(userData, SELF_UPDATE_TRANSACTION_FILE));
  const { successor } = selfUpdateHandoffPaths(app);

  await assert.rejects(
    persistUpdatedSuccessorReceipt(app, {
      argv: ['METAENGINE Browser Test.exe', '--updated'],
      appId: 'com.metaengine.browser.test',
      clock: () => Date.parse('2026-09-02T20:00:02.000Z'),
    }),
    /self_update_transaction_missing/,
  );
  await assert.rejects(fs.access(successor));
});
