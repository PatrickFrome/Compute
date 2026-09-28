import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');

test('R98 Command Palette cannot resurrect daemon AgentChat identity or navigation', () => {
  assert.doesNotMatch(palette, /useAgentChatSessions\s*\(/);
  assert.doesNotMatch(palette, /setChatId\s*\(/);
  assert.doesNotMatch(palette, /AgentPaletteGroup/);
  assert.doesNotMatch(palette, /setPage\(["']agents["']\)/);
  assert.doesNotMatch(palette, /ambiguous chat|chat revalidating/i);
});

test('R98 palette keeps only retained page, task and typed command surfaces', () => {
  assert.match(palette, /"all" \| "pages" \| "tasks" \| "actions"/);
  assert.match(palette, /FLEET_RECONCILE/);
  assert.match(palette, /sendCommand\(/);
  assert.match(palette, /setDialog\("newTask"\)/);
});

test('R98 legacy agent/API command surfaces are not primary palette pages', () => {
  assert.doesNotMatch(palette, /agents:\s*\{/);
  assert.doesNotMatch(palette, /compute:\s*\{/);
  assert.doesNotMatch(palette, /agentchat:op|AGENT_SPAWN|AGENT_MODEL/);
});
