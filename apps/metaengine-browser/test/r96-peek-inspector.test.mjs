import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');

const store = await read('../../me2-ui/src/components/me2/store.tsx');
const shell = await read('../../me2-ui/src/components/me2/shell/me2-shell.tsx');
const inspector = await read('../../me2-ui/src/components/me2/shell/peek-inspector.tsx');
const hook = await read('../../me2-ui/src/hooks/use-temporary-peek.ts');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const agents = await read('../../me2-ui/src/components/me2/pages/agents.tsx');

test('R96 Peek state is ephemeral presentation-only state and dies on navigation', () => {
  assert.match(store, /export type PeekKind = "task" \| "agent"/);
  assert.match(store, /peekTarget: PeekTarget \| null/);
  assert.match(store, /setPeekTarget: \(target: PeekTarget \| null\)/);
  assert.match(store, /setPeekTarget: \(target\) => set\(\{ peekTarget: target \}\)/);
  assert.match(store, /page: nextPage,[\s\S]{0,160}peekTarget: null/);
  assert.match(store, /workspace: w,[\s\S]{0,120}peekTarget: null/);
  assert.doesNotMatch(store, /peekTarget[\s\S]{0,80}localStorage/);
});

test('R96 hold-Space controller closes on release and keeps Arrow navigation inside the current list', () => {
  assert.match(hook, /event\.key === " "/);
  assert.match(hook, /window\.addEventListener\("keyup", onKeyUp\)/);
  assert.match(hook, /event\.key === "ArrowDown"/);
  assert.match(hook, /event\.key === "ArrowUp"/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /Math\.max\(0, Math\.min\(rows\.length - 1/);
  assert.match(hook, /setPeekTarget\(\{ kind, id: nextId \}\)/);
  assert.match(hook, /focusPeekItem\(kind, nextId\)/);
  assert.match(hook, /input, textarea, select/);
  assert.match(hook, /\[role="textbox"\]/);
  assert.match(hook, /\[role="combobox"\]/);
  assert.match(hook, /isReservedInteractionTarget\(event\.target, kind\)/);
  assert.match(hook, /button, a\[href\], summary/);
  assert.match(hook, /data-peek-kind=/);
  assert.doesNotMatch(hook, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
});

test('R96 Peek requires explicit row focus before Space can capture page navigation', () => {
  assert.match(tasks, /const effectivePeekTaskId = peekTaskId && peekTaskIds\.includes\(peekTaskId\)[\s\S]{0,80}\? peekTaskId[\s\S]{0,40}: null;/);
  assert.doesNotMatch(tasks, /effectivePeekTaskId[\s\S]{0,120}peekTaskIds\[0\]/);
  assert.match(agents, /const effectivePeekAgentId = peekAgentId && peekAgentIds\.includes\(peekAgentId\)[\s\S]{0,80}\? peekAgentId[\s\S]{0,40}: null;/);
  assert.doesNotMatch(agents, /effectivePeekAgentId[\s\S]{0,120}peekAgentIds\[0\]/);
});

test('R96 Peek never steals native Space activation from unrelated controls', () => {
  assert.match(hook, /function isReservedInteractionTarget/);
  assert.match(hook, /\[role="button"\]/);
  assert.match(hook, /\[role="menuitem"\]/);
  assert.match(hook, /\[role="tab"\]/);
  assert.match(hook, /const row = target\.closest\(\`\[data-peek-kind=/);
  assert.match(hook, /isEditableTarget\(event\.target\) \|\| isReservedInteractionTarget\(event\.target, kind\)/);
});

test('R96B nested interactive controls inside a Peek row keep native Space semantics', () => {
  assert.match(hook, /const row = target\.closest/);
  assert.match(hook, /const interactive = target\.closest/);
  assert.match(hook, /if \(row && interactive === row\) return false/);
  assert.match(hook, /return Boolean\(interactive\)/);
  assert.doesNotMatch(hook, /if \(target\.closest\([\s\S]{0,80}data-peek-kind[\s\S]{0,80}\)\) return false/);
});

test('R96A Space Peek begins only from the currently focused selected row', () => {
  assert.match(hook, /function isFocusedPeekRow/);
  assert.match(hook, /target\.closest\(\`\[data-peek-kind=/);
  assert.match(hook, /row\?\.getAttribute\("data-peek-id"\) === selectedId/);
  assert.match(hook, /if \(!id \|\| !isFocusedPeekRow\(event\.target, kind, id\)\) return/);
});

test('R96 held Peek rebinds or closes when live snapshot membership changes', () => {
  assert.match(hook, /if \(!heldRef\.current\) return/);
  assert.match(hook, /if \(!selectedId \|\| !ids\.includes\(selectedId\)\)/);
  assert.match(hook, /heldRef\.current = false;[\s\S]{0,80}setPeekTarget\(null\)/);
  assert.match(hook, /setPeekTarget\(\{ kind, id: selectedId \}\)/);
});

test('R96 inspector resolves only existing snapshot entities and never gains an action plane', () => {
  assert.match(inspector, /data-testid="peek-inspector"/);
  assert.match(inspector, /data-testid="peek-task"/);
  assert.match(inspector, /data-testid="peek-agent"/);
  assert.match(inspector, /snap\.tasks\.find/);
  assert.match(inspector, /snap\.agents\.find/);
  assert.match(inspector, /pointer-events-none/);
  assert.match(inspector, /hold Space · ↑\/↓ browse · release close/);
  assert.doesNotMatch(inspector, /onClick=|sendCommand|taskAction|agentChatOp|me2Fetch|fetch\(/);
});

test('R97 keeps Peek capability out of persistent main chrome while preserving zero-authority state fencing', () => {
  assert.match(shell, /const peekTarget = useMe2\(\(s\) => s\.peekTarget\)/);
  assert.match(shell, /nativeOverlayOpen = Boolean\(paletteOpen \|\| overlaysOpen \|\| peekTarget \|\| chromeOverlaySources\.length > 0\)/);
  assert.doesNotMatch(shell, /<PeekInspector \/>/);
  assert.doesNotMatch(inspector, /onClick=|sendCommand|taskAction|agentChatOp|me2Fetch|fetch\(/);
});

test('R96 task surfaces separate Enter activation from temporary Space preview', () => {
  assert.match(tasks, /useTemporaryPeekList\(\{[\s\S]{0,220}kind: "task"/);
  assert.match(tasks, /data-peek-kind="task"/);
  assert.match(tasks, /data-peek-selected=/);
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,120}onOpen\(t\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(tasks, /onFocus=\{\(\) => setPeekTaskId\(t\.id\)\}/);
});

test('R96 agent registry previews with Space without opening chat', () => {
  assert.match(agents, /useTemporaryPeekList\(\{[\s\S]{0,220}kind: "agent"/);
  assert.match(agents, /data-peek-kind="agent"/);
  assert.match(agents, /onFocus=\{\(\) => setPeekAgentId\(a\.id\)\}/);
  assert.match(agents, /if \(e\.key === "Enter"\) openAgentChat\(a\)/);
  assert.match(agents, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
});
