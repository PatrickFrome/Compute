import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator,SCHEMA} from '../src/operator-core.mjs';
function fixture() {
  let persisted=null, creates=0, sends=[], closes=[], failedWrites=false, failSend=false, draftPresent=false;
  const adapter={
    async create(tab_id,url){creates++;return {tab_id,url};},
    async read(tab_id,offset,max_chars){
      const full='GPT result for '+tab_id;
      return {tab_id,url:'https://chatgpt.com/c/abcd-1234',text:full.slice(offset,offset+max_chars),
        total_chars:full.length,has_more:offset+max_chars<full.length,authority_effect:false};
    },
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
    failWrite(x){failedWrites=x;},failSend(x){failSend=x;},setDraft(x){draftPresent=x;},get disk(){return persisted;}};
}
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
