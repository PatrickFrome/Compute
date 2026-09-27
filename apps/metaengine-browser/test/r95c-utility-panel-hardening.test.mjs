import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile(
  new URL('../../me2-ui/src/components/me2/shell/context-drawer.tsx', import.meta.url),
  'utf8',
);

test('R95C dual-axis splitter Escape and pointercancel share one non-persistent restore path', () => {
  assert.match(panel, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(panel, /window\.removeEventListener\("keydown", onKey\)/);
  assert.match(panel, /if \(keyEvent\.key !== "Escape"\) return;/);
  assert.match(panel, /const restore = \(\) => \{/);
  assert.match(panel, /const cancel = restore;/);
  assert.match(panel, /const current = sameTransaction\(\);[\s\S]{0,100}cleanup\(\);[\s\S]{0,100}if \(!current\) return;/);
  assert.match(panel, /if \(startDock === "right"\) setWidth\(startWidth, false\);/);
  assert.match(panel, /else setHeight\(startHeight, false\);/);
  assert.match(panel, /useMe2\.getState\(\)\.workspace === startWorkspace/);
  assert.match(panel, /useMe2\.getState\(\)\.contextDrawerDock === startDock/);
  assert.doesNotMatch(panel, /pointercancel", finish/);
});

test('R95C double-click reset is fenced by both workspace and dock and persists only preferred geometry', () => {
  assert.match(panel, /onDoubleClick=\{resetByDoubleTap\}/);
  assert.match(panel, /const state = useMe2\.getState\(\);/);
  assert.match(panel, /state\.workspace !== workspace \|\| state\.contextDrawerDock !== dock/);
  assert.match(panel, /if \(dock === "right"\)[\s\S]{0,180}setWidth\(preferredWidth, true\)/);
  assert.match(panel, /setHeight\(preferredHeight, true\)/);
});

test('R95C splitter keeps orientation-specific keyboard semantics, larger hit targets and an explicit focus cue', () => {
  assert.match(panel, /role="separator"/);
  assert.match(panel, /aria-orientation=\{dock === "right" \? "vertical" : "horizontal"\}/);
  assert.match(panel, /event\.key === "ArrowLeft"/);
  assert.match(panel, /event\.key === "ArrowRight"/);
  assert.match(panel, /event\.key === "ArrowUp"/);
  assert.match(panel, /event\.key === "ArrowDown"/);
  assert.match(panel, /event\.key === "Home"/);
  assert.match(panel, /event\.key === "End"/);
  assert.match(panel, /before:-inset-x-1\.5/);
  assert.match(panel, /before:-inset-y-1\.5/);
  assert.match(panel, /group-focus-visible:bg-cyan-500/);
  assert.match(panel, /Esc cancel · double-click reset/);
});

test('R95C splitter hardening remains presentation-only and introduces no effect API', () => {
  assert.doesNotMatch(panel, /sendCommand\(|me2Fetch\(|agentChatOp\(/);
});
