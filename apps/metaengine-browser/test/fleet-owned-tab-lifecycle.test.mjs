import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TabRegistry } from '../src/tab-registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = path.join(here, '..', 'ui', 'app.js');

test('tab ownership and agent binding are immutable identity fields', () => {
  const registry = new TabRegistry();
  const tab = registry.create({
    url: 'https://chatgpt.com/',
    kind: 'CHATGPT',
    ownership: 'FLEET_OWNED',
    agent_id: 'agent_12345678',
  });
  assert.equal(tab.ownership, 'FLEET_OWNED');
  assert.equal(tab.agent_id, 'agent_12345678');
  assert.throws(() => registry.update(tab.tab_id, { ownership: 'USER' }), /tab_ownership_immutable/);
  assert.throws(() => registry.update(tab.tab_id, { agent_id: 'agent_abcdefgh' }), /tab_agent_id_immutable/);
});

test('user tab cannot smuggle a fleet agent binding', () => {
  const registry = new TabRegistry();
  assert.throws(() => registry.create({
    url: 'https://chatgpt.com/',
    ownership: 'USER',
    agent_id: 'agent_12345678',
  }), /tab_agent_id_requires_fleet_ownership/);
});

test('fleet-owned tab requires a valid agent id', () => {
  const registry = new TabRegistry();
  assert.throws(() => registry.create({
    url: 'https://chatgpt.com/',
    ownership: 'FLEET_OWNED',
  }), /tab_agent_id_invalid/);
});

test('shell UI disables CLOSE_TAB for fleet-owned surfaces', async () => {
  const source = await fs.readFile(appSource, 'utf8');
  assert.match(source, /agent\?\.ownership === 'FLEET_OWNED'/);
  assert.match(source, /close\.disabled = protectedFleetSurface/);
  assert.match(source, /if \(!protectedFleetSurface\) close\.onclick = \(\) => api\.command\('CLOSE_TAB'/);
});