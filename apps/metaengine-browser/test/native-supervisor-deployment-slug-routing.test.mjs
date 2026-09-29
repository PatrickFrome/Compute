import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('native supervisor route extraction strips stable and canary deployment mounts as exact segments', () => {
  assert.ok(source.includes("const hostedPrefix='/functions/v1/'"));
  assert.ok(source.includes("const firstSlash=raw.indexOf('/',1)"));
  assert.ok(source.includes("const mount=firstSlash>0?raw.slice(1,firstSlash):raw.slice(1)"));
  assert.ok(source.includes("const deployedMount=/^a2-browser-native-supervisor-v[0-9]+(?:-[a-z0-9][a-z0-9-]{0,63})?$/"));
  assert.ok(source.includes("if(deployedMount.test(mount))return firstSlash>0?(raw.slice(firstSlash)||'/'):'/'"));
  assert.ok(source.includes('const path=routedServicePath(url.pathname)'));
  assert.equal(source.includes('raw.indexOf(SERVICE_MARKER)'), false);
});

test('canonical signed request identity remains the stable v1 service marker', () => {
  assert.ok(source.includes("const SERVICE_MARKER='/a2-browser-native-supervisor-v1'"));
  assert.ok(source.includes('const canonicalPath=`${SERVICE_MARKER}${path}`'));
});
