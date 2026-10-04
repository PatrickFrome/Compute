import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { actorConfig, openAiChatBody, openAiModel, openAiPolicy, requestOpenAiChat } from '../src/inference-policy.ts';

test('active A/B policy ignores legacy provider endpoints, credentials and model defaults', () => {
  const policy = openAiPolicy({
    OPENAI_API_KEY: 'test-openai-key',
    SOVEREIGN_GLM_URL: 'https://api.z.ai', SOVEREIGN_GPT_URL: 'http://localhost:8001',
    SOVEREIGN_GLM_TOKEN: 'legacy-key', SOVEREIGN_INFERENCE_TOKEN: 'legacy-key',
    SOVEREIGN_GLM_MODEL: 'zai-org/GLM-4.7-Flash',
  });
  for (const cfg of Object.values(policy)) {
    assert.equal(cfg.provider, 'OPENAI');
    assert.equal(cfg.base, 'https://api.openai.com');
    assert.equal(cfg.model, 'gpt-6.1-sol');
    assert.equal(cfg.token, 'test-openai-key');
  }
  assert.notEqual(policy.agent_a.agent_id, policy.agent_b.agent_id);
});

test('saved GLM and local GPT-OSS model hints read without activating those models', () => {
  const policy = openAiPolicy({ SOVEREIGN_AGENT_B_MODEL: 'gpt-6-luna' });
  assert.equal(actorConfig(policy, 'GLM', { glm_model: 'zai-org/GLM-4.7-Flash' }).model, 'gpt-6-luna');
  assert.equal(actorConfig(policy, 'GPT', { gpt_model: 'openai/gpt-oss-20b' }).model, 'gpt-6.1-sol');
  assert.equal(actorConfig(policy, 'GPT', { gpt_model: 'openai:gpt-4.1' }).model, 'gpt-4.1');
  assert.throws(() => actorConfig(policy, 'GLM', { agent_b_model: 'zai:glm-5.3' }), /openai_model_not_allowed/);
});

test('new active model config rejects non-OpenAI providers and local open-weight models', () => {
  for (const model of ['zai:glm-5.3', 'zai-org/GLM-4.7-Flash', 'claude-sonnet', 'gateway:gpt-6.1-sol', 'gpt-oss-20b']) {
    assert.throws(() => openAiModel(model), /openai_model_not_allowed/);
    assert.throws(() => openAiPolicy({ SOVEREIGN_AGENT_B_MODEL: model }), /openai_model_not_allowed/);
  }
});

test('ChatGPT browser auth or legacy token cannot substitute for a separate API credential', async () => {
  const policy = openAiPolicy({ CHATGPT_SESSION_TOKEN: 'browser-auth', SOVEREIGN_GLM_TOKEN: 'legacy-key' });
  let calls = 0;
  await assert.rejects(requestOpenAiChat(policy.agent_a, {}, {
    fetchImpl: async () => { calls += 1; return new Response('{}'); },
  }), /openai_api_key_required/);
  assert.equal(calls, 0);
});

test('two concurrent agents send independent contexts and fenced identities only to OpenAI', async () => {
  const policy = openAiPolicy({ OPENAI_API_KEY: 'test-key' });
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return new Response(JSON.stringify({ choices: [{ message: { content: body.metadata.agent_id } }] }));
  };
  const inputs = [
    { messages: [{ role: 'user', content: 'Implement independent task A' }], max_tokens: 1200, temperature: 0.2, conversation_id: 'shared', metadata: { agent_id: 'spoofed' } },
    { messages: [{ role: 'user', content: 'Critic independent task B' }], max_completion_tokens: 2400, previous_response_id: 'shared' },
  ];
  const responses = await Promise.all([
    requestOpenAiChat(policy.agent_a, inputs[0], { fetchImpl }),
    requestOpenAiChat(policy.agent_b, inputs[1], { fetchImpl }),
  ]);
  assert.deepEqual(await Promise.all(responses.map(async response => (await response.json()).choices[0].message.content)), ['agent_a', 'agent_b']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.authorization, 'Bearer test-key');
    assert.equal(call.body.model, 'gpt-6.1-sol');
    assert.equal(call.body.store, false);
    for (const field of ['max_tokens', 'temperature', 'conversation_id', 'previous_response_id']) assert.equal(field in call.body, false);
  }
  assert.equal(calls[0].body.max_completion_tokens, 1200);
  assert.equal(calls[1].body.max_completion_tokens, 2400);
  assert.equal(calls[0].body.messages[0].content, 'Implement independent task A');
  assert.equal(calls[1].body.messages[0].content, 'Critic independent task B');
  assert.equal(inputs[0].metadata.agent_id, 'spoofed'); // Caller objects are not mutated.
  assert.equal(inputs[0].max_tokens, 1200);
});

test('proxy body pins configured OpenAI model and preserves explicit stream transport', () => {
  const cfg = openAiPolicy({ SOVEREIGN_AGENT_A_MODEL: 'gpt-4.1' }).agent_a;
  const body = openAiChatBody(cfg, { model: 'zai:glm-5.3', stream: true, temperature: 0.2, max_tokens: 42 });
  assert.equal(body.model, 'gpt-4.1');
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_completion_tokens, 42);
});

test('active runner refuses to lease without API credentials and legacy runner stays retired', () => {
  for (const entry of ['index.ts', 'same_point_v4.ts']) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL(`../src/${entry}`, import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, timeout: 10000,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
        SOVEREIGN_OPENAI_API_KEY: '', OPENAI_API_KEY: '',
        SOVEREIGN_AGENT_A_MODEL: 'gpt-6.1-sol', SOVEREIGN_AGENT_B_MODEL: 'gpt-6.1-sol',
        SOVEREIGN_GLM_TOKEN: 'legacy-only-token', CHATGPT_SESSION_TOKEN: 'browser-only-token',
      },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.match(child.stderr, entry === 'index.ts' ? /sovereign_legacy_runner_retired_chatgpt_only/ : /openai_api_key_required/);
    assert.equal(child.stdout.includes('STARTING'), false);
    assert.equal(child.stderr.includes('ECONNREFUSED'), false);
  }
});

test('actual HTTP role proxies fence A/B requests and reject legacy GLM execution', { timeout: 15000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // Only the child's upstream fetch is stubbed; local HTTP routing runs normally.
  const stub = `globalThis.fetch = async (url, init) => {
    if (url !== 'https://api.openai.com/v1/chat/completions') throw new Error('non_openai_upstream');
    if (init.headers.authorization !== 'Bearer test-api-key') throw new Error('credential_not_fenced');
    return new Response(JSON.stringify({ destination: url, request: JSON.parse(init.body) }), {headers:{'content-type':'application/json'}});
  };`;
  const child = spawn(process.execPath, [
    '--import', 'tsx', '--import', `data:text/javascript,${encodeURIComponent(stub)}`,
    fileURLToPath(new URL('../src/control.ts', import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      SOVEREIGN_HTTP_HOST: '127.0.0.1', SOVEREIGN_HTTP_PORT: String(port),
      SOVEREIGN_CONTROL_TOKEN: 'test-control-key',
      SOVEREIGN_OPENAI_API_KEY: 'test-api-key', OPENAI_API_KEY: 'test-api-key',
      SOVEREIGN_AGENT_A_MODEL: 'gpt-6.1-sol', SOVEREIGN_AGENT_B_MODEL: 'gpt-6.1-sol',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error('control_listen_timeout')), 10000);
    child.stderr.on('data', chunk => { errors += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`control_exited_before_ready:${code}:${errors.slice(0, 1000)}`)); });
    child.stdout.on('data', chunk => {
      output += String(chunk);
      if (output.includes('"status":"LISTENING"')) { clearTimeout(timer); resolve(); }
    });
  });
  const invoke = (path, content) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { authorization: 'Bearer test-control-key', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'zai:glm-5.3', messages: [{ role: 'user', content }], max_tokens: 200, temperature: 0.2 }),
  });
  const legacy = await invoke('/glm/v1/chat/completions', 'old GLM task');
  assert.equal(legacy.status, 410);
  assert.equal((await legacy.json()).error, 'legacy_provider_endpoint_retired');
  const oldGpt = await invoke('/gpt/v1/chat/completions', 'old provider-shaped task');
  assert.equal(oldGpt.status, 410);
  const [a, b] = await Promise.all([
    invoke('/primary/v1/chat/completions', 'task A'),
    invoke('/critic/v1/chat/completions', 'task B'),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const bodies = await Promise.all([a.json(), b.json()]);
  assert.deepEqual(bodies.map(row => row.request.metadata.agent_id), ['agent_a', 'agent_b']);
  assert.deepEqual(bodies.map(row => row.request.messages[0].content), ['task A', 'task B']);
  for (const row of bodies) {
    assert.equal(row.destination, 'https://api.openai.com/v1/chat/completions');
    assert.equal(row.request.model, 'gpt-6.1-sol');
    assert.equal(row.request.max_completion_tokens, 200);
    assert.equal(row.request.store, false);
    assert.equal('max_tokens' in row.request, false);
    assert.equal('temperature' in row.request, false);
  }
});
