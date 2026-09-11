import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtimeSource = new URL('../src/browser-brain-adaptive-fanout-runtime.mjs', import.meta.url);

test('adaptive fanout passes the runtime-fenced executor directly into the hot effect path', async () => {
  const source = await readFile(runtimeSource, 'utf8');

  assert.match(source, /execute:\s*executeRuntimeFenced,/);
  assert.doesNotMatch(source, /execute:\s*\([^)]*\)\s*=>\s*executeRuntimeFenced\(/);
});
