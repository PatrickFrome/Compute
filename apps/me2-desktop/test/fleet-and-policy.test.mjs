import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentTabUrl, matchTabForSession, FleetTabs } from '../src/me2/fleet-tabs.mjs';
import { resolveNavigation, resolvePermission } from '../src/core/browser-policy.mjs';
import { FLEET } from '../src/shared/me2-constants.mjs';

const session = { id: 'chat_abc123', title: 'API 429 Recovery' };

test('fleet tabs: url built from session id', () => {
  assert.equal(agentTabUrl(session), `${FLEET.ORIGIN}/c/chat_abc123`);
  assert.equal(agentTabUrl(null), null);
});

test('fleet tabs: match by url suffix, ambiguity falls back honestly', () => {
  const tabs = [{ url: `${FLEET.ORIGIN}/c/chat_abc123?x=1`, title: 't' }];
  assert.equal(matchTabForSession(session, tabs), tabs[0]);
  const ambiguous = [
    { url: `${FLEET.ORIGIN}/c/chat_abc123`, title: 'a' },
    { url: `${FLEET.ORIGIN}/c/chat_abc123`, title: 'b' },
  ];
  assert.equal(matchTabForSession(session, ambiguous), null);
});

test('fleet tabs: open respects ceiling, reuse focuses', () => {
  const views = [];
  const ft = new FleetTabs({ viewFactory: ({ url, role }) => (views.push({ url, role }), { url, role }) });
  for (let i = 0; i < 12; i += 1) {
    const r = ft.openAgent({ id: `chat_${i}` });
    assert.equal(r.ok, true);
  }
  const overflow = ft.openAgent({ id: 'chat_overflow' });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, 'tab_ceiling_reached');
  const reuse = ft.openAgent({ id: 'chat_1' });
  assert.equal(reuse.ok, true);
  assert.equal(reuse.reused, true);
  assert.equal(ft.list().length, 12);
});

test('browser policy: navigation allowlist', () => {
  assert.equal(resolveNavigation({ url: `${FLEET.ORIGIN}/c/x` }).allow, true);
  assert.equal(resolveNavigation({ url: 'https://evil.example.com' }).allow, false);
  assert.equal(resolveNavigation({ url: 'http://127.0.0.1:3041/health' }).allow, false);
  assert.equal(resolveNavigation({ url: 'file:///etc/passwd' }).allow, false);
  assert.equal(resolveNavigation({ url: 'not a url' }).allow, false);
  assert.equal(resolveNavigation({ url: 'https://me2.local/', mainOrigin: 'https://me2.local' }).allow, true);
});

test('browser policy: permissions deny-by-default', () => {
  for (const p of ['media', 'geolocation', 'notifications', 'unknown-permission']) {
    assert.equal(resolvePermission(p), 'deny');
  }
});
