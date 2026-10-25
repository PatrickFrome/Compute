import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createRuntimeRecoveryMainController,runtimeRecoverySuccessorTicket} from '../src/runtime-recovery-main.mjs';
function fixture({argv=[],prepareReason=null}={}){
  const host_pid=321,instance_id=randomUUID(),launch_nonce=randomUUID(),ticket=randomUUID(),events=[];
  let generation={schema:'metaengine.browser.runtime-host-generation.v1',host_pid,instance_id,launch_nonce,ever_ready:true,
    exited:false,stopping:false,transport_failed:false,terminal:null,terminal_rejected:false,cleanup_confirmed:false,authority_effect:false};
  let observer,timer;
  const transaction={arm:async()=>{events.push('arm');return {state:'ARMED'};},prepare:async()=>{events.push('prepare');return {state:'PREPARED',ticket_id:ticket,not_before_ms:105000,reason:prepareReason};},
    dispatch:async value=>{assert.equal(value,ticket);events.push('dispatch');return {state:'REQUESTED'};},
    acknowledgeSuccessor:async value=>{events.push('ack:'+value);return {state:'CONFIRMED'};},cancel:()=>events.push('cancel')};
  const controller=createRuntimeRecoveryMainController({app:{},readBinding:async()=>({}),readGate:async()=>({}),drain:async()=>({}),
    beforeRelaunch:async()=>{},fenceNative:()=>events.push('fence'),readGeneration:async()=>structuredClone(generation),argv,
    subscribeGeneration:fn=>{observer=fn;fn(generation);return()=>events.push('unsubscribe');},transactionFactory:()=>transaction,
    now:()=>100000,setTimer:(fn,delay)=>{events.push('timer:'+delay);timer=fn;return {unref(){}};},clearTimer:()=>{timer=null;events.push('clear');}});
  return {controller,events,get timer(){return timer;},emit:()=>observer(generation),
    fail:()=>{generation={...generation,exited:true,cleanup_confirmed:true,terminal:{schema:'compute.runtime-host-terminal.v1',host_pid,instance_id,launch_nonce,
      state:'STOPPED',children_stopped:true,ownership_released:true,reason:'runtime_health_failed',authority_effect:false},
      health_witness:{schema:'metaengine.browser.runtime-recovery-health-witness.v1',host_pid,instance_id,launch_nonce,bundle_sha256:'c'.repeat(64),
        status_sha256:'e'.repeat(64),stopped_at:new Date().toISOString(),failure:{schema:'metaengine.client-state.health-failure.v1',
          code:'health_timeout',component:'edge',consecutive_failures:3,http_status:null,authority_effect:false},authority_effect:false}};},
    http503:()=>{generation.health_witness.failure={...generation.health_witness.failure,code:'health_http_failed',http_status:503};}};
}
test('main fences issuance synchronously, then schedules exactly one durable transaction per failed generation',async()=>{
  const f=fixture();await f.controller.start();assert.equal(f.events.filter(v=>v==='arm').length,1);
  f.fail();f.emit();assert.equal(f.events.at(-1),'fence');await f.controller.settled();
  f.emit();await f.controller.settled();assert.equal(f.events.filter(v=>v==='prepare').length,1);assert.ok(f.events.includes('timer:5000'));
  f.timer();await f.controller.settled();assert.equal(f.events.filter(v=>v==='dispatch').length,1);
});
test('503 is held and cancellation removes a scheduled relaunch',async()=>{
  const held=fixture();await held.controller.start();held.fail();held.http503();held.emit();await held.controller.settled();
  assert.ok(held.events.includes('fence'));assert.ok(!held.events.includes('prepare'));
  const f=fixture();await f.controller.start();f.fail();f.emit();await f.controller.settled();const scheduled=f.timer;
  f.controller.cancel();scheduled();await f.controller.settled();assert.ok(!f.events.includes('dispatch'));assert.ok(f.events.includes('clear'));
});
test('fresh normal bootstrap acknowledges the sole selector before arming, never dispatches an old effect',async()=>{
  const ticket=randomUUID(),f=fixture({argv:['--metaengine-runtime-recovery='+ticket]});await f.controller.start();
  assert.deepEqual(f.events.slice(0,2),['ack:'+ticket,'arm']);assert.ok(!f.events.includes('dispatch'));
  assert.equal(runtimeRecoverySuccessorTicket([]),null);
  assert.throws(()=>runtimeRecoverySuccessorTicket(['--metaengine-runtime-recovery=bad']),/selector_invalid/);
  assert.throws(()=>runtimeRecoverySuccessorTicket(Array(2).fill('--metaengine-runtime-recovery='+ticket)),/selector_invalid/);
});
test('a prior unresolved intent never gets a main timer',async()=>{
  const f=fixture({prepareReason:'PRIOR_EFFECT_UNRESOLVED'});await f.controller.start();f.fail();f.emit();await f.controller.settled();
  assert.equal(f.timer,undefined);assert.ok(!f.events.includes('dispatch'));
});
