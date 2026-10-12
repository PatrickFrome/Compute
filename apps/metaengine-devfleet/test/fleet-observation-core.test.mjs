import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintAxSnapshot,validateObservationRequest,runObservationBatch,
  OBSERVATION_SCHEMA
} from '../src/fleet-observation-core.mjs';

const tab=n=>'tab_'+String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const epoch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const page=(text='safe page',generation=1,url='https://chatgpt.com/c/abcd-1234')=>
  fingerprintAxSnapshot({
    tab_id:tab(1),process_epoch:epoch,target_id:'webcontents:7',
    navigation_generation:generation,url,text
  });

test('digest binds process incarnation, native target, navigation and bounded text',()=>{
  const first=page('answer');
  assert.equal(first.complete,true);
  assert.match(first.revision,/^[a-f0-9]{64}$/);
  assert(!JSON.stringify(first).includes('answer'));
  assert.notEqual(first.revision,page('new answer').revision);
  assert.notEqual(first.revision,page('answer',2).revision);
  assert.notEqual(first.revision,page('answer',1,'https://chatgpt.com/c/xyz-1234').revision);
  assert.notEqual(first.revision,fingerprintAxSnapshot({
    tab_id:tab(1),process_epoch:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    target_id:'webcontents:7',navigation_generation:1,
    url:'https://chatgpt.com/c/abcd-1234',text:'answer'
  }).revision);
});

test('digest rejects invalid source, oversized page and private foreign origin',()=>{
  assert.throws(()=>page('bad',-1),/observation_identity_invalid/);
  assert.throws(()=>page('x'.repeat(180001)),/observation_identity_invalid/);
  assert.throws(()=>page('bad',1,'https://evil.invalid/c/abcd'),/observation_origin_invalid/);
  assert.throws(()=>page('bad',1,'http://chatgpt.com/c/abcd'),/observation_origin_invalid/);
  assert.equal(page('x'.repeat(180000)).complete,false);
});

test('request validation refuses duplicate, foreign and malformed revisions before invoking adapter',()=>{
  const owned=[tab(1),tab(2)];
  assert.deepEqual(validateObservationRequest({},owned).ids,owned);
  for(const params of [
    {tab_ids:[tab(1),tab(1)]}, {tab_ids:[tab(3)]},
    {parallelism:5}, {since:[{tab_id:tab(1),revision:'invalid'}]},
    {since:[{tab_id:tab(1),revision:'a'.repeat(64)},{tab_id:tab(1),revision:'b'.repeat(64)}]},
    {secret:'attack'}, {tab_ids:[]}
  ]) assert.throws(()=>validateObservationRequest(params,owned));
});

test('one request reads up to four separate tabs in parallel and returns order, only digests',async()=>{
  const owned=Array.from({length:10},(_,i)=>tab(i+1));
  let active=0,maxActive=0,reads=0;
  const observe=async id=>{
    active++;reads++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,10));
    active--;
    return {tab_id:id,revision:'c'.repeat(64),chars:20,complete:true,authority_effect:false};
  };
  const a=await runObservationBatch({params:{parallelism:4},ownedTabs:owned,observe});
  assert.equal(a.schema,OBSERVATION_SCHEMA);
  assert.equal(a.records.length,10);assert.equal(a.observed,10);assert.equal(a.unknown,0);
  assert.equal(maxActive,4);assert.equal(reads,10);
  assert.deepEqual(a.records.map(x=>x.tab_id),owned);
  assert(a.records.every(x=>x.change==='INITIAL'));
  assert(!JSON.stringify(a).includes('safe page'));
  assert.equal(a.authority_effect,false);assert.equal(a.completion_proven,false);
  const b=await runObservationBatch({params:{
    parallelism:2,
    since:owned.map(tab_id=>({tab_id,revision:'c'.repeat(64)}))
  },ownedTabs:owned,observe});
  assert(b.records.every(x=>x.change==='UNCHANGED'));
});

test('partial failure and incomplete AX transcript fail closed and do not abort other tabs',async()=>{
  const owned=[tab(1),tab(2),tab(3)];
  const observe=async id=>{
    if(id===tab(2)) throw new Error('ERR_SECRET_connection/password value');
    return {tab_id:id,revision:'d'.repeat(64),chars:id===tab(3)?180000:20,
      complete:id!==tab(3),authority_effect:false};
  };
  const data=await runObservationBatch({params:{
    since:[{tab_id:tab(3),revision:'d'.repeat(64)}]
  },ownedTabs:owned,observe});
  assert.equal(data.observed,2);assert.equal(data.unknown,1);
  assert.equal(data.records[1].state,'UNKNOWN');
  assert.equal(data.records[1].error,'observation_failed');
  assert.equal(data.records[2].change,'TRUNCATED_UNVERIFIED');
  assert.equal(data.records[0].change,'INITIAL');
  assert.equal(data.records[2].authority_effect,false);
});

test('malformed adapter response never receives a positive observation',async()=>{
  const data=await runObservationBatch({
    params:{tab_ids:[tab(1)]},ownedTabs:[tab(1)],
    observe:async()=>({tab_id:tab(2),revision:'f'.repeat(64),complete:true,
      chars:7,authority_effect:false})
  });
  assert.equal(data.observed,0);
  assert.equal(data.records[0].state,'UNKNOWN');
  assert.equal(data.records[0].error,'observation_readback_invalid');
});
