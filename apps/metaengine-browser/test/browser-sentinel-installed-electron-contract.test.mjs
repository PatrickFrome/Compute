import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('dedicated Windows gate must qualify the installed Electron sentinel heartbeat, not only file presence', async () => {
  const workflow = await read('../../../.github/workflows/browser-windows-installed-sentinel.yml');
  assert.match(workflow, /METAENGINE Browser Test\.exe/);
  assert.match(workflow, /app\.asar\.unpacked/);
  assert.match(workflow, /worker-heartbeat-v1\.json/);
  assert.match(workflow, /worker_pid/);
  assert.match(workflow, /parent_pid/);
  assert.match(workflow, /token/);
  assert.match(workflow, /lifecycle/);
  assert.match(workflow, /authority_effect/);
  assert.doesNotMatch(workflow, /METAENGINE_DISABLE_CRASH_SENTINEL:\s*['\"]?1/i, 'qualification must not disable the Sentinel');
});
