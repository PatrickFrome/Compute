import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { agentTabUrl, matchTabForSession, FleetTabs } from '../src/me2/fleet-tabs.mjs';
import { resolveNavigation, resolvePermission } from '../src/core/browser-policy.mjs';
import { FLEET } from '../src/shared/me2-constants.mjs';
const session = { id: 'local-api-id', conversation_url: FLEET.ORIGIN + '/c/real-web-id' };
function setup({ load, ceiling } = {}) {
  const views = [], focused = [], removed = [];
  const fleet = new FleetTabs({ ceiling, activate: id => focused.push(id), remove: id => removed.push(id),
    viewFactory: () => {
      const wc = new EventEmitter();
      wc.id = views.length + 1; wc.url = ''; wc.dead = false;
      wc.getURL = () => wc.url; wc.isDestroyed = () => wc.dead;
      wc.loadURL = async url => { wc.emit('did-start-navigation', {}, url, false, true); if (load) await load(wc, url); else wc.url = url; };
      wc.close = () => { wc.dead = true; wc.emit('destroyed'); };
      const view = { webContents: wc }; views.push(view); return view;
    } });
  return { fleet, views, focused, removed };
}
test('API IDs, spoof origins and title matches never establish web identity', () => {
  assert.equal(agentTabUrl({ id: 'abc' }), null);
  assert.equal(agentTabUrl(session), session.conversation_url);
  for (const url of ['https://chat.z.ai.evil/c/real-web-id', 'https://evil/c/real-web-id', 'https://x@chat.z.ai/c/real-web-id'])
    assert.equal(agentTabUrl({ conversation_url: url }), null);
  assert.equal(matchTabForSession(session, [{ url: session.conversation_url + '-other', title: session.id }]), null);
  assert.equal(matchTabForSession(session, [{ url: session.conversation_url }, { url: session.conversation_url }]), null);
});
test('native navigation completes before binding; reuse focuses exact conversation', async () => {
  const { fleet, views, focused } = setup();
  const first = await fleet.openAgent(session);
  assert.equal(first.ok, true); assert.equal(first.reused, false);
  assert.equal(first.web_contents_id, 1); assert.equal(first.generation, 1);
  assert.equal(first.execution_authority, false);
  const second = await fleet.openAgent({ ...session, id: 'different-api-id' });
  assert.equal(second.reused, true); assert.equal(views.length, 1); assert.equal(focused.length, 2);
});
test('concurrent open is singleflight and reserves bounded capacity', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { fleet, views } = setup({ ceiling: 1, load: async (wc, url) => { await gate; wc.url = url; } });
  const first = fleet.openAgent(session), duplicate = fleet.openAgent(session);
  assert.equal(first, duplicate);
  assert.equal((await fleet.createConversation()).reason, 'tab_ceiling_reached');
  release(); assert.equal((await first).ok, true); assert.equal(views.length, 1);
});
test('login redirect stays unbound, never reports a proven conversation', async () => {
  const { fleet } = setup({ load: async wc => { wc.url = FLEET.ORIGIN + '/login'; } });
  const result = await fleet.openAgent(session);
  assert.equal(result.ok, false); assert.equal(result.reason, 'conversation_not_proven');
  assert.equal(result.conversation_url, null); assert.equal(result.state, 'UNBOUND');
});
test('root seed has no conversation proof; native navigation later establishes identity', async () => {
  const { fleet, views } = setup();
  const root = await fleet.createConversation(); assert.equal(root.state, 'UNBOUND');
  views[0].webContents.url = session.conversation_url;
  assert.equal(fleet.list()[0].state, 'CONVERSATION_OBSERVED');
  views[0].webContents.emit('render-process-gone');
  assert.equal(fleet.list()[0].state, 'INVALIDATED');
  assert.equal(fleet.list()[0].conversation_url, null);
});
test('failed load releases quota and destroys orphan WebContents', async () => {
  const { fleet, views } = setup({ load: async () => { throw Error('network'); } });
  assert.equal((await fleet.openAgent(session)).ok, false);
  assert.equal(fleet.list().length, 0); assert.equal(views[0].webContents.dead, true);
});
test('browser policy separates trusted control from remote conversation', () => {
  assert.equal(resolveNavigation({ url: session.conversation_url }).allow, true);
  assert.equal(resolveNavigation({ url: session.conversation_url, mainOrigin: 'http://127.0.0.1:8137', trusted: true }).allow, false);
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1:3041/health', 'https://evil.test'])
    assert.equal(resolveNavigation({ url }).allow, false);
  assert.equal(resolvePermission('unknown'), 'deny');
});
