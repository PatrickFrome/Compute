import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');
const sessionsHook = await read('../../me2-ui/src/hooks/use-agentchat-sessions.ts');

test('R98 Command Palette has no daemon AgentChat identity or polling path', () => {
  assert.doesNotMatch(palette, /useAgentChatSessions\(\)/);
  assert.doesNotMatch(palette, /AgentPaletteGroup/);
  assert.doesNotMatch(palette, /setChatId\(/);
  assert.doesNotMatch(palette, /mode === "agents"/);
  assert.match(palette, /Native agents live in the Browser workspace rail/);
});

test('R98 palette cannot resurrect removed daemon agent surfaces through search', () => {
  assert.doesNotMatch(palette, /setPage\("agents"\)/);
  assert.doesNotMatch(palette, /agentchat|AgentChat/i);
  assert.match(palette, /Advanced surfaces · search/);
});

test('R98 quarantined AgentChat hook remains non-authoritative while it has no palette consumer', () => {
  assert.match(sessionsHook, /refreshing: boolean/);
  assert.match(sessionsHook, /refreshing: true/);
  assert.match(sessionsHook, /refreshing: false/);
  assert.match(sessionsHook, /updatedAt: Date\.now\(\)/);
  assert.doesNotMatch(sessionsHook, /error: "daemon unavailable", updatedAt: Date\.now\(\)/);
});
