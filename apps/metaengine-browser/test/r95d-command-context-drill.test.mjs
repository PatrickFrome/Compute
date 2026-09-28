import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const command = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url),
  'utf8',
);
const store = await readFile(
  new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url),
  'utf8',
);

test('R102 supersedes legacy COMMAND attention/drill state with an inert compatibility tombstone', () => {
  assert.match(command, /data-testid="retired-command-page"/);
  assert.match(command, /data-authority-effect="false"/);
  assert.match(command, /Mission control moved/);
  assert.match(command, /legacy daemon Command surface is retired/i);
  for (const legacy of [
    'focusTaskId',
    'focusChatId',
    'openAttention',
    'openTask',
    'setChatId',
    'mission-active-work',
    'mission-attention',
    'mission-outcomes',
  ]) {
    assert.equal(command.includes(legacy), false, `retired COMMAND page still carries legacy drill state: ${legacy}`);
  }
});

test('R102 retired COMMAND page has no navigation, daemon fetch or renderer command authority', () => {
  for (const forbidden of [
    'setPage(',
    'me2Fetch',
    'sendCommand',
    'ipcRenderer',
    'selectPrimaryAgentSession',
    'BROWSER_SELECT_TAB',
    'agentChatOp',
  ]) {
    assert.equal(command.includes(forbidden), false, `retired COMMAND page still carries authority token: ${forbidden}`);
  }
});

test('R102 historical command deep links normalize to the canonical Browser fleet', () => {
  assert.match(store, /export function normalizePageKey\(value: unknown\): PageKey/);
  assert.match(store, /raw === "command" \|\| raw === "agents" \|\| raw === "compute"/);
  assert.match(store, /return "browser"/);
  assert.match(store, /const nextPage = normalizePageKey\(p\)/);
});

test('R102 COMMAND compatibility surface remains presentation-only', () => {
  assert.doesNotMatch(command, /BrowserStage/);
  assert.doesNotMatch(command, /primaryShellPage\s*=/);
  assert.doesNotMatch(command, /fetch\(|WebSocket|raw CDP|eval\(/);
  assert.match(command, /<section/);
  assert.match(command, /aria-label="Retired Command compatibility surface"/);
});
