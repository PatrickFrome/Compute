import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const command = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url),
  'utf8',
);

test('R102 retired COMMAND compatibility page cannot resurrect exact task/chat drill authority', () => {
  assert.match(command, /data-testid="retired-command-page"/);
  assert.match(command, /data-authority-effect="false"/);
  assert.match(command, /legacy daemon Command surface is retired/i);

  for (const retiredAuthority of [
    'focusTaskId',
    'focusChatId',
    'openAttention',
    'openTask',
    'setChatId',
    'setPage',
    'selectPrimaryAgentSession',
    'mission-active-work',
    'mission-attention',
    'mission-outcomes',
  ]) {
    assert.equal(command.includes(retiredAuthority), false, `retired COMMAND authority resurfaced: ${retiredAuthority}`);
  }
});

test('R102 retired COMMAND remains an inert compatibility surface with no effect transport', () => {
  assert.doesNotMatch(command, /BrowserStage/);
  assert.doesNotMatch(command, /primaryShellPage\s*=/);
  assert.doesNotMatch(command, /ipcRenderer/);
  assert.doesNotMatch(command, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
  assert.doesNotMatch(command, /onClick=|onKeyDown=|onSubmit=/);
});
