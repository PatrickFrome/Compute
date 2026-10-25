import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('PageKey exposes five product screens without retired daemon authority modules', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  const pageType = store.match(/export type PageKey\s*=\s*([^;]+);/);
  assert.ok(pageType);
  const keys = [...pageType[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(keys, ['browser','tasks','code','operator','system']);
});

test('R100 primary shell imports no daemon Agent/Command/Compute page', () => {
  const shell = read('me2-ui/src/components/me2/shell/me2-shell.tsx');
  for (const legacyImport of [
    'pages/agents',
    'pages/command',
    'pages/compute',
    'AgentsPage',
    'CommandPage',
    'ComputePage',
  ]) assert.equal(shell.includes(legacyImport), false, 'legacy shell consumer remains: ' + legacyImport);
  assert.match(shell, /PrimaryChatFleetWorkspace/);
  assert.match(shell, /primaryChatFleetRoster/);
});

test('production palette navigates current screens and exact native project tasks without daemon agent creation', () => {
  const palette = read('me2-ui/src/components/me2/shell/command-palette.tsx');
  assert.match(palette, /PAGES\.map/);
  assert.match(palette, /useClientProjectTasks/);
  assert.doesNotMatch(palette, /Open native z\.ai Agent fleet/);
  assert.equal(palette.includes('spawnAgent'), false);
  assert.equal(palette.includes('AgentChat'), false);
});
