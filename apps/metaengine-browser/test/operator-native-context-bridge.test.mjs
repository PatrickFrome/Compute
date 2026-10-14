import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createOperatorNativeContextReader, unknownNativeOperatorContext } from '../src/operator-native-context-bridge.mjs';

const apiKey = 'k'.repeat(64);
const owner = 'native-owner-1';
const now = () => new Date().toISOString();
const sources = ['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity'];
const gatewayBody = () => ({
  schema: 'metaengine.operator.gateway.v1', version: 1, operation: 'context',
  observed_at: now(), scope: 'READ_ONLY', storage: 'OWN_POSTGRES_ONLY',
  authority_effect: false, scheduler_authority: false, automatic_retry_allowed: false,
  context: {
    schema: 'metaengine.operator.context.v1', generated_at: now(),
    scope: 'READ_ONLY', storage: 'OWN_POSTGRES_ONLY', authority_effect: false,
    planes: Object.fromEntries(sources.map(name => [name, { state: 'UNKNOWN', proof: 'NONE', fresh: false }])),
    secret: 'must-not-expose',
  },
  run: { state: 'UNKNOWN', proof: 'NONE', run_id: null, cursor: null },
  raw_payload: 'do-not-expose',
});
const binding = (gateway_base_url) => ({
  provider: 'LOCAL_POSTGRES', boot_state: 'READY',
  owner_binding_source: 'NATIVE_IN_PROCESS_OWNER', owner_id: owner,
  api_key: apiKey, gateway_base_url,
});
async function fixture() {
  let body = gatewayBody(), count = 0, status = 200, headers = null;
  const server = createServer((req, res) => {
    count++; headers = req.headers;
    if (req.url !== '/operator/v1/context' || req.method !== 'GET' ||
      req.headers.apikey !== apiKey || req.headers.origin !== undefined) {
      res.writeHead(403); res.end('{}'); return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    get body() { return body; }, set body(x) { body = x; },
    get count() { return count; }, get headers() { return headers; },
    set status(x) { status = x; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test('native unbound Owner: typed UNKNOWN, no guessed URL, no network/effect', async () => {
  let calls = 0;
  const reader = createOperatorNativeContextReader({ fetchImpl: async () => { calls++; throw Error('network'); } });
  const value = await reader.readContext();
  assert.equal(value.state, 'UNKNOWN');
  assert.equal(value.run_id, null);
  assert.equal(value.event_seq, null);
  assert.equal(value.cloud_database_dependency, false);
  assert.equal(value.remote_fallback_allowed, false);
  assert.equal(value.authority_effect, false);
  assert.equal(calls, 0);
  assert.equal(unknownNativeOperatorContext('ATTACKER_REASON').reason, 'GATEWAY_UNAVAILABLE');
});

test('Owner blocked and malformed/external/redirect-capable Gateway targets make zero calls', async () => {
  let calls = 0;
  for (const patch of [
    { boot_state: 'BLOCKED' }, { boot_state: 'OFFLINE_DIAGNOSTIC' },
    { provider: 'HOSTED' }, { owner_binding_source: 'RENDERER' },
    { api_key: 'short' }, { owner_id: 'bad\\nowner' },
    ...['https://127.0.0.1:1234', 'http://localhost:1234',
      'http://127.0.0.2:1234', 'http://evil.example:1234',
      'http://[::1]:1234', 'http://127.0.0.1:1234/x',
      'http://127.0.0.1:1234?x=1', 'http://127.0.0.1:1234/#x',
      'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:0',
      'http://127.0.0.1:65536'].map(gateway_base_url => ({ gateway_base_url })),
  ]) {
    const reader = createOperatorNativeContextReader({
      getTrustedBinding: () => ({ ...binding('http://127.0.0.1:1234'), ...patch }),
      fetchImpl: async () => { calls++; throw Error('unsafe'); },
    });
    assert.equal((await reader.readContext()).state, 'UNKNOWN', JSON.stringify(patch));
  }
  assert.equal(calls, 0);
});

test('one authenticated loopback GET yields only the allowlisted W6 context', async () => {
  const f = await fixture();
  try {
    f.body.context.planes.database = { state: 'AVAILABLE', proof: 'TRUSTED_READBACK',
      fresh: true, observed_at: now(), password: 'secret' };
    const result = await createOperatorNativeContextReader({
      getTrustedBinding: () => binding(f.base),
    }).readContext();
    assert.equal(result.schema, 'metaengine.operator.context.v1');
    assert.equal(result.scope, 'READ_ONLY');
    assert.equal(result.storage, 'OWN_POSTGRES_ONLY');
    assert.equal(result.planes.database.source, 'LOCAL_POSTGRES');
    assert.equal(result.planes.database.state, 'AVAILABLE');
    assert.equal(result.planes.fleet.state, 'UNKNOWN');
    assert.equal(result.event_seq, null);
    assert.equal(result.proof_identity, null);
    assert.equal(result.automatic_retry_allowed, false);
    assert.equal(f.count, 1);
    assert.equal(f.headers.apikey, apiKey);
    assert.equal(f.headers.origin, undefined);
    assert.doesNotMatch(JSON.stringify(result), /must-not-expose|do-not-expose|password|secret|api_key/);
  } finally { await f.close(); }
});

test('forged positive, stale plane and no cryptographic cursor proof remain unproven', async () => {
  const f = await fixture();
  try {
    f.body.context.planes.host = { state: 'READY', fresh: true, proof: 'NONE', observed_at: now() };
    f.body.context.planes.source = { state: 'READY', fresh: true,
      proof: 'TRUSTED_READBACK', observed_at: new Date(Date.now() - 60_000).toISOString() };
    f.body.run = { state: 'AVAILABLE', owner_id: owner, project_id: 'project-1',
      run_id: 'run-1', owner_epoch: 3, cursor: '18', observed_at: now() };
    const value = await createOperatorNativeContextReader({
      getTrustedBinding: () => binding(f.base),
    }).readContext();
    assert.equal(value.planes.host.state, 'UNVERIFIED');
    assert.equal(value.planes.source.state, 'STALE');
    assert.equal(value.run_id, 'run-1');
    assert.equal(value.event_seq, 18);
    assert.equal(value.proof_identity, null);
  } finally { await f.close(); }
});

test('mismatched Owner/run, stale/context-forged response and denied auth => UNKNOWN', async () => {
  const f = await fixture();
  try {
    const reader = createOperatorNativeContextReader({ getTrustedBinding: () => binding(f.base) });
    for (const corrupt of [
      { ...gatewayBody(), operation: 'write' },
      { ...gatewayBody(), authority_effect: true },
      { ...gatewayBody(), storage: 'HOSTED' },
      { ...gatewayBody(), observed_at: new Date(Date.now() - 60_000).toISOString() },
      { ...gatewayBody(), context: { ...gatewayBody().context, generated_at: 'malformed' } },
      { ...gatewayBody(), run: { state: 'AVAILABLE', owner_id: 'other-owner',
        project_id: 'project', run_id: 'run', owner_epoch: 1, cursor: '5', observed_at: now() } },
      { ...gatewayBody(), run: { state: 'AVAILABLE', owner_id: owner,
        project_id: 'project', run_id: 'run', owner_epoch: 1, cursor: '005', observed_at: now() } },
      { ...gatewayBody(), run: { state: 'UNKNOWN', proof: 'TRUSTED_READBACK', run_id: null, cursor: null } },
    ]) {
      f.body = corrupt;
      assert.equal((await reader.readContext()).state, 'UNKNOWN');
    }
    f.status = 401;
    assert.equal((await reader.readContext()).state, 'UNKNOWN');
  } finally { await f.close(); }
});

test('oversize, redirects, network failures and competing reads stay bounded and inert', async () => {
  const f = await fixture();
  try {
    f.body.padding = 'x'.repeat(40_000);
    const reader = createOperatorNativeContextReader({ getTrustedBinding: () => binding(f.base) });
    assert.equal((await reader.readContext()).state, 'UNKNOWN');
    const redirect = createOperatorNativeContextReader({
      getTrustedBinding: () => binding(f.base),
      fetchImpl: async () => ({ url: 'https://evil.example/', ok: true, status: 200 }),
    });
    assert.equal((await redirect.readContext()).state, 'UNKNOWN');
    const broken = createOperatorNativeContextReader({
      getTrustedBinding: () => binding(f.base),
      fetchImpl: async () => { throw Error('secret error'); },
    });
    assert.doesNotMatch(JSON.stringify(await broken.readContext()), /secret/);
    f.body = gatewayBody();
    const [a,b,c] = await Promise.all([reader.readContext(),reader.readContext(),reader.readContext()]);
    assert.deepEqual(a,b); assert.deepEqual(b,c);
    assert.equal(f.count, 2);
  } finally { await f.close(); }
});

test('source IPC/preload contract: primary-only one-method bridge; no renderer URL/key authority', async () => {
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(preload, /contextBridge\\.exposeInMainWorld\\('metaengineOperator'/);
  assert.match(preload, /if \\(isPrimaryMe2PresentationDocument\\(\\)\\)/);
  assert.match(preload, /readContext: async \\(\\) =>/);
  assert.match(preload, /ipcRenderer\\.invoke\\('metaengine:operator:read-context'\\)/);
  assert.match(main, /assertOperatorContextSender\\(event\\)/);
  assert.match(main, /event\\.senderFrame !== shellView\\.webContents\\.mainFrame/);
  assert.match(main, /actual\\.origin !== pinned\\.origin/);
  assert.match(main, /args\\.length !== 0/);
  assert.doesNotMatch(preload, /LOCAL_STATE_API_KEY|METAENGINE_OPERATOR_GATEWAY_BASE_URL/);
});
