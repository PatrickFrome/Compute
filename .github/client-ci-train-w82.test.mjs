import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = (name) =>
  readFileSync(root + '.github/workflows/' + name + '.yml', 'utf8');

function triggerPaths(source) {
  const match = /^on:\r?\n([\s\S]*?)(?=^(?:permissions|concurrency|jobs):)/m.exec(source);
  assert.ok(match, 'missing workflow trigger block');
  assert.match(match[1], /^  pull_request:/m);
  assert.match(match[1], /^  workflow_dispatch:/m);
  return [...match[1].matchAll(/^      - '([^']+)'\s*$/gm)].map((m) => m[1]);
}

test('W43/W51 frozen ancestor seals only trigger on their contract files', () => {
  for (const wave of ['43', '51']) {
    const paths = triggerPaths(workflow('client-source-candidate-w' + wave));
    assert.deepEqual(paths.slice().sort(), [
      '.github/workflows/client-source-candidate-w' + wave + '.yml',
      'coordination/operator-control/client-source-candidate-w' + wave + '.manifest.json'
    ].sort());
  }
});

test('W59 complementary physical PG and legacy qualification requires explicit final dispatch', () => {
  const paths = triggerPaths(workflow('client-source-candidate-w59'));
  assert.deepEqual(paths.slice().sort(), [
    '.github/workflows/client-source-candidate-w59.yml',
    'coordination/operator-control/client-source-candidate-w59.manifest.json',
    'coordination/operator-control/client-source-candidate-w51.manifest.json',
    'coordination/operator-control/client-source-candidate-w66.manifest.json',
    'coordination/operator-control/client-source-candidate-w73.manifest.json'
  ].sort());
  assert.match(workflow('client-source-candidate-w59'), /postgres:17/);
  assert.match(workflow('client-source-candidate-w59'), /w61-generated-two-cluster-restore/);
});

test('W66 candidate independently runs frozen ancestor and current source seals on both OSes', () => {
  const ci = workflow('client-source-candidate-w66');
  assert.match(ci, /ubuntu-24\.04, windows-2025/);
  for (const wave of ['43', '51', '59', '66']) {
    assert.ok(ci.includes('client-source-candidate-w' + wave + '.test.mjs'));
  }
  assert.ok(ci.includes('bun run typecheck'));
  assert.ok(ci.includes('bun run build'));
  assert.ok(ci.includes('bun run pack'));
});

test('current security, PG and release checks are still registered (never infer skipped as PASS)', () => {
  const acl = workflow('client-current-native-acl-w72');
  assert.match(acl, /^  push:/m);
  assert.match(acl, /^  pull_request:/m);
  assert.match(acl, /windows-2025/);
  assert.match(acl, /ubuntu-24\.04/);
  assert.match(workflow('client-own-pg-w61'), /postgres:17/);
  assert.match(workflow('client-pg17-qualification-w45'), /postgres:17/);
  assert.match(workflow('metaengine-browser-self-update-e2e'), /windows-2022/);
  assert.match(workflow('client-c2-existing-worker-w71'), /postgres:17/);
});
