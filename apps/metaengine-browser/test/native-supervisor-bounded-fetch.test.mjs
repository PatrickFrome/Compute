import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedSupervisorFetch } from '../src/native-supervisor-client.mjs';

function hangingFetch(_url,{signal}={}){
  return new Promise((_resolve,reject)=>{
    signal?.addEventListener('abort',()=>reject(signal.reason || new Error('aborted')),{once:true});
  });
}

test('pre-effect supervisor requests have a bounded network wait', async () => {
  const fetchImpl=createBoundedSupervisorFetch(hangingFetch,{deadlineMs:20});
  await assert.rejects(fetchImpl('https://example.invalid/v1/state',{method:'POST'}),/deadline|abort/i);
});

test('command result delivery aborts on the generous result deadline, not the short request deadline (F-L1b)', async () => {
  // deadlineMs is tiny (clamps to 1000ms minimum) while the result deadline uses
  // its own 10000ms minimum clamp: the receipt must outlive the request deadline
  // by far, then abort — a wedged result POST may no longer black-hole the
  // steady-state command lease loop forever (observed live).
  const fetchImpl=createBoundedSupervisorFetch(hangingFetch,{deadlineMs:1000,resultDeliveryDeadlineMs:10000});
  const started=Date.now();
  await assert.rejects(
    fetchImpl('https://example.invalid/v1/commands/00000000-0000-4000-8000-000000000001/result',{method:'POST'}),
    /result_delivery_deadline|abort/i,
  );
  const waited=Date.now()-started;
  assert.ok(waited>=9500,`aborted too early (${waited}ms) — request deadline leaked into the result path`);
  assert.ok(waited<15000,`aborted too late (${waited}ms)`);
});

test('command result batch delivery uses the same generous deadline (F-L1b)', async () => {
  const fetchImpl=createBoundedSupervisorFetch(hangingFetch,{deadlineMs:1000,resultDeliveryDeadlineMs:10000});
  const started=Date.now();
  await assert.rejects(
    fetchImpl('https://example.invalid/v1/commands/result-batch',{method:'POST'}),
    /result_delivery_deadline|abort/i,
  );
  const waited=Date.now()-started;
  assert.ok(waited>=9500,`aborted too early (${waited}ms)`);
});

test('an explicit caller-provided signal is honored verbatim', async () => {
  let receivedSignal='unset';
  const raw=async(_url,init={})=>{receivedSignal=init.signal ?? null;return {ok:true,status:200};};
  const fetchImpl=createBoundedSupervisorFetch(raw,{deadlineMs:20});
  const controller=new AbortController();
  await fetchImpl('https://example.invalid/v1/commands/00000000-0000-4000-8000-000000000002/result',{method:'POST',signal:controller.signal});
  assert.equal(receivedSignal,controller.signal);
});

test('result delivery outlives the short request deadline by an order of magnitude', async () => {
  let stateAborted=null;
  const raw=async(_url,init={})=>{
    await new Promise((_resolve,reject)=>{
      init.signal?.addEventListener('abort',()=>reject(init.signal.reason||new Error('aborted')),{once:true});
    });
  };
  const fetchImpl=createBoundedSupervisorFetch(raw,{deadlineMs:1000,resultDeliveryDeadlineMs:10000});
  const t0=Date.now();
  const statePromise=fetchImpl('https://example.invalid/v1/state',{method:'POST'}).catch((e)=>{stateAborted=Date.now()-t0;throw e;});
  await assert.rejects(statePromise,/deadline|abort/i);
  assert.ok(stateAborted<3000,`state request waited ${stateAborted}ms — should use the short request deadline`);
  // The result path must still be pending when the state path has already aborted.
  let resultSettled=false;
  const resultPromise=fetchImpl('https://example.invalid/v1/commands/00000000-0000-4000-8000-000000000003/result',{method:'POST'})
    .catch(()=>{}).then(()=>{resultSettled=true;});
  await new Promise((resolve)=>setTimeout(resolve,1500));
  assert.equal(resultSettled,false,'result request must not use the short request deadline');
  await resultPromise;
});
