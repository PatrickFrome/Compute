import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import protocol from '../protocol-v1.json' with { type: 'json' };
import { buildChromeArgs } from '../src/chrome-process.mjs';
import { RPC_METHODS } from '../src/rpc-server.mjs';
import { atomicJsonWrite, getOrCreateControlToken, readJson, validateNavigationUrl, validateProfileId, validateTargetId } from '../src/security.mjs';

test('identity validators are fail closed', () => {
  assert.equal(validateProfileId('GPT_WORKER-01'), 'gpt_worker-01');
  assert.throws(() => validateProfileId('../default'), /profile_id_invalid/);
  assert.equal(validateTargetId('gpt:critic.01'), 'gpt:critic.01');
  assert.throws(() => validateTargetId('x'), /target_id_invalid/);
});

test('navigation permits only https or about:blank', () => {
  assert.equal(validateNavigationUrl('about:blank'), 'about:blank');
  assert.match(validateNavigationUrl('https://example.com/a'), /^https:\/\/example\.com\/a/);
  assert.throws(() => validateNavigationUrl('http://example.com'), /target_url_scheme_forbidden/);
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /target_url_scheme_forbidden/);
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

test('RPC surface is typed and does not expose raw CDP or eval', () => {
  assert.deepEqual(RPC_METHODS, ['runtime.health', 'profile.start', 'profile.stop', 'profile.list', 'target.create', 'target.list', 'target.activate', 'target.close']);
  assert.deepEqual(protocol.methods, RPC_METHODS);
  assert.equal(protocol.authority_effect, false);
  assert.ok(protocol.forbidden_external_capabilities.includes('raw_cdp'));
  assert.ok(protocol.forbidden_external_capabilities.includes('runtime_evaluate'));
  const joined = RPC_METHODS.join(' ');
  assert.doesNotMatch(joined, /cdp|evaluate|javascript|exec|shell/i);
});

test('control token is stable 256-bit local capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-token-'));
  const first = await getOrCreateControlToken(root);
  const second = await getOrCreateControlToken(root);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  await fs.rm(root, { recursive: true, force: true });
});

test('atomic json store preserves exact structured state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-json-'));
  const file = path.join(root, 'nested', 'state.json');
  const value = { schema: 'test.v1', revision: 3, targets: [{ target_id: 'gpt_one' }] };
  await atomicJsonWrite(file, value);
  assert.deepEqual(await readJson(file, null), value);
  await fs.rm(root, { recursive: true, force: true });
});
