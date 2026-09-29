import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('native supervisor route extraction is deployment-slug agnostic', () => {
  assert.ok(source.includes("const hostedPrefix='/functions/v1/'"));
  assert.ok(source.includes('const deployed=raw.slice(hostedPrefix.length)'));
  assert.ok(source.includes("const slash=deployed.indexOf('/')"));
  assert.ok(source.includes("return slash>=0?(deployed.slice(slash)||'/'):'/'"));
  assert.ok(source.includes('const path=routedServicePath(url.pathname)'));
});

test('canonical signed request identity remains the stable v1 service marker', () => {
  assert.ok(source.includes("const SERVICE_MARKER='/a2-browser-native-supervisor-v1'"));
  assert.ok(source.includes('const canonicalPath=`${SERVICE_MARKER}${path}`'));
});
