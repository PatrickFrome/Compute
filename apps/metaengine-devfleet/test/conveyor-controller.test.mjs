import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetConveyor} from '../src/conveyor-controller.mjs';

class FakeOperator {
  items=[]; hot=3; admissions=0; sends=0;
  queueStatus(){
    const counts={};
    for(const x of this.items)counts[x.state]=(counts[x.state]||0)+1;
    return {hot_limit:this.hot,occupied_or_reserved:0,free_hot_slots:this.hot,
      counts,items:this.items.map(({task_id,request_id,project_id,tab_id,state})=>
        ({task_id,request_id,project_id,tab_id,state}))};
  }
  async configureCodingSlots({hot_slots}){this.hot=hot_slots;}
  async enqueueCoding(task){
    this.items.push({...task,tab_id:null,state:'QUEUED'});
    return {task_id:task.task_id,request_id:task.request_id,state:'QUEUED',duplicate:false};
  }
  async admitCoding({max_items}){
    this.admissions++;
    let count=0;
    for(const x of this.items){
      if(x.state==='QUEUED'&&count<max_items){x.state='SENT';count++;this.sends++;}
    }
    return {state:'WAVE_COMPLETED'};
  }
  queueTask(task_id){return this.items.find(x=>x.task_id===task_id);}
  codingTaskReceiptStatus(task_id){
    const row=this.queueTask(task_id);
    return {task_id,task_state:row?.state,ledger_state:row?.ledger_state??'NONE',
      tab_state:row?.tab_state??'OPEN',read_only:true,authority_effect:false};
  }
  async resolveCodingTask({task_id,state}){
    const row=this.items.find(x=>x.task_id===task_id);
    if(row?.ledger_state!==state)throw Error('conveyor_receipt_not_proven');
    row.state=state;
  }
  async assign(){throw Error('UNEXPECTED_ASSIGN');}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('owner-started conveyor sends 48 distinct queued source tasks via single operator',async()=>{
  const op=new FakeOperator(),conveyor=new DevFleetConveyor(op);
  const tasks=Array.from({length:48},(_,i)=>({
    task_id:'task-conveyor-'+String(i).padStart(3,'0'),
    request_id:'send-conveyor-'+String(i).padStart(3,'0'),
    project_id:'client',text:'Source task '+i,
    kind:'SOURCE_CODING',scope:'SOURCE_ONLY',draft_pr_only:true
  }));
  const queued=await conveyor.enqueueBatch({tasks});
  assert.equal(queued.accepted,48);
  const start=await conveyor.start({hot_slots:7});
  assert.equal(start.state,'STARTED');
  for(let i=0;i<40&&op.sends!==48;i++)await sleep(20);
  assert.equal(op.sends,48);
  assert.equal(conveyor.status().sent_confirmed,48);
  assert.equal(conveyor.status().send_unknown,0);
  assert.equal(conveyor.stop().state,'STOPPING');
});

test('conveyor resumes automatically after transient operator RESTORING',async()=>{
  const op=new FakeOperator(),initial=op.queueStatus.bind(op);
  let restoring=3;
  op.queueStatus=()=>{if(restoring-->0)throw Error('operator_restoring');return initial();};
  const controller=new DevFleetConveyor(op,{retryDelayMs:10});
  await controller.enqueueBatch({tasks:[{task_id:'task-after-restore-01',
    request_id:'send-after-restore-01',project_id:'client',text:'source task',
    kind:'SOURCE_CODING',scope:'SOURCE_ONLY',draft_pr_only:true}]});
  await controller.start({hot_slots:2});
  for(let i=0;i<45&&op.sends===0;i++)await sleep(10);
  assert.equal(op.sends,1);
  assert.equal(controller.status().last_error,null);
  controller.stop();
});

test('committed SENT ledger resolves READY task without new Send',async()=>{
  const op=new FakeOperator();
  const row={task_id:'task-ledger-sent-01',request_id:'send-ledger-sent-01',
    project_id:'client',kind:'SOURCE_CODING',scope:'SOURCE_ONLY',
    draft_pr_only:true,text:'Existing confirmed user turn',
    state:'READY_NOT_SENT',tab_id:'tab_11111111-1111-4111-8111-111111111111',
    tab_state:'OPEN',ledger_state:'SENT'};
  op.items.push(row);
  const conveyor=new DevFleetConveyor(op,{retryDelayMs:10});
  await conveyor.start({hot_slots:1});
  for(let i=0;i<35&&row.state!=='SENT';i++)await sleep(10);
  assert.equal(row.state,'SENT');
  assert.equal(op.sends,0);
  assert.equal(conveyor.status().sent_confirmed,1);
  conveyor.stop();
});
test('RESTORE_BLOCKED task is not resent and counted separately',async()=>{
  const op=new FakeOperator();
  const row={task_id:'task-restored-bad-01',request_id:'send-restored-bad-01',
    project_id:'client',kind:'SOURCE_CODING',scope:'SOURCE_ONLY',
    draft_pr_only:true,text:'Do not blindly resend',
    state:'READY_NOT_SENT',tab_id:'tab_22222222-2222-4222-8222-222222222222',
    tab_state:'RESTORE_BLOCKED',ledger_state:'NONE'};
  op.items.push(row);
  const conveyor=new DevFleetConveyor(op,{retryDelayMs:10});
  await conveyor.start({hot_slots:1});
  for(let i=0;i<25&&conveyor.status().restore_blocked_tasks!==1;i++)await sleep(10);
  assert.equal(conveyor.status().restore_blocked_tasks,1);
  assert.equal(op.sends,0);
  assert.equal(row.state,'READY_NOT_SENT');
  conveyor.stop();
});
