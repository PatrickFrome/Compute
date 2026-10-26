import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runContinuationSourceFixture,hash} from './fixtures/project-continuation-support.mjs';

test('continuation acceptance exercises useful bytes, independent critic, process loss and durable no-replay fences',async t=>{
  const parent=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(parent,'project-continuation-acceptance-'));
  t.after(async()=>{assert.equal(await fs.realpath(directory),directory);await fs.rm(directory,{recursive:true,force:false});});
  const recorded=[],result=await runContinuationSourceFixture({directory,onCheck:async row=>recorded.push(row)});
  assert.equal(recorded.length,10);assert.ok(recorded.every(row=>row.status==='PASS'));
  assert.equal(hash(await fs.readFile(path.join(directory,result.useful_result.path))),result.useful_result.artifact_sha256);
  assert.equal(result.native_end_to_end_proven,false);assert.equal(result.installed_physical_proven,false);
  const hold=recorded.find(row=>row.name==='git_complete_before_sql_intent_retains_hold');
  assert.equal(hold.evidence.state,'HOLD');assert.equal(hold.evidence.successor_admitted,false);
  assert.equal(hold.evidence.finish_checkpoint_dispatches,0);
});
