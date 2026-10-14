import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
const adapter={async create(tab_id,url){return {tab_id,url};},
 async read(tab_id){return {tab_id,url:'https://chatgpt.com/',text:'',total_chars:0,authority_effect:false};},
 async send(tab_id){return {state:'UNVERIFIED',tab_id};}};
test('fresh operator reports source-backed READY and not a fake receipt',async()=>{
 const op=new DevFleetOperator({adapter,store:{load:async()=>null,save:async()=>{}}});
 await op.init();
 assert.equal(op.snapshot().operator_liveness,'READY');
 assert.equal(op.snapshot().receipt_summary.sent,0);
});
test('write-ahead persistence error fences future operations and exposes liveness',async()=>{
 let writes=0;
 const op=new DevFleetOperator({adapter,store:{load:async()=>null,save:async()=>{writes++;throw Object.assign(Error('path redacted'),{code:'EPERM'})}}});
 await op.init();
 await assert.rejects(op.create({request_id:'client-wave-create-unique-20261014',count:1}),/path redacted/);
 assert.equal(op.snapshot().operator_liveness,'DURABILITY_FENCED');
 assert.equal(op.snapshot().operator_storage_error,'EPERM');
 await assert.rejects(op.create({request_id:'client-wave-next-unique-20261014',count:1}),/operator_persistence_reconciliation_required/);
 assert.equal(writes,1);
});
