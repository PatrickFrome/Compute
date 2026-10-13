import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
import {LiveOperatorContracts,LIVE_CONTRACT_SCHEMA} from '../src/live-operator-contracts.mjs';

function make() {
  let disk=null,policyDisk=null,sends=0,positive=false;
  const uuid='tab_11111111-2222-4333-8444-555555555555';
  const adapter={
    create:async(tab_id,url)=>({tab_id,url}),
    read:async tab_id=>({tab_id,url:'https://chatgpt.com/c/abc-def',
      text:'',total_chars:0,authority_effect:false}),
    inputProbe:async tab_id=>({tab_id,mode:'CHAT',page_failure:null,
      unique_composer:true,composer_nonempty:false,authority_effect:false}),
    modelProbe:async tab_id=>({tab_id,mode:'CHAT',model_selection_proven:true,
      high_selection_proven:true,authority_effect:false}),
    send:async(tab_id)=>{sends++;if(!positive)throw Error('unknown_send');
      return {tab_id,state:'PROVEN_SENT',url:'https://chatgpt.com/c/abc-def'};},
    probePosted:async(tab_id,request_id)=>({tab_id,request_id,
      state:positive?'PROVEN_SENT':'UNVERIFIED',
      url:'https://chatgpt.com/c/abc-def',target_id:'webcontents:73',
      authority_effect:false})
  };
  const store={
    load:async()=>structuredClone(disk),
    save:async s=>{disk=structuredClone(s);}
  };
  const pstore={
    load:async()=>structuredClone(policyDisk),
    save:async s=>{policyDisk=structuredClone(s);}
  };
  return {adapter,store,pstore,uuid,positive:v=>positive=v,
    get sends(){return sends;},get disk(){return disk;}};
}
const contract=(options={})=>({
  schema:LIVE_CONTRACT_SCHEMA,dispatch_enabled:true,max_batch_items:1,
  max_prompt_chars:80,max_observe_parallelism:1,
  existing_draft:'DENY_EXISTING_DRAFT',require_verified_model:true,...options
});
test('ambiguous send is replay fenced, positive native receipt frees tab without resending',async()=>{
 const f=make(),pol=new LiveOperatorContracts({store:f.pstore});await pol.init();
 const op=new DevFleetOperator({adapter:f.adapter,store:f.store,contracts:pol});await op.init();
 const [tab]= (await op.create({request_id:'hot-receipt-create-001',count:1})).sessions;
 const req={request_id:'hot-receipt-send-001',tab_id:tab.tab_id,text:'First assignment'};
 const first=await op.assign(req);
 assert.equal(first.state,'AMBIGUOUS');
 assert.equal(f.sends,1);
 assert.equal(op.receiptSummary().counts.AMBIGUOUS,1);
 await assert.rejects(op.assign({...req,request_id:'hot-receipt-next-002'}),/ambiguous_reconciliation_required/);
 const unknown=await op.reconcileReceipt({request_id:req.request_id,tab_id:tab.tab_id});
 assert.equal(unknown.state,'AMBIGUOUS');
 assert.equal(f.sends,1);
 f.positive(true);
 const fixed=await op.reconcileReceipt({request_id:req.request_id,tab_id:tab.tab_id});
 assert.equal(fixed.state,'SENT');
 assert.equal(fixed.reconciliation,'POSTED_MESSAGE_NATIVE_READBACK');
 assert.equal(op.receiptSummary().counts.AMBIGUOUS,0);
 assert.equal(op.receiptSummary().counts.SENT,1);
 assert.equal(f.sends,1);
 const next=await op.assign({...req,request_id:'hot-receipt-next-003'});
 assert.equal(next.state,'SENT');
 assert.equal(f.sends,2);
 const reboot=new DevFleetOperator({adapter:f.adapter,store:f.store,contracts:pol});
 await reboot.init();
 assert.equal(reboot.receiptSummary().counts.AMBIGUOUS,0);
 assert.equal((await reboot.assign(req)).state,'SENT');
 assert.equal(f.sends,2);
});
test('hot policy disarms physical Sends and admission is CAS-versioned',async()=>{
 const f=make(),pol=new LiveOperatorContracts({store:f.pstore});await pol.init();
 const op=new DevFleetOperator({adapter:f.adapter,store:f.store,contracts:pol});await op.init();
 const [tab]=(await op.create({request_id:'hot-contract-create-001',count:1})).sessions;
 const staged=await pol.stage({expected_generation:0,contract:contract({dispatch_enabled:false})});
 await pol.activate({expected_generation:0,expected_sha256:staged.staged_sha256});
 await assert.rejects(op.assign({request_id:'hot-disarmed-send-001',tab_id:tab.tab_id,text:'Disallowed'}),/policy_disarmed/);
 assert.equal(f.sends,0);
 await pol.rollback({expected_generation:1});
 const stage=await pol.stage({expected_generation:2,contract:contract()});
 await pol.activate({expected_generation:2,expected_sha256:stage.staged_sha256});
 await assert.rejects(op.batchAssign({assignments:[
   {request_id:'hot-oversized-001',tab_id:tab.tab_id,text:'Long assignment'},
   {request_id:'hot-oversized-002',tab_id:'tab_99999999-9999-4999-8999-999999999999',text:'Other assignment'}
 ]}),/batch_size_invalid/);
 assert.equal(f.sends,0);
});

test('hot code and contract maintenance use the single physical-Send exclusion lock',async()=>{
 const f=make(),pol=new LiveOperatorContracts({store:f.pstore});await pol.init();
 const op=new DevFleetOperator({adapter:f.adapter,store:f.store,contracts:pol});await op.init();
 const [tab]=(await op.create({request_id:'hot-maintenance-create-001',count:1})).sessions;
 let held=false;
 await op.withMaintenanceLock(async()=>{
   held=op.isBusy();
   await assert.rejects(op.assign({
     request_id:'hot-maintenance-send-001',tab_id:tab.tab_id,text:'Forbidden while editing'
   }),/effect_in_progress/);
 });
 assert.equal(held,true);
 assert.equal(op.isBusy(),false);
 assert.equal(f.sends,0);
});
