import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createCodexCliLaunch,validateCodexCliLaunch,validateCodexCliJoinedSettlement,validateCodexCliProtectedSettlement,codexCliLocalOutputDrain} from '../src/codex-cli-physical-settlement.mjs';
import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const binding={task_id:randomUUID(),agent_id:'agent_fixture-12345678',base_sha:'a'.repeat(40),lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER'};
 const spec={runId:randomUUID(),args:['private argument','Unicode: Привет'],cwd:'/fixture/worktree',executablePath:'/fixture/codex.exe',
  expectedExecutableSha256:'b'.repeat(64),promptSha256:sha('private prompt'),timeoutMs:1000,binding};
 const generated=joinedSettlementFixture(spec),result=generated.complete();
 const receipt={schema:'metaengine.codex-cli.run-receipt.v1',...binding,run_id:spec.runId,launch_identity:generated.proof.launch,process:generated.proof,process_result:result,
  physical_settlement:result.joined_settlement,local_output_drain:codexCliLocalOutputDrain(result.joined_settlement),state:'RESULT_READY',prompt_sha256:spec.promptSha256,executable_sha256:spec.expectedExecutableSha256,worktree_path:spec.cwd};
 return {spec,...generated,result,receipt,processReceipt:structuredClone(receipt)};
}
test('launch digest uses exact canonical bytes, preserves unicode/argv, never serializes prompt or environment',()=>{
 const f=fixture(),launch=createCodexCliLaunch({...f.spec,env:{PRIVATE_TOKEN:'never serialize'},prompt:'private prompt'});
 assert.equal(launch.request_sha256,sha(launch.canonical_body));assert.deepEqual(validateCodexCliLaunch(launch).args,f.spec.args);
 assert.ok(!JSON.stringify(launch).includes('never serialize'));assert.ok(!JSON.stringify(launch).includes('private prompt'));
 const changed={...launch,canonical_body:launch.canonical_body+' '};assert.throws(()=>validateCodexCliLaunch(changed),/launch_digest/);
 changed.request_sha256=sha(changed.canonical_body);assert.throws(()=>validateCodexCliLaunch(changed),/launch_body/);
 assert.throws(()=>validateCodexCliLaunch(launch,{...f.spec,args:['changed']}),/launch_spec_changed/);
});
test('full joined fixture verifies as data only; old receipt is explicitly no proof',()=>{
 const f=fixture();assert.deepEqual(validateCodexCliJoinedSettlement(f.result.joined_settlement,{proof:f.proof,launch:f.launch}),f.result.joined_settlement);
 assert.deepEqual(validateCodexCliProtectedSettlement(f.receipt,f),f.result.joined_settlement);
 assert.equal(validateCodexCliProtectedSettlement({schema:'metaengine.codex-cli.run-receipt.v1',process_result:{tree_cleanup_confirmed:true}}),null);
 assert.throws(()=>validateCodexCliJoinedSettlement({tree_cleanup_confirmed:true},{proof:f.proof}),/joined_shape/);
});
for(const [name,mutate] of [
 ['wrong launch bytes',f=>{f.launch={...f.launch,request_sha256:'f'.repeat(64)};}],
 ['missing pre-spawn record',f=>{f.launch=null;}],
 ['changed pre-resume process record',f=>{f.processReceipt.process.helper_sha256='f'.repeat(64);}],
 ['different lease generation',f=>{f.receipt.lease_generation++;}],
 ['different original role',f=>{f.processReceipt.role='CRITIC';}],
 ['different worktree',f=>{f.receipt.worktree_path='/foreign';f.processReceipt.worktree_path='/foreign';}],
 ['forged prompt digest',f=>{f.receipt.prompt_sha256='f'.repeat(64);f.processReceipt.prompt_sha256='f'.repeat(64);}],
 ['forged all-effects cleanup',f=>{f.receipt.local_output_drain.all_effects_cleanup='CONFIRMED';}],
 ['erased Host uncertainty',f=>{f.receipt.local_output_drain.host_scope_callbacks='SETTLED';}],
 ['missing local output join',f=>{delete f.receipt.local_output_drain;}],
 ['missing success join',f=>{delete f.receipt.physical_settlement;}],
 ['explicit helper pin without prepared manifest',f=>{f.receipt.physical_settlement.runtime_manifest_sha256=null;f.receipt.process.runtime_manifest_sha256=null;f.processReceipt.process.runtime_manifest_sha256=null;f.receipt.local_output_drain=codexCliLocalOutputDrain(f.receipt.physical_settlement);}],
 ['parent only EXIT event',f=>{f.receipt.physical_settlement.parent_join.event='exit';}],
 ['helper close failure',f=>{f.receipt.physical_settlement.parent_join.exit_code=1;}],
 ['changed terminal bytes',f=>{f.receipt.physical_settlement.native_terminal.job_accounting.total_processes++;}],
])test('protected chain refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validateCodexCliProtectedSettlement(f.receipt,f));});
test('ambiguous receipt with no qualified parent join remains readable but unresolved',()=>{
 const f=fixture();f.receipt.state='AMBIGUOUS';delete f.receipt.physical_settlement;
 assert.equal(validateCodexCliProtectedSettlement(f.receipt,f),null);
});
