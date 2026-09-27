import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tasks = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url),
  'utf8',
);

test('R96D BranchGraph nested actions are reachable in sequential keyboard navigation', () => {
  assert.match(tasks, /className="branch-retry cursor-pointer"[\s\S]{0,500}role="button"[\s\S]{0,120}tabIndex=\{0\}/);
  assert.match(tasks, /className="branch-reflect cursor-pointer"[\s\S]{0,500}role="button"[\s\S]{0,120}tabIndex=\{0\}/);
  assert.doesNotMatch(tasks, /className="branch-(?:retry|reflect) cursor-pointer"[\s\S]{0,240}tabIndex=\{-1\}/);
});

test('R96D nested action buttons honor both standard button activation keys', () => {
  assert.match(tasks, /branch-retry[\s\S]{0,420}e\.key !== "Enter" && e\.key !== " "/);
  assert.match(tasks, /branch-retry[\s\S]{0,520}e\.preventDefault\(\)[\s\S]{0,120}e\.stopPropagation\(\)[\s\S]{0,120}onRetry\(t\)/);
  assert.match(tasks, /branch-reflect[\s\S]{0,420}e\.key !== "Enter" && e\.key !== " "/);
  assert.match(tasks, /branch-reflect[\s\S]{0,520}e\.preventDefault\(\)[\s\S]{0,120}e\.stopPropagation\(\)[\s\S]{0,120}onReflect\(t\)/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space"/);
});

test('R96D nested button activation stops bubbling before the existing callbacks', () => {
  assert.match(
    tasks,
    /className="branch-retry cursor-pointer"[\s\S]{0,420}onKeyDown=\{\(e\) => \{[\s\S]{0,240}e\.preventDefault\(\);[\s\S]{0,120}e\.stopPropagation\(\);[\s\S]{0,120}onRetry\(t\);/,
  );
  assert.match(
    tasks,
    /className="branch-reflect cursor-pointer"[\s\S]{0,420}onKeyDown=\{\(e\) => \{[\s\S]{0,240}e\.preventDefault\(\);[\s\S]{0,120}e\.stopPropagation\(\);[\s\S]{0,120}onReflect\(t\);/,
  );
  assert.match(tasks, /className="branch-retry cursor-pointer"[\s\S]{0,160}onClick=\{\(e\) => \{ e\.stopPropagation\(\); onRetry\(t\); \}\}/);
  assert.match(tasks, /className="branch-reflect cursor-pointer"[\s\S]{0,160}onClick=\{\(e\) => \{ e\.stopPropagation\(\); onReflect\(t\); \}\}/);
});
