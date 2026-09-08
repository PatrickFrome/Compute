import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function source(rel) {
  return fs.readFile(path.join(ROOT, rel), 'utf8');
}

test('closing the last Browser tab is allowed to reach a true zero-tab workspace', async () => {
  const main = await source('src/main.mjs');
  assert.doesNotMatch(main, /if \(!registry\.selected\(\)\) await createTab\('https:\/\/chatgpt\.com\/'/);
  assert.match(main, /registry\.close\(id\);[\s\S]{0,400}invalidatePerception\(id\);/);
});

test('persisted OFF state suppresses automatic initial remote tab creation', async () => {
  const main = await source('src/main.mjs');
  assert.match(main, /loadNativeSupervisorControlState\(supervisorControlStatePath\(\)\)/);
  assert.match(main, /quiescentStartup[\s\S]{0,500}sessionReady && !quiescentStartup/);
  assert.match(main, /controlStatePath:\s*supervisorControlStatePath\(\)/);
});

test('remote OFF is durable, disarms, and is restored before supervisor scheduling', async () => {
  const client = await source('src/native-supervisor-client-base.mjs');
  assert.match(client, /await this\.#restoreControlState\(\);[\s\S]{0,220}this\.#running = true/);
  assert.match(client, /if \(next === 'OFF'\) this\.#armed = false;/);
  assert.match(client, /await this\.#persistControlState\(\);/);
  assert.match(client, /control_state_persistence:/);
});
