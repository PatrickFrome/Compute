import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edge = await readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('stable Edge persists only fully correlated installed Electron enrollment attempts', () => {
  assert.match(edge, /function enrollmentMetadata\(body:any\)/);
  assert.match(edge, /const runAttempt=String\(body\?\.metadata\?\.qualification_run_attempt\|\|''\)\.trim\(\)/);
  assert.match(edge, /kind==='INSTALLED_ELECTRON'/);
  assert.match(edge, /\/\^\[0-9\]\{1,20\}\$\//);
  assert.match(edge, /\/\^\[1-9\]\[0-9\]\{0,5\}\$\//);
  assert.match(edge, /\/\^\[0-9a-f\]\{40\}\$\//);
  assert.match(edge, /metadata\.qualification_run_attempt=runAttempt/);
  assert.match(edge, /enrollmentInsert\(proof\.id!,proof\.jwk,proof\.fingerprint!,enrollmentMetadata\(body\)\)/);
  assert.doesNotMatch(edge, /metadata\s*:\s*body\?\.metadata/);
});
