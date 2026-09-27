import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const pagebar = await readFile(new URL('../../me2-ui/src/components/me2/shell/pagebar.tsx', import.meta.url), 'utf8');
const topbar = await readFile(new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url), 'utf8');

test('R94 primary shell navigation is seven workflow stages, not ten architecture modules', () => {
  for (const label of ['COMMAND', 'PLAN', 'BUILD', 'RUN', 'FLEET', 'OBSERVE', 'SYSTEM']) {
    assert.match(store, new RegExp(`label: "${label}"`));
  }
  assert.match(store, /WorkflowStageKey = "command" \| "plan" \| "build" \| "run" \| "fleet" \| "observe" \| "system"/);
  assert.match(pagebar, /WORKFLOW_STAGES\.map/);
  assert.match(pagebar, /data-testid="workflow-stage-tabs"/);
  assert.doesNotMatch(pagebar, /PAGES\.map\(\(p\)/);
});

test('R94 stages preserve every legacy module page through explicit grouped ownership', () => {
  assert.match(store, /key: "command"[\s\S]{0,180}pages: \["command"\]/);
  assert.match(store, /key: "plan"[\s\S]{0,180}pages: \["tasks"\]/);
  assert.match(store, /key: "build"[\s\S]{0,180}pages: \["code"\]/);
  assert.match(store, /key: "run"[\s\S]{0,180}pages: \["browser"\]/);
  assert.match(store, /key: "fleet"[\s\S]{0,220}pages: \["agents", "supervisor"\]/);
  assert.match(store, /key: "observe"[\s\S]{0,220}pages: \["observability", "memory"\]/);
  assert.match(store, /key: "system"[\s\S]{0,220}pages: \["system", "compute"\]/);
  assert.match(pagebar, /stage\.pages\.map\(\(modulePage\)/);
});

test('R94 Alt+1..7 selects workflow stage primary pages while history stays independent', () => {
  assert.match(store, /hotkeys:[^\n]*Alt\+1\.\.7 workflow stages/);
  assert.match(store, /e\.key >= "1" && e\.key <= "7"/);
  assert.match(store, /WORKFLOW_STAGES\[Number\(e\.key\) - 1\]/);
  assert.match(store, /get\(\)\.setPage\(stage\.primaryPage\)/);
  assert.match(store, /e\.key === "ArrowLeft" \|\| e\.key === "ArrowRight"/);
});

test('R94 keeps native Browser bottom geometry stable while changing information architecture', () => {
  assert.match(pagebar, /className="flex h-9 shrink-0/);
  assert.doesNotMatch(pagebar, /className="flex h-10 shrink-0/);
});

test('R94 top chrome exposes workspace then workflow stage then secondary module', () => {
  assert.match(topbar, /workflowStageForPage\(page\)/);
  assert.match(topbar, /workspaceMeta\?\.label/);
  assert.match(topbar, /stageMeta\.label/);
  assert.match(topbar, /pageMeta\?\.label && pageMeta\.label !== stageMeta\.label/);
});

test('R94 separates brand/selection accent from runtime health green', () => {
  assert.match(topbar, /border-cyan-800/);
  assert.match(topbar, /text-cyan-300/);
  assert.match(topbar, /border-emerald-900/);
  assert.match(topbar, /text-emerald-300/);
});
