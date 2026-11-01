import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRegistry, FLEET_TAB_CEILING, MAX_TABS } from '../src/tab-registry.mjs';

test('tab census observes resource headroom without changing logical tabs',()=>{
 const r=new TabRegistry({readResources:()=>({physical_start_allowed:true,memory_headroom:200})});
 r.create({url:'https://chatgpt.com/',kind:'CHATGPT'});const before=r.snapshot(),c=r.census();
 assert.equal(c.agent_count_limit,null);assert.equal(c.total_tabs,1);assert.equal(c.user_tab_headroom,200);
 assert.equal(FLEET_TAB_CEILING,null);assert.equal(MAX_TABS,null);assert.equal(c.authority_effect,false);
 assert.deepEqual(r.snapshot().tabs,before.tabs);
});

test('resource recovery allows more tabs without changing a fixed count ceiling',()=>{
 let headroom=200;const r=new TabRegistry({readResources:()=>({physical_start_allowed:headroom>0,memory_headroom:headroom})});
 for(let i=0;i<140;i++)r.create({url:'https://chatgpt.com/',role:'FLEET'});
 assert.equal(r.census().by_role.FLEET,140);headroom=0;
 assert.throws(()=>r.create({url:'https://chatgpt.com/',role:'FLEET'}),/tab_capacity_exceeded/);
 assert.equal(r.census().total_at_wall,true);headroom=10;
 r.create({url:'https://chatgpt.com/',role:'FLEET'});assert.equal(r.census().by_role.FLEET,141);
});

test('tab role is validated at creation and immutable through updates', () => {
  const r = new TabRegistry({readResources:()=>({physical_start_allowed:true,memory_headroom:8})});
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
  const r = new TabRegistry({readResources:()=>({physical_start_allowed:true,memory_headroom:8})});
  const a = r.create({ url: 'https://example.com/' });
  assert.equal(a.role, 'USER');
  assert.equal(r.census().by_kind.USER_WEB, 1);
  const b = r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT' });
  assert.equal(b.role, 'USER');
  assert.equal(r.census().by_kind.CHATGPT, 1);
  assert.deepEqual(r.census().fleet_tab_ids, []);
});
