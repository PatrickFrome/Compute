import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const command = await read('../../me2-ui/src/components/me2/pages/command.tsx');
const shell = await read('../../me2-ui/src/components/me2/shell/me2-shell.tsx');
const store = await read('../../me2-ui/src/components/me2/store.tsx');

test('R103 retired COMMAND is an explicit zero-authority compatibility tombstone', () => {
  assert.match(command, /data-testid="retired-command-page"/);
  assert.match(command, /data-authority-effect="false"/);
  assert.match(command, /Mission control moved/);
  assert.match(command, /Use the Browser fleet,/);
  assert.doesNotMatch(command, /selectPrimaryAgentSession|openAttention|openTask\(|setChatId\(|setPage\(/);
  assert.doesNotMatch(command, /onClick=|ipcRenderer|me2Fetch\(|fetch\(|WebSocket|agentChatOp/);
});

test('R103 canonical product shell cannot route back into the retired COMMAND authority page', () => {
  assert.doesNotMatch(shell, /pages\/command|CommandPage/);
  assert.match(shell, /PrimaryChatFleetWorkspace/);
  assert.match(store, /raw === "command" \|\| raw === "agents" \|\| raw === "compute"/);
  assert.match(store, /const nextPage = normalizePageKey\(p\)/);
  const pageType = store.slice(store.indexOf('export type PageKey'), store.indexOf('// R97 native swarm convergence'));
  assert.equal(pageType.includes('"command"'), false);
  assert.equal(pageType.includes('"agents"'), false);
  assert.equal(pageType.includes('"compute"'), false);
});
