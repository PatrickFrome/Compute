import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('OFF/unarmed clean genesis still bootstraps the initial browser presentation surface', async () => {
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const genesis = await fs.readFile(new URL('../src/runtime-genesis.mjs', import.meta.url), 'utf8');

  assert.match(main, /const sessionReady = await runDegradableStartupStep\('USER_SESSION'/);
  assert.match(main, /if \(sessionReady\) \{[\s\S]{0,600}runDegradableStartupStep\('INITIAL_TAB_CREATE'/);
  assert.doesNotMatch(main, /sessionReady\s*&&\s*!quiescentStartup/);
  assert.doesNotMatch(main, /const quiescentStartup = startupControlState\?\.supervisor_mode === 'OFF'/);

  assert.match(genesis, /supervisor_mode: 'OFF'/);
  assert.match(genesis, /armed: false/);
  assert.match(genesis, /automatic_actuation_after_genesis: false/);
});
