import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const command = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url),
  'utf8',
);

test('R95D COMMAND attention carries bounded exact selection for the newest blocker', () => {
  assert.match(command, /focusTaskId\?: string/);
  assert.match(command, /focusChatId\?: string/);
  assert.match(command, /const latestFailed = failedTasks\[0\] \?\? null/);
  assert.match(command, /const latestBlocked = blockedAgents\[0\] \?\? null/);
  assert.match(command, /focusTaskId: latestFailed\?\.id/);
  assert.match(command, /focusChatId: latestBlocked\?\.id/);
  assert.match(command, /\.sort\(\(a, b\) => new Date\(b\.updated_at\)\.getTime\(\) - new Date\(a\.updated_at\)\.getTime\(\)\)/);
});

test('R95D attention drill preserves exact task or chat selection before stage navigation', () => {
  assert.match(command, /const openAttention = useCallback\(\(item: MissionAttention\) => \{/);
  assert.match(command, /if \(item\.focusTaskId\) openTask\(item\.focusTaskId\)/);
  assert.match(command, /if \(item\.focusChatId\) setChatId\(item\.focusChatId\)/);
  assert.match(command, /setPage\(item\.page\)/);
  assert.match(command, /onClick=\{\(\) => openAttention\(item\)\}/);
});

test('R95D active work and outcome rows drill into the concrete task instead of leaving latent selection on COMMAND', () => {
  assert.match(command, /onClick=\{\(\) => \{ openTask\(t\.id\); setPage\("tasks"\); \}\}/);
  assert.match(command, /if \(e\.task_id\) \{[\s\S]{0,160}openTask\(e\.task_id\);[\s\S]{0,160}setPage\("tasks"\);/);
  assert.match(command, /else \{[\s\S]{0,100}setPage\("observability"\);/);
});

test('R95D remains presentation/navigation-only for cross-stage drill-in', () => {
  assert.doesNotMatch(command, /BrowserStage/);
  assert.doesNotMatch(command, /primaryShellPage\s*=/);
  assert.doesNotMatch(command, /ipcRenderer/);
  assert.match(command, /data-testid="mission-active-work"/);
  assert.match(command, /data-testid="mission-attention"/);
  assert.match(command, /data-testid="mission-outcomes"/);
});
