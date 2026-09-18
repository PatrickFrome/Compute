import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RsiCommandAttributionRegistry,
  createRsiCommandAttributionBinding,
  verifyRsiCommandAttributionBinding,
  rsiCommandAttributionTrustRootSnapshot,
} from '../src/rsi-command-attribution-registry.mjs';

const SOURCE='a'.repeat(40);
const COMMAND='11111111-1111-4111-8111-111111111111';
const d=(c)=>`sha256:${c.repeat(64)}`;

function binding(overrides={}){
  return {
    command_id:COMMAND,
    action:'SCROLL',
    platform:'CHATGPT',
    effect_key:'effect-1',
    task_id:'task.rsi.canary.1',
    task_signature_digest:d('1'),
    environment_fingerprint:'env.browser.chatgpt.v1',
    model_family:'GPT_5_6_SOL',
    runtime_candidate_id:'candidate.runtime.1',
    candidate_digest:'b'.repeat(64),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('2'),
    skill_digests:[d('3'),d('4')],
    external_planner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('binding derives immutable learning candidate identity from candidate record digest',()=>{
  const row=createRsiCommandAttributionBinding({source_sha:SOURCE,bound_at:'2026-09-18T17:00:00.000Z',...binding()});
  verifyRsiCommandAttributionBinding(row);
  assert.equal(row.candidate_id,`candidate_sha256_${'b'.repeat(64)}`);
  assert.equal(row.runtime_candidate_id,'candidate.runtime.1');
  assert.equal(row.binding_is_effect_authority,false);
  assert.equal(row.candidate_can_edit_binding,false);
  assert.equal(row.raw_command_payload_stored,false);
  assert.equal(row.authority_effect,false);
});

test('candidate-authored or partial authority-bearing attribution is rejected',()=>{
  assert.throws(()=>createRsiCommandAttributionBinding({
    source_sha:SOURCE,bound_at:'2026-09-18T17:00:00.000Z',...binding({external_planner:false,authored_by_candidate:true}),
  }),/external_planner_required/);
  const row=createRsiCommandAttributionBinding({source_sha:SOURCE,bound_at:'2026-09-18T17:00:00.000Z',...binding()});
  assert.throws(()=>verifyRsiCommandAttributionBinding({...row,execution_authority:true}),/execution_authority_invalid/);
});

test('registry persists exact binding, reloads it, and rejects command-id rebinding',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-attribution-'));
  const statePath=path.join(root,'registry.json');
  let now=1_800_000_000_000;
  try{
    const registry=new RsiCommandAttributionRegistry({statePath,source_sha:SOURCE,clock:()=>now});
    await registry.init();
    const first=await registry.bind(binding());
    assert.equal(first.state,'BOUND');
    assert.equal(registry.snapshot().pending_count,1);
    const exact=registry.resolve({command_id:COMMAND,action:'SCROLL',platform:'CHATGPT',effect_key:'effect-1'});
    assert.equal(exact.binding_digest,first.binding_digest);
    await assert.rejects(()=>registry.bind(binding({proposal_digest:d('9')})),/command_rebind_forbidden/);

    const restored=new RsiCommandAttributionRegistry({statePath,source_sha:SOURCE,clock:()=>now});
    await restored.init();
    assert.equal(restored.snapshot().pending_count,1);
    assert.equal(restored.resolve({command_id:COMMAND,action:'SCROLL',platform:'CHATGPT',effect_key:'effect-1'}).binding_digest,first.binding_digest);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('runtime action/platform/effect binding mismatch fails closed instead of lending candidate credit',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-attribution-mismatch-'));
  try{
    const registry=new RsiCommandAttributionRegistry({statePath:path.join(root,'registry.json'),source_sha:SOURCE});
    await registry.init();await registry.bind(binding());
    assert.throws(()=>registry.resolve({command_id:COMMAND,action:'TYPED_CLICK',platform:'CHATGPT',effect_key:'effect-1'}),/runtime_binding_mismatch/);
    assert.throws(()=>registry.resolve({command_id:COMMAND,action:'SCROLL',platform:'CHATGPT',effect_key:'other-effect'}),/runtime_binding_mismatch/);
    assert.equal(registry.snapshot().pending_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('consumption is durable, exact-episode idempotent, and conflicting replay is rejected',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-attribution-consume-'));
  const statePath=path.join(root,'registry.json');
  let now=1_800_000_000_000;
  try{
    const registry=new RsiCommandAttributionRegistry({statePath,source_sha:SOURCE,clock:()=>now});
    await registry.init();await registry.bind(binding());
    now+=1000;
    const consumed=await registry.consume({command_id:COMMAND,episode_digest:d('5')});
    assert.equal(consumed.state,'CONSUMED');
    assert.equal(consumed.consumed_episode_digest,d('5'));
    assert.equal(registry.resolve({command_id:COMMAND,action:'SCROLL',platform:'CHATGPT',effect_key:'effect-1'}),null);
    const same=await registry.consume({command_id:COMMAND,episode_digest:d('5')});
    assert.equal(same.consumed_episode_digest,d('5'));
    await assert.rejects(()=>registry.consume({command_id:COMMAND,episode_digest:d('6')}),/consumed_episode_conflict/);

    const restored=new RsiCommandAttributionRegistry({statePath,source_sha:SOURCE,clock:()=>now});
    await restored.init();
    assert.equal(restored.snapshot().consumed_count,1);
    assert.equal(restored.snapshot().pending_count,0);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('trust root makes command attribution evidence-only and zero authority',()=>{
  const root=rsiCommandAttributionTrustRootSnapshot();
  assert.equal(root.exact_command_binding_required,true);
  assert.equal(root.external_planner_required,true);
  assert.equal(root.candidate_can_write_registry,false);
  assert.equal(root.binding_is_effect_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.scheduler_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.attribution_root_digest,/^sha256:[0-9a-f]{64}$/);
});
