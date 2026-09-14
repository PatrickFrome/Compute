import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComputeBridgeClient } from '../src/compute-bridge-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DAEMON_ENTRY = path.join(REPO_ROOT, 'coordination', 'browser-compute', 'src', 'cli.mjs');

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (lastError) throw lastError;
  throw new Error('compute_bridge_daemon_wait_timeout');
}

test('real A2 daemon creates HTTP bridge manifest and satisfies Browser runtime.health', {
  skip: process.env.METAENGINE_TEST_COMPUTE_DAEMON !== '1',
  timeout: 15000,
}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-a2-daemon-'));
  const manifestPath = path.join(home, '.a2', 'compute-bridge.json');
  const child = spawn(process.execPath, [DAEMON_ENTRY, 'serve', '--bridge-port=0'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    await waitFor(async () => {
      try {
        const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        return raw?.url && raw?.token ? raw : null;
      } catch {
        return null;
      }
    });
    const client = new ComputeBridgeClient({ manifestPath, autoStart: false, timeoutMs: 1500 });
    const health = await waitFor(async () => {
      const value = await client.health();
      return value.available ? value : null;
    });
    assert.equal(health.state, 'HEALTHY');
    assert.equal(health.result.schema, 'metaengine.a2-compute-browser.health.v1');
    assert.equal(health.result.runtime, '0.3.0-dev.3');
    assert.equal(health.result.web_authority_effect, false);
    assert.deepEqual(health.result.profiles, []);
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  }
  assert.equal(stderr.trim(), '');
});
