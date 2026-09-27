import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');
const sessionsHook = await read('../../me2-ui/src/hooks/use-agentchat-sessions.ts');

test('R95E Command Palette never treats Agent.id as AgentChat session identity', () => {
  assert.doesNotMatch(palette, /setChatId\(a\.id\)/);
  assert.match(palette, /useAgentChatSessions\(\)/);
  assert.match(palette, /session\.status !== "ACTIVE"/);
  assert.match(palette, /map\.get\(session\.agent_id\)/);
  assert.match(palette, /ids\.push\(session\.id\)/);
});

test('R95E agent drill binds only one exact ACTIVE chat and fails closed on ambiguity', () => {
  assert.match(palette, /chatSnapshotTrusted && chatIds\.length === 1 \? chatIds\[0\] : null/);
  assert.match(palette, /setChatId\(exactChatId\)/);
  assert.match(palette, /setPage\("agents"\)/);
  assert.match(palette, /chatIds\.length > 1/);
  assert.match(palette, /ambiguous chat/);
});

test('R95E AgentChat polling exists only in the conditionally-mounted agent palette group', () => {
  assert.match(palette, /function AgentPaletteGroup/);
  assert.match(palette, /\(mode === "all" \|\| mode === "agents"\) && <AgentPaletteGroup agents=\{agents\} \/>/);
});

test('R95F palette revalidates AgentChat identity on mount and rejects in-flight or stale snapshots', () => {
  assert.match(palette, /refreshing: chatsRefreshing/);
  assert.match(palette, /updatedAt: chatsUpdatedAt/);
  assert.match(palette, /void refreshChats\(\)/);
  assert.match(palette, /Math\.max\(0, nowMs - chatsUpdatedAt\) <= 7_000/);
  assert.match(palette, /!chatsLoading && !chatsRefreshing && !chatsError && chatSnapshotFresh/);
  assert.match(palette, /chat revalidating/);
});

test('R95F shared AgentChat hook exposes in-flight refresh without falsifying last-success freshness', () => {
  assert.match(sessionsHook, /refreshing: boolean/);
  assert.match(sessionsHook, /refreshing: true/);
  assert.match(sessionsHook, /refreshing: false/);
  assert.match(sessionsHook, /updatedAt: Date\.now\(\)/);
  assert.doesNotMatch(sessionsHook, /error: "daemon unavailable", updatedAt: Date\.now\(\)/);
});
