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

test('command result delivery is not locally timed out before ambiguous receipt readback exists', async () => {
  let sawSignal='unset';
  const raw=async(_url,init={})=>{sawSignal=init.signal ?? null;return {ok:true,status:200};};
  const fetchImpl=createBoundedSupervisorFetch(raw,{deadlineMs:20});
  await fetchImpl('https://example.invalid/v1/commands/00000000-0000-4000-8000-000000000001/result',{method:'POST'});
  assert.equal(sawSignal,null);
});
