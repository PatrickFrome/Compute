import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import test from 'node:test';
import { MetaOrchestratorNativeProvider } from '../src/meta-orchestrator-native-provider.mjs';

const execute = promisify(execFile);
const workspace = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const runtimePath = '/a2-browser-native-supervisor-v1';
const roadmap = 'metaengine-development-os-v1';
function identity() {
  const signed = [];
  return {
    signed,
    async ensure() { return { device_id: '11111111-1111-4111-8111-111111111111' }; },
    async deviceHeaders(method, path, body) {
      signed.push({ method, path, body });
      return { 'content-type': 'application/json', 'x-test-signature': 'signed' };
    },
  };
}
function inputs() {
  return {
    workspace_id: workspace, roadmap_id: roadmap,
    authority_effect: false, scheduler_authority: false,
    browser_authority: false, release_authority: false, task_content_authority: false,
  };
}

test('Meta authoritative read reaches the local HTTP supervisor with the canonical signed path', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, signature: req.headers['x-test-signature'], body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(inputs()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const id = identity();
  const provider = new MetaOrchestratorNativeProvider({
    identity: id, workspace_id: workspace,
    baseUrl: `http://127.0.0.1:${server.address().port}${runtimePath}/`,
  });
  assert.deepEqual(await provider.readAuthoritativeInputs({ roadmap_id: roadmap }), inputs());
  assert.deepEqual(requests, [{
    method: 'POST', path: `${runtimePath}/v1/meta/authoritative-inputs`,
    signature: 'signed', body: JSON.stringify({ roadmap_id: roadmap }),
  }]);
  assert.equal(id.signed[0].path, requests[0].path);
  assert.equal(provider.snapshot().automatic_retry, false);
  assert.equal(provider.snapshot().authority_effect, false);
});

test('Meta provider shares HTTPS and localhost normalization with supervisor endpoint policy', async () => {
  for (const baseUrl of ['http://localhost:15433/native/', ' https://provider.test/native/ ']) {
    const calls = [];
    const provider = new MetaOrchestratorNativeProvider({
      identity: identity(), workspace_id: workspace, baseUrl, runtimePath: '/native',
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify(inputs()), { status: 200 });
      },
    });
    await provider.readAuthoritativeInputs({ roadmap_id: roadmap });
    assert.deepEqual(calls, [`${baseUrl.trim().replace(/\/+$/, '')}/v1/meta/authoritative-inputs`]);
  }
});

test('Meta provider rejects remote plaintext and ambiguous endpoint material before signing or network', () => {
  for (const baseUrl of [
    '', 'not a URL', 'http://provider.test/native', 'http://127.0.0.1.example/native',
    'http://localhost.example/native', 'ftp://127.0.0.1/native',
    'https://provider.test/native?key=1', 'https://provider.test/native#fragment',
    'http://user:password@127.0.0.1:15433/native', 'https://user:password@provider.test/native',
  ]) {
    let calls = 0;
    const id = identity();
    assert.throws(() => new MetaOrchestratorNativeProvider({
      identity: id, workspace_id: workspace, baseUrl,
      fetchImpl: async () => { calls += 1; },
    }), /meta_native_endpoint_invalid/);
    assert.equal(calls, 0);
    assert.equal(id.signed.length, 0);
  }
});

test('LOCAL_POSTGRES module default constructs Meta provider and uses only the pinned local endpoint', async () => {
  const moduleUrl = new URL('../src/meta-orchestrator-native-provider.mjs', import.meta.url).href;
  const local = `http://127.0.0.1:15433${runtimePath}`;
  const code = `
    const { MetaOrchestratorNativeProvider } = await import(${JSON.stringify(moduleUrl)});
    const calls = [];
    const signed = [];
    const provider = new MetaOrchestratorNativeProvider({
      workspace_id: ${JSON.stringify(workspace)},
      identity: {
        ensure: async () => ({ device_id: '11111111-1111-4111-8111-111111111111' }),
        deviceHeaders: async (method, path) => { signed.push({ method, path }); return {}; },
      },
      fetchImpl: async (url) => { calls.push(url); return new Response(${JSON.stringify(JSON.stringify(inputs()))}, { status: 200 }); },
    });
    await provider.readAuthoritativeInputs({ roadmap_id: ${JSON.stringify(roadmap)} });
    console.log(JSON.stringify({ calls, signed }));
  `;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', code], {
    env: {
      ...process.env,
      METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
      METAENGINE_SUPERVISOR_BASE_URL: local,
      METAENGINE_LOCAL_STATE_INSTANCE_ID: '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59',
    },
    windowsHide: true, timeout: 15000,
  });
  assert.deepEqual(JSON.parse(stdout.trim()), {
    calls: [`${local}/v1/meta/authoritative-inputs`],
    signed: [{ method: 'POST', path: `${runtimePath}/v1/meta/authoritative-inputs` }],
  });
});
