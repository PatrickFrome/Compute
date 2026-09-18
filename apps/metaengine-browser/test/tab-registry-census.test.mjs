import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRegistry, FLEET_TAB_CEILING } from '../src/tab-registry.mjs';

test('tab census is a read-only probe: it never mutates registry state', () => {
  const r = new TabRegistry();
  r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT' });
  const before = r.snapshot();
  const census = r.census();
  assert.equal(census.schema, 'metaengine.browser.tab-census.v1');
  assert.equal(census.total_tabs, 1);
  assert.equal(census.by_role.USER, 1);
  assert.equal(census.by_role.FLEET, 0);
  assert.equal(census.create_tab_attempted, false);
  assert.equal(census.authority_effect, false);
  assert.equal(census.fleet_tab_ceiling, FLEET_TAB_CEILING);
  assert.equal(census.user_reserved_slots, 32 - FLEET_TAB_CEILING);
  assert.equal(census.fleet_tab_headroom, FLEET_TAB_CEILING);
  assert.deepEqual(r.snapshot().tabs.map((t) => t.tab_id), before.tabs.map((t) => t.tab_id));
});

test('fleet tabs draw from their own ceiling, user tabs from the shared wall', () => {
  const r = new TabRegistry();
  for (let i = 0; i < FLEET_TAB_CEILING; i += 1) {
    r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT', role: 'FLEET' });
  }
  assert.equal(r.census().fleet_at_ceiling, true);
  assert.equal(r.census().fleet_tab_headroom, 0);
  // The fleet wall is hit exactly at the per-kind ceiling...
  assert.throws(() => r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT', role: 'FLEET' }), /tab_capacity_exceeded/);
  // ...while the user still holds the full guaranteed reservation.
  for (let i = 0; i < 32 - FLEET_TAB_CEILING; i += 1) {
    r.create({ url: 'https://example.com/', kind: 'USER_WEB', role: 'USER' });
  }
  assert.equal(r.census().by_role.USER, 32 - FLEET_TAB_CEILING);
  assert.equal(r.census().user_tab_headroom, 0);
  assert.throws(() => r.create({ url: 'https://example.com/', kind: 'USER_WEB' }), /tab_capacity_exceeded/);
  // Closing one fleet tab reopens exactly one fleet slot, user slots unchanged.
  const fleetIds = r.census().fleet_tab_ids;
  r.close(fleetIds[0]);
  const c = r.census();
  assert.equal(c.by_role.FLEET, FLEET_TAB_CEILING - 1);
  assert.equal(c.fleet_tab_headroom, 1);
  assert.equal(c.by_role.USER, 32 - FLEET_TAB_CEILING);
  r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT', role: 'FLEET' });
  assert.equal(r.census().by_role.FLEET, FLEET_TAB_CEILING);
});

test('tab role is validated at creation and immutable through updates', () => {
  const r = new TabRegistry();
  assert.throws(() => r.create({ url: 'https://example.com/', role: 'GUEST' }), /tab_role_invalid/);
  const tab = r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT', role: 'FLEET' });
  assert.equal(tab.role, 'FLEET');
  const updated = r.update(tab.tab_id, { title: 'worker', kind: 'USER_WEB' });
  assert.equal(updated.role, 'FLEET', 'role survives kind/title updates');
  assert.equal(updated.kind, 'USER_WEB');
  const snap = r.snapshot();
  assert.equal(snap.census.by_role.FLEET, 1);
  assert.ok(snap.tabs[0].role === 'FLEET');
  assert.equal(snap.census.release_signal, 'PHYSICAL_TAB_CLOSED');
});

test('default role is USER so legacy create calls keep their capacity semantics', () => {
  const r = new TabRegistry();
  const a = r.create({ url: 'https://example.com/' });
  assert.equal(a.role, 'USER');
  assert.equal(r.census().by_kind.USER_WEB, 1);
  const b = r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT' });
  assert.equal(b.role, 'USER');
  assert.equal(r.census().by_kind.CHATGPT, 1);
  assert.deepEqual(r.census().fleet_tab_ids, []);
});
