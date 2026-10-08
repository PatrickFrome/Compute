import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelfHostedSupervisorConfig } from '../supabase/a2-browser-native-supervisor-v1/self-hosted-config.mjs';

const valid = {
  LOCAL_STATE_RUNTIME: 'LOCAL_POSTGRES', LOCAL_STATE_DATABASE_URL: 'postgres://local_state_api:private@127.0.0.1:15434/postgres',
  LOCAL_STATE_API_BASE_URL: 'http://127.0.0.1:15432', LOCAL_STATE_API_KEY: 'a'.repeat(64),
  LOCAL_STATE_INSTANCE_ID: '11223344-5566-4788-9900-aabbccddeeff', LOCAL_STATE_EDGE_PORT: '15433',
};
const resolve = (env) => resolveSelfHostedSupervisorConfig((name) => env[name]);

test('local provider resolves only explicit local service values and ignores old cloud credentials', () => {
  const result = resolve({ ...valid, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'old' });
  assert.equal(result.local, true);
  assert.equal(result.apiBase, 'http://127.0.0.1:15432');
  assert.equal(result.key, valid.LOCAL_STATE_API_KEY);
  assert.deepEqual(result.serverOptions, { hostname: '127.0.0.1', port: 15433 });
});

test('local provider rejects cloud URLs, inline API credentials, weak keys and colliding ports', () => {
  for (const patch of [
    { LOCAL_STATE_DATABASE_URL: 'postgres://postgres:private@db.example.com/postgres' },
    { LOCAL_STATE_API_BASE_URL: 'https://example.supabase.co' },
    { LOCAL_STATE_API_BASE_URL: 'http://secret@127.0.0.1:15432' },
    { LOCAL_STATE_API_BASE_URL: 'http://127.0.0.1:15432/path' },
    { LOCAL_STATE_API_KEY: 'short' }, { LOCAL_STATE_INSTANCE_ID: 'not-an-instance' },
    { LOCAL_STATE_EDGE_PORT: '15432' }, { LOCAL_STATE_EDGE_PORT: '15434' }, { LOCAL_STATE_RUNTIME: 'AUTO' },
  ]) assert.throws(() => resolve({ ...valid, ...patch }));
});

test('absent local mode preserves hosted setup and never infers local readiness', () => {
  assert.deepEqual(resolve({}), { local: false, serverOptions: {} });
  assert.throws(() => resolve({ LOCAL_STATE_RUNTIME: 'LOCAL_POSTGRES' }));
});
