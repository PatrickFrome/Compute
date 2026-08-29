import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const policyUrl = new URL('../src/browser-policy.mjs', import.meta.url).href;

test('packaged boot defers exactly one ChatGPT network navigation', () => {
  const source = `
    const { navigationDecision } = await import(${JSON.stringify(policyUrl)});
    const first = navigationDecision('https://chatgpt.com/');
    const second = navigationDecision('https://chatgpt.com/');
    process.stdout.write(JSON.stringify({ first, second }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: { ...process.env, METAENGINE_PACKAGED_BOOT_SAFE: '1' },
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result.first, {
    allow: true,
    reason: 'PACKAGED_BOOT_NETWORK_DEFERRED',
    normalized_url: 'about:blank',
    kind: 'BLANK',
  });
  assert.equal(result.second.allow, true);
  assert.equal(result.second.kind, 'CHATGPT');
  assert.equal(result.second.normalized_url, 'https://chatgpt.com/');
});
