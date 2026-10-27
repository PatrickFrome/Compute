import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyFreshSchemaNative } from './test/fresh-schema-disposable.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN, driver=process.env.METAENGINE_PG_TEST_DRIVER;
test('canonical fresh schema candidate on factory-owned disposable native PG17', {skip:!bin||!driver,timeout:240000}, async()=>{
  const receipt=await qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE});
  assert.equal(receipt.production_qualified,false); assert.equal(receipt.native_identity_verified,true);
  console.log(JSON.stringify(receipt));
});
