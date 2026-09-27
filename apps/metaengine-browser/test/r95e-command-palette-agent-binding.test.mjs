import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const palette = await readFile(
  new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url),
  'utf8',
);

test('R95E Command Palette never treats Agent.id as AgentChat session identity', () => {
  assert.doesNotMatch(palette, /setChatId\(a\.id\)/);
  assert.match(palette, /useAgentChatSessions\(\)/);
  assert.match(palette, /session\.status !== "ACTIVE"/);
  assert.match(palette, /map\.get\(session\.agent_id\)/);
  assert.match(palette, /ids\.push\(session\.id\)/);
});

test('R95E agent drill binds only one exact ACTIVE chat and fails closed on ambiguity', () => {
  assert.match(palette, /const exactChatId = chatIds\.length === 1 \? chatIds\[0\] : null/);
  assert.match(palette, /setChatId\(exactChatId\)/);
  assert.match(palette, /setPage\("agents"\)/);
  assert.match(palette, /chatIds\.length > 1/);
  assert.match(palette, /ambiguous chat/);
});

test('R95E AgentChat polling exists only in the conditionally-mounted agent palette group', () => {
  assert.match(palette, /function AgentPaletteGroup/);
  assert.match(palette, /\(mode === "all" \|\| mode === "agents"\) && <AgentPaletteGroup agents=\{agents\} \/>/);
  assert.doesNotMatch(palette, /const \{ sessions \} = useAgentChatSessions\(\);[\s\S]{0,200}export function CommandPalette/);
});
