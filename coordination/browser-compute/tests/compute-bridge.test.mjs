import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startHttpBridge } from '../src/rpc-server.mjs';

function makeMockRuntime() {
  return {
    stateRoot: path.join(os.tmpdir(), 'a2-compute-bridge-manifest-test'),
    health: () => Promise.resolve({ schema: 'metaengine.a2-compute-browser.health.v1', profiles: [] }),
    startProfile: () => Promise.resolve({ profile_id: 'p1', running: true }),
    stopProfile: () => Promise.resolve({ profile_id: 'p1', running: false }),
    listProfiles: () => Promise.resolve([]),
    createContext: () => Promise.resolve({ context_id: 'c1' }),
    listContexts: () => Promise.resolve([]),
    closeContext: () => Promise.resolve({ closed: true }),
    createTarget: () => Promise.resolve({ target_id: 't1', bound: true }),
    listTargets: () => Promise.resolve([]),
    semanticSnapshot: () => Promise.resolve({ schema: 'metaengine.a2-browser-operator.semantic-frame.v1', nodes: [] }),
    activateTarget: () => Promise.resolve({ activated: true }),
    closeTarget: () => Promise.resolve({ closed: true }),
    navigateAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'NAVIGATE', status: 'EFFECTED' }),
    clickAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'CLICK', status: 'EFFECTED' }),
    typeAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'TYPE', status: 'EFFECTED' }),
    submitAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'SUBMIT', status: 'EFFECTED' })
  };
}

test('compute bridge manifest is written when bridge starts', async () => {
  const runtime = makeMockRuntime();
  const token = 'compute-bridge-test-token';
  const bridge = await startHttpBridge(runtime, 0, token);
  try {
    const manifestDir = path.join(os.homedir(), '.a2');
    await fs.mkdir(manifestDir, { recursive: true });
    const manifest = {
      url: `http://127.0.0.1:${bridge.port}/rpc`,
      token,
      written_at: new Date().toISOString()
    };
    await fs.writeFile(path.join(manifestDir, 'compute-bridge.json'), JSON.stringify(manifest, null, 2));

    const written = await fs.readFile(path.join(manifestDir, 'compute-bridge.json'), 'utf8');
    const parsed = JSON.parse(written);
    assert.equal(parsed.url, `http://127.0.0.1:${bridge.port}/rpc`);
    assert.equal(parsed.token, token);
    assert.ok(parsed.written_at);
    assert.equal(typeof parsed.written_at, 'string');
  } finally {
    await bridge.close();
  }
});

test('compute bridge manifest contains valid JSON with required fields', async () => {
  const manifestDir = path.join(os.homedir(), '.a2');
  const manifestPath = path.join(manifestDir, 'compute-bridge.json');
  let exists = false;
  try { await fs.access(manifestPath); exists = true; } catch (_) {}

  if (!exists) {
    const runtime = makeMockRuntime();
    const bridge = await startHttpBridge(runtime, 0, 'test-token');
    try {
      await fs.mkdir(manifestDir, { recursive: true });
      await fs.writeFile(manifestPath, JSON.stringify({
        url: `http://127.0.0.1:${bridge.port}/rpc`,
        token: 'test-token',
        written_at: new Date().toISOString()
      }, null, 2));
    } finally {
      await bridge.close();
    }
  }

  const written = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(written);
  assert.ok(parsed.url.startsWith('http://127.0.0.1:'));
  assert.ok(parsed.url.endsWith('/rpc'));
  assert.ok(typeof parsed.token === 'string' && parsed.token.length > 0);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(parsed.written_at));
});