import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveOperatorContracts,LIVE_CONTRACT_SCHEMA} from '../src/live-operator-contracts.mjs';

function fixture() {
  let state=null,fail=false;
  const store={
    async load(){return structuredClone(state);},
    async save(next){if(fail)throw Error('disk_fault');state=structuredClone(next);}
  };
  return {store,get saved(){return structuredClone(state);},fail(next){fail=next;}};
}
const tightened=()=>({
  schema:LIVE_CONTRACT_SCHEMA,dispatch_enabled:false,max_batch_items:2,
  max_prompt_chars:3000,max_observe_parallelism:2,
  existing_draft:'DENY_EXISTING_DRAFT',require_verified_model:true
});
test('hot contract stages, switches, rolls back, and restarts without EXE changes',async()=>{
  const f=fixture(),p=new LiveOperatorContracts(f);
  await p.init();
  assert.equal(p.status().generation,0);
  assert.equal(p.contract.max_batch_items,8);
  const s=await p.stage({expected_generation:0,contract:tightened()});
  assert.equal(s.state,'STAGED');assert.equal(p.contract.dispatch_enabled,true);
  assert.throws(()=>p.activate({expected_generation:0,expected_sha256:'0'.repeat(64)}),/sha_mismatch/);
  const live=await p.activate({expected_generation:0,expected_sha256:s.staged_sha256});
  assert.equal(live.generation,1);assert.equal(live.dispatch_enabled,false);
  assert.equal(p.contract.max_batch_items,2);
  const reboot=new LiveOperatorContracts(f);
  await reboot.init();
  assert.equal(reboot.contract.require_verified_model,true);
  await assert.rejects(reboot.rollback({expected_generation:0}),/generation_mismatch/);
  const rolled=await reboot.rollback({expected_generation:1});
  assert.equal(rolled.generation,2);
  assert.equal(rolled.dispatch_enabled,true);
  assert.equal(reboot.contract.max_batch_items,8);
  assert.equal(rolled.event_count,2);
});
test('no loosening of bounded surface or arbitrary JS/execution injection',async()=>{
  const f=fixture(),p=new LiveOperatorContracts(f);await p.init();
  for(const bad of [
    {...tightened(),max_batch_items:9},
    {...tightened(),max_prompt_chars:20000},
    {...tightened(),max_observe_parallelism:5},
    {...tightened(),raw_code:'require("child_process")'},
    {...tightened(),existing_draft:'OVERWRITE_UNVERIFIED'}
  ]) {
    await assert.rejects(p.stage({expected_generation:0,contract:bad}),/invalid/);
  }
  assert.equal(p.status().active_sha256.length,64);
  assert.equal(p.status().generation,0);
});
test('stale generation and digest are rejected before promotion',async()=>{
  const f=fixture(),p=new LiveOperatorContracts(f);await p.init();
  await assert.rejects(p.stage({expected_generation:99,contract:tightened()}),/generation_mismatch/);
  const stage=await p.stage({expected_generation:0,contract:tightened()});
  await assert.rejects(p.activate({expected_generation:1,expected_sha256:stage.staged_sha256}),/generation_mismatch/);
  assert.equal(p.contract.dispatch_enabled,true);
});
test('post-prepare persistence uncertainty fences active dispatch across restart',async()=>{
  let writes=0;let state=null;
  const store={
    async load(){return structuredClone(state);},
    async save(next){writes++;if(writes===3)throw Error('lost_receipt');
      state=structuredClone(next);}
  };
  const p=new LiveOperatorContracts({store});await p.init();
  const s=await p.stage({expected_generation:0,contract:tightened()});
  await assert.rejects(p.activate({expected_generation:0,expected_sha256:s.staged_sha256}),/persistence_ambiguous/);
  assert.equal(p.status().dispatch_enabled,false);
  const reboot=new LiveOperatorContracts({store});
  await reboot.init();
  assert.equal(reboot.status().state,'RECONCILIATION_REQUIRED');
  assert.equal(reboot.status().dispatch_enabled,false);
  await assert.rejects(reboot.stage({expected_generation:0,contract:tightened()}),/reconciliation_required/);
  const conservative=await reboot.reconcile({expected_generation:0});
  assert.equal(conservative.state,'ACTIVE');
  assert.equal(conservative.dispatch_enabled,false);
  assert.equal(conservative.generation,1);
});
test('stored policy digest mismatch fails boot instead of silently falling back',async()=>{
  const f=fixture(),p=new LiveOperatorContracts(f);await p.init();
  const s=await p.stage({expected_generation:0,contract:tightened()});
  assert.equal(s.state,'STAGED');
  const corrupt=f.saved;
  corrupt.staged.value.max_batch_items=8;
  await f.store.save(corrupt);
  await assert.rejects(new LiveOperatorContracts(f).init(),/hash_invalid/);
});
