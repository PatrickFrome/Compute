import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import protocol from '../protocol-v1.json' with { type: 'json' };
import { buildChromeArgs } from '../src/chrome-process.mjs';
import { RPC_METHOD_EFFECTS, RPC_METHODS } from '../src/rpc-server.mjs';
import { atomicJsonWrite, readJson, rotateControlToken, validateNavigationUrl, validateProfileId, validateTargetId } from '../src/security.mjs';

test('identity validators are fail closed', () => {
  assert.equal(validateProfileId('GPT_WORKER-01'), 'gpt_worker-01');
  assert.throws(() => validateProfileId('../default'), /profile_id_invalid/);
  assert.equal(validateTargetId('gpt:critic.01'), 'gpt:critic.01');
  assert.throws(() => validateTargetId('x'), /target_id_invalid/);
});

test('B3 Chrome args expose native pipe and no DevTools TCP surface', () => {
  const dir = path.resolve('/tmp/a2-cb-contract-profile');
  const args = buildChromeArgs({ userDataDir: dir, headless: true });
  assert.ok(args.includes(`--user-data-dir=${dir}`));
  assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(args.includes('--headless'));
  assert.ok(!args.some((value) => value.startsWith('--remote-debugging-port')));
  assert.ok(!args.some((value) => value.startsWith('--remote-debugging-address')));
  assert.ok(!args.includes('--no-sandbox'));
  assert.throws(() => buildChromeArgs({ userDataDir: dir, allowNoSandbox: true }), /no_sandbox_forbidden_outside_ci/);
});

test('URL parser remains narrow and remote navigation remains disabled at R4 boundary', () => {
  assert.equal(validateNavigationUrl('about:blank'), 'about:blank');
  assert.match(validateNavigationUrl('https://example.com/a'), /^https:\/\/example\.com\/a/);
  assert.throws(() => validateNavigationUrl('http://example.com'), /target_url_scheme_forbidden/);
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /target_url_scheme_forbidden/);
  assert.ok(protocol.forbidden_external_capabilities.includes('remote_navigation_b1'));
});

test('RPC surface is typed, effect-classed, and external raw CDP remains forbidden', () => {
  assert.deepEqual(protocol.methods, RPC_METHODS);
  assert.deepEqual(protocol.method_effects, RPC_METHOD_EFFECTS);
  assert.equal(protocol.transport.internal_devtools, 'native_remote_debugging_pipe');
  assert.equal(protocol.devtools_tcp_exposed, false);
  assert.ok(!protocol.identity.ephemeral.includes('debug_port'));
  for (const forbidden of ['raw_cdp', 'raw_bidi', 'runtime_evaluate', 'javascript_eval', 'shell_exec', 'devtools_tcp_listener']) assert.ok(protocol.forbidden_external_capabilities.includes(forbidden));
  assert.doesNotMatch(RPC_METHODS.join(' '), /cdp|evaluate|javascript|exec|shell/i);
});

test('R4 semantic snapshot is perception-only and explicitly tainted', () => {
  assert.equal(protocol.version, '1.3.0');
  assert.equal(protocol.method_effects['target.semantic_snapshot'], 'READ_ONLY');
  assert.equal(protocol.semantic_perception.schema, 'metaengine.a2-browser-operator.semantic-frame.v1');
  assert.equal(protocol.semantic_perception.page_data_tainted, true);
  assert.equal(protocol.semantic_perception.authority_effect, false);
  assert.equal(protocol.semantic_perception.page_script_evaluation, false);
  assert.equal(protocol.semantic_perception.raw_cdp_exposed, false);
  assert.equal(protocol.semantic_perception.document_epoch_source, 'main_frame_loader_id');
  assert.equal(protocol.semantic_perception.min_node_budget, 30);
  assert.equal(protocol.semantic_perception.max_node_budget, 80);
});

test('control token is a fresh 256-bit daemon-session capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-token-'));
  try {
    const first = await rotateControlToken(root);
    const second = await rotateControlToken(root);
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.match(second.token, /^[a-f0-9]{64}$/);
    assert.notEqual(first.token, second.token);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('atomic json store preserves exact structured state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-json-'));
  const file = path.join(root, 'nested', 'state.json');
  const value = { schema: 'test.v1', revision: 3, targets: [{ target_id: 'gpt_one' }] };
  await atomicJsonWrite(file, value);
  assert.deepEqual(await readJson(file, null), value);
  await fs.rm(root, { recursive: true, force: true });
});
