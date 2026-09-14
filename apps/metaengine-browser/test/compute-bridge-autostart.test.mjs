import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBridgeClient, COMPUTE_HEALTH_STATES, resolveBundledComputeBridgeRoot } from '../src/compute-bridge-client.mjs';

test('bundled bridge root resolves to packaged resources or repository coordination runtime', () => {
  assert.equal(
    resolveBundledComputeBridgeRoot({ resourcesPath: 'C:\\Program Files\\METAENGINE\\resources', moduleDir: 'ignored' }),
    path.join('C:\\Program Files\\METAENGINE\\resources', 'a2-compute-browser'),
  );
  const moduleDir = path.join('/repo', 'apps', 'metaengine-browser', 'src');
  assert.equal(
    resolveBundledComputeBridgeRoot({ resourcesPath: null, moduleDir }),
    path.join('/repo', 'coordination', 'browser-compute'),
  );
});

test('ECONNREFUSED triggers one bundled daemon launch and returns real health after recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-compute-autostart-'));
  const manifestPath = path.join(dir, 'compute-bridge.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://127.0.0.1:47631/rpc', token: 'stale-token' }));
  let launched = false;
  let launchCount = 0;
  const client = new ComputeBridgeClient({
    manifestPath,
    autoStart: true,
    autoStartTimeoutMs: 500,
    autoStartPollMs: 25,
    launchBridge: async () => {
      launchCount += 1;
      launched = true;
      await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://127.0.0.1:48123/rpc', token: 'fresh-token' }));
      return null;
    },
    fetchImpl: async (_url, init) => {
      if (!launched) {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:47631');
        error.cause = { code: 'ECONNREFUSED' };
        throw error;
      }
      assert.equal(init.headers.authorization, 'Bearer fresh-token');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          effect_class: 'READ_ONLY',
          web_authority_effect: false,
          result: { schema: 'metaengine.a2-compute-browser.health.v1', runtime: '0.3.0-dev.3', profiles: [] },
        }),
      };
    },
  });
  try {
    const health = await client.health();
    assert.equal(launchCount, 1);
    assert.equal(health.state, COMPUTE_HEALTH_STATES.HEALTHY);
    assert.equal(health.available, true);
    assert.equal(health.automatic_remediation, true);
    assert.equal(health.remediation, 'BUNDLED_DAEMON_AUTOSTART');
    assert.equal(health.result.runtime, '0.3.0-dev.3');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid manifest remains fail-closed and is never overwritten by autostart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-compute-invalid-'));
  const manifestPath = path.join(dir, 'compute-bridge.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'https://example.com/rpc', token: 'bad' }));
  let launchCount = 0;
  const client = new ComputeBridgeClient({
    manifestPath,
    autoStart: true,
    launchBridge: async () => { launchCount += 1; },
  });
  try {
    const health = await client.health();
    assert.equal(health.state, COMPUTE_HEALTH_STATES.UNAVAILABLE_CONFIG);
    assert.equal(health.available, false);
    assert.equal(health.automatic_remediation, false);
    assert.equal(launchCount, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
