import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientRuntimeResource, readClientRuntimePair } from './client-runtime-resource.ts';

// These are renderer contract inputs, not receipts from a running Owner.
const observation = () => ({
  connection: {
    schema: 'metaengine.client.connection-status.v1', local_runtime_ready: true,
    admin_ready: true, cloud_control_state: 'CONNECTED', authority_effect: false,
  },
  work: {
    schema: 'metaengine.client.work-readiness.v1', observed_at: new Date().toISOString(),
    state: 'READY', reason: null, label: 'Ready for work', detail: 'Results require independent review.',
    execution_ready: true, readiness_scope: 'CHAT_DISPATCH', heartbeat_fresh: true,
    capabilities: {
      chat_dispatch: { ready: true, reason: null },
      coding_execution: { ready: false, reason: 'CODING_BACKEND_NOT_EXECUTABLE' },
      host_continuity: { ready: false, reason: 'GUARDIAN_CONTINUITY_NOT_PROVEN' },
      continuous_autonomy: { ready: false, reason: 'CODING_BACKEND_NOT_EXECUTABLE' },
    },
    continuous_autonomy_ready: false, generation_floor: 28, local_generation_floor: 28,
    proven_agent_count: 1, useful_work_verified: false, verified_self_improvement: false,
    recovery_effect_exposed: false, scheduler_authority: false,
    automatic_retry_allowed: false, authority_effect: false,
  },
});

function resource(t, read) {
  const timers = new Map();
  let id = 0;
  const value = createClientRuntimeResource({
    read, isVisible: () => true, onVisibilityChange: () => () => {},
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    cancel: timer => timers.delete(timer),
  });
  const stop = value.subscribe(() => {});
  t.after(stop);
  return value;
}

test('a fresh READY work read cannot override an unavailable local Owner read', async t => {
  const next = observation();
  next.connection.local_runtime_ready = false;
  const value = resource(t, async () => next);
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
});

test('loss of local Owner clears a previously ready observation', async t => {
  const next = observation();
  const value = resource(t, async () => structuredClone(next));
  await value.refresh();
  assert.equal(value.getSnapshot().readback.work.execution_ready, true);
  next.connection.local_runtime_ready = false;
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
  next.connection.local_runtime_ready = true;
  next.work.observed_at = new Date().toISOString();
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  assert.equal(value.getSnapshot().readback.work.execution_ready, true);
});

test('an explanatory BLOCKED observation remains visible when local Owner is unavailable', async t => {
  const next = observation();
  next.connection.local_runtime_ready = false;
  Object.assign(next.work, {
    state: 'BLOCKED', execution_ready: false, heartbeat_fresh: false,
    reason: 'LOCAL_RUNTIME_NOT_READY', label: 'Waiting for local runtime',
  });
  next.work.capabilities.chat_dispatch = { ready: false, reason: 'LOCAL_RUNTIME_NOT_READY' };
  const value = resource(t, async () => next);
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  assert.equal(value.getSnapshot().readback.work.reason, 'LOCAL_RUNTIME_NOT_READY');
  assert.equal(value.getSnapshot().readback.work.execution_ready, false);
});

test('an IPC failure remains unavailable and cannot be hidden by prior valid readiness', async t => {
  let fail = false;
  const value = resource(t, async () => {
    if (fail) throw new Error('owner_connection_lost');
    return observation();
  });
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  fail = true;
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
});

test('timed out native read retains its physical in-flight slot until settlement',async t=>{
 const timers=new Map();let id=0,calls=0,resolveRead;
 const gate=new Promise(resolve=>{resolveRead=resolve;});
 const value=createClientRuntimeResource({read:()=>{calls++;return calls===1?gate:Promise.resolve(observation());},
 isVisible:()=>true,onVisibilityChange:()=>()=>{},schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:key=>timers.delete(key)});
 const stop=value.subscribe(()=>{});t.after(stop);
 const pending=value.refresh();await Promise.resolve();assert.equal(calls,1);
 const timeout=[...timers.values()].find(v=>v.ms===4000);assert.ok(timeout);timeout.fn();await pending;
 assert.equal(value.getSnapshot().state,'UNAVAILABLE');
 await value.refresh();await value.refresh();assert.equal(calls,1,'deadline must not create overlapping physical reads');
 resolveRead(observation());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(value.getSnapshot().state,'UNAVAILABLE','late success must not publish READY');
 await value.refresh();assert.equal(calls,2);assert.equal(value.getSnapshot().state,'LIVE');
});


test('a failed connection read joins its pending work-readiness sibling before releasing the slot',async()=>{
 let finish,settled=false,reads=0;
 const gate=new Promise(resolve=>{finish=resolve;});
 const pending=readClientRuntimePair(()=>{reads++;throw Error('private diagnostic');},()=>{reads++;return gate;});
 const outcome=pending.then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);assert.equal(settled,false);
 finish(observation().work);const error=await outcome;assert.equal(error.message,'client_runtime_observation_failed');
 assert.doesNotMatch(error.message,/private diagnostic/);
});

test('visibility and resubscription cannot restart or publish an old timed-out read',async()=>{
 const timers=new Map();let id=0,calls=0,visible=true,change,finish;
 const gate=new Promise((_,reject)=>{finish=reject;});
 const value=createClientRuntimeResource({read:()=>{calls++;return calls===1?gate:Promise.resolve(observation());},
 isVisible:()=>visible,onVisibilityChange:fn=>{change=fn;return ()=>{};},
 schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:key=>timers.delete(key)});
 let stop=value.subscribe(()=>{});const pending=value.refresh();await Promise.resolve();
 visible=false;change();visible=true;change();assert.equal(calls,1);assert.equal(value.getSnapshot().state,'UNAVAILABLE');
 [...timers.values()].find(v=>v.ms===4000).fn();await pending;
 stop();stop=value.subscribe(()=>{});await value.refresh();assert.equal(calls,1);
 finish(Error('late failure'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(value.getSnapshot().state,'UNAVAILABLE');assert.equal(calls,1);
 await value.refresh();assert.equal(calls,2);assert.equal(value.getSnapshot().state,'LIVE');
 stop();assert.equal(timers.size,0);
});
