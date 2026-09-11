import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '../..');

async function source(rel) {
  return fs.readFile(path.join(ROOT, rel), 'utf8');
}

test('closing the last Browser tab is allowed to reach a true zero-tab workspace', async () => {
  const main = await source('src/main.mjs');
  assert.doesNotMatch(main, /if \(!registry\.selected\(\)\) await createTab\('https:\/\/chatgpt\.com\/'/);
  assert.match(main, /registry\.close\(id\);[\s\S]{0,400}invalidatePerception\(id\);/);
});

test('clean genesis suppresses automatic initial remote topology without lowering supervisor authority', async () => {
  const main = await source('src/main.mjs');
  const genesis = await source('src/runtime-genesis.mjs');

  assert.match(main, /const requestedInitialTabs = Number\(runtimeGenesisState\?\.initial_tabs \|\| 0\);/);
  assert.match(main, /const shouldCreateInitialRemoteTab = Number\.isSafeInteger\(requestedInitialTabs\) && requestedInitialTabs > 0;/);
  assert.match(main, /if \(sessionReady && shouldCreateInitialRemoteTab\)/);
  assert.match(main, /controlStatePath:\s*supervisorControlStatePath\(\)/);

  assert.match(genesis, /initial_tabs:\s*0/);
  assert.match(genesis, /supervisor_mode:\s*'CONTROL'/);
  assert.match(genesis, /armed:\s*true/);
  assert.match(genesis, /automatic_actuation_after_genesis:\s*false/);
});

test('legacy OFF MONITOR and disarmed persistence migrate to CONTROL plus armed before scheduling', async () => {
  const client = await source('src/native-supervisor-client-base.mjs');
  const controlState = await source('src/native-supervisor-control-state.mjs');

  assert.match(client, /await this\.#restoreControlState\(\);[\s\S]{0,220}this\.#running = true/);
  assert.match(controlState, /supervisor_mode:\s*'CONTROL'/);
  assert.match(controlState, /armed:\s*true/);
  assert.match(controlState, /ALWAYS_ON_CONTROL:/);
  assert.match(controlState, /canonicalDrift[\s\S]{0,260}writeCanonicalControlState\(filePath, startup\)/);
  assert.match(controlState, /NATIVE_SUPERVISOR_ALWAYS_ON_CONTROL_REQUIRED/);
  assert.doesNotMatch(controlState, /supervisor_mode:\s*mode/);
});

test('convergence product head contains no temporary patch authority and packages only fixed source evidence', async () => {
  for (const relative of [
    '.github/workflows/devos-convergence-runtime-temp.yml',
    'apps/metaengine-browser/scripts/patch-devos-convergence-runtime-temp.mjs',
    'apps/metaengine-browser/scripts/patch-devos-convergence-contracts-temp.mjs',
  ]) {
    await assert.rejects(fs.access(path.join(REPO_ROOT, relative)), (error) => error?.code === 'ENOENT');
  }

  const builder = JSON.parse(await source('electron-builder.test.json'));
  assert.deepEqual(builder.extraResources, [
    { from: 'native-dist/guardian', to: 'guardian-native', filter: ['**/*'] },
    { from: 'devos-source-snapshot', to: 'devos-source-snapshot', filter: ['**/*'] },
  ]);
});