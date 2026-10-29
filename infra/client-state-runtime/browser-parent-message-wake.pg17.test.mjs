import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyFreshSchemaNative} from './test/fresh-schema-disposable.mjs';
import {exerciseBrowserParentSuspension} from './test/browser-parent-suspension-fixture.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;

test('native PG17 resumes a message-addressed parent while child work is still open',{
  skip:!bin||!driver?'Native PG17 binaries/driver absent':false,timeout:240000,
 },async()=>{
  const receipt=await qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE,exercise:async({sql})=>{
   await exerciseBrowserParentSuspension({q:(s,a=[])=>sql.unsafe(s,a),exec:s=>sql.unsafe(s),messageWake:true});
   return {status:'MESSAGE_WAKE_SQL_PASSED',installed_client_qualified:false};
  }});
  assert.equal(receipt.test_exercise.status,'MESSAGE_WAKE_SQL_PASSED');
 });
