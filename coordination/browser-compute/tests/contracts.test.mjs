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

test('URL parser accepts canonical input but B1 policy keeps remote navigation disabled', () => {
  assert.equal(validateNavigationUrl('about:blank'), 'about:blank');
  assert.match(validateNavigationUrl('https://example.com/a'), /^https:\/\/example\.com\/a/);
  assert.throws(() => validateNavigationUrl('http://example.com'), /target_url_scheme_forbidden/);
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /target_url_scheme_forbidden/);
  assert.ok(protocol.forbidden_external_capabilities.includes('remote_navigation_b1'));
});

test('chrome args always isolate profile and debugger', () => {
  const dir = path.resolve('/tmp/a2-cb-contract-profile');
  const args = buildChromeArgs({ userDataDir: dir, debuggingPort: 43210, headless: true });
  assert.ok(args.includes(`--user-data-dir=${dir}`));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=43210'));
  assert.ok(args.includes('--headless'));
  assert.ok(!args.includes('--no-sandbox'));
  assert.throws(() => buildChromeArgs({ userDataDir: dir, debuggingPort: 43210, allowNoSandbox: true }), /no_sandbox_forbidden_outside_ci/);
  assert.throws(() => buildChromeArgs({ userDataDir: dir, debuggingPort: 80 }), /debugging_port_invalid/);
});

test('RPC surface is typed, effect-classed, and exposes no raw browser code path', () => {
  assert.deepEqual(RPC_METHODS, ['runtime.health', 'profile.start', 'profile.stop', 'profile.list', 'target.create', 'target.list', 'target.activate', 'target.close']);
  assert.deepEqual(protocol.methods, RPC_METHODS);
  assert.deepEqual(protocol.method_effects, RPC_METHOD_EFFECTS);
  assert.equal(protocol.web_authority_effect, false);
  assert.equal(protocol.local_effects_present, true);
  for (const forbidden of ['raw_cdp', 'runtime_evaluate', 'javascript_eval', 'shell_exec', 'arbitrary_browser_flags', 'arbitrary_executable_path', 'headless_override', 'sandbox_override']) {
    assert.ok(protocol.forbidden_external_capabilities.includes(forbidden));
  }
  const joined = RPC_METHODS.join(' ');
  assert.doesNotMatch(joined, /cdp|evaluate|javascript|exec|shell/i);
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
