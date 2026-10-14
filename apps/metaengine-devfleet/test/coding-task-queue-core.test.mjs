import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyCodingQueue,readCodingQueue,enqueueCodingTask,cancelQueuedTask,
 chooseFairCodingWave,codingQueueSummary,HOT_SLOTS,QUEUE_LIMIT} from '../src/coding-task-queue-core.mjs';
const task=(project,id)=>({project_id:project,task_id:'task-20261014-'+id,
 request_id:'send-20261014-'+id,text:'Build hermetic source tests for '+id,
 kind:'SOURCE_CODING',scope:'SOURCE_ONLY',draft_pr_only:true});
function add(q,project,id){return enqueueCodingTask(q,task(project,id)).queue;}
test('round-robin fair wave, FIFO per project, persists cursor after restart',()=>{
 let q=emptyCodingQueue();
 for(let i=0;i<6;i++)q=add(q,'group-alpha','a'+i);
 for(let i=0;i<3;i++)q=add(q,'group-beta','b'+i);
 let wave=chooseFairCodingWave(q,4);
 assert.deepEqual(wave.task_ids,['task-20261014-a0','task-20261014-b0',
  'task-20261014-a1','task-20261014-b1']);
 for(const id of wave.task_ids)q.items.find(x=>x.task_id===id).state='RESERVED';
 q.last_project=wave.last_project;
 q=readCodingQueue(structuredClone(q));
 wave=chooseFairCodingWave(q,4);
 assert.deepEqual(wave.task_ids,['task-20261014-a2','task-20261014-b2',
  'task-20261014-a3','task-20261014-a4']);
 assert.equal(chooseFairCodingWave(q,0).task_ids.length,0);
});
test('dedup cannot change project, request, content or authority scope',()=>{
 let q=add(emptyCodingQueue(),'group-alpha','x0');
 assert.equal(enqueueCodingTask(q,task('group-alpha','x0')).duplicate,true);
 for(const diff of [{text:'Different'}, {project_id:'group-beta'}, {request_id:'send-20261014-x9'}])
  assert.throws(()=>enqueueCodingTask(q,{...task('group-alpha','x0'),...diff}),/identity_collision/);
 assert.throws(()=>enqueueCodingTask(q,{...task('group-alpha','x1'),request_id:task('group-alpha','x0').request_id}),/identity_collision/);
 assert.throws(()=>enqueueCodingTask(q,{...task('group-alpha','x1'),scope:'LIVE_EFFECT'}),/task_invalid/);
 assert.throws(()=>enqueueCodingTask(q,{...task('group-alpha','x1'),draft_pr_only:false}),/task_invalid/);
});
test('queue bounded by 32 tasks, no silent eviction of old identities',()=>{
 let q=emptyCodingQueue();
 for(let i=0;i<QUEUE_LIMIT;i++)q=add(q,'group-alpha','x'+i);
 assert.equal(q.items.length,32);
 assert.throws(()=>add(q,'group-alpha','overflow'),/capacity_exceeded/);
 assert.equal(codingQueueSummary(q,0).items.length,32);
 assert.equal(HOT_SLOTS,4);
 assert.equal(JSON.stringify(codingQueueSummary(q,0)).includes('Build hermetic'),false);
});
test('cancel only unreserved, cannot resurrect or replay task id',()=>{
 let q=add(emptyCodingQueue(),'group-alpha','x0');
 q=cancelQueuedTask(q,'task-20261014-x0');
 assert.deepEqual(chooseFairCodingWave(q,4).task_ids,[]);
 assert.equal(enqueueCodingTask(q,task('group-alpha','x0')).item.state,'CANCELLED');
 q=add(q,'group-beta','x1');q.items[1].state='AMBIGUOUS';
 assert.throws(()=>cancelQueuedTask(q,'task-20261014-x1'),/inflight/);
});
test('missing/corrupted persisted queue fails closed',()=>{
 assert.deepEqual(readCodingQueue(undefined),emptyCodingQueue());
 let q=add(emptyCodingQueue(),'group-alpha','x0');
 assert.throws(()=>readCodingQueue({...q,schema:'other'}),/state_invalid/);
 assert.throws(()=>readCodingQueue({...q,items:[q.items[0],q.items[0]]}),/state_invalid/);
 assert.throws(()=>readCodingQueue({...q,items:[{...q.items[0],text:''}]}),/state_invalid/);
 assert.throws(()=>readCodingQueue({...q,last_project:'?'}),/state_invalid/);
 assert.throws(()=>chooseFairCodingWave(q,5),/budget_invalid/);
});
test('fenced, orphaned CREATE reservation consumes hot budget after restart',()=>{
 let q=add(emptyCodingQueue(),'group-alpha','x0');
 q.items[0].state='INTERRUPTED_UNKNOWN';q.items[0].tab_id='tab_11111111-1111-4111-8111-111111111111';
 assert.equal(codingQueueSummary(q,3).free_hot_slots,0);
 assert.equal(codingQueueSummary(q,3,[q.items[0].tab_id]).free_hot_slots,1);
 assert.equal(codingQueueSummary(q,5).free_hot_slots,0);
});
