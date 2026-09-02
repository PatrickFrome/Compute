import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeWorkspaceBindingSnapshot, unavailableWorkspaceBindingSnapshot } from '../src/workspace-binding-observer.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migration=fs.readFileSync(path.resolve(root,'../../supabase/migrations/20260902090000_a2_workspace_binding_snapshot_v1.sql'),'utf8');
const wrapper=fs.readFileSync(path.join(root,'src/native-supervisor-client.mjs'),'utf8');
const UUID='11111111-1111-4111-8111-111111111111';
const TASK='22222222-2222-4222-8222-222222222222';
const row=()=>({workspace_id:UUID,workspace_generation:2,coordination_workspace_id:'33333333-3333-4333-8333-333333333333',task_id:TASK,claim_id:7,point_id:'c5',repo_id:'PatrickFrome/Compute',base_sha:'a'.repeat(40),branch_name:'work/example',agent_id:'agent_12345678',tab_id:'tab_44444444-4444-4444-8444-444444444444',target_id:'webcontents:9',agent_generation_epoch:3,lease_generation:4,lease_expires_at:'2026-09-02T12:00:00.000Z',lease_current:true,state:'READY',last_verified_head_sha:'a'.repeat(40),ambiguity_code:null,dirty_hold:false,updated_at:'2026-09-02T10:00:00.000Z',automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,page_data_authority:false,authority_effect:false});
const envelope=(binding=row())=>({schema:'metaengine.devos.workspace-binding-snapshot.v1',state:'AVAILABLE',coordination_workspace_id:binding.coordination_workspace_id,observed_at:'2026-09-02T10:00:01.000Z',bindings:[binding],filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false});

test('workspace observer accepts exact bounded non-authority snapshot',()=>{
  const out=normalizeWorkspaceBindingSnapshot(envelope());
  assert.equal(out.state,'AVAILABLE');
  assert.equal(out.bindings.length,1);
  assert.equal(out.bindings[0].lease_generation,4);
  assert.equal(out.runtime_deployed,true);
  assert.equal(out.second_polling_loop,false);
});

test('workspace observer rejects path leakage and malformed authority flags',()=>{
  assert.equal(normalizeWorkspaceBindingSnapshot(envelope({...row(),worktree_path:'C:/secret'})),null);
  assert.equal(normalizeWorkspaceBindingSnapshot(envelope({...row(),scheduler_authority:true})),null);
  assert.equal(normalizeWorkspaceBindingSnapshot(envelope({...row(),automatic_retry_allowed:true})),null);
});

test('workspace unavailable states never invent deployment or authority',()=>{
  const out=unavailableWorkspaceBindingSnapshot('RUNTIME_NOT_DEPLOYED','missing rpc');
  assert.equal(out.runtime_deployed,false);
  assert.equal(out.bindings.length,0);
  assert.equal(out.browser_actuation_authority,false);
  assert.equal(out.automatic_retry_allowed,false);
});

test('snapshot migration is bounded service-role-only and omits filesystem topology',()=>{
  assert.match(migration,/security definer/i);
  assert.match(migration,/set search_path = public, pg_temp/i);
  assert.match(migration,/limit 64/i);
  assert.match(migration,/revoke all on function public\.h205f22_a2_workspace_binding_snapshot_v1\(uuid\) from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function public\.h205f22_a2_workspace_binding_snapshot_v1\(uuid\) to service_role/i);
  for(const key of ['repo_root','managed_root','worktree_path','worktree_realpath']) assert.doesNotMatch(migration,new RegExp(`'${key}'\\s*,`,'i'));
  assert.doesNotMatch(migration,/\binsert\s+into\s+public\.compute_fabric_a2_workspace_binding_h205f22/i);
  assert.doesNotMatch(migration,/\bupdate\s+public\.compute_fabric_a2_workspace_binding_h205f22/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.compute_fabric_a2_workspace_binding_h205f22/i);
});

test('native wrapper adds observation to existing cycle and creates no polling loop',()=>{
  assert.match(wrapper,/await super\.cycle\(\)/);
  assert.match(wrapper,/await this\.#observeWorkspaceBindings\(\)/);
  assert.match(wrapper,/workspace_binding_second_polling_loop:\s*false/);
  assert.doesNotMatch(wrapper,/setInterval\s*\(/);
  assert.doesNotMatch(wrapper,/setTimeout\s*\(/);
  assert.doesNotMatch(wrapper,/FLEET_RECONCILE|GATE_DISABLE|TYPED_CLICK|SEMANTIC_TYPE/);
});
