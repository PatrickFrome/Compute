import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../../.github/workflows/a1-gpt-coordination-worker.yml', import.meta.url),
  'utf8',
);
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('R104 legacy managed-model worker workflow is validation-only', () => {
  assert.match(workflow, /validation-only historical lane/i);
  assert.match(workflow, /z\.ai Agent Web UI/);
  assert.doesNotMatch(workflow, /^\s{2}deploy:\s*$/m);
  assert.match(workflow, /actions\/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0/);
  assert.doesNotMatch(workflow, /actions\/checkout@v\d+/);
  assert.doesNotMatch(workflow, /secrets\.OPENAI_API_KEY|GPT_WORKER_CONTROL_TOKEN|secret put/);
  const wranglerDeployLines = workflow
    .split(/\r?\n/)
    .filter((line) => line.includes('wrangler@4.125.0 deploy'));
  assert.deepEqual(wranglerDeployLines.length, 1);
  assert.match(wranglerDeployLines[0], /--dry-run/);
});

test('R104 legacy worker documentation cannot advertise a production deploy path', () => {
  assert.match(readme, /QUARANTINED/i);
  assert.match(readme, /reference-only/i);
  assert.match(readme, /z\.ai Agent Web UI/);
  assert.doesNotMatch(readme, /printf\s+'%s'[\s\S]*secret put/);
  assert.doesNotMatch(readme, /^## Deploy$/m);
});
