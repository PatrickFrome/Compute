import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {qualifyOwnerBackedActivationWave,OWNER_BACKED_ACTIVATION_WAVE_SCHEMA}
  from '../scripts/qa-owner-backed-activation-wave.mjs';

function fixture({tamper=null}={}){
  const pid=8124,version='0.7.0-dev.1107139874581.1',windowId=102;
  const journal={current_boot_id:'boot-native-001',current_pid:pid,current_version:version,
    events:[]};
  let sequence=10,n=0;
  const activate=async()=>{
    n++;
    const index=n;
    const launch_id=randomUUID(),event_sequence=++sequence;
    const ack={schema:'metaengine.browser.secondary-launch.v1',
      state:'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED',primary_pid:pid,primary_version:version,
      launch_id,event_sequence,second_browser_runtime_started:false,authority_effect:false};
    journal.events.push({boot_id:journal.current_boot_id,pid,version,
      state:'PRIMARY_WINDOW_ACTIVATED',sequence:event_sequence,
      details:{launch_id,window_id:windowId,visible:true}});
    return tamper?.(ack,journal,index) || ack;
  };
  const options={activate,readJournal:async()=>journal,
    inspectWindow:async()=>({pid,handle:'12345',visible:true,minimized:false,
      width:1440,height:960,authority_effect:false}),
    pid,version,windowId,sequentialCount:4,concurrentCount:3,
    p95BudgetMs:1000,concurrentBudgetMs:8000};
  return {options,journal};
}
test('real Owner-backed wave checks every nonce and durable window event',async()=>{
  const {options}=fixture();
  const receipt=await qualifyOwnerBackedActivationWave(options);
  assert.equal(receipt.schema,OWNER_BACKED_ACTIVATION_WAVE_SCHEMA);
  assert.equal(receipt.owner_backed_activation_wave_verified,true);
  assert.equal(receipt.total_activations,7);
  assert.equal(receipt.sequential_activations,4);
  assert.equal(receipt.concurrent_activations,3);
  assert.equal(receipt.unique_nonce_count,7);
  assert.equal(receipt.unique_durable_sequence_count,7);
  assert.equal(receipt.same_native_window_verified,true);
  assert.equal(receipt.production_ready,false);
  assert.equal(receipt.authority_effect,false);
});
test('duplicate, forged, wrong pid or cross-window ACK cannot be qualified',async()=>{
  for(const tamper of [
    (ack,_journal,index)=>index===2?{...ack,primary_pid:4242}:ack,
    (ack,_journal,index)=>index===2?{...ack,authority_effect:true}:ack,
    (ack,journal,index)=>{if(index===2)journal.events.at(-1).details.visible=false;return ack;},
    (ack,journal,index)=>{if(index===2)journal.events.at(-1).details.window_id=77;return ack;},
    (ack,journal,index)=>{if(index===2)journal.events.at(-1).boot_id='stale';return ack;},
  ]){
    const {options}=fixture({tamper});
    await assert.rejects(qualifyOwnerBackedActivationWave(options),
      /owner_backed_activation_wave_(secondary_receipt_unverified|durable_activation_missing)/);
  }
});
test('native window must remain same-identity, real and visibly qualified',async()=>{
  const f=fixture();
  for(const modified of [
    {pid:1},{visible:false},{minimized:true},{width:200},{handle:null},
    {authority_effect:true},
  ]){
    await assert.rejects(qualifyOwnerBackedActivationWave({
      ...fixture().options,inspectWindow:async()=>({
        pid:f.options.pid,handle:'12345',visible:true,minimized:false,
        width:1440,height:960,authority_effect:false,...modified})
    }),/owner_backed_activation_wave_native_window_not_stable/);
  }
});
test('readback cannot waive latency or burst budgets',async()=>{
  await assert.rejects(qualifyOwnerBackedActivationWave({
    ...fixture().options,p95BudgetMs:100,clock:(()=>{let t=0;return ()=>{t+=101;return t;};})(),
  }),/owner_backed_activation_wave_activation_latency_budget_exceeded/);
  await assert.rejects(qualifyOwnerBackedActivationWave({
    ...fixture().options,concurrentBudgetMs:100,clock:(()=>{let t=0;return ()=>{t+=101;return t;};})(),
  }),/owner_backed_activation_wave_(activation_latency_budget_exceeded|burst_budget_exceeded)/);
});
test('72 activation wave stops at the fourth slow sample and still permits exactly three',async()=>{
  for(const slowLimit of [3,4]){
    const f=fixture(); let now=0,calls=0;
    const activate=async()=>{const ack=await f.options.activate(); if(++calls<=slowLimit)now+=1001; return ack;};
    const run=()=>qualifyOwnerBackedActivationWave({...f.options,activate,
      sequentialCount:64,concurrentCount:8,clock:()=>now});
    if(slowLimit===4){
      await assert.rejects(run(),/owner_backed_activation_wave_activation_latency_budget_exceeded/);
      assert.equal(calls,4,'remaining physical secondary launches must not run after P95 is impossible');
    }else{
      const receipt=await run(); assert.equal(calls,72); assert.equal(receipt.total_activations,72);
      assert.equal(receipt.activation_p95_ms,0);
    }
  }
});
test('invalid callbacks and missing exact native identities fail before activation',async()=>{
  await assert.rejects(qualifyOwnerBackedActivationWave({
    ...fixture().options,windowId:null}),/owner_backed_activation_wave_arguments_invalid/);
  await assert.rejects(qualifyOwnerBackedActivationWave({
    ...fixture().options,concurrentCount:0}),/owner_backed_activation_wave_arguments_invalid/);
});
