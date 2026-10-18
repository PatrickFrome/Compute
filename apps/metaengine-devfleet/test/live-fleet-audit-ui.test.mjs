import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../src/index.html',import.meta.url),'utf8');
const extracted=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(extracted.length,1);

function harness(scenarios){
  const nodes=new Map();
  for(const id of ['create','read','assign','refresh','inspect','recover','replace','audit-all',
    'tabs','status','output','fleet-evidence','count','prompt','model-probe','input-probe',
    'conveyor-launch','conveyor-stop','conveyor-state','conveyor-batch','conveyor-hot']){
    nodes.set(id,{disabled:false,value:id==='count'?'7':'',textContent:'',
      replaceChildren(){this.children=[];},append(x){(this.children??=[]).push(x);}});
  }
  const used={inspect:[],assign:0,recover:0,create:0,select:0};
  const sessions=scenarios.map((x,i)=>({tab_id:'tab_'+String(i).padStart(8,'0')+'-0000-4000-8000-000000000000',
    url:'https://chatgpt.com/',state:'OPEN'}));
  const devfleet={
    list:async()=>({session_count:sessions.length,sessions}),
    conveyorStatus:async()=>({enabled:false,counts:{},hot_slots:10,occupied_or_reserved:0,last_error:null}),
    conveyorStart:async()=>({state:'STARTED'}),
    conveyorStop:async()=>({state:'STOPPED'}),
    conveyorEnqueueBatch:async()=>({accepted:0}),
    inspect:async({tab_id})=>{
      used.inspect.push(tab_id);
      const idx=sessions.findIndex(s=>s.tab_id===tab_id);
      return {...scenarios[idx],tab_id,authority_effect:false};
    },
    assign:async()=>{used.assign++;throw Error('unexpected assign');},
    recover:async()=>{used.recover++;throw Error('unexpected recover');},
    create:async()=>{used.create++;throw Error('unexpected create');},
    select:async()=>{used.select++;},
    onReady:()=>{},
  };
  const context={
    window:{devfleet},document:{getElementById:id=>nodes.get(id),
      createElement:()=>({textContent:'',className:'',title:'',onclick:null})},
    setTimeout:()=>{},setInterval:()=>{},crypto:{randomUUID:()=> 'test-id'},
  };
  vm.runInNewContext(extracted[0][1],context,{timeout:3000});
  return {nodes,used,sessions,devfleet,run:async()=>nodes.get('audit-all').onclick()};
}

test('fleet audit never sends a prompt or reloads a chat and fails closed on Work',async()=>{
  const h=harness([
    {mode:'WORK',high_label_visible:true,gpt6_label_visible:true,page_failure:null},
    {mode:'CHAT',high_label_visible:true,gpt6_label_visible:false,page_failure:null},
    {mode:'UNKNOWN',high_label_visible:false,gpt6_label_visible:false,page_failure:'ACCOUNT'},
  ]);
  await h.run();
  const report=JSON.parse(h.nodes.get('output').textContent);
  assert.deepEqual(JSON.parse(JSON.stringify(report.counts)),
    {ready:0,blocked_work:1,error:1,unverified:1});
  assert.equal(h.used.inspect.length,3);
  assert.equal(h.used.assign,0);
  assert.equal(h.used.recover,0);
  assert.equal(h.used.create,0);
  assert.match(h.nodes.get('fleet-evidence').textContent,/GPT-6 High подтверждены: 0 \/ 3/);
});

test('only explicit Chat plus High plus GPT-6 mark a session ready',async()=>{
  const h=harness([
    {mode:'CHAT',high_label_visible:true,gpt6_label_visible:true,page_failure:null},
    {mode:'CHAT',high_label_visible:false,gpt6_label_visible:true,page_failure:null},
    {mode:'WORK',high_label_visible:true,gpt6_label_visible:true,page_failure:null},
  ]);
  await h.run();
  const report=JSON.parse(h.nodes.get('output').textContent);
  assert.equal(report.counts.ready,1);
  assert.equal(report.counts.unverified,1);
  assert.equal(report.counts.blocked_work,1);
  assert.equal(h.used.assign,0);
});

test('blocked restore can be replaced without inspecting the missing cell; ambiguous close stops creation',async()=>{
  for(const state of ['CLOSED','AMBIGUOUS']){
    const h=harness([{mode:'UNKNOWN',page_failure:null}]);
    h.sessions[0].state='RESTORE_BLOCKED';
    const doomed=h.sessions[0].tab_id;
    let closes=0;
    h.devfleet.close=async p=>{assert.equal(p.tab_id,doomed);closes++;return {state};};
    h.devfleet.create=async()=>{
      h.used.create++;
      const replacement={tab_id:'tab_99999999-0000-4000-8000-000000000000',url:'https://chatgpt.com/',state:'OPEN'};
      h.sessions.splice(0,1,replacement);return {state:'CREATED',sessions:[replacement]};
    };
    await h.nodes.get('refresh').onclick();
    await h.nodes.get('replace').onclick();
    assert.equal(h.used.inspect.length,0);
    assert.equal(closes,1);
    assert.equal(h.used.create,state==='CLOSED'?1:0);
    assert.equal(h.used.assign,0);
  }
});
