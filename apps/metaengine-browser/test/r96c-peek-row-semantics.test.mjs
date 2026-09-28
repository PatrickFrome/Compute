import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const hook = await read('../../me2-ui/src/hooks/use-temporary-peek.ts');

test('R96C task Peek rows keep focus semantics while Space remains presentation-only preview', () => {
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="link"|role="link"[\s\S]{0,420}data-peek-kind="task"/);
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="group"|role="group"[\s\S]{0,420}data-peek-kind="task"/);
  assert.doesNotMatch(tasks, /role="button"[\s\S]{0,180}data-peek-kind="task"/);
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,100}openTask\(t\.id\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space"/);
  assert.doesNotMatch(tasks, /aria-keyshortcuts="[^"]*Arrow(?:Up|Down)/);
});

test('R106 retired Agents page is physically absent and cannot own Peek or AgentChat controls', () => {
  const agentsUrl = new URL('../../me2-ui/src/components/me2/pages/agents.tsx', import.meta.url);
  assert.equal(fs.existsSync(agentsUrl), false);
});

test('R96C generic Peek capture still reserves nested real controls without creating an effect path', () => {
  assert.match(hook, /const interactive = target\.closest/);
  assert.match(hook, /if \(row && interactive === row\) return false/);
  assert.match(hook, /return Boolean\(interactive\)/);
  assert.match(hook, /setPeekTarget/);
  assert.doesNotMatch(hook, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
});

test('R96C retained task Peek contract creates no new process or Browser effect path', () => {
  assert.doesNotMatch(tasks, /ipcRenderer|shell\.exec|raw CDP|eval\(/);
});
