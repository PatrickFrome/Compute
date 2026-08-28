import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import protocol from '../protocol-v1.json' with { type: 'json' };
import { buildChromeArgs } from '../src/chrome-process.mjs';
import { RPC_METHOD_EFFECTS, RPC_METHODS, validateRpcParams } from '../src/rpc-server.mjs';
import { atomicJsonWrite, readJson, rotateControlToken, validateContextId, validateNavigationUrl, validateProfileId, validateTargetId } from '../src/security.mjs';

test('identity validators are fail closed', () => {
  assert.equal(validateProfileId('GPT_WORKER-01'), 'gpt_worker-01');
  assert.throws(() => validateProfileId('../default'), /profile_id_invalid/);
  assert.equal(validateTargetId('gpt:critic.01'), 'gpt:critic.01');
  assert.throws(() => validateTargetId('x'), /target_id_invalid/);
  assert.equal(validateContextId('Research:01'), 'research:01');
  assert.throws(() => validateContextId('../default'), /context_id_invalid/);
});

test('URL parser accepts canonical input but B1 policy keeps remote navigation disabled', () => {
  assert.equal(validateNavigationUrl('about:blank'), 'about:blank');
  assert.match(validateNavigationUrl('https://example.com/a'), /^https:\/\/example\.com\/a/);
  assert.throws(() => validateNavigationUrl('http://example.com'), /target_url_scheme_forbidden/);
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /target_url_scheme_forbidden/);
  assert.ok(protocol.forbidden_external_capabilities.includes('remote_navigation_b1'));
});

test('chrome args isolate profile and expose only the inherited B3 pipe', () => {
  const dir = path.resolve('/tmp/a2-cb-contract-profile');
  const args = buildChromeArgs({ userDataDir: dir, headless: true });
  assert.ok(args.includes(`--user-data-dir=${dir}`));
  assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(!args.some((arg) => arg.startsWith('--remote-debugging-address=')));
  assert.ok(!args.some((arg) => arg.startsWith('--remote-debugging-port=')));
  assert.ok(args.includes('--headless'));
  assert.ok(!args.includes('--no-sandbox'));
  assert.throws(() => buildChromeArgs({ userDataDir: dir, allowNoSandbox: true }), /no_sandbox_forbidden_outside_ci/);
  assert.deepEqual(protocol.identity.ephemeral, ['browser_pid', 'process_incarnation_id', 'cdp_browser_context_id', 'cdp_target_id']);
  assert.equal(protocol.trusted_engine_transport.kind, 'chromium_remote_debugging_pipe');
  assert.equal(protocol.trusted_engine_transport.devtools_tcp_listener, false);
  assert.equal(protocol.trusted_engine_transport.raw_cdp_external, false);
});

test('RPC surface is typed, effect-classed, and exposes no raw browser code path', () => {
  assert.deepEqual(RPC_METHODS, [
    'runtime.health', 'profile.start', 'profile.stop', 'profile.list',
    'context.create', 'context.list', 'context.close',
    'target.create', 'target.list', 'target.activate', 'target.close',
    'perception.capture'
  ]);
  assert.deepEqual(protocol.methods, RPC_METHODS);
  assert.deepEqual(protocol.method_effects, RPC_METHOD_EFFECTS);
  assert.equal(RPC_METHOD_EFFECTS['perception.capture'], 'READ_ONLY');
  assert.equal(protocol.semantic_perception.authority, false);
  assert.equal(protocol.semantic_perception.tainted_page_data, true);
  assert.equal(protocol.semantic_perception.live_revalidation_required_before_actuation, true);
  assert.equal(protocol.semantic_perception.raw_dom_external, false);
  assert.equal(protocol.semantic_perception.raw_accessibility_external, false);
  assert.equal(protocol.web_authority_effect, false);
  assert.equal(protocol.local_effects_present, true);
  for (const forbidden of ['raw_cdp', 'runtime_evaluate', 'javascript_eval', 'shell_exec', 'arbitrary_browser_flags', 'arbitrary_executable_path', 'headless_override', 'sandbox_override', 'raw_browser_context_id', 'context_proxy_override', 'context_universal_network_access', 'default_context_disposal', 'silent_context_recreation', 'raw_dom_export', 'raw_accessibility_export', 'body_text_export_r4']) {
    assert.ok(protocol.forbidden_external_capabilities.includes(forbidden));
  }
  const joined = RPC_METHODS.join(' ');
  assert.doesNotMatch(joined, /cdp|evaluate|javascript|exec|shell/i);
  assert.deepEqual(validateRpcParams('context.create', { profileId: 'one', contextId: 'two' }), { profileId: 'one', contextId: 'two' });
  assert.deepEqual(validateRpcParams('perception.capture', { profileId: 'one', targetId: 'two', nodeBudget: 80, taskTerms: ['send'] }), { profileId: 'one', targetId: 'two', nodeBudget: 80, taskTerms: ['send'] });
  for (const key of ['proxyServer', 'proxyBypassList', 'originsWithUniversalNetworkAccess', 'browserContextId', 'executablePath', 'headless', 'allowNoSandbox']) {
    assert.throws(() => validateRpcParams('context.create', { profileId: 'one', [key]: 'attacker' }), /rpc_params_forbidden/);
    assert.throws(() => validateRpcParams('perception.capture', { profileId: 'one', targetId: 'two', [key]: 'attacker' }), /rpc_params_forbidden/);
  }
});

test('control token is a fresh 256-bit daemon-session capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-token-'));
  try {
    const first = await rotateControlToken(root);
    const second = await rotateControlToken(root);
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.match(second.token, /^[a-f0-9]{64}$/);
    assert.notEqual(first.token, second.token);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('atomic json store preserves exact structured state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-json-'));
  const file = path.join(root, 'nested', 'state.json');
  const value = { schema: 'test.v1', revision: 3, targets: [{ target_id: 'gpt_one' }] };
  await atomicJsonWrite(file, value);
  assert.deepEqual(await readJson(file, null), value);
  await fs.rm(root, { recursive: true, force: true });
});
