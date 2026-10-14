import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DevFleetOperator,SCHEMA} from '../src/operator-core.mjs';

test('explicit UNKNOWN abandonment admits only one hash-bound distinct task; original never retries',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab_id=(await op.create({request_id:'abandon-create-20261014',count:1})).sessions[0].tab_id;
 const old={tab_id,request_id:'abandon-original-20261014',text:'Old independent assignment'};
 f.failSend(true);assert.equal((await op.assign(old)).state,'AMBIGUOUS');
 const next={tab_id,request_id:'abandon-distinct-20261014',text:'Different scoped successor'};
 const p={request_id:old.request_id,tab_id,acknowledge_unknown_delivery:true,
  replacement_request_id:next.request_id,
  replacement_prompt_sha256:crypto.createHash('sha256').update(next.text).digest('hex')};
 assert.equal((await op.abandonReceipt(p)).delivery_state,'UNKNOWN');
 assert.equal((await op.assign(old)).state,'AMBIGUOUS');
 assert.equal(f.sends.length,1);
 await assert.rejects(op.assign({...next,request_id:'abandon-wrong-new-20261014'}),/distinct_replacement/);
 await assert.rejects(op.assign({...next,text:'Conflicting scope'}),/distinct_replacement/);
 f.failSend(false);assert.equal((await op.assign(next)).state,'SENT');
 assert.equal(f.sends.length,2);
 assert.equal(f.disk.requests.find(r=>r.request_id===old.request_id).receipt.state,'AMBIGUOUS');
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal((await reboot.assign(old)).state,'AMBIGUOUS');
 assert.equal((await reboot.assign(next)).state,'SENT');
 assert.equal(f.sends.length,2);
 assert.equal(reboot.receiptSummary().counts.ABANDONED_UNKNOWN,1);
});
test('abandonment refuses active generation, absent acknowledgment, collision and failed durability',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab_id=(await op.create({request_id:'abandon-adverse-create-20261014',count:1})).sessions[0].tab_id;
 f.failSend(true);const old={tab_id,request_id:'abandon-adverse-original-20261014',text:'Original'};
 await op.assign(old);
 const p={tab_id,request_id:old.request_id,acknowledge_unknown_delivery:true,
  replacement_request_id:'abandon-adverse-next-20261014',replacement_prompt_sha256:'a'.repeat(64)};
 await assert.rejects(op.abandonReceipt({...p,acknowledge_unknown_delivery:false}),/parameters_invalid/);
 await assert.rejects(op.abandonReceipt({...p,replacement_request_id:old.request_id}),/parameters_invalid/);
 const probe=f.adapter.inputProbe;
 f.adapter.inputProbe=async id=>({...await probe(id),generation_active:true});
 await assert.rejects(op.abandonReceipt(p),/chat_not_idle/);
 assert.equal(f.disk.requests.find(r=>r.request_id===old.request_id).state,'AMBIGUOUS');
 f.adapter.inputProbe=probe;f.failWrite(true);
 await assert.rejects(op.abandonReceipt(p),/disk_write_failed/);
 assert.equal(f.disk.requests.find(r=>r.request_id===old.request_id).state,'AMBIGUOUS');
 await assert.rejects(op.assign({tab_id,request_id:p.replacement_request_id,text:'Next'}),/persistence_reconciliation/);
 assert.equal(f.sends.length,1);
});
function fixture() {
  let persisted=null, creates=0, sends=[], closes=[], failedWrites=false, failSend=false, draftPresent=false, modelProven=true;
  const adapter={
    async create(tab_id,url){creates++;return {tab_id,url};},
    async read(tab_id,offset,max_chars){
      const full='GPT result for '+tab_id;
      return {tab_id,url:'https://chatgpt.com/c/abcd-1234',text:full.slice(offset,offset+max_chars),
        total_chars:full.length,has_more:offset+max_chars<full.length,authority_effect:false};
    },
    async observe(tab_id){return {tab_id,revision:'e'.repeat(64),chars:24,complete:true,authority_effect:false};},
    pollHint(tab_id){return {tab_id,hint:'DIRTY_HINT',age_ms:null,authority_effect:false};},
    async modelProbe(tab_id){return {tab_id,mode:'CHAT',model_selection_proven:modelProven,high_selection_proven:modelProven,authority_effect:false};},
    async inputProbe(tab_id){return {tab_id,mode:'CHAT',page_failure:null,unique_composer:true,unique_send:true,composer_nonempty:draftPresent,generation_active:false,authority_effect:false};},
    async closeTab(tab_id){closes.push(tab_id);return {tab_id,closed:true,authority_effect:false};},
    async send(tab_id,text){
      sends.push({tab_id,text});
      if(failSend)throw Error('post_click_network_unknown');
      return {state:'PROVEN_SENT',tab_id,url:'https://chatgpt.com/c/abcd-1234'};
    }
  };
  const store={
    async load(){return persisted?structuredClone(persisted):null;},
    async save(state){if(failedWrites)throw Error('disk_write_failed');persisted=structuredClone(state);}
  };
  return {adapter,store,get creates(){return creates;},get sends(){return sends;},get closes(){return closes;},
    failWrite(x){failedWrites=x;},failSend(x){failSend=x;},setDraft(x){draftPresent=x;},setModelProven(x){modelProven=x;},get disk(){return persisted;}};
}
test('early restore exposes truthful RESTORING list while fencing all external effects',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const created=(await seed.create({request_id:'early-restore-cells-20261013',count:4})).sessions;
 let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
 let active=0;
 const adapter={...f.adapter,async create(tab_id,url){
   active++;await gate;active--;
   return {tab_id,url};
 }};
 const op=new DevFleetOperator({adapter,store:f.store});
 const baseline=f.disk.requests.length;
 const early=await op.init({deferRestore:true});
 assert.equal(early.bootstrap_state,'RESTORING');
 assert.equal(early.restored_count,0);
 assert.equal(early.session_count,4);
 assert(early.sessions.every(s=>s.state==='RESTORING'));
 assert.equal(op.isBusy(),true);
 assert.equal(active,4);
 await assert.rejects(op.create({request_id:'early-restore-denied-20261013',count:1}),/operator_restoring/);
 await assert.rejects(op.batchAssign({assignments:[{
   request_id:'early-restore-task-20261013',tab_id:created[0].tab_id,text:'Must never send'
 }]}),/operator_restoring/);
 await assert.rejects(op.batchObserve({}),/operator_restoring/);
 await assert.rejects(op.inputProbe({tab_id:created[0].tab_id}),/operator_restoring/);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.length,baseline);
 unblock();
 const ready=await op.whenRestored();
 assert.equal(ready.bootstrap_state,'READY');
 assert.equal(ready.restored_count,4);
 assert.equal(op.isBusy(),false);
 assert(ready.sessions.every(s=>s.state==='OPEN'));
 const repeat=await op.init();
 assert.equal(repeat.bootstrap_state,'READY');
 assert.equal(f.disk.requests.length,baseline);
});
test('restart restores owned WebContents at bounded concurrency, preserving blocked identities',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const sessions=(await seed.create({request_id:'restore-bounded-create-20261012',count:8})).sessions;
 let active=0,peak=0,total=0;
 const adapter={...f.adapter,async create(tab_id,url){
   active++;peak=Math.max(active,peak);total++;
   await new Promise(resolve=>setTimeout(resolve,12));
   active--;
   if(tab_id===sessions[3].tab_id)throw Error('synthetic_load_failed');
   return {tab_id,url};
 }};
 const reboot=new DevFleetOperator({adapter,store:f.store});
 const snapshot=await reboot.init();
 assert.equal(total,8);assert.equal(peak,4);
 assert.equal(snapshot.session_count,8);
 assert.equal(snapshot.sessions[3].state,'RESTORE_BLOCKED');
 assert.equal(snapshot.sessions.filter(x=>x.state==='OPEN').length,7);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.filter(x=>x.operation==='create').length,1);
});

test('restore must retain the saved conversation; root and different chat readbacks stay blocked',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const sessions=(await seed.create({request_id:'restore-exact-chats-20261013',count:3})).sessions;
 for(const s of sessions)await seed.read({tab_id:s.tab_id});
 let effects=0;
 const adapter={...f.adapter,
   async create(tab_id,url){
     return {tab_id,url:tab_id===sessions[0].tab_id?'https://chatgpt.com/'
       :tab_id===sessions[1].tab_id?'https://chatgpt.com/c/other-chat':url};
   },
   async read(){effects++;throw Error('unexpected_read');},
   async inspect(){effects++;throw Error('unexpected_inspection');},
   async recover(){effects++;throw Error('unexpected_recovery');},
   async inputProbe(){effects++;throw Error('unexpected_input_probe');},
   async modelProbe(){effects++;throw Error('unexpected_model_probe');},
   async send(){effects++;throw Error('unexpected_send');},
 };
 const op=new DevFleetOperator({adapter,store:f.store});
 const ready=await op.init();
 assert.deepEqual(ready.sessions.map(s=>s.state),['RESTORE_BLOCKED','RESTORE_BLOCKED','OPEN']);
 assert.equal(ready.sessions[0].url,'https://chatgpt.com/c/abcd-1234');
 const tab_id=sessions[0].tab_id;
 for(const method of ['read','inspect','recover','inputProbe','modelProbe'])
   await assert.rejects(op[method]({tab_id}),/operator_tab_not_open/);
 const request_id='restore-blocked-send-20261013';
 await assert.rejects(op.assign({tab_id,request_id,text:'Do not use a lost conversation'}),/operator_tab_not_open/);
 const batch=await op.batchAssign({assignments:[{tab_id,request_id,text:'Do not use a lost conversation'}]});
 assert.equal(batch.receipts[0].state,'REFUSED');
 assert.equal(effects,0);
 assert.equal(f.disk.requests.filter(r=>r.operation==='assign').length,0);
 assert.equal((await op.closeTab({tab_id,request_id:'restore-blocked-close-20261013'})).state,'CLOSED');
 assert.equal(op.snapshot().session_count,2);
});

test('failed restore cannot resend a known request or erase an ambiguous receipt',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const tab_id=(await seed.create({request_id:'restore-receipt-chat-20261013',count:1})).sessions[0].tab_id;
 const request={tab_id,request_id:'restore-receipt-send-20261013',text:'Preserve the first delivery'};
 assert.equal((await seed.assign(request)).state,'SENT');
 const op=new DevFleetOperator({store:f.store,adapter:{...f.adapter,
   async create(){throw Error('synthetic_load_failed');}}});
 await op.init();
 assert.equal(op.snapshot().sessions[0].state,'RESTORE_BLOCKED');
 assert.equal((await op.assign(request)).state,'SENT');
 assert.equal(f.sends.length,1);
 await assert.rejects(op.assign({...request,request_id:'restore-receipt-new-20261013'}),/operator_tab_not_open/);
 f.failSend(true);
 assert.equal((await seed.assign({...request,request_id:'restore-unknown-send-20261013'})).state,'AMBIGUOUS');
 const after=new DevFleetOperator({store:f.store,adapter:{...f.adapter,
   async create(){throw Error('synthetic_load_failed');}}});
 await after.init();
 assert.equal((await after.assign({...request,request_id:'restore-unknown-send-20261013'})).state,'AMBIGUOUS');
 await assert.rejects(after.closeTab({tab_id,request_id:'restore-unknown-close-20261013'}),/blocked_by_ambiguous_send/);
 assert.equal(f.sends.length,2);
});

test('restore accepts equivalent www and trailing slash without changing conversation identity',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const tab=(await seed.create({request_id:'restore-canonical-chat-20261013',count:1})).sessions[0];
 await seed.read({tab_id:tab.tab_id});
 const op=new DevFleetOperator({store:f.store,adapter:{...f.adapter,
   async create(tab_id){return {tab_id,url:'https://www.chatgpt.com/c/abcd-1234/'};}}});
 assert.equal((await op.init()).sessions[0].state,'OPEN');
 assert.equal((await op.read({tab_id:tab.tab_id})).state,'READ');
});

test('final close persistence failure returns ambiguous and fences replacement across restart',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const tab_id=(await seed.create({request_id:'close-save-chat-20261013',count:1})).sessions[0].tab_id;
 const adapter={...f.adapter,async closeTab(tab){
   const result=await f.adapter.closeTab(tab);f.failWrite(true);return result;
 }};
 const op=new DevFleetOperator({adapter,store:f.store});await op.init();
 const request={tab_id,request_id:'close-save-failed-20261013'};
 const receipt=await op.closeTab(request);
 assert.equal(receipt.state,'AMBIGUOUS');assert.equal(receipt.automatic_retry_allowed,false);
 assert.equal((await op.closeTab(request)).state,'AMBIGUOUS');
 assert.equal(f.disk.sessions.length,1);
 assert.equal(f.disk.requests.find(r=>r.request_id===request.request_id).state,'AMBIGUOUS');
 f.failWrite(false);
 await assert.rejects(op.create({request_id:'close-save-replacement-20261013',count:1}),/persistence_reconciliation_required/);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal((await reboot.closeTab(request)).state,'AMBIGUOUS');
 await assert.rejects(reboot.closeTab({...request,request_id:'close-save-retry-20261013'}),/close_reconciliation_required/);
 assert.equal(f.closes.length,1);
});

test('failed final Send receipt fences in-process retries and remains ambiguous after restart',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const tab_id=(await seed.create({request_id:'send-save-chat-20261013',count:1})).sessions[0].tab_id;
 const adapter={...f.adapter,async send(tab,text){
   const result=await f.adapter.send(tab,text);f.failWrite(true);return result;
 }};
 const op=new DevFleetOperator({adapter,store:f.store});await op.init();
 const request={tab_id,request_id:'send-save-failed-20261013',text:'Single delivery only'};
 assert.equal((await op.assign(request)).state,'AMBIGUOUS');
 await assert.rejects(op.assign(request),/persistence_reconciliation_required/);
 assert.equal(f.disk.requests.find(r=>r.request_id===request.request_id).state,'AMBIGUOUS');
 f.failWrite(false);
 const reboot=new DevFleetOperator(f);await reboot.init();
 assert.equal((await reboot.assign(request)).state,'AMBIGUOUS');
 assert.equal(f.sends.length,1);
});

test('operator deadline aborts the native capture and prevents a late quiet baseline',async()=>{
 const f=fixture(),seed=new DevFleetOperator(f);await seed.init();
 const sessions=(await seed.create({request_id:'native-abort-cells-20261013',count:2})).sessions;
 let captured,finish,quiet=false;
 const pending=new Promise(resolve=>{finish=resolve;});
 const adapter={...f.adapter,async observe(tab_id,signal){
   if(tab_id===sessions[1].tab_id)return f.adapter.observe(tab_id);
   captured=signal;
   await pending;
   if(signal?.aborted)throw Error('observation_timeout');
   quiet=true;
   return f.adapter.observe(tab_id);
 }};
 const op=new DevFleetOperator({adapter,store:f.store});await op.init();
 const result=await op.batchObserve({parallelism:2});
 assert.equal(result.observed,1);assert.equal(result.unknown,1);
 assert.equal(result.records[0].error,'observation_timeout');
 assert.equal(captured?.aborted,true);
 finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(quiet,false);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.length,1);
});
test('batch poll is an O(1) native hint: no Send, AX read or durable receipt',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'hint-cells-20261012',count:2})).sessions;
 const before=f.disk.requests.length;
 const poll=await op.batchPoll({});
 assert.equal(poll.records.length,2);
 assert(poll.records.every(x=>x.hint==='DIRTY_HINT'));
 assert.equal(poll.hints_only,true);assert.equal(poll.completion_proven,false);
 assert.equal(f.sends.length,0);assert.equal(f.disk.requests.length,before);
 assert.deepEqual((await op.batchPoll({tab_ids:[tabs[1].tab_id]})).records.map(x=>x.tab_id),[tabs[1].tab_id]);
 await assert.rejects(op.batchPoll({tab_ids:[tabs[0].tab_id,tabs[0].tab_id]}),/ids_invalid/);
});
test('operator batches digest-only observation without issuing Send or new receipts',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'native-observe-chat-20261012',count:3})).sessions;
 const before=f.disk.requests.length;
 const first=await op.batchObserve({parallelism:3});
 assert.equal(first.observed,3);assert.equal(first.unknown,0);
 assert.equal(first.completion_proven,false);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.length,before);
 assert(!JSON.stringify(first).includes('GPT result'));
 const second=await op.batchObserve({tab_ids:[tabs[0].tab_id],
   since:[{tab_id:tabs[0].tab_id,revision:first.records[0].revision}]});
 assert.equal(second.records[0].change,'UNCHANGED');
 assert.equal(second.records.length,1);
});
test('batch sends on distinct verified Chat surfaces with durable receipts and no replay',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'batch-created-chats-20261012',count:3})).sessions;
 const assignments=tabs.map((x,i)=>({tab_id:x.tab_id,request_id:'batch-task-20261012-'+i,text:'Research lane '+i}));
 const a=await op.batchAssign({assignments});
 assert.equal(a.state,'COMPLETED');assert.equal(a.sent,3);assert.equal(a.ambiguous,0);
 assert.equal(f.sends.length,3);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,3);
 const b=await op.batchAssign({assignments});
 assert.equal(b.sent,3);assert.equal(f.sends.length,3);
 assert.deepEqual(a.receipts,b.receipts);
});
test('batch dispatch accepts owner-authorized model label gaps and replaces drafts',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'batch-model-chat-20261012',count:1})).sessions[0].tab_id;
 const assignments=[{tab_id:tab,request_id:'batch-model-task-20261012',text:'Ship the real roadmap change'}];
 f.setModelProven(false);
 f.setDraft(true);
 const first=await op.batchAssign({assignments});
 assert.equal(first.state,'COMPLETED');
 assert.equal(first.receipts[0].state,'SENT');
 assert.equal(f.sends.length,1);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,1);
 const again=await op.batchAssign({assignments});
 assert.equal(again.receipts[0].state,'SENT');
 assert.equal(f.sends.length,1);
});
test('unknown Send fences its tab but unrelated batch lanes still advance, no retries after restart',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'batch-unknown-chats-20261012',count:3})).sessions;
 const assignments=tabs.map((x,i)=>({tab_id:x.tab_id,request_id:'batch-unknown-task-20261012-'+i,text:'Task '+i}));
 let n=0;
 const wrapped={...f.adapter,async send(tab,text){
   n++;
   if(n===1)throw Error('post_click_network_unknown');
   return f.adapter.send(tab,text);
 }};
 const operator=new DevFleetOperator({adapter:wrapped,store:f.store});await operator.init();
 const a=await operator.batchAssign({assignments});
 assert.equal(a.state,'PARTIAL_AMBIGUOUS');
 assert.equal(a.ambiguous,1);
 assert.equal(a.sent,2);
 assert.deepEqual(a.receipts.map(x=>x.state),['AMBIGUOUS','SENT','SENT']);
 assert.equal(n,3);
 const replay=await operator.batchAssign({assignments});
 assert.deepEqual(replay.receipts,a.receipts);
 assert.equal(n,3);
 const resumed=new DevFleetOperator({adapter:wrapped,store:f.store});await resumed.init();
 const b=await resumed.batchAssign({assignments});
 assert.equal(b.receipts[0].state,'AMBIGUOUS');
 assert.equal(n,3);
 await assert.rejects(resumed.assign({
   tab_id:tabs[0].tab_id,request_id:'unknown-tab-new-intent-20261013',text:'Must be fenced'
 }),/reconciliation_required/);
 assert.equal(n,3);
});
test('bad batch identity never reaches probe, receipt ledger or Send',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'batch-invalid-chats-20261012',count:1})).sessions[0].tab_id;
 const row={tab_id:tab,request_id:'batch-collision-20261012',text:'A'};
 await assert.rejects(op.batchAssign({assignments:[]}),/batch_size_invalid/);
 await assert.rejects(op.batchAssign({assignments:[row,row]}),/duplicate_id_or_tab/);
 await assert.rejects(op.batchAssign({assignments:[{...row,unknown:'value'}]}),/params_invalid/);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,0);
});
test('7 chats, read their output, give two successive tasks with separate identities',async()=>{
  const f=fixture(),op=new DevFleetOperator(f);
  await op.init();
  const c=await op.create({request_id:'create-seven-20261012',count:7});
  assert.equal(c.state,'CREATED');
  assert.equal(c.sessions.length,7);
  assert.equal(new Set(c.sessions.map(x=>x.tab_id)).size,7);
  const tab=c.sessions[0].tab_id;
  const read=await op.read({tab_id:tab});
  assert.equal(read.state,'READ');assert.match(read.text,/GPT result/);
  const a=await op.assign({tab_id:tab,text:'Investigate P0',request_id:'p0-step1-20261012'});
  const b=await op.assign({tab_id:tab,text:'Continue P0 fixes',request_id:'p0-step2-20261012'});
  assert.equal(a.state,'SENT');assert.equal(b.state,'SENT');
  assert.equal(f.sends.length,2);
  assert.match(f.sends[0].text,/DevFleet request: p0-step1-20261012/);
  assert.match(f.sends[1].text,/Continue P0 fixes/);
  assert.equal((await op.create({request_id:'create-seven-20261012',count:7})).state,'CREATED');
  assert.equal(f.creates,7);
  assert.equal((await op.assign({tab_id:tab,text:'Investigate P0',request_id:'p0-step1-20261012'})).state,'SENT');
  assert.equal(f.sends.length,2);
  await assert.rejects(op.assign({tab_id:tab,text:'Changed text',request_id:'p0-step1-20261012'}),/request_collision/);
});
test('problem tab close is durable, idempotent, and releases the bounded chat slot',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'create-tabs-close-20261012',count:2})).sessions;
 const id='close-failed-tab-20261012';
 const receipt=await op.closeTab({request_id:id,tab_id:tabs[1].tab_id});
 assert.equal(receipt.state,'CLOSED');
 assert.equal(op.snapshot().session_count,1);
 assert.deepEqual(f.closes,[tabs[1].tab_id]);
 assert.equal((await op.closeTab({request_id:id,tab_id:tabs[1].tab_id})).state,'CLOSED');
 assert.equal(f.closes.length,1);
 assert.equal((await op.create({request_id:'create-replacement-20261012',count:1})).state,'CREATED');
 assert.equal(op.snapshot().session_count,2);
});
test('ambiguous Send prevents closing a tab with unknown external outcome',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'create-ambiguous-close-20261012',count:1})).sessions[0].tab_id;
 f.failSend(true);
 assert.equal((await op.assign({request_id:'ambiguous-close-task-20261012',tab_id:tab,text:'P0'})).state,'AMBIGUOUS');
 await assert.rejects(op.closeTab({request_id:'close-blocked-20261012',tab_id:tab}),/blocked_by_ambiguous_send/);
 assert.equal(f.closes.length,0);assert.equal(op.snapshot().session_count,1);
});
test('existing composer draft is replaceable and does not block write-ahead Send',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'create-draft-fence-20261012',count:1})).sessions[0].tab_id;
 f.setDraft(true);
 const receipt=await op.assign({request_id:'safe-draft-block-20261012',tab_id:tab,text:'Roadmap'});
 assert.equal(receipt.state,'SENT');
 assert.equal(f.sends.length,1);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,1);
 assert.equal((await op.assign({request_id:'safe-draft-block-20261012',tab_id:tab,text:'Roadmap'})).state,'SENT');
 assert.equal(f.sends.length,1);
});
test('restore from own independent local profile preserves chats, no duplicate creation requests',async()=>{
  const f=fixture(),a=new DevFleetOperator(f);await a.init();
  const c=await a.create({request_id:'create-restart-20261012',count:2});
  const b=new DevFleetOperator(f);await b.init();
  assert.equal(b.snapshot().session_count,2);
  assert.equal((await b.read({tab_id:c.sessions[1].tab_id})).state,'READ');
  assert.equal((await b.create({request_id:'create-restart-20261012',count:2})).state,'CREATED');
  assert.equal(f.creates,4); // two physical session reconnections, no new create effects
});
test('unknown send is write-ahead fenced across restart; new effect on same tab blocked',async()=>{
  const f=fixture(),op=new DevFleetOperator(f);await op.init();
  const tab=(await op.create({request_id:'create-blocked-20261012',count:1})).sessions[0].tab_id;
  f.failSend(true);
  const result=await op.assign({request_id:'task-ambiguous-20261012',tab_id:tab,text:'Do work'});
  assert.equal(result.state,'AMBIGUOUS');
  assert.equal((await op.assign({request_id:'task-ambiguous-20261012',tab_id:tab,text:'Do work'})).state,'AMBIGUOUS');
  assert.equal(f.sends.length,1);
  const after=new DevFleetOperator(f);await after.init();
  await assert.rejects(after.assign({request_id:'task-after-failure-20261012',tab_id:tab,text:'Retry?'}),/reconciliation_required/);
  assert.equal(f.sends.length,1);
});
test('disk failure prevents any native effect and fences later mutation',async()=>{
  const f=fixture(),op=new DevFleetOperator(f);await op.init();
  f.failWrite(true);
  await assert.rejects(op.create({request_id:'create-disk-fail-20261012',count:1}),/disk_write_failed/);
  assert.equal(f.creates,0);
  f.failWrite(false);
  await assert.rejects(op.create({request_id:'create-another-20261012',count:1}),/persistence_reconciliation_required/);
});
test('hostile payloads and wrong chat IDs cannot reach own ChatGPT session',async()=>{
  const f=fixture(),op=new DevFleetOperator(f);await op.init();
  await assert.rejects(op.create({request_id:'bad',count:7}),/request_id_invalid/);
  await assert.rejects(op.create({request_id:'create-very-many-20261012',count:9}),/count_invalid/);
  await assert.rejects(op.create({request_id:'create-wrongurl-20261012',count:2,url:'https://evil.test'}),/params_invalid/);
  await assert.rejects(op.read({tab_id:'tab_not_owned'}),/tab_id_invalid/);
  await assert.rejects(op.assign({request_id:'valid-request-20261012',tab_id:'tab_not_owned',text:'Hi'}),/tab_id_invalid/);
  assert.equal(f.creates,0);assert.equal(f.sends.length,0);
});
test('default identity is standalone: no Supabase SDK, production Browser, Guardian or PostgreSQL mutation',async()=>{
  const {default:fs}=await import('node:fs/promises');
  const {default:path}=await import('node:path');
  const root=new URL('../',import.meta.url);
  const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  const builder=JSON.parse(await fs.readFile(new URL('../electron-builder.json',import.meta.url),'utf8'));
  assert.equal(pkg.name,'metaengine-devfleet');
  assert.equal(builder.appId,'com.metaengine.devfleet.standalone');
  assert.equal(builder.productName,'METAENGINE DevFleet');
  assert.deepEqual(builder.files,['src/**/*','package.json']);
  assert.deepEqual(builder.extraResources,[
    {from:'scripts/devfleet-admin-mcp.mjs',to:'devfleet-admin-mcp.mjs'}
  ]);
  assert.equal(pkg.dependencies,undefined);
  const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  assert.match(source,/METAENGINE DevFleet/);
  assert.doesNotMatch(source,/HostResilienceRuntime|METAENGINE Browser Test|Guardian|supabase\.co|child_process|execFile|spawn\(/i);
  assert.equal(SCHEMA,'metaengine.devfleet.operator.v1');
});
