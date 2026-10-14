import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
function makeFixture(){
 let disk=null,failSend=true,failClose=false,ready=true,failStore=false;
 const fx={creates:[],closes:[],sends:[]};
 const adapter={
   async create(tab_id,url){fx.creates.push(tab_id);return {tab_id,url};},
   async read(tab_id){return {tab_id,url:'https://chatgpt.com/',text:'',total_chars:0,authority_effect:false};},
   async closeTab(tab_id){fx.closes.push(tab_id);if(failClose)throw Error('unknown_os_close');return {tab_id,closed:true,authority_effect:false};},
   async inputProbe(tab_id){return {tab_id,mode:ready?'CHAT':'UNKNOWN',page_failure:null,
     unique_composer:ready,generation_active:false,authority_effect:false};},
   async send(tab_id,text){fx.sends.push({tab_id,text});if(failSend)throw Error('transport_unknown');
     return {tab_id,state:'PROVEN_SENT',url:'https://chatgpt.com/c/abcd-1234'};}
 };
 const store={async load(){return disk?structuredClone(disk):null;},
   async save(state){if(failStore)throw Error('disk_write_failed');disk=structuredClone(state);}};
 Object.assign(fx,{adapter,store,
   setFailedSend(x){failSend=x;},setFailedClose(x){failClose=x;},
   setReady(x){ready=x;},setFailStore(x){failStore=x;}});
 Object.defineProperty(fx,'disk',{get(){return disk;},set(x){disk=structuredClone(x);}});
 return fx;
}
async function original(fx){
 const op=new DevFleetOperator(fx);await op.init();
 const tab=(await op.create({request_id:'mass-initial-create-001',count:1})).sessions[0].tab_id;
 const old={tab_id:tab,request_id:'mass-original-job-001',text:'Implement test-only module'};
 assert.equal((await op.assign(old)).state,'AMBIGUOUS');
 return {op,tab,old};
}
function rotateArgs(tab){
 return {request_id:'mass-rotation-operation-001',tab_id:tab,
   replacement_request_id:'mass-replacement-job-002',
   text:'Reimplement test-only module on an isolated branch; no merge',
   acknowledge_unknown_delivery:true};
}
test('AMBIGUOUS no longer prevents lane replacement, original receipt remains UNKNOWN',async()=>{
 const f=makeFixture();const {op,tab,old}=await original(f);
 f.setFailedSend(false);
 const args=rotateArgs(tab),r=await op.rotateFailed(args);
 assert.equal(r.state,'ROTATION_FINISHED');
 assert.equal(r.assignment_state,'SENT');
 assert.equal(r.original_delivery_state,'UNKNOWN');
 assert.notEqual(r.new_tab_id,tab);
 assert.deepEqual(f.closes,[tab]);
 assert.equal(f.creates.length,2);
 assert.equal(f.sends.length,2);
 assert.equal(op.snapshot().session_count,1);
 assert.equal(op.receiptSummary().counts.AMBIGUOUS,1);
 assert.deepEqual(op.receiptSummary().blocked_tabs,[]);
 assert.equal(f.disk.requests.find(x=>x.request_id===old.request_id).state,'AMBIGUOUS');
 assert.equal((await op.rotateFailed(args)).state,'ROTATION_FINISHED');
 assert.equal((await op.assign(old)).state,'AMBIGUOUS');
 assert.equal(f.sends.length,2);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal(reboot.snapshot().session_count,1);
 assert.equal((await reboot.rotateFailed(args)).state,'ROTATION_FINISHED');
 assert.equal(f.creates.length,3); // one owned WebContents restoration
 assert.equal(f.sends.length,2);
});
test('physical close uncertainty fences only failed lane; never creates replacement',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);
 f.setFailedClose(true);
 const args=rotateArgs(tab);
 assert.equal((await op.rotateFailed(args)).state,'RETIRE_UNKNOWN');
 assert.equal((await op.rotateFailed(args)).state,'RETIRE_UNKNOWN');
 assert.equal(f.closes.length,1);
 assert.equal(f.creates.length,1);
 assert.equal(f.sends.length,1);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign'&&x.state==='AMBIGUOUS').length,1);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal(reboot.snapshot().session_count,0);
 assert.equal(reboot.snapshot().pipeline.free_slots,16);
 assert.equal((await reboot.rotateFailed(args)).state,'ROTATION_INTERRUPTED_UNKNOWN');
 assert.equal(f.sends.length,1);
});
test('save failure before closure cannot delete tab or repeat task',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);
 f.setFailStore(true);
 await assert.rejects(op.rotateFailed(rotateArgs(tab)),/disk_write_failed/);
 assert.equal(f.closes.length,0);
 assert.equal(f.creates.length,1);
 assert.equal(f.sends.length,1);
 assert.equal(f.disk.sessions.length,1);
});
test('slow new composer never replays prior Send or fabricates SENT',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);
 f.setFailedSend(false);f.setReady(false);
 const r=await op.rotateFailed(rotateArgs(tab));
 assert.equal(r.state,'ROTATION_FINISHED');
 assert.equal(r.assignment_state,'NOT_ATTEMPTED');
 assert.equal(r.original_delivery_state,'UNKNOWN');
 assert.equal(f.sends.length,1);
 assert.equal(f.creates.length,2);
 assert.equal(op.snapshot().session_count,1);
});
test('rotation request collisions or missing owner acknowledgment prevent mutation',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);
 const a=rotateArgs(tab);
 await assert.rejects(op.rotateFailed({...a,acknowledge_unknown_delivery:false}),/acknowledgment_required/);
 await assert.rejects(op.rotateFailed({...a,replacement_request_id:a.request_id}),/acknowledgment_required/);
 await assert.rejects(op.rotateFailed({...a,replacement_request_id:'invalid!request'}),/request_id_invalid/);
 assert.equal(f.closes.length,0);
});

test('mass wave rotates two independent AMBIGUOUS lanes and preserves both originals',async()=>{
 const f=makeFixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'mass-wave-create-cells-20261014',count:2})).sessions;
 for(let i=0;i<2;i++)assert.equal((await op.assign({
   tab_id:tabs[i].tab_id,request_id:'mass-wave-old-request-0'+i,
   text:'Isolated coding task '+i})).state,'AMBIGUOUS');
 f.setFailedSend(false);
 const wave=tabs.map((x,i)=>({request_id:'mass-wave-rotate-0'+i,
   tab_id:x.tab_id,replacement_request_id:'mass-wave-new-job-0'+i,
   text:'Implement independent hermetic test '+i+' in dedicated work branch',
   acknowledge_unknown_delivery:true}));
 const result=await op.batchRotate({rotations:wave});
 assert.equal(result.state,'BATCH_COMPLETED');
 assert.deepEqual(result.results.map(x=>x.assignment_state),['SENT','SENT']);
 assert.equal(f.sends.length,4);
 assert.equal(f.closes.length,2);
 assert.equal(op.snapshot().session_count,2);
 assert.equal(op.receiptSummary().counts.AMBIGUOUS,2);
 assert.deepEqual(op.receiptSummary().blocked_tabs,[]);
 assert.deepEqual((await op.batchRotate({rotations:wave})).results.map(x=>x.state),
   ['ROTATION_FINISHED','ROTATION_FINISHED']);
 assert.equal(f.sends.length,4);
});
test('failed lane does not stall an unrelated healthy lane in same batch',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);f.setFailedSend(false);
 const fake='tab_ffffffff-ffff-4fff-8fff-ffffffffffff';
 const failed={...rotateArgs(fake),request_id:'mass-wave-stale-rotate-001',
   replacement_request_id:'mass-wave-stale-task-002'};
 const good=rotateArgs(tab);
 const res=await op.batchRotate({rotations:[failed,good]});
 assert.equal(res.results[0].state,'NOT_ATTEMPTED');
 assert.equal(res.results[1].state,'ROTATION_FINISHED');
 assert.equal(f.sends.length,2);
});
test('batch preflight rejects colliding IDs before closing any live cell',async()=>{
 const f=makeFixture();const {op,tab}=await original(f);
 const first=rotateArgs(tab);
 await assert.rejects(op.batchRotate({rotations:[first,first]}),/identity_conflict/);
 assert.equal(f.closes.length,0);
 await assert.rejects(op.batchRotate({rotations:Array(5).fill(first)}),/batch_budget/);
 assert.equal(f.closes.length,0);
});
