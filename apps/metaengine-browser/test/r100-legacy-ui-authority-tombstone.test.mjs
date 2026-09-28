import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const retired = [
  'me2-ui/src/components/me2/pages/agents.tsx',
  'me2-ui/src/components/me2/pages/command.tsx',
  'me2-ui/src/components/me2/pages/compute.tsx',
];

test('R100 retired daemon pages are inert compatibility tombstones', () => {
  for (const file of retired) {
    const source = read(file);
    assert.match(source, /data-authority-effect="false"/, file);
    assert.match(source, /retired/i, file);
    for (const forbidden of [
      'sendCommand',
      'me2Fetch',
      'spawnAgent',
      'agentChatOp',
      'useAgentChatSessions',
      'MODEL_OPTIONS',
      '/providers',
      '/llm',
      '/glm',
      '/agentchat',
      'TASK_ENQUEUE',
      'TASK_SCHEDULE',
      'AGENT_MODEL',
      'AGENT_PAUSE',
      'AGENT_RETIRE',
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} still carries legacy authority token: ${forbidden}`);
    }
  }
});

test('R100 retired daemon pages import no bus, socket, provider or fleet runtime', () => {
  for (const file of retired) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/lib\/me2-(?:bus|socket)/, file);
    assert.doesNotMatch(source, /@\/hooks\/use-agentchat/, file);
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:provider|fleet|agentchat)[^"']*["']/, file);
  }
});
