import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserRoot = path.resolve(here, '..');
const appsRoot = path.resolve(browserRoot, '..');

test('R107 primary Agent selection belongs only to the native Browser fleet roster', async () => {
  const main = await fs.readFile(path.join(browserRoot, 'src', 'main.mjs'), 'utf8');
  const preload = await fs.readFile(path.join(browserRoot, 'src', 'preload-shell.cjs'), 'utf8');
  const shell = await fs.readFile(path.join(appsRoot, 'me2-ui', 'src', 'components', 'me2', 'shell', 'me2-shell.tsx'), 'utf8');

  assert.match(main, /function primaryChatFleetRoster\(\)/);
  assert.match(main, /function selectPrimaryChatActor\(actorId\)/);
  assert.match(main, /metaengine:shell:primary-chat-fleet-roster/);
  assert.match(main, /metaengine:shell:primary-chat-actor-select/);
  assert.doesNotMatch(main, /me2MissionSelectSession|primary-agent-session-select|me2FleetTabsSetHost/);
  assert.match(preload, /primaryChatFleetRoster/);
  assert.match(preload, /selectPrimaryChatActor/);
  assert.doesNotMatch(preload, /selectPrimaryAgentSession|primary-agent-session-select/);
  assert.match(shell, /primaryChatFleetRoster/);
  assert.match(shell, /selectPrimaryChatActor/);
  assert.doesNotMatch(shell, /selectPrimaryAgentSession|me2MissionSelectSession/);
});

test('R106 retired Command renderer file cannot re-enter the product', async () => {
  const commandPath = path.join(appsRoot, 'me2-ui', 'src', 'components', 'me2', 'pages', 'command.tsx');
  await assert.rejects(fs.readFile(commandPath, 'utf8'), { code: 'ENOENT' });
});

test('R93 shared agent list polling has a bounded request lifetime', async () => {
  const hook = await fs.readFile(path.join(appsRoot, 'me2-ui', 'src', 'hooks', 'use-agentchat-sessions.ts'), 'utf8');
  assert.match(hook, /AGENTCHAT_FETCH_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(hook, /AbortSignal\.timeout\(AGENTCHAT_FETCH_TIMEOUT_MS\)/);
  assert.match(hook, /finally\s*\{[\s\S]{0,160}inFlight\s*=\s*false/);
});

test('R93/R95 drawer drag remains fenced to its workspace and pointercancel never persists', async () => {
  const drawer = await fs.readFile(path.join(appsRoot, 'me2-ui', 'src', 'components', 'me2', 'shell', 'context-drawer.tsx'), 'utf8');
  assert.match(drawer, /const startWorkspace = workspace/);
  assert.match(drawer, /useMe2\.getState\(\)\.workspace === startWorkspace/);
  assert.match(drawer, /pointercancel", cancel/);
  assert.match(drawer, /const current = sameTransaction\(\);[\s\S]{0,120}if \(!current\) return/);
  assert.match(drawer, /setHeight\(startHeight, false\)/);
  assert.match(drawer, /setWidth\(startWidth, false\)/);
  assert.doesNotMatch(drawer, /pointercancel", finish/);
});
