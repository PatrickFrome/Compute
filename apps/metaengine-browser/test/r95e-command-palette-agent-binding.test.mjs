import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');

test('R98 Command Palette exposes the canonical native Browser Agent fleet, not daemon AgentChat identity', () => {
  assert.match(palette, /Native Agent fleet/);
  assert.match(palette, /Open native z\.ai Agent fleet/);
  assert.match(palette, /setPage\("browser"\)/);
  assert.doesNotMatch(palette, /useAgentChatSessions\(/);
  assert.doesNotMatch(palette, /setChatId\(/);
  assert.doesNotMatch(palette, /AgentPaletteGroup/);
});

test('R98 Command Palette has no daemon/API agent creation or model-selection authority', () => {
  assert.doesNotMatch(palette, /agentChatOp|AGENT_SPAWN|AGENT_MODEL|create_chat|provider|model gateway/i);
  assert.match(palette, /does not spawn daemon\/API agents or invent a second fleet projection/);
});

test('R98 palette modes keep agents out of a rival AgentChat polling surface', () => {
  assert.match(palette, /useState<"all" \| "pages" \| "tasks" \| "actions">/);
  assert.doesNotMatch(palette, /mode === "agents"/);
  assert.doesNotMatch(palette, /refreshChats|chatsRefreshing|chatSnapshotTrusted/);
});
