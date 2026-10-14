import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
function fixture(){
 let disk=null,failSave=false,failSend=false,failCreate=false,ready=true;
 const actions={creates:[],sends:[]};
 const adapter={
  async create(tab_id,url){actions.creates.push(tab_id);if(failCreate)throw Error('create_unknown');return {tab_id,url};},
  async read(tab_id){return {tab_id,url:'https://chatgpt.com/',text:'',total_chars:0,authority_effect:false};},
  async send(tab_id,text){actions.sends.push({tab_id,text});if(failSend)throw Error('network_unknown');return {tab_id,state:'PROVEN_SENT',url:'https://chatgpt.com/c/abcd-1234'};},
  async inputProbe(tab_id){return {tab_id,mode:ready?'CHAT':'UNKNOWN',page_failure:null,unique_composer:ready,authority_effect:false};},
  async closeTab(tab_id){return {tab_id,closed:true,authority_effect:false};}
 };
 const store={async load(){return disk?structuredClone(disk):null;},
   async save(x){if(failSave)throw Error('disk_write_failed');disk=structuredClone(x);}};
 return {adapter,store,actions,setCreate(x){failCreate=x;},setSave(x){failSave=x;},
  setSend(x){failSend=x;},setReady(x){ready=x;},get disk(){return disk;}};
}
const item=(project,id)=>({project_id:project,task_id:'coding-task-'+id,
 request_id:'coding-send-'+id,kind:'SOURCE_CODING',scope:'SOURCE_ONLY',
 draft_pr_only:true,text:'Write source-only hermetic checks for '+id+' as DRAFT PR'});
async function seed(op, n=5){
 for(let i=0;i<n;i++)await op.enqueueCoding(item(i%2?'group-beta':'group-alpha',String(i).padStart(3,'0')));
}
test('explicit admission uses operator Send preflight, four slots max, project fairness',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();await seed(op,6);
 const wave=await op.admitCoding({max_items:4});
 assert.deepEqual(wave.results.map(x=>x.task_id),['coding-task-000','coding-task-001','coding-task-002','coding-task-003']);
 assert.equal(wave.results.every(x=>x.state==='SENT'),true);
 assert.equal(op.queueStatus().free_hot_slots,0);
 assert.equal('items' in op.snapshot().coding_queue,false); // chat.list lacks task identity
 assert.equal(f.actions.creates.length,4);assert.equal(f.actions.sends.length,4);
 const noCapacity=await op.admitCoding({max_items:4});
 assert.equal(noCapacity.results.length,0);assert.equal(f.actions.sends.length,4);
 assert.equal(op.queueStatus().counts.QUEUED,2);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal(reboot.queueStatus().counts.QUEUED,2);
 assert.equal((await reboot.admitCoding({max_items:4})).results.length,0);
 assert.equal(f.actions.sends.length,4);
});
test('duplicate enqueue is idempotent, collisions reject before effects',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 await op.enqueueCoding(item('group-alpha','abc'));
 assert.equal((await op.enqueueCoding(item('group-alpha','abc'))).duplicate,true);
 await assert.rejects(op.enqueueCoding({...item('group-alpha','abc'),text:'different'}),/identity_collision/);
 assert.equal(op.queueStatus().items.length,1);
 assert.equal(f.actions.creates.length,0);
});
test('ambiguous Send never retries after reboot/admission rerun',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 f.setSend(true);await op.enqueueCoding(item('group-alpha','abc'));
 const out=await op.admitCoding({max_items:1});
 assert.equal(out.results[0].state,'AMBIGUOUS');assert.equal(f.actions.sends.length,1);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal(reboot.queueStatus().counts.AMBIGUOUS,1);
 assert.equal((await reboot.admitCoding({max_items:1})).results.length,0);
 assert.equal(f.actions.sends.length,1);
});
test('create ambiguity reserves hot capacity and blocks blind replacement',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 f.setCreate(true);await seed(op,5);
 const r=await op.admitCoding({max_items:4});
 assert.equal(r.results.every(x=>x.state==='CREATION_UNKNOWN'),true);
 assert.equal(f.actions.creates.length,4);
 assert.equal(f.actions.sends.length,0);
 assert.equal(op.queueStatus().free_hot_slots,0);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal(reboot.queueStatus().counts.INTERRUPTED_UNKNOWN,4);
 assert.equal((await reboot.admitCoding({max_items:4})).results.length,0);
 assert.equal(f.actions.creates.length,4);
});
test('write-ahead failure before create makes no physical effect; exclusive lock',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 await op.enqueueCoding(item('group-alpha','abc'));f.setSave(true);
 await assert.rejects(op.admitCoding({max_items:1}),/disk_write_failed/);
 assert.equal(f.actions.creates.length,0);assert.equal(f.actions.sends.length,0);
 await assert.rejects(op.admitCoding({max_items:1}),/persistence_reconciliation_required/);
});
test('unready native composer never attempts Send; task held, no silent requeue',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 await op.enqueueCoding(item('group-alpha','abc'));f.setReady(false);
 const r=await op.admitCoding({max_items:1});
 assert.equal(r.results[0].state,'READY_NOT_SENT');
 assert.equal(f.actions.sends.length,0);
 assert.equal((await op.admitCoding({max_items:1})).results.length,0);
});
test('manual cancel before admission never dispatches; admitted cannot cancel',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 await op.enqueueCoding(item('group-alpha','abc'));
 await op.cancelCoding({task_id:'coding-task-abc'});
 assert.equal((await op.admitCoding({max_items:4})).results.length,0);
 assert.equal(f.actions.creates.length,0);
 await op.enqueueCoding(item('group-alpha','def'));
 assert.equal((await op.admitCoding({max_items:1})).results[0].state,'SENT');
 await assert.rejects(op.cancelCoding({task_id:'coding-task-def'}),/inflight/);
});
