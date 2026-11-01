import test from 'node:test';
import assert from 'node:assert/strict';
import * as consumer from './native-coding-setup-job-drain.mjs';

test('setup job drain seam exposes only one-use consumption and no issuer or authority factory',()=>{
 assert.deepEqual(Object.keys(consumer),['consumeNativeSetupJobDrain']);
});
test('serialized identifiers, drain promises and readiness flags cannot reconstruct actual setup job ownership',()=>{
 for(const value of [undefined,null,true,{},Object.freeze({}),
  {operationId:'00000000-0000-4000-8000-000000000001',custodyId:'00000000-0000-4000-8000-000000000002',cleanup_confirmed:true},
  {job_joined:true,scope_joined:true,native_qualified:true,readiness:true,verified:true},
  Promise.resolve({cleanup_confirmed:true})]){
  assert.throws(()=>consumer.consumeNativeSetupJobDrain(value),/original_job_drain_required/);
 }
});
