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
  // R100 moved fleet data to typed native resources; the store owns navigation only.
  const pages = [...store.matchAll(/\{key:'([^']+)',label:/g)].map(match => match[1]);
  assert.deepEqual(pages, ['browser', 'tasks', 'code', 'operator', 'system']);
  assert.match(store, /page:'browser',paletteOpen:false,recentPages:\['browser'\]/);
  assert.match(store, /\['supervisor','memory','observability'\]\.includes\(key\)\)return 'operator'/);
  assert.match(store, /PAGES\.find\(page=>page\.key===key\)\?\.key\?\?'browser'/);
  assert.doesNotMatch(store, /daemonSnapshot|sendCommand\s*\(|spawnAgent\s*\(|submitGoal\s*\(/);
  assert.doesNotMatch(me2Shell, /GLM-5\.3-Flash|Verified z\.ai Agent|Open an existing z\.ai Agent conversation/i);
});

test('command palette navigates current screens and confirmed native project tasks without daemon effects', () => {
  assert.match(palette, /CommandGroup heading="Рабочая область"/);
  assert.match(palette, /PAGES\.map\(page=>/);
  assert.match(palette, /onSelect=\{\(\)=>\{setPage\(page\.key\);setOpen\(false\);\}\}/);
  assert.match(palette, /const \{resource,view\}=useClientProjectTasks\(\)/);
  assert.match(palette, /\(view\.page\?\.tasks\?\?\[\]\)\.map\(task=>/);
  // Failed/stale task selection must not navigate or dismiss the palette.
  assert.match(palette, /onSelect=\{\(\)=>\{if\(resource\.selectTask\(task\.task_id\)\)\{setPage\('tasks'\);setOpen\(false\);\}\}\}/);
  for (const state of ['OBSERVED', 'DEGRADED', 'UNBOUND']) {
    assert.ok(palette.includes(`view.state==='${state}'`), `missing task-source boundary: ${state}`);
  }
  assert.doesNotMatch(palette, /spawnAgent|AgentChat|Open native z\.ai Agent fleet|daemonSnapshot|sendCommand\s*\(|submitGoal\s*\(|fetch\s*\(/);
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
