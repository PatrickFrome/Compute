import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tasks = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url),
  'utf8',
);

test('R108 BranchGraph rows remain keyboard reachable after task mutations retire', () => {
  assert.match(tasks, /className="branch-row"/);
  assert.match(tasks, /role="group"/);
  assert.match(tasks, /tabIndex=\{0\}/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space"/);
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,140}onOpen\(t\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
});

// Historical retry lineage may still be rendered as read-only evidence; retired mutation commands/handlers may not reappear.
test('R108 retired retry and reflection controls cannot regain task mutation authority', () => {
  assert.doesNotMatch(tasks, /className="branch-(?:retry|reflect) cursor-pointer"/);
  assert.doesNotMatch(tasks, /onRetry\(|onReflect\(|TASK_RETRY|agentChatOp|branch-reflect/);
  assert.match(tasks, /read-only projection/);
});

test('R108 task-row activation remains presentation-only', () => {
  assert.match(tasks, /onClick=\{\(\) => \{ onSelect\?\.\(t\.id\); onOpen\(t\); \}\}/);
  assert.doesNotMatch(tasks, /sendCommand\(|taskAction\(|me2Fetch\([^\n]*TASK_/);
});
