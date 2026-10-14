import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
import {chooseFairCodingWave,codingQueueSummary,emptyCodingQueue,enqueueCodingTask} from '../src/coding-task-queue-core.mjs';

function harness(){
 let disk=null;
 const effects={created:[],sent:[],closed:[]};
 const adapter={
  async create(tab_id,url){effects.created.push(tab_id);return {tab_id,url};},
  async send(tab_id,text){effects.sent.push({tab_id,text});return {tab_id,state:'PROVEN_SENT',url:'https://chatgpt.com/c/test-1'};},
  async read(tab_id){return {tab_id,url:'https://chatgpt.com/',text:'',total_chars:0,authority_effect:false};},
  async inputProbe(tab_id){return {tab_id,mode:'CHAT',unique_composer:true,authority_effect:false};},
  async closeTab(tab_id){effects.closed.push(tab_id);return {tab_id,closed:true,authority_effect:false};}
 };
 const store={async load(){return structuredClone(disk)},async save(v){disk=structuredClone(v)}};
 return {adapter,store,effects,get disk(){return structuredClone(disk);},set disk(v){disk=structuredClone(v)}};
}
const task=i=>({task_id:'hot-config-client-'+String(i).padStart(3,'0'),
 request_id:'hot-config-request-'+String(i).padStart(3,'0'),
 project_id:'client-ui',text:'Implement hermetic client source tests for '+i,
 kind:'SOURCE_CODING',scope:'SOURCE_ONLY',draft_pr_only:true});

test('legacy journal retains old initial target yet can be reconfigured without reinstall',async()=>{
 const h=harness(),op=new DevFleetOperator(h);await op.init();
 assert.equal(op.queueStatus().hot_limit,4);
 await assert.rejects(op.configureCodingSlots({hot_slots:0}),/target_invalid/);
 await assert.rejects(op.configureCodingSlots({hot_slots:1.5}),/target_invalid/);
 const configured=await op.configureCodingSlots({hot_slots:5});
 assert.equal(configured.state,'CONFIGURED');
 assert.equal(configured.hot_slots,5);
 assert.equal(op.queueStatus().hot_limit,5);
 assert.equal(op.snapshot().pipeline.capacity,5);
 const resumed=new DevFleetOperator(h);await resumed.init();
 assert.equal(resumed.queueStatus().hot_limit,5);
});

test('five slots can be occupied by one wave with same owner and no second scheduler',async()=>{
 const h=harness(),op=new DevFleetOperator(h);await op.init();
 await op.configureCodingSlots({hot_slots:5});
 for(let i=0;i<6;i++)await op.enqueueCoding(task(i));
 const out=await op.admitCoding({max_items:5});
 assert.equal(out.results.length,5);
 assert.equal(out.hot_limit,5);
 assert.equal(op.snapshot().session_count,5);
 assert.equal(h.effects.created.length,5);
 assert.equal(h.effects.sent.length,5);
 assert.equal(op.queueStatus().free_hot_slots,0);
 assert.equal(op.queueStatus().counts.QUEUED,1);
 const restored=new DevFleetOperator(h);await restored.init();
 assert.equal(restored.snapshot().session_count,5);
 assert.equal(restored.queueStatus().hot_limit,5);
 assert.equal(h.effects.sent.length,5);
});

test('targets above prior 16-session ceiling are allowed as configuration, never auto-created',async()=>{
 const h=harness(),op=new DevFleetOperator(h);await op.init();
 await op.configureCodingSlots({hot_slots:24});
 assert.equal(op.queueStatus().hot_limit,24);
 assert.equal(op.snapshot().session_count,0);
 assert.equal(h.effects.created.length,0);
 const reboot=new DevFleetOperator(h);await reboot.init();
 assert.equal(reboot.queueStatus().hot_limit,24);
});

test('lowering target below existing occupancy never deletes or re-sends sessions',async()=>{
 const h=harness(),op=new DevFleetOperator(h);await op.init();
 await op.configureCodingSlots({hot_slots:5});
 for(let i=0;i<5;i++)await op.enqueueCoding(task(i));
 await op.admitCoding({max_items:5});
 await op.configureCodingSlots({hot_slots:2});
 assert.equal(op.queueStatus().free_hot_slots,0);
 assert.equal(op.queueStatus().occupied_or_reserved,5);
 assert.equal(op.snapshot().session_count,5);
 assert.equal(h.effects.closed.length,0);
 assert.equal((await op.admitCoding({max_items:1})).results.length,0);
});

test('the pure fair selector is bounded by queued tasks, not hardcoded hot slots',()=>{
 let q=emptyCodingQueue();
 for(let i=0;i<12;i++)q=enqueueCodingTask(q,task(i)).queue;
 assert.equal(chooseFairCodingWave(q,12).task_ids.length,12);
 assert.equal(codingQueueSummary(q,0,[],24).free_hot_slots,24);
 assert.throws(()=>chooseFairCodingWave(q,Number.POSITIVE_INFINITY),/budget_invalid/);
});
