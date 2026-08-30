import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  persistPreInstallReceipt,
  persistUpdatedSuccessorReceipt,
  selfUpdateHandoffPaths,
} from '../src/self-update-handoff.mjs';

function appFixture(userData, {
  version = '0.6.3-dev.99.1',
  packaged = true,
  primary = true,
} = {}) {
  return {
    isPackaged: packaged,
    getPath(name) {
      assert.equal(name, 'userData');
      return userData;
    },
    getVersion() { return version; },
    hasSingleInstanceLock() { return primary; },
  };
}

function preInstall(version, recordedAt) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version,
    available_version: version,
    metadata_verified: true,
    restart_gate_safe: true,
    authority_effect: false,
    successor_startup: 'PROBE_ONLY',
    recorded_at: recordedAt,
  };
}

test('updated successor is bound to exact verified version, primary lock, and durable predecessor receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-handoff-'));
  try {
    const now = Date.parse('2026-08-30T05:00:00.000Z');
    const version = '0.6.3-dev.99.1';
    const app = appFixture(root, { version, primary: true });
    const predecessor = preInstall(version, new Date(now - 1000).toISOString());

    await persistPreInstallReceipt(app, predecessor);
    const result = await persistUpdatedSuccessorReceipt(app, {
      argv: ['METAENGINE Browser.exe', '--updated'],
      primaryInstance: true,
      appId: 'metaengine-browser',
      clock: () => now,
    });

    assert.equal(result.row.version, version);
    assert.equal(result.row.primary_instance, true);
    assert.equal(result.row.successor_startup, 'PROBE_ONLY');
    assert.equal(result.row.authority_effect, false);
    assert.equal(result.row.pre_install_recorded_at, predecessor.recorded_at);
    assert.match(result.row.pre_install_receipt_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.row.pid, process.pid);

    const paths = selfUpdateHandoffPaths(app);
    const durable = JSON.parse(await readFile(paths.successor, 'utf8'));
    assert.deepEqual(durable, result.row);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('updated successor fails closed when target version does not match durable predecessor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-version-'));
  try {
    const now = Date.parse('2026-08-30T05:00:00.000Z');
    const predecessorVersion = '0.6.3-dev.99.1';
    const app = appFixture(root, { version: '0.6.3-dev.100.1', primary: true });
    await persistPreInstallReceipt(app, preInstall(predecessorVersion, new Date(now - 1000).toISOString()));

    await assert.rejects(
      persistUpdatedSuccessorReceipt(app, {
        argv: ['METAENGINE Browser.exe', '--updated'],
        primaryInstance: true,
        clock: () => now,
      }),
      /self_update_successor_version_binding_invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('updated successor fails closed without exact primary-instance ownership', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-primary-'));
  try {
    const now = Date.parse('2026-08-30T05:00:00.000Z');
    const version = '0.6.3-dev.99.1';
    const app = appFixture(root, { version, primary: false });

    await assert.rejects(
      persistUpdatedSuccessorReceipt(app, {
        argv: ['METAENGINE Browser.exe', '--updated'],
        primaryInstance: true,
        clock: () => now,
      }),
      /self_update_successor_primary_lock_required/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('normal startup without --updated cannot synthesize successor evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-successor-normal-'));
  try {
    const app = appFixture(root);
    const result = await persistUpdatedSuccessorReceipt(app, {
      argv: ['METAENGINE Browser.exe'],
      primaryInstance: true,
    });
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
