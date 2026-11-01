import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyNativePhysicalTask} from './native-coding-physical-custody.mjs';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {codexCliLocalOutputDrain} from '../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import {nativePhysicalTaskFixture as fixture} from './test/fixtures/native-coding-physical-task-fixture.mjs';

const hash=letter=>letter.repeat(64),clone=value=>structuredClone(value);
function chain(f){
 let head='0'.repeat(64);
 f.journal.records.forEach((record,sequence)=>{record.sequence=sequence;record.previous_sha256=head;head=sha(record);});
 f.journal.projection.records=f.journal.records.length;f.journal.projection.head_sha256=head;
 return f;
}
function copyClosure(f){
 Object.assign(f.closure,{publication:clone(f.publication),receipt:clone(f.receipt),journal:clone(f.journal)});
 return f;
}
function rewriteCallback(f,mutate){
 const row=f.requests[0],payload=row.request.frame.payload;mutate(payload);
 row.request.request_sha256=sha(row.request.frame);row.terminal={...row.terminal,request_sha256:row.request.request_sha256};
 for(const record of f.journal.records){const e=record.event;if(e.request_id!==row.request.frame.request_id)continue;
  e.request_sha256=row.request.request_sha256;
  if(e.kind==='INTENT'){e.operation=payload.operation;e.job_binding_sha256=sha(payload.job_binding);}
  if(e.kind==='TERMINAL')e.terminal_sha256=sha(row.terminal);
 }
 chain(f);f.publication.cursor.head_sha256=sha(f.journal.records[f.publication.cursor.record_count-1]);
 return copyClosure(f);
}
const refuses=(f,pattern=/native_(?:physical_custody|host_settlement)|codex_cli_settlement/)=>assert.throws(()=>verifyNativePhysicalTask(copyClosure(f)),pattern);

test('full generated TASK joins original reserve, anchored callbacks and helper/local-output closure without changing receipts',()=>{
 const f=fixture(),before=clone(f);assert.equal(verifyNativePhysicalTask(f),sha(f.closure));assert.deepEqual(f,before);
 assert.equal(f.receipt.local_output_drain.scope,'HELPER_TREE_AND_LOCAL_OUTPUT');
 assert.equal(f.receipt.local_output_drain.host_scope_callbacks,'NOT_ATTESTED');
 assert.equal(f.receipt.local_output_drain.all_effects_cleanup,'UNCONFIRMED');
});
test('caller UNKNOWN remains UNKNOWN while independently joined physical settlement verifies',()=>{
 const f=fixture({outcome:'UNKNOWN'}),before=clone(f);
 assert.equal(verifyNativePhysicalTask(f),sha(f.closure));assert.deepEqual(f,before);
 assert.equal(f.journal.records.find(r=>r.event.kind==='CALLER').event.outcome,'UNKNOWN');
 assert.equal(f.closure.automatic_retry_allowed,false);
});
test('fenced UNSENT with no dispatched request is structurally distinct from an actual terminal',()=>{
 const f=fixture({outcome:'REJECTED',unsent:true});assert.equal(verifyNativePhysicalTask(f),sha(f.closure));assert.equal(f.requests.length,0);
});
for(const [name,mutate] of [
 ['missing helper',f=>{delete f.receipt.physical_settlement;}],
 ['native active process',f=>{const s=f.receipt.physical_settlement;s.native_terminal.job_accounting.active_processes=1;s.native_terminal_sha256=sha(s.native_terminal);f.receipt.local_output_drain=codexCliLocalOutputDrain(s);}],
 ['forged full-scope helper assertion',f=>{f.receipt.physical_settlement.scope='ALL_EFFECTS';}],
 ['forged full-scope local-output assertion',f=>{f.receipt.local_output_drain.all_effects_cleanup='CONFIRMED';}],
 ['rehashed wrong run receipt',f=>{f.receipt.run_id=randomUUID();}],
 ['rehashed wrong callback worker',f=>{f.receipt.pid++;}],
 ['original request digest',f=>{f.requests[0].request.request_sha256=hash('0');}],
 ['Host instance',f=>{f.requests[0].request.host.instance_id=randomUUID();}],
 ['Host birth',f=>{f.requests[0].request.host.process_incarnation_id='pid:7000:created_100ns:133333333333333332';}],
 ['Host timestamp inconsistent with birth',f=>{f.requests[0].request.host.created_at='2000-01-01T00:00:00.000Z';}],
 ['Main birth',f=>{f.requests[0].request.main_birth='pid:9000:created_100ns:133333333333333332';}],
 ['PG exact startup microseconds',f=>{f.requests[0].request.postgres.started_at='2026-11-01T01:00:00.123457Z';}],
 ['PG data-directory identity',f=>{f.requests[0].request.postgres.data_directory_identity_sha256=hash('0');}],
 ['PG system identifier',f=>{f.requests[0].request.postgres.system_identifier='987654321';}],
 ['protected callback directory identity',f=>{f.journal.prefix_identity_sha256=hash('0');}],
 ['original attempt identity',f=>{f.journal.attempt_sha256=hash('0');}],
 ['missing dispatched callback',f=>{f.requests=[];}],
 ['missing actual Host terminal',f=>{f.requests[0].terminal=null;}],
 ['actual Host HOLD terminal',f=>{f.requests[0].terminal={...f.requests[0].terminal,state:'HOLD',cleanup_confirmed:false};}],
 ['duplicate dispatched callback',f=>{f.requests.push(clone(f.requests[0]));}],
 ['terminal digest',f=>{f.journal.records.find(r=>r.event.kind==='TERMINAL').event.terminal_sha256=hash('0');chain(f);}],
 ['dispatch masquerading as UNSENT',f=>{const e=f.journal.records.find(r=>r.event.kind==='TERMINAL').event;delete e.state;delete e.terminal_sha256;e.kind='UNSENT';chain(f);}],
 ['duplicate journal intent',f=>{f.journal.records.splice(5,0,clone(f.journal.records[2]));chain(f);}],
 ['missing dispatch fence',f=>{f.journal.records=f.journal.records.filter(r=>r.event.kind!=='FENCE');chain(f);}],
 ['missing callback join',f=>{f.journal.records=f.journal.records.filter(r=>r.event.kind!=='CALLBACKS_JOINED');chain(f);}],
 ['missing final candidate',f=>{f.journal.records.pop();chain(f);}],
 ['unrehashed truncated journal',f=>{f.journal.records.splice(4,1);}],
 ['coherent rewritten anchored intent',f=>{f.journal.records[2].event.operation='READ_INTENT';chain(f);}],
 ['extra unrepresented dispatched callback',f=>{const row=clone(f.requests[0]);row.request.frame.request_id=randomUUID();row.request.request_sha256=sha(row.request.frame);row.terminal={...row.terminal,request_id:row.request.frame.request_id,request_sha256:row.request.request_sha256};f.requests.push(row);}],
 ['original RESERVE digest in closure',f=>{f.closure.reserve_request_sha256=hash('0');}],
 ['original RESERVE body changed with stale digest',f=>{f.reserve.request.frame.payload.scope.scope_sha256=hash('0');}],
 ['rehashed substituted RESERVE scope',f=>{f.reserve.request.frame.payload.scope.scope_sha256=hash('0');f.reserve.request.request_sha256=sha(f.reserve.request.frame);f.reserve.terminal={...f.reserve.terminal,request_sha256:f.reserve.request.request_sha256};f.closure.reserve_request_sha256=f.reserve.request.request_sha256;}],
 ['substituted RESERVE request id',f=>{f.publication.root.reserve_request_id=randomUUID();}],
])test('physical TASK verifier refuses '+name,()=>{const f=fixture();mutate(f);refuses(f);});

for(const field of ['workspace_id','project_id','agent_id','agent_generation_epoch','base_sha','owner_epoch','executable_sha256'])
 test('physical TASK verifier rejects coherently stored receipt with substituted '+field,()=>{
  const f=fixture();f.receipt[field]=typeof f.receipt[field]==='number'?f.receipt[field]+1:field.endsWith('_id')?randomUUID():hash('0');refuses(f);
 });

test('physical TASK verifier independently checks exact permit hash',()=>{
 const f=fixture();f.permit.artifact.cli_executable_sha256=hash('0');refuses(f);
});
for(const [field,replacement] of [['role','CRITIC'],['device_id',()=>randomUUID()],['device_key_fingerprint_sha256',hash('0')]])
 test('physical TASK verifier refuses coherently rehashed permit with substituted '+field,()=>{
  const f=fixture();f.permit[field]=typeof replacement==='function'?replacement():replacement;
  f.publication.root.permit_sha256=sha(f.permit);refuses(f);
 });
for(const [name,mutate] of [
 ['device',f=>{f.job.payload.device_id=randomUUID();}],
 ['operator signing key',f=>{f.job.issuer_key_fingerprint_sha256=hash('0');}],
])test('physical TASK verifier rejects rehashed registered job with substituted '+name,()=>{
 const f=fixture();mutate(f);f.publication.job_sha256=sha(f.job);refuses(f);
});
for(const [name,mutate] of [
 ['workspace',payload=>{payload.binding.workspace_id=randomUUID();}],
 ['role',payload=>{payload.binding.role='CRITIC';}],
 ['agent epoch',payload=>{payload.binding.agent_generation_epoch++;}],
 ['job id',payload=>{payload.job_binding.job_id=randomUUID();}],
 ['worker birth',payload=>{payload.job_binding.process_incarnation_id='pid:12345:created_100ns:133333333333333334';}],
 ['executable hash',payload=>{payload.job_binding.executable_sha256=hash('0');}],
])test('physical TASK verifier rejects internally rehashed callback with substituted '+name,()=>{
 const f=fixture();rewriteCallback(f,mutate);refuses(f);
});
