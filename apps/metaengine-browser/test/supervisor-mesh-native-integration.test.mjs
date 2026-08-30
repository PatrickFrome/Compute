import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/native-supervisor-client.mjs');

async function source() { return fs.readFile(sourcePath, 'utf8'); }

test('native supervisor owns additive mesh lifecycle and publishes it in heartbeat', async () => {
  const raw = await source();
  assert.match(raw, /import \{ SupervisorMeshRuntime \} from '\.\/supervisor-mesh-runtime\.mjs'/);
  assert.match(raw, /#mesh\s*=\s*null/);
  assert.match(raw, /new SupervisorMeshRuntime\(\{[\s\S]*getState:\s*this\.#getState/);
  assert.match(raw, /await this\.#mesh\.start\(\)[\s\S]*await this\.#lifecycle\.start\(\)[\s\S]*await this\.#selfUpdate\.start\(\)/);
  assert.match(raw, /supervisor_mesh:\s*this\.#mesh\?\.snapshot\(\)\s*\|\|\s*null/);
  assert.match(raw, /this\.#mesh\?\.stop\?\.\(\)/);
});

test('native cycle reconciles mesh before durable heartbeat and after command handling', async () => {
  const raw = await source();
  const beforeHeartbeat = raw.indexOf('await this.#mesh?.reconcile()');
  const heartbeat = raw.indexOf('await this.#heartbeat()');
  const nextCommand = raw.indexOf('const command = await this.#nextCommand()');
  const secondReconcile = raw.indexOf('await this.#mesh?.reconcile()', beforeHeartbeat + 1);
  assert.ok(beforeHeartbeat >= 0 && heartbeat > beforeHeartbeat);
  assert.ok(nextCommand > heartbeat);
  assert.ok(secondReconcile > nextCommand);
});

test('self-update restart gate includes mesh quiescence and cannot bypass ambiguous delivery state', async () => {
  const raw = await source();
  assert.match(raw, /this\.#currentCommand == null[\s\S]*this\.#lifecycle\?\.isQuiescent\(\) === true[\s\S]*this\.#mesh\?\.isQuiescent\(\) === true/);
  assert.doesNotMatch(raw, /supervisor_mesh[^\n]*authority_effect:\s*true/);
});
