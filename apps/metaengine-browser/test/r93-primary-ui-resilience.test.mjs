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
