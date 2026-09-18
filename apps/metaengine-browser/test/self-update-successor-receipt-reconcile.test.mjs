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

function fakeApp(userData, { version = '0.6.6-dev.900.1' } = {}) {
  return {
    isPackaged: true,
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return userData;
    },
    getVersion() { return version; },
    hasSingleInstanceLock() { return true; },
  };
}

function preInstallReceipt(overrides = {}) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: '0.6.6-dev.900.1',
    available_version: '0.6.6-dev.900.1',
    metadata_verified: true,
    restart_gate_safe: true,
    restart_gate_since: '2026-09-02T20:00:00.000Z',
    recorded_at: '2026-09-02T20:00:01.000Z',
    authority_effect: false,
    ...overrides,
  };
}

async function fixture(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-reconcile-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, preInstallReceipt());
  return { app, userData };
}

const updatedArgv = ['METAENGINE Browser Test.exe', '--updated'];
const appId = 'com.metaengine.browser.test';

test('same successor process reuses exact durable receipt without rewriting recorded_at', async (t) => {
  const { app } = await fixture(t);
  const first = await persistUpdatedSuccessorReceipt(app, {
    argv: updatedArgv,
    appId,
    clock: () => Date.parse('2026-09-02T20:00:02.000Z'),
  });
  const firstRaw = await fs.readFile(first.path, 'utf8');

  const second = await persistUpdatedSuccessorReceipt(app, {
    argv: updatedArgv,
    appId,
    clock: () => Date.parse('2026-09-02T20:05:00.000Z'),
  });
  const secondRaw = await fs.readFile(second.path, 'utf8');

  assert.equal(second.row.recorded_at, '2026-09-02T20:00:02.000Z');
  assert.equal(second.row.pid, process.pid);
  assert.equal(secondRaw, firstRaw);
});

test('mismatched existing successor receipt fails closed and is never overwritten', async (t) => {
  const { app } = await fixture(t);
  const first = await persistUpdatedSuccessorReceipt(app, {
    argv: updatedArgv,
    appId,
    clock: () => Date.parse('2026-09-02T20:00:02.000Z'),
  });
  const tampered = { ...first.row, pre_install_receipt_sha256: '0'.repeat(64) };
  await fs.writeFile(first.path, `${JSON.stringify(tampered, null, 2)}\n`);

  await assert.rejects(
    persistUpdatedSuccessorReceipt(app, {
      argv: updatedArgv,
      appId,
      clock: () => Date.parse('2026-09-02T20:05:00.000Z'),
    }),
    /self_update_successor_receipt_binding_mismatch:pre_install_receipt_sha256/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(first.path, 'utf8')), tampered);
});

test('malformed existing successor receipt fails closed and is never replaced', async (t) => {
  const { app } = await fixture(t);
  const paths = selfUpdateHandoffPaths(app);
  await fs.writeFile(paths.successor, '{not-json\n');

  await assert.rejects(
    persistUpdatedSuccessorReceipt(app, {
      argv: updatedArgv,
      appId,
      clock: () => Date.parse('2026-09-02T20:05:00.000Z'),
    }),
    /self_update_successor_receipt_json_invalid/,
  );
  assert.equal(await fs.readFile(paths.successor, 'utf8'), '{not-json\n');
});

test('write error after final-path commit is recovered only by exact positive readback', async (t) => {
  const { app } = await fixture(t);
  let writes = 0;
  const result = await persistUpdatedSuccessorReceipt(app, {
    argv: updatedArgv,
    appId,
    clock: () => Date.parse('2026-09-02T20:00:02.000Z'),
    writeJson: async (target, row) => {
      writes += 1;
      await fs.writeFile(target, `${JSON.stringify(row, null, 2)}\n`);
      const error = new Error('simulated_post_rename_fsync_failure');
      error.code = 'EIO';
      throw error;
    },
  });

  assert.equal(writes, 1);
  assert.equal(result.row.version, app.getVersion());
  assert.equal(result.row.pid, process.pid);
  assert.equal(result.row.authority_effect, false);
});

test('write error with no final receipt remains held and is not retried in-call', async (t) => {
  const { app } = await fixture(t);
  let writes = 0;
  await assert.rejects(
    persistUpdatedSuccessorReceipt(app, {
      argv: updatedArgv,
      appId,
      clock: () => Date.parse('2026-09-02T20:00:02.000Z'),
      writeJson: async () => {
        writes += 1;
        throw new Error('simulated_precommit_failure');
      },
    }),
    /simulated_precommit_failure/,
  );
  assert.equal(writes, 1);
});
