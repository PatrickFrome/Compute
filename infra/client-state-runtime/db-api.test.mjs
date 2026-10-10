import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { authenticated, ApiError, RPC_ALLOWLIST, TABLE_ALLOWLIST, RPC_CATALOG_QUERY, inspectLocalApiSchemaCatalog, compileTableRequest, compileRpcRequest, databaseError } from './db-api-core.mjs';
import { startDbApi } from './db-api.mjs';

const enrollment = 'compute_fabric_a2_browser_device_enrollment_request_h205f22';
const params = (text) => new URLSearchParams(text);
const signature = (name, args = [], defaults = 0) => ({ name, defaults, returnsSet: false, returnComposite: false, args: args.map((name) => ({ name, typeSchema: 'pg_catalog', typeName: 'text' })) });

test('all current Native Supervisor RPC call names are in the explicit allowlist', async () => {
  const dir = new URL('../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/', import.meta.url);
  const observed = new Set();
  for (const name of await readdir(dir)) {
    if (!/\.(mjs|ts)$/.test(name)) continue;
    const text = await readFile(new URL(name, dir), 'utf8');
    for (const match of text.matchAll(/(?:rpc\(|boundedRpc\(|\b[A-Z_]*RPC\s*=\s*)['"]([a-z0-9_]+)['"]/g)) observed.add(match[1]);
  }
  assert.deepEqual([...observed].sort(), [...RPC_ALLOWLIST].sort());
});

test('authentication requires apikey and independently validates optional bearer', () => {
  const secret = 'a'.repeat(64);
  assert.equal(authenticated({ apikey: secret }, secret), true);
  assert.equal(authenticated({ apikey: secret, authorization: 'Bearer ' + secret }, secret), true);
  assert.equal(authenticated({ authorization: 'Bearer ' + secret }, secret), false);
  assert.equal(authenticated({ apikey: secret, authorization: 'Bearer wrong' }, secret), false);
  assert.equal(authenticated({ apikey: 'a'.repeat(63) }, secret), false);
});

test('SELECT binds injection-looking values, bounded IN lists and actual order', () => {
  const attack = "x'); DROP TABLE public.secret; --";
  const query = new URLSearchParams({ client_id: 'eq.' + attack, status: 'in.(PENDING,APPROVED)', expires_at: 'gt.2026-10-07T00:00:00Z', select: 'request_id,status', order: 'requested_at.desc', limit: '1' });
  const plan = compileTableRequest({ table: enrollment, method: 'GET', params: query });
  assert.equal(plan.text.includes(attack), false);
  assert.match(plan.text, /"client_id" = \$1/);
  assert.match(plan.text, /"status" IN \(\$2, \$3\)/);
  assert.match(plan.text, /"expires_at" > \$4 ORDER BY "requested_at" DESC LIMIT \$5$/);
  assert.deepEqual(plan.values.map((item) => item.value), [attack, 'PENDING', 'APPROVED', '2026-10-07T00:00:00Z', 1]);
});

test('pairing active filter binds a PostgreSQL boolean rather than a truthy string', () => {
  const table = 'compute_fabric_a2_chat_bridge_remote_pairing_h205f22';
  const plan = compileTableRequest({ table, method: 'GET', params: params('active=eq.true&select=token_hash') });
  assert.equal(plan.values[0].value, true);
  const falsePlan = compileTableRequest({ table, method: 'GET', params: params('active=eq.false&select=token_hash') });
  assert.equal(falsePlan.values[0].value, false);
  assert.throws(() => compileTableRequest({ table, method: 'GET', params: params('active=eq.yes') }), /boolean_filter_invalid/);
});

test('general SQL paths, unused mutations and unsupported query grammar fail closed', () => {
  for (const table of ['pg_proc', '__proto__', 'secret']) assert.throws(() => compileTableRequest({ table, method: 'GET' }), ApiError);
  for (const method of ['PATCH', 'DELETE', 'PUT']) assert.throws(() => compileTableRequest({ table: enrollment, method }), /table_method_not_allowed/);
  for (const query of ['select=*', 'select=status,metadata', 'or=(status.eq.PENDING)', 'status=ilike.%', 'limit=999999', 'limit=-1', 'status=eq.PENDING&status=eq.APPROVED', 'order=requested_at.desc.nullsfirst']) {
    assert.throws(() => compileTableRequest({ table: enrollment, method: 'GET', params: params(query) }), ApiError, query);
  }
});

test('enrollment insert binds JSON and forbids extra fields and bulk bodies', () => {
  const body = { client_id: 'client-test', public_jwk: { kty: 'EC' }, metadata: { text: "' ); --" }, authority_effect: false };
  const plan = compileTableRequest({ table: enrollment, method: 'POST', params: params('select=request_id,status'), body, prefer: 'return=representation' });
  assert.match(plan.text, /^INSERT INTO/);
  assert.match(plan.text, /RETURNING "request_id", "status"$/);
  assert.equal(plan.values[1].json, true);
  assert.equal(plan.text.includes(body.metadata.text), false);
  assert.throws(() => compileTableRequest({ table: enrollment, method: 'POST', body: { ...body, approved_at: 'now' } }), /insert_columns_forbidden/);
  assert.throws(() => compileTableRequest({ table: enrollment, method: 'POST', body: [body] }), /json_object_required/);
});

test('RPC resolution supports omitted defaults and exact named typed arguments', () => {
  const name = 'devos_environment_state_v1';
  const input = signature(name, ['p_workspace', 'p_optional'], 1);
  input.args[0].typeName = 'uuid';
  const plan = compileRpcRequest(name, { p_workspace: 'uuid-text' }, [input]);
  assert.equal(plan.text, 'SELECT "public"."devos_environment_state_v1"("p_workspace" => $1::"pg_catalog"."uuid") AS value');
  assert.deepEqual(plan.values[0].value, 'uuid-text');
  assert.throws(() => compileRpcRequest(name, { unexpected: 'value' }, [input]), /rpc_arguments_invalid/);
  assert.throws(() => compileRpcRequest(name, {}, [input]), /rpc_arguments_invalid/);
  assert.throws(() => compileRpcRequest(name, { p_workspace: 'uuid-text' }, [input, input]), /rpc_signature_ambiguous/);
  assert.throws(() => compileRpcRequest('arbitrary_function', {}, [signature('arbitrary_function')]), /rpc_not_allowed/);
});

test('array and JSON RPC casts use catalog types and reject non-array inputs', () => {
  const name = 'meta_orchestrator_frontier_admit_v1';
  const input = signature(name, ['p_point_ids', 'p_plan']);
  Object.assign(input.args[0], { typeName: '_text', elementOid: 25 });
  Object.assign(input.args[1], { typeName: 'jsonb' });
  const plan = compileRpcRequest(name, { p_point_ids: ['P1', 'P2'], p_plan: { x: 1 } }, [input]);
  assert.equal(plan.values[0].elementOid, 25);
  assert.equal(plan.values[1].json, true);
  assert.match(plan.text, /::"pg_catalog"\."_text"/);
  assert.throws(() => compileRpcRequest(name, { p_point_ids: 'P1', p_plan: {} }, [input]), /rpc_array_required/);
});

function fakeDatabase() {
  const calls = [];
  const catalog = RPC_ALLOWLIST.map((name) => signature(name));
  const tx = { unsafe: async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('FROM pg_catalog.pg_proc')) return catalog;
    if (text.includes('devos_runtime_capabilities_v1')) return [{ value: { schema: 'test-capabilities' } }];
    if (text.startsWith('SELECT "public".')) return [{ value: { accepted: true } }];
    return [];
  } };
  return { calls, sql: { begin: async (run) => run(tx), array: (value) => value, json: (value) => value } };
}

test('direct API keeps the login identity while preserving signed protocol claims', async () => {
  const database = fakeDatabase();
  const apiKey = 'c'.repeat(64);
  await assert.rejects(startDbApi({ apiKey, port: 0, sql: database.sql, roleMode: 'admin' }), /api_role_mode_invalid/);
  const runtime = await startDbApi({ apiKey, port: 0, sql: database.sql, roleMode: 'direct' });
  try {
    const response = await fetch(runtime.address + '/health', { headers: { apikey: apiKey } });
    assert.equal(response.status, 200);
    assert.equal(database.calls.some(call => /SET LOCAL ROLE/.test(call.text)), false);
    const jwt = database.calls.find(call => call.text.includes('request.jwt.claims'));
    assert.deepEqual(JSON.parse(jwt.values[0]), { role: 'service_role', aud: 'authenticated', iss: 'local-state-runtime' });
  } finally { await runtime.close(); }
});

test('direct API refuses a missing or overloaded RPC catalog before binding a listener', async () => {
  for (const catalog of [RPC_ALLOWLIST.slice(1).map(name => signature(name)),
    [...RPC_ALLOWLIST.map(name => signature(name)), signature(RPC_ALLOWLIST[0])]]) {
    const database = fakeDatabase();
    const unsafe = database.sql.begin;
    database.sql.begin = run => unsafe(tx => run({ ...tx,
      unsafe: (text, values) => text === RPC_CATALOG_QUERY ? Promise.resolve(catalog) : tx.unsafe(text, values),
    }));
    await assert.rejects(startDbApi({ apiKey: 'd'.repeat(64), port: 0, sql: database.sql, roleMode: 'direct' }),
      /local_state_rpc_catalog_(incomplete|overloaded)/);
  }
});

test('HTTP requires local authority, role transaction and validates routing/body', async () => {
  const database = fakeDatabase();
  const secret = 'b'.repeat(64);
  const runtime = await startDbApi({ apiKey: secret, port: 0, instanceId: 'test-owned-instance', sql: database.sql });
  const get = (path, init = {}) => fetch(runtime.address + path, { ...init, headers: { apikey: secret, ...init.headers } });
  try {
    const health = await get('/health');
    assert.equal(health.status, 200);
    const value = await health.json();
    assert.equal(value.instance_id, 'test-owned-instance');
    assert.equal(value.rpc_catalog.available, RPC_ALLOWLIST.length);
    assert.equal(value.runtime_capabilities.schema, 'test-capabilities');
    assert.equal((await fetch(runtime.address + '/health')).status, 401);
    assert.equal((await get('/health', { headers: { authorization: 'Bearer different' } })).status, 401);
    assert.equal((await get('/health', { headers: { origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await get('/rest/v1/rpc/secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await get('/rest/v1/rpc/devos_environment_state_v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await get('/rest/v1/rpc/devos_environment_state_v1', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    const accepted = await get('/rest/v1/rpc/devos_environment_state_v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual(await accepted.json(), { accepted: true });
    const roleCalls = database.calls.filter((item) => item.text === 'SET LOCAL ROLE service_role');
    assert.ok(roleCalls.length >= 3);
    const jwt = database.calls.find((item) => item.text.includes('request.jwt.claims'));
    assert.deepEqual(JSON.parse(jwt.values[0]), { role: 'service_role', aud: 'authenticated', iss: 'local-state-runtime' });
    assert.ok(database.calls.some((item) => item.text.includes("statement_timeout = '10s'")));
  } finally { await runtime.close(); }
});

test('HTTP rejects oversized declared bodies before database work', async () => {
  const database = fakeDatabase();
  const secret = 'c'.repeat(64);
  const runtime = await startDbApi({ apiKey: secret, port: 0, sql: database.sql });
  try {
    const response = await fetch(runtime.address + '/rest/v1/rpc/devos_environment_state_v1', { method: 'POST', headers: { apikey: secret, 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }) });
    assert.equal(response.status, 413);
    assert.equal(database.calls.some((item) => item.text.startsWith('SELECT "public"."devos_environment_state_v1"')), false);
  } finally { await runtime.close(); }
});

test('chunked oversized bodies produce 413 without a database query or socket loss', async () => {
  const database = fakeDatabase();
  const secret = 'e'.repeat(64);
  const runtime = await startDbApi({ apiKey: secret, port: 0, sql: database.sql });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(runtime.address + '/rest/v1/rpc/devos_environment_state_v1', {
        method: 'POST', headers: { apikey: secret, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      }, (response) => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      for (let index = 0; index < 18; index += 1) request.write('x'.repeat(65536));
      request.end();
    });
    assert.equal(status, 413);
    assert.equal(database.calls.some((item) => item.text.startsWith('SELECT "public"."devos_environment_state_v1"')), false);
  } finally { await runtime.close(); }
});

test('busy requests fail before entering the database pool', async () => {
  const database = fakeDatabase();
  const originalBegin = database.sql.begin;
  let release;
  let held = 0;
  let allHeld;
  const gate = new Promise((resolve) => { release = resolve; });
  const admitted = new Promise((resolve) => { allHeld = resolve; });
  const secret = 'f'.repeat(64);
  const runtime = await startDbApi({ apiKey: secret, port: 0, sql: database.sql });
  database.sql.begin = async (run) => {
    held += 1;
    if (held === 6) allHeld();
    await gate;
    return originalBegin(run);
  };
  const responses = Array.from({ length: 6 }, () => fetch(runtime.address + '/health', { headers: { apikey: secret } }));
  try {
    await admitted;
    const overflow = await fetch(runtime.address + '/health', { headers: { apikey: secret } });
    assert.equal(overflow.status, 503);
    assert.equal((await overflow.json()).code, 'local_state_api_busy');
    assert.equal(held, 6);
  } finally {
    release();
    for (const response of await Promise.all(responses)) { assert.equal(response.status, 200); await response.arrayBuffer(); }
    await runtime.close();
  }
});

test('loopback configuration and error privacy are enforced', async () => {
  await assert.rejects(startDbApi({ host: '0.0.0.0' }), /loopback_host_required/);
  await assert.rejects(startDbApi({ apiKey: 'short' }), /random_api_key_required/);
  await assert.rejects(startDbApi({ apiKey: 'd'.repeat(64), databaseUrl: 'postgres://user:secret@remote.invalid:5432/db' }), /loopback_database_required/);
  assert.deepEqual(databaseError({ code: '08006', message: 'password sensitive connection' }), { status: 503, body: { code: '08006', message: 'database_request_failed' } });
  assert.equal(databaseError({ code: '57014' }).status, 504);
  assert.equal(databaseError({ code: '42501' }).status, 403);
});

test('fresh PostgreSQL catalog is explicitly missing all API functions/tables/roles without becoming READY', async () => {
  const calls = [];
  const sql = { unsafe: async (query, params = []) => {
    calls.push({ query: query.trim(), params });
    if (query.includes('AS "superuser"')) return [{ superuser: true }];
    return [];
  } };
  const observed = await inspectLocalApiSchemaCatalog({ sql });
  assert.equal(observed.state, 'BASELINE_SCHEMA_MISSING');
  assert.deepEqual(observed.missing_rpc, RPC_ALLOWLIST);
  assert.deepEqual(observed.missing_table, Object.keys(TABLE_ALLOWLIST));
  assert.equal(observed.required_rpc_count, RPC_ALLOWLIST.length);
  assert.equal(observed.required_table_count, 5);
  assert.equal(observed.service_role_present, false);
  assert.equal(observed.pgcrypto_present, false);
  assert.equal(observed.runtime_ready, false);
  assert.equal(observed.initialization_authorized, false);
  assert.equal(observed.authority_effect, false);
  assert.equal(calls.length, 5);
  assert(calls.every(({ query }) => query.startsWith('SELECT')), 'catalog inspection must be read-only');
});

test('catalog-complete cannot impersonate grants, RLS, runtime or owner authority', async () => {
  const tables = Object.entries(TABLE_ALLOWLIST).flatMap(([table_name, p]) =>
    [...new Set([...p.select, ...p.filters, ...p.order, ...(p.insert || [])])]
      .map(column_name => ({ table_name, column_name })));
  const sql = { unsafe: async (query) => {
    if (query.includes('AS "superuser"')) return [{ superuser: true }];
    if (query === RPC_CATALOG_QUERY) return RPC_ALLOWLIST.map(name => ({ name }));
    if (query.includes('information_schema.columns')) return tables;
    if (query.includes("rolname = 'service_role'")) return [{ rolname: 'service_role' }];
    if (query.includes("extname = 'pgcrypto'")) return [{ extname: 'pgcrypto' }];
    throw new Error('unrecognized SQL');
  } };
  const observed = await inspectLocalApiSchemaCatalog({ sql });
  assert.equal(observed.state, 'CATALOG_PRESENT_UNATTESTED');
  assert.equal(observed.complete_catalog_only, true);
  assert.deepEqual(observed.missing_rpc, []);
  assert.deepEqual(observed.missing_table, []);
  assert.deepEqual(observed.missing_column, []);
  assert.equal(observed.grants_attested, false);
  assert.equal(observed.rls_attested, false);
  assert.equal(observed.runtime_ready, false);
  assert.equal(observed.initialization_authorized, false);
});

test('partial catalog, denied admin and SQL errors fail closed without leaking SQL error text', async () => {
  const denied = { unsafe: async () => [{ superuser: false }] };
  await assert.rejects(inspectLocalApiSchemaCatalog({ sql: denied }), /superuser_required/);
  const error = { unsafe: async () => { throw new Error('private_password_in_error'); } };
  await assert.rejects(inspectLocalApiSchemaCatalog({ sql: error }), error => {
    assert.equal(error.message, 'local_schema_catalog_readback_failed');
    return true;
  });
  const noConnection = () => inspectLocalApiSchemaCatalog({});
  await assert.rejects(noConnection(), /connection_required/);
});
