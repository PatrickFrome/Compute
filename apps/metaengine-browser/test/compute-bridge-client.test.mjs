import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBridgeClient, validateBridgeManifest } from '../src/compute-bridge-client.mjs';

test('bridge manifest accepts loopback RPC only', () => {
  assert.equal(validateBridgeManifest({ url: 'http://127.0.0.1:3123/rpc', token: 'x' }).url, 'http://127.0.0.1:3123/rpc');
  assert.throws(() => validateBridgeManifest({ url: 'https://example.com/rpc', token: 'x' }), /not_loopback/);
});

test('shell bridge exposes read-only calls and never leaks token in result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-shell-'));
  const manifestPath = path.join(dir, 'bridge.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://127.0.0.1:9999/rpc', token: 'secret-test-token' }));
  let seenAuth = null;
  const client = new ComputeBridgeClient({ manifestPath, fetchImpl: async (_url, init) => {
    seenAuth = init.headers.authorization;
    return { ok: true, status: 200, json: async () => ({ ok: true, effect_class: 'READ_ONLY', web_authority_effect: false, result: { runtime: '0.3.0-dev.3' } }) };
  }});
  assert.equal((await client.health()).result.runtime, '0.3.0-dev.3');
  assert.equal(seenAuth, 'Bearer secret-test-token');
  await assert.rejects(() => client.callReadOnly('action.click', {}), /not_read_only/);
  await fs.rm(dir, { recursive: true, force: true });
});
