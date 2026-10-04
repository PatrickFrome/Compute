import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../../', import.meta.url);
const providers = await readFile(new URL('apps/me2-daemon/providers.ts', repo), 'utf8');
const tokens = await readFile(new URL('apps/me2-daemon/src/tokens.ts', repo), 'utf8');
const agentchat = await readFile(new URL('apps/me2-daemon/src/agentchat.ts', repo), 'utf8');
const reviewer = await readFile(new URL('apps/me2-daemon/src/reviewer.ts', repo), 'utf8');
const brain = await readFile(new URL('apps/me2-daemon/src/brain.ts', repo), 'utf8');
const daemonEntry = await readFile(new URL('apps/me2-daemon/index.ts', repo), 'utf8');
const browserMain = await readFile(new URL('apps/metaengine-browser/src/main.mjs', repo), 'utf8');

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


test('fresh ME2 seed agents are born OpenAI/ChatGPT without transient ZAI identity', () => {
  assert.match(daemonEntry, /const seedModel = activeAgentModelTag\(\)/);
  assert.match(daemonEntry, /createAgent\("IMPLEMENTER", seedModel\)/);
  assert.match(daemonEntry, /createAgent\("RESEARCHER", seedModel\)/);
  assert.match(daemonEntry, /provider: "OPENAI", platform: "CHATGPT"/);
  const seedBlock = daemonEntry.split('function seed() {', 2)[1]?.split('// R47:', 1)[0] ?? '';
  assert.doesNotMatch(seedBlock, /zai:default|GLM_ZAI|chat\.z\.ai/);
});

test('primary Browser projection cannot alias legacy GLM selectors onto ChatGPT tabs', () => {
  assert.match(browserMain, /provider: AGENT_PLATFORM_PROVIDER/);
  assert.match(browserMain, /platform: AGENT_PLATFORM_ID/);
  assert.match(browserMain, /model: AGENT_PLATFORM_MODEL/);
  assert.match(browserMain, /if \(p === 'GLM_ZAI'\) return host === 'chat\.z\.ai'/);
  assert.doesNotMatch(browserMain, /if \(p === 'GLM_ZAI'\) return isAgentPlatformHost\(host\)/);
});


test('ME2 Supabase backend-key compatibility prefers modern secret keys and never bearer-wraps them', () => {
  assert.match(tokens, /SUPABASE_SECRET_KEY/);
  assert.match(tokens, /SUPABASE_SECRET_KEYS/);
  assert.match(providers, /function supabaseAdminKey\(\)/);
  assert.match(providers, /namedSupabaseSecret\(tokenGet\("SUPABASE_SECRET_KEYS"\)\)/);
  assert.match(providers, /export function supabaseAdminRpcHeaders/);
  assert.match(providers, /value\.split\("\."\)\.length === 3/);
  assert.match(providers, /headers\.Authorization = `Bearer \$\{value\}`/);
  assert.doesNotMatch(
    providers,
    /headers:\s*\{\s*apikey:\s*serviceJwt,\s*Authorization:\s*`Bearer \$\{serviceJwt\}`/,
  );
});
