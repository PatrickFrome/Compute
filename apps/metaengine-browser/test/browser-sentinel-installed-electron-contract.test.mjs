import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('Windows package smoke must qualify the installed sentinel heartbeat, not only file presence', async () => {
  const workflow = await read('../../../.github/workflows/browser-windows-package-smoke.yml');
  assert.match(workflow, /sentinel/i, 'Windows package smoke must include Sentinel qualification');
  assert.match(workflow, /worker[_ -]?heartbeat|sentinel_worker_healthy/i, 'installed package gate must prove a worker heartbeat/healthy state');
  assert.doesNotMatch(workflow, /METAENGINE_DISABLE_CRASH_SENTINEL:\s*['\"]?1/i, 'qualification must not disable the Sentinel');
});

