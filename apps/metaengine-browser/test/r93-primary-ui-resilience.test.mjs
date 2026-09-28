import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { me2FleetTabsSetHost } from '../src/me2/me2-fleet-tabs-host.mjs';
import {
  me2MissionReconcile,
  me2MissionSessionBinding,
  me2MissionSelectSession,
} from '../src/me2/me2-mission-control.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserRoot = path.resolve(here, '..');
const appsRoot = path.resolve(browserRoot, '..');

test('R93 canonical ME2 session selection uses Browser-owned session->tab binding, not session-id URL inference', async () => {
  const sessionId = 'me2_internal_session_alpha';
  const conversationUrl = 'https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const rows = new Map([
    ['tab_supervisor', {
      tab_id: 'tab_supervisor',
      role: 'SUPERVISOR',
      url: 'http://127.0.0.1:3041/ui',
      title: 'ME2 Mission Control',
    }],
    ['tab_agent', {
      tab_id: 'tab_agent',
      role: 'FLEET',
      url: conversationUrl,
      title: 'Native agent conversation',
    }],
  ]);
  let selected = null;
  const registry = {
    snapshot: () => ({ tabs: [...rows.values()] }),
    census: () => ({ by_role: { SUPERVISOR: 1, FLEET: 1 } }),
    get: (id) => rows.get(String(id)) ?? null,
    update: (id, patch) => {
      const current = rows.get(String(id));
      if (current) rows.set(String(id), { ...current, ...patch });
    },
  };
  me2FleetTabsSetHost({
    registry,
    createTab: async () => { throw new Error('unexpected_create'); },
    selectTab: async (tabId) => { selected = String(tabId); },
  });

  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    sessions: [{
      id: sessionId,
      status: 'ACTIVE',
      conversation_url: conversationUrl,
      title: 'Internal ME2 agent',
      role: 'CODE',
    }],
    status: { total: 1, active: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await me2MissionReconcile();
    const binding = me2MissionSessionBinding(sessionId);
    assert.equal(binding.state, 'BOUND');
    assert.equal(binding.tab_id, 'tab_agent');
    assert.equal(binding.conversation_url, conversationUrl);
    assert.equal(binding.exact_session_binding, true);
    assert.equal(binding.renderer_routing_authority, false);
    assert.equal(binding.browser_command_authority, false);

    const selectedResult = await me2MissionSelectSession(sessionId);
    assert.equal(selectedResult.state, 'BOUND');
    assert.equal(selectedResult.selection_applied, true);
    assert.equal(selected, 'tab_agent');

    rows.set('tab_agent', { ...rows.get('tab_agent'), url: 'https://chat.z.ai/c/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' });
    selected = null;
    const stale = await me2MissionSelectSession(sessionId);
    assert.equal(stale.state, 'STALE');
    assert.equal(stale.selection_applied, false);
    assert.equal(selected, null);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('R103 primary renderer keeps the narrow bound-session host intent while retired COMMAND cannot consume it', async () => {
  const preload = await fs.readFile(path.join(browserRoot, 'src', 'preload-shell.cjs'), 'utf8');
  const main = await fs.readFile(path.join(browserRoot, 'src', 'main.mjs'), 'utf8');
  const command = await fs.readFile(path.join(appsRoot, 'me2-ui', 'src', 'components', 'me2', 'pages', 'command.tsx'), 'utf8');

  assert.match(preload, /selectPrimaryAgentSession/);
  assert.match(preload, /metaengine:shell:primary-agent-session-select/);
  assert.match(main, /me2MissionSelectSession/);
  assert.match(main, /primary-agent-session-select/);
  assert.match(command, /data-testid="retired-command-page"/);
  assert.match(command, /data-authority-effect="false"/);
  assert.doesNotMatch(command, /selectPrimaryAgentSession/);
  assert.doesNotMatch(command, /BROWSER_SELECT_TAB|loadBrowserTabs|resolveExactAgentTab/);
  assert.doesNotMatch(command, /onClick=|ipcRenderer|me2Fetch\(|fetch\(|WebSocket/);
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
