import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

function productionSource(file, imports) {
  let source = stripTypeScriptTypes(readFileSync(new URL(`../../me2-ui/src/lib/${file}`, import.meta.url), 'utf8'), { mode: 'strip' });
  for (const statement of imports) {
    assert.ok(source.includes(statement), 'production import anchor missing');
    source = source.replace(statement, '');
  }
  return source.replace(/\bexport\s+/g, '');
}

const cloudSource = productionSource('cloud.ts', ['import fs from "node:fs";']);
const fallbackSource = productionSource('fallback-console.ts', ['import { EDGE_BASE, edgeHealth } from "@/lib/edge";', 'import { query } from "@/lib/pg";']);

function cloudFixture(env = {}) {
  const calls = { files: [], fetch: [] };
  const fs = { readFileSync: (...args) => { calls.files.push(args); return 'SUPABASE_URL=https://historical.supabase.co\nSUPABASE_SERVICE_ROLE_JWT=historical-private-key\n'; } };
  const fetch = async (...args) => { calls.fetch.push(args); return Response.json([]); };
  const client = new Function('fs', 'process', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout',
    `${cloudSource}\nreturn {cloudConfigured, cloudLatestState, cloudIssueCommand, cloudCommandReceipt, cloudRpc, cloudFleetSnapshot};`)(
    fs, { env }, fetch, AbortController, setTimeout, clearTimeout,
  );
  return { client, calls, env };
}

function fallbackFixture(env = {}, responses = [200, 200]) {
  const calls = { fetch: [], query: [], drill: [] };
  const fetch = async (...args) => { calls.fetch.push(args); return new Response('', { status: responses[(calls.fetch.length - 1) % responses.length] }); };
  const query = async (...args) => { calls.query.push(args); return { rows: [] }; };
  const edgeHealth = async (...args) => { calls.drill.push(args); return { ok: true, ms: 1 }; };
  const module = new Function('EDGE_BASE', 'edgeHealth', 'query', 'process', 'fetch', 'globalThis', 'AbortController', 'setTimeout', 'clearTimeout',
    `${fallbackSource}\nreturn {getFallbackConsole, ensureFallbackTables, recentTransitions};`)(
    'http://127.0.0.1:3031/a2-browser-native-supervisor-v1', edgeHealth, query, { env }, fetch, {}, AbortController, setTimeout, clearTimeout,
  );
  return { module, calls, env };
}

test('local console refuses every hosted read/RPC before credentials, files or network', async () => {
  for (const env of [
    { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES' },
    { METAENGINE_STATE_PROVIDER: ' LOCAL_POSTGRES ', SUPABASE_URL: 'https://private.supabase.co', SUPABASE_SERVICE_ROLE_JWT: 'private' },
  ]) {
    const { client, calls } = cloudFixture(env);
    assert.equal(client.cloudConfigured(), false);
    for (const operation of [
      () => client.cloudLatestState(), () => client.cloudCommandReceipt('command-test'),
      () => client.cloudRpc('devos_fleet_snapshot_v1', {}), () => client.cloudFleetSnapshot(),
      () => client.cloudIssueCommand({ action: 'CAPTURE', payload: {}, idempotencyKey: 'test' }),
    ]) await assert.rejects(operation(), /cloud_console_unavailable_in_local_profile/);
    assert.deepEqual(calls, { files: [], fetch: [] });
  }
});

test('a cached historic service identity cannot bypass a later explicit local profile', async () => {
  const { client, calls, env } = cloudFixture();
  assert.equal(client.cloudConfigured(), true);
  assert.equal(calls.files.length, 1);
  env.METAENGINE_STATE_PROVIDER = ' LOCAL_POSTGRES ';
  assert.equal(client.cloudConfigured(), false);
  await assert.rejects(client.cloudLatestState(), /cloud_console_unavailable_in_local_profile/);
  assert.equal(calls.files.length, 1);
  assert.equal(calls.fetch.length, 0);
});

test('legacy cloud profile retains the selected REST endpoint and backend headers', async () => {
  const { client, calls } = cloudFixture({ SUPABASE_URL: 'https://selected.example/', SUPABASE_SERVICE_ROLE_JWT: 'server-only-key' });
  assert.equal(client.cloudConfigured(), true);
  assert.equal(await client.cloudLatestState(), null);
  assert.equal(calls.files.length, 0);
  assert.match(calls.fetch[0][0], /^https:\/\/selected\.example\/rest\/v1\//);
  assert.deepEqual(calls.fetch[0][1].headers, { apikey: 'server-only-key', Authorization: 'Bearer server-only-key' });
});

test('local fallback console remains held with no probes, transitions, DDL or drills', async () => {
  const { module, calls } = fallbackFixture({ METAENGINE_STATE_PROVIDER: ' LOCAL_POSTGRES ' });
  const console = module.getFallbackConsole();
  await module.ensureFallbackTables();
  assert.deepEqual(await module.recentTransitions(), []);
  for (const operation of [() => console.tickIfDue(), () => console.forceTick(), () => console.setSimulation(true), () => console.setSimulation(false)]) {
    const result = await operation();
    assert.equal(result.mode, 'DISABLED_LOCAL_PROFILE');
    assert.equal(result.gate.locked, true);
    assert.equal(result.gate.reserveUsable, false);
    assert.equal(result.failover.enabled, false);
    assert.equal(result.failover.cloudBase, '');
    assert.equal(result.simulation.active, false);
    assert.deepEqual(result.counters, { probesTotal: 0, transitionsTotal: 0, drillsTotal: 0 });
    assert.equal(result.authorityEffect, false);
  }
  const drill = await console.drill();
  assert.equal(drill.ok, false);
  assert.equal(drill.error, 'LOCAL_PROFILE_LEGACY_CONSOLE_NOT_PORTED');
  assert.deepEqual(calls, { fetch: [], query: [], drill: [] });
});

test('previously created legacy sentinel cannot probe or drill after local profile selection', async () => {
  const { module, calls, env } = fallbackFixture();
  const console = module.getFallbackConsole();
  env.METAENGINE_STATE_PROVIDER = 'LOCAL_POSTGRES';
  assert.equal((await console.forceTick()).mode, 'DISABLED_LOCAL_PROFILE');
  await console.drill();
  await console.setSimulation(true);
  assert.deepEqual(calls, { fetch: [], query: [], drill: [] });
});

test('legacy fallback hysteresis, persistence and local health drill still work without local marker', async () => {
  const { module, calls } = fallbackFixture({}, [503, 200]);
  const console = module.getFallbackConsole();
  assert.equal((await console.forceTick()).mode, 'CLOUD_AUTHORITY');
  assert.equal((await console.forceTick()).mode, 'LOCAL_FALLBACK');
  assert.equal(calls.fetch.length, 4);
  assert.equal(calls.query.length, 1);
  assert.match(calls.query[0][0], /INSERT INTO destruktion_meta\.fallback_console_transition_log/);
  assert.equal((await console.drill()).ok, true);
  assert.equal(calls.drill.length, 1);
});
