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

test('R108 historical retry lineage stays visible but cannot regain task mutation authority', () => {
  // parent_id/TASK_RETRY lineage is read-only evidence and must remain inspectable.
  assert.match(tasks, /parent_id/);
  assert.match(tasks, /TASK_RETRY lineage/);

  // What is retired is the actionable legacy mutation/reflection surface.
  assert.doesNotMatch(tasks, /className="branch-(?:retry|reflect) cursor-pointer"/);
  assert.doesNotMatch(tasks, /onRetry\(|onReflect\(|agentChatOp|branch-reflect/);
  assert.doesNotMatch(tasks, /taskAction\(\s*["']TASK_RETRY["']/);
  assert.doesNotMatch(tasks, /sendCommand\(\s*["']TASK_RETRY["']/);
  assert.doesNotMatch(tasks, /(?:action|value)\s*[:=]\s*["']TASK_RETRY["']/);
  assert.match(tasks, /read-only projection/);
});

test('R108 task-row activation remains presentation-only', () => {
  assert.match(tasks, /onClick=\{\(\) => \{ onSelect\?\.\(t\.id\); onOpen\(t\); \}\}/);
  assert.doesNotMatch(tasks, /sendCommand\(|taskAction\(|me2Fetch\([^\n]*TASK_/);
});
