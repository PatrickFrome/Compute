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
  async resolveCodingTask({task_id,state}){
    this.items.find(x=>x.task_id===task_id).state=state;
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
