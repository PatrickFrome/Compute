import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const retired = [
  'me2-ui/src/components/me2/pages/agents.tsx',
  'me2-ui/src/components/me2/pages/command.tsx',
  'me2-ui/src/components/me2/pages/compute.tsx',
];

test('R106 retired daemon authority pages are physically removed', () => {
  for (const file of retired) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, file);
  }
});

test('R106 removal replaces compatibility tombstones instead of preserving dead UI state', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'me2-ui/src/components/me2/shell/me2-shell.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(ROOT, 'me2-ui/src/components/me2/store.tsx'), 'utf8');
  for (const token of ['AgentsPage','CommandPage','ComputePage','pages/agents','pages/command','pages/compute']) {
    assert.equal(shell.includes(token), false, 'shell consumer remains: ' + token);
    assert.equal(store.includes(token), false, 'store consumer remains: ' + token);
  }
});
