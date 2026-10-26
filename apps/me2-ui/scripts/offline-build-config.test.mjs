import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('effective production config prevents implicit upgrade assessment traffic', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', `
    const assert = require('node:assert/strict');
    delete process.env.__NEXT_AGENT_UPGRADE;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('Unexpected network request in offline configuration test');
    };
    (async () => {
      const loadConfig = require('next/dist/server/config').default;
      const { PHASE_PRODUCTION_BUILD } = require('next/constants');
      const config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd());
      assert.equal(config.experimental.agentUpgrade, false);
      const { assessUpgrade, getUpgradeContext, nudgeUpgrade } = require('next/dist/lib/upgrade/nudge');
      const context = getUpgradeContext(config);
      assert.equal(context.experimental.agentUpgrade, false);
      assert.equal(await assessUpgrade(process.cwd(), context), null);
      await nudgeUpgrade(process.cwd(), context, 'build');
      assert.equal(fetchCalls, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
