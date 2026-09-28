import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');
const sessionsHook = await read('../../me2-ui/src/hooks/use-agentchat-sessions.ts');

test('R97 Command Palette cannot resurrect daemon/API AgentChat identity', () => {
  assert.doesNotMatch(palette, /useAgentChatSessions\(\)/);
  assert.doesNotMatch(palette, /setChatId\(/);
  assert.doesNotMatch(palette, /setPage\("agents"\)/);
  assert.doesNotMatch(palette, /AgentPaletteGroup/);
  assert.doesNotMatch(palette, /"agents" \| "tasks"/);
});

test('R97 native Agent discovery routes to the Browser fleet workspace only', () => {
  assert.match(palette, /Native Agent fleet/);
  assert.match(palette, /Open native z\.ai Agent fleet/);
  assert.match(palette, /setPage\("browser"\)/);
  assert.match(palette, /Browser roster/);
  assert.match(palette, /does not spawn daemon\/API agents or invent a second fleet projection/);
});

test('R97 command palette modes exclude the retired Agents control plane', () => {
  assert.match(palette, /useState<"all" \| "pages" \| "tasks" \| "actions">\("all"\)/);
  assert.doesNotMatch(palette, /\["agents", "agents"\]/);
  assert.doesNotMatch(palette, /mode === "agents"/);
});

test('R95F shared AgentChat hook remains non-authoritative compatibility code', () => {
  assert.match(sessionsHook, /refreshing: boolean/);
  assert.match(sessionsHook, /refreshing: true/);
  assert.match(sessionsHook, /refreshing: false/);
  assert.match(sessionsHook, /updatedAt: Date\.now\(\)/);
  assert.doesNotMatch(sessionsHook, /error: "daemon unavailable", updatedAt: Date\.now\(\)/);
});
