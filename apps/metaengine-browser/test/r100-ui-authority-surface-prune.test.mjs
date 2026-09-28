import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('R100 persisted PageKey contains product surfaces only', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  const pageType = store.slice(store.indexOf('export type PageKey'), store.indexOf('// R97 native swarm convergence'));
  for (const legacy of ['"command"', '"agents"', '"compute"']) {
    assert.equal(pageType.includes(legacy), false, 'legacy authority page remains in PageKey: ' + legacy);
  }
  for (const product of ['"browser"', '"tasks"', '"code"', '"supervisor"', '"memory"', '"observability"', '"system"']) {
    assert.equal(pageType.includes(product), true, 'product page missing: ' + product);
  }
});

test('R100 legacy page identifiers exist only as input routing compatibility', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  assert.match(store, /type LegacyPageKey = "command" \| "agents" \| "compute"/);
  assert.match(store, /type PageRouteKey = PageKey \| LegacyPageKey/);
  assert.match(store, /setPage: \(p: PageRouteKey\) => void/);
  assert.match(store, /const nextPage: PageKey = \(p === "command" \|\| p === "agents" \|\| p === "compute"\) \? "browser" : p/);
  assert.doesNotMatch(store, /export type LegacyPageKey/);
});

test('R100 primary shell imports no daemon Agent\/Command\/Compute page', () => {
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

test('R100 production palette exposes native Browser fleet instead of daemon agent creation', () => {
  const palette = read('me2-ui/src/components/me2/shell/command-palette.tsx');
  const store = read('me2-ui/src/components/me2/store.tsx');
  assert.match(palette, /Native Agent fleet/);
  assert.match(palette, /Open native z\.ai Agent fleet/);
  assert.equal(palette.includes('spawnAgent'), false);
  assert.equal(palette.includes('AgentChat'), false);
  assert.doesNotMatch(store, /export type PaletteMode = [^\n]*"agents"/);
});
