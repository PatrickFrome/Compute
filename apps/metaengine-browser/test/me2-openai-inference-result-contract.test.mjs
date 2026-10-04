import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../../', import.meta.url);
const providers = await readFile(new URL('apps/me2-daemon/providers.ts', repo), 'utf8');
const agentchat = await readFile(new URL('apps/me2-daemon/src/agentchat.ts', repo), 'utf8');
const reviewer = await readFile(new URL('apps/me2-daemon/src/reviewer.ts', repo), 'utf8');
const brain = await readFile(new URL('apps/me2-daemon/src/brain.ts', repo), 'utf8');

test('ME2 provider treats HTTP success as unproven until terminal non-empty OpenAI payload', () => {
  assert.match(providers, /extractCompletedChatText/);
  assert.match(providers, /finishReason !== "stop"/);
  assert.match(providers, /chat_response_not_completed/);
  assert.match(providers, /chat_response_empty/);
  assert.match(providers, /return extractCompletedChatText\(j, "openai"\)/);
  assert.match(providers, /return extractCompletedChatText\(j, "gateway"\)/);
  assert.doesNotMatch(providers, /message\?\.content \?\? ""/);
});

test('AgentChat cannot manufacture success after exhausting model steps without reply', () => {
  assert.match(agentchat, /agent_reply_missing_after_max_steps/);
  assert.doesNotMatch(agentchat, /ход завершён без reply/);
  assert.match(agentchat, /const ok = !hardError && !!reply/);
});

test('Brain and Reviewer use the active OpenAI durable identity, never zai:default', () => {
  for (const source of [brain, reviewer]) {
    assert.match(source, /activeAgentModelTag/);
    assert.doesNotMatch(source, /zai:default/);
  }
  assert.match(brain, /const model = activeAgentModelTag\(\)/);
  assert.match(brain, /ms, model,/);
});
