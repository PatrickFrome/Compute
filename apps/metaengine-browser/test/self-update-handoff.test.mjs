import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearSuccessorReceipt,
  persistPreInstallReceipt,
  persistUpdatedSuccessorReceipt,
  readExpectedPreInstallReceipt,
  selfUpdateHandoffPaths,
  SUCCESSOR_STARTUP_NORMAL,
  SUCCESSOR_STARTUP_PROBE_ONLY,
} from '../src/self-update-handoff.mjs';

function fakeApp(userData, { version = '0.6.3-dev.50.1', locked = true } = {}) {
  let hasLock = locked;
  return {
    isPackaged: true,
    getPath(name) { if (name !== 'userData') throw new Error(`unexpected_path:${name}`); return userData; },
    getVersion() { return version; },
    hasSingleInstanceLock() { return hasLock; },
    releaseSingleInstanceLock() { hasLock = false; },
  };
}

function receipt(overrides = {}) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: '0.6.3-dev.50.1',
    available_version: '0.6.3-dev.50.1',
    metadata_verified: true,
    restart_gate_safe: true,
    restart_gate_since: '2026-08-29T18:00:00.000Z',
    recorded_at: '2026-08-29T18:00:03.000Z',
    authority_effect: false,
    ...overrides,
  };
}

async function tempUserData() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-self-update-handoff-'));
}

test('pre-install receipt is durable and clears stale successor evidence', async (t) => {
  const userData = await tempUserData();
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  const paths = selfUpdateHandoffPaths(app);
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(paths.successor, '{"stale":true}\n');

  const result = await persistPreInstallReceipt(app, receipt({ successor_startup: SUCCESSOR_STARTUP_PROBE_ONLY }));
  assert.equal(result.path, paths.pre_install);
  assert.equal(result.successor_startup, SUCCESSOR_STARTUP_PROBE_ONLY);
  await assert.rejects(fs.access(paths.successor));

  const expected = await readExpectedPreInstallReceipt(app, { clock: () => Date.parse('2026-08-29T18:00:04.000Z') });
  assert.equal(expected.receipt.version, '0.6.3-dev.50.1');
  assert.equal(expected.successor_startup, SUCCESSOR_STARTUP_PROBE_ONLY);
  assert.match(expected.sha256, /^[a-f0-9]{64}$/);
});

test('updated successor is exact-version and hash bound without environment inheritance', async (t) => {
  const userData = await tempUserData();
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, receipt({ successor_startup: SUCCESSOR_STARTUP_PROBE_ONLY }));

  const result = await persistUpdatedSuccessorReceipt(app, {
    argv: ['METAENGINE Browser Test.exe', '--updated'],
    primaryInstance: true,
    appId: 'com.metaengine.browser.test',
    clock: () => Date.parse('2026-08-29T18:00:05.000Z'),
  });
  assert.equal(result.row.version, '0.6.3-dev.50.1');
  assert.equal(result.row.primary_instance, true);
  assert.equal(result.row.app_id, 'com.metaengine.browser.test');
  assert.equal(result.row.successor_startup, SUCCESSOR_STARTUP_PROBE_ONLY);
  assert.equal(result.row.authority_effect, false);
  assert.match(result.row.pre_install_receipt_sha256, /^[a-f0-9]{64}$/);

  const persisted = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.deepEqual(persisted, result.row);
});

test('normal production startup mode is the default', async (t) => {
  const userData = await tempUserData();
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, receipt());
  const result = await persistUpdatedSuccessorReceipt(app, {
    argv: ['METAENGINE Browser Test.exe', '--updated'],
    clock: () => Date.parse('2026-08-29T18:00:05.000Z'),
  });
  assert.equal(result.successor_startup, SUCCESSOR_STARTUP_NORMAL);
  assert.equal(result.row.successor_startup, SUCCESSOR_STARTUP_NORMAL);
});

test('non-updater launches never create successor evidence', async (t) => {
  const userData = await tempUserData();
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, receipt());
  const result = await persistUpdatedSuccessorReceipt(app, { argv: ['METAENGINE Browser Test.exe'] });
  assert.equal(result, null);
});

test('stale, wrong-version, invalid-mode and secondary successor states fail closed', async (t) => {
  const userData = await tempUserData();
  t.after(() => fs.rm(userData, { recursive: true, force: true }));

  const app = fakeApp(userData);
  await persistPreInstallReceipt(app, receipt());
  await assert.rejects(
    persistUpdatedSuccessorReceipt(app, {
      argv: ['METAENGINE Browser Test.exe', '--updated'],
      clock: () => Date.parse('2026-08-29T19:00:00.000Z'),
      maxAgeMs: 60_000,
    }),
    /receipt_stale/,
  );

  await persistPreInstallReceipt(app, receipt());
  const wrongVersion = fakeApp(userData, { version: '0.6.3-dev.50.2' });
  await assert.rejects(
    persistUpdatedSuccessorReceipt(wrongVersion, {
      argv: ['METAENGINE Browser Test.exe', '--updated'],
      clock: () => Date.parse('2026-08-29T18:00:05.000Z'),
    }),
    /version_binding_invalid/,
  );

  await assert.rejects(
    persistPreInstallReceipt(app, receipt({ successor_startup: 'REMOTE_EXECUTE' })),
    /successor_startup_invalid/,
  );

  const secondary = fakeApp(userData, { locked: false });
  await assert.rejects(
    persistUpdatedSuccessorReceipt(secondary, {
      argv: ['METAENGINE Browser Test.exe', '--updated'],
      primaryInstance: false,
    }),
    /primary_required/,
  );

  await clearSuccessorReceipt(app);
});

test('pre-install and successor receipts use the shared committed-file durability primitive', async () => {
  const source = await fs.readFile(new URL('../src/self-update-handoff.mjs', import.meta.url), 'utf8');
  const durable = await fs.readFile(new URL('../src/durable-json-file.cjs', import.meta.url), 'utf8');
  assert.match(source, /durableWriteJson\(pre_install, receipt\)/);
  assert.match(source, /durableWriteJson\(successor, row\)/);
  assert.doesNotMatch(source, /async function atomicWriteJson/);
  assert.doesNotMatch(source, /fs\.rename\(/);
  assert.match(durable, /await committed\.sync\(\)/);
  assert.match(durable, /await syncDirectory\(directory\)/);
  assert.match(durable, /if \(process\.platform === 'win32'\) return false/);
});
