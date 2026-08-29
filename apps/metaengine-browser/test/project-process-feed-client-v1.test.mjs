import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectProcessFeedClient, validateProjectProcessFeedManifest } from '../src/project-process-feed-client-v1.mjs';

test('process feed manifest accepts only loopback typed RPC', () => {
  const valid = validateProjectProcessFeedManifest({ url: 'http://127.0.0.1:7711/rpc', token: 'local-capability' });
  assert.equal(valid.url, 'http://127.0.0.1:7711/rpc');
  assert.throws(() => validateProjectProcessFeedManifest({ url: 'https://example.com/rpc', token: 'x' }), /endpoint_not_loopback/);
  assert.throws(() => validateProjectProcessFeedManifest({ url: 'http://127.0.0.1:7711/admin', token: 'x' }), /endpoint_not_loopback/);
});

test('snapshot accepts only explicit zero-authority read-only response contract', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-process-feed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const manifestPath = path.join(dir, 'feed.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://127.0.0.1:7711/rpc', token: 'local-capability' }));
  let request = null;
  const client = new ProjectProcessFeedClient({
    manifestPath,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          schema: 'metaengine.project-process-feed.response.v1',
          effect_class: 'READ_ONLY',
          authority_effect: false,
          cursor: 'snapshot:42',
          observations: [{ source_system: 'SUPABASE', process_id: 'c5' }],
        }),
      };
    },
  });
  const result = await client.snapshot();
  assert.equal(result.cursor, 'snapshot:42');
  assert.equal(result.observations.length, 1);
  assert.equal(request.url, 'http://127.0.0.1:7711/rpc');
  assert.match(request.init.headers.authorization, /^Bearer /);
  const body = JSON.parse(request.init.body);
  assert.equal(body.method, 'project.process.snapshot');
});

test('feed rejects writable or authority-bearing responses', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-process-feed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const manifestPath = path.join(dir, 'feed.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://localhost:7711/rpc', token: 'local-capability' }));
  const client = new ProjectProcessFeedClient({
    manifestPath,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        schema: 'metaengine.project-process-feed.response.v1',
        effect_class: 'WRITE',
        authority_effect: true,
        observations: [],
      }),
    }),
  });
  await assert.rejects(() => client.snapshot(), /read_contract_failed/);
});
