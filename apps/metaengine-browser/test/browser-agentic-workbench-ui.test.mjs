import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const me2Shell = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');
const palette = await readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

test('deprecated Agentic Workbench renderer is physically retired', async () => {
  await assert.rejects(access(new URL('../ui/app.js', import.meta.url)), /ENOENT/);
  assert.doesNotMatch(main, /metaengine:\/\/shell\/|metaengine-dark-workspace-v2|LEGACY_RECOVERY/);
  assert.match(main, /Packaged ME2 is the only product UI/);
  assert.match(main, /FAIL_CLOSED_RECOVERY/);
});

test('current primary workspace is native ChatGPT fleet plus selected Browser surface', () => {
  assert.match(me2Shell, /PrimaryChatFleetWorkspace/);
  assert.match(me2Shell, /Verified ChatGPT Agent/);
  assert.match(me2Shell, /Open an existing ChatGPT agent conversation\./);
  assert.match(store, /native ChatGPT agent fleet and selected Browser surface/);
  assert.doesNotMatch(me2Shell, /GLM-5\.3-Flash|Verified z\.ai Agent|Open an existing z\.ai Agent conversation/i);
});

test('command palette routes to the existing native fleet without creating daemon agents', () => {
  assert.match(palette, /CommandGroup heading="Native Agent fleet"/);
  assert.match(palette, /Open native ChatGPT agent fleet/);
  assert.match(palette, /setPage\("browser"\)/);
  assert.doesNotMatch(palette, /spawnAgent|AgentChat|Open native z\.ai Agent fleet/);
});

test('current primary renderer keeps legacy proof token internal and carries no arbitrary evaluation primitive', () => {
  assert.match(me2Shell, /"ZAI_AGENT_SURFACE_CAUSAL_V1"/);
  assert.doesNotMatch(me2Shell, />[^<]*z\.ai[^<]*</i);
  for (const source of [me2Shell, palette, store]) {
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /new\s+Function\s*\(/);
    assert.doesNotMatch(source, /child_process|execSync|spawnSync/);
  }
});
