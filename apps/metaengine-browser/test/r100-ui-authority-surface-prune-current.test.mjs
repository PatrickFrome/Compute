import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('R100 PageKey contains product authority surfaces only', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  const pageType = store.slice(
    store.indexOf('export type PageKey'),
    store.indexOf('type LegacyPageAlias'),
  );
  for (const legacy of ['"command"', '"agents"', '"compute"']) {
    assert.equal(pageType.includes(legacy), false, 'legacy authority page remains in PageKey: ' + legacy);
  }
  for (const product of ['"browser"', '"tasks"', '"code"', '"supervisor"', '"memory"', '"observability"', '"system"']) {
    assert.equal(pageType.includes(product), true, 'product page missing: ' + product);
  }
});

test('R100 historical page names survive only as one-way compatibility aliases to Browser', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  assert.match(store, /type LegacyPageAlias = "command" \| "agents" \| "compute"/);
  assert.match(store, /type PageInput = PageKey \| LegacyPageAlias/);
  assert.match(store, /function normalizePageInput\(page: PageInput\): PageKey/);
  assert.match(store, /page === "command" \|\| page === "agents" \|\| page === "compute" \? "browser" : page/);
  assert.match(store, /setPage: \(p: PageInput\) => void/);
  assert.match(store, /const nextPage = normalizePageInput\(p\)/);
});

test('R100 primary shell imports no daemon Agent, Command or Compute page', () => {
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

test('R100 production palette exposes native Browser fleet without a daemon-agent mode', () => {
  const store = read('me2-ui/src/components/me2/store.tsx');
  const palette = read('me2-ui/src/components/me2/shell/command-palette.tsx');
  const paletteType = store.slice(store.indexOf('export type PaletteMode'), store.indexOf('export type DialogKind'));
  assert.equal(paletteType.includes('"agents"'), false);
  assert.match(palette, /Native Agent fleet/);
  assert.match(palette, /Open native z\.ai Agent fleet/);
  assert.doesNotMatch(palette, /useState<"all" \| "pages" \| "agents"/);
  assert.equal(palette.includes('AgentChat'), false);
});
