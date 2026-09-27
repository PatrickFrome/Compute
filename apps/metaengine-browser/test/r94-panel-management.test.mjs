import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserRoot = path.resolve(here, '..');
const appsRoot = path.resolve(browserRoot, '..');

const readDrawer = () =>
  fs.readFile(
    path.join(appsRoot, 'me2-ui', 'src', 'components', 'me2', 'shell', 'context-drawer.tsx'),
    'utf8',
  );

test('R94 splitter drag supports Escape cancel and never persists partial geometry', async () => {
  const drawer = await readDrawer();

  // Escape listener is scoped to the active drag transaction, not global.
  assert.match(drawer, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(drawer, /removeEventListener\("keydown", onKey\)/);
  assert.match(drawer, /if \(keyEvent\.key !== "Escape"\) return;/);

  // pointercancel and Escape share one restore path: drop partial geometry
  // in the starting workspace, never persist.
  assert.match(drawer, /const restore = \(\) => \{/);
  assert.match(drawer, /const cancel = restore;/);
  assert.match(drawer, /if \(current\) setHeight\(startHeight, false\);/);

  // R93 contracts remain intact after the R94 refactor.
  assert.match(drawer, /const startWorkspace = workspace/);
  assert.match(drawer, /useMe2\.getState\(\)\.workspace === startWorkspace/);
  assert.match(drawer, /pointercancel", cancel/);
  assert.doesNotMatch(drawer, /pointercancel", finish/);
});

test('R94 separator keeps the WAI-ARIA splitter keyboard contract', async () => {
  const drawer = await readDrawer();
  assert.match(drawer, /role="separator"/);
  assert.match(drawer, /aria-orientation="horizontal"/);
  assert.match(drawer, /aria-valuemin=\{160\}/);
  assert.match(drawer, /aria-valuemax=\{360\}/);
  assert.match(drawer, /aria-valuenow=\{height\}/);
  assert.match(drawer, /ArrowUp/);
  assert.match(drawer, /ArrowDown/);
  assert.match(drawer, /"Home"/);
  assert.match(drawer, /"End"/);
});

test('R94 double-click resets the panel to preferred height inside the owning workspace', async () => {
  const drawer = await readDrawer();
  assert.match(drawer, /onDoubleClick=\{resetByDoubleTap\}/);
  // fenced before it can touch layout state
  assert.match(
    drawer,
    /const resetByDoubleTap[\s\S]{0,240}useMe2\.getState\(\)\.workspace !== workspace[\s\S]{0,80}return;[\s\S]{0,120}setHeight\(preferredHeight, true\)/,
  );
});

test('R94 splitter hit target and keyboard focus cue meet control-room a11y bar', async () => {
  const drawer = await readDrawer();
  // 6px visual rail + 6px invisible extension up and down => >=18px effective target
  assert.match(drawer, /before:-inset-y-1\.5/);
  assert.match(drawer, /before:content-\[''\]/);
  // visible focus cue on the grip line, not only a background tint
  assert.match(drawer, /group-focus-visible:bg-cyan-500/);
  // discoverability of the new affordances
  assert.match(drawer, /Esc cancel · double-click reset/);
});
