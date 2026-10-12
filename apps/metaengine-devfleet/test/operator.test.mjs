import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator,SCHEMA} from '../src/operator-core.mjs';
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
    async inputProbe(tab_id){return {tab_id,mode:'CHAT',page_failure:null,unique_composer:true,unique_send:true,composer_nonempty:draftPresent,authority_effect:false};},
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
test('batch refuses unverified model and existing draft before any persisted send',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'batch-model-chat-20261012',count:1})).sessions[0].tab_id;
 const assignments=[{tab_id:tab,request_id:'batch-model-task-20261012',text:'Do not send until verified'}];
 f.setModelProven(false);
 assert.equal((await op.batchAssign({assignments})).receipts[0].state,'REFUSED');
 f.setModelProven(true);f.setDraft(true);
 assert.equal((await op.batchAssign({assignments})).receipts[0].state,'REFUSED');
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,0);
});
test('unknown first Send blocks later batch effects even after restart',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tabs=(await op.create({request_id:'batch-unknown-chats-20261012',count:2})).sessions;
 const assignments=tabs.map((x,i)=>({tab_id:x.tab_id,request_id:'batch-unknown-task-20261012-'+i,text:'Task '+i}));
 f.failSend(true);
 const a=await op.batchAssign({assignments});
 assert.equal(a.state,'HALTED');assert.equal(a.ambiguous,1);
 assert.equal(a.receipts[1].state,'NOT_ATTEMPTED');assert.equal(f.sends.length,1);
 const resumed=new DevFleetOperator(f);await resumed.init();
 const b=await resumed.batchAssign({assignments});
 assert.equal(b.state,'HALTED');assert.equal(b.receipts[0].state,'AMBIGUOUS');
 assert.equal(f.sends.length,1);
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
test('existing draft is refused before write-ahead or Send, no phantom AMBIGUOUS',async()=>{
 const f=fixture(),op=new DevFleetOperator(f);await op.init();
 const tab=(await op.create({request_id:'create-draft-fence-20261012',count:1})).sessions[0].tab_id;
 f.setDraft(true);
 await assert.rejects(op.assign({request_id:'safe-draft-block-20261012',tab_id:tab,text:'Roadmap'}),/chat_input_not_ready_or_draft_present/);
 assert.equal(f.sends.length,0);
 assert.equal(f.disk.requests.filter(x=>x.operation==='assign').length,0);
 f.setDraft(false);
 const result=await op.assign({request_id:'safe-draft-block-20261012',tab_id:tab,text:'Roadmap'});
 assert.equal(result.state,'SENT');
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
  assert.equal(builder.extraResources,undefined);
  assert.equal(pkg.dependencies,undefined);
  const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  assert.match(source,/METAENGINE DevFleet/);
  assert.doesNotMatch(source,/HostResilienceRuntime|METAENGINE Browser Test|Guardian|supabase\.co|child_process|execFile|spawn\(/i);
  assert.equal(SCHEMA,'metaengine.devfleet.operator.v1');
});
