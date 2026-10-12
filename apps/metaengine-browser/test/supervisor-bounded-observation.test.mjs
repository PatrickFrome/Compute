import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {mapBoundedObservations} from '../src/supervisor-bounded-observation.mjs';

const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

test('128 logical agents use at most four concurrent read-only observations', async()=>{
  const agents=Array.from({length:128},(_,i)=>({agent_id:'agent_'+i}));
  let active=0,peak=0;
  const result=await mapBoundedObservations(agents,async(agent,i)=>{
    active++;peak=Math.max(active,peak);
    await sleep(i%5);
    active--;
    return {agent_id:agent.agent_id, generation_state:i%2?'GENERATING':'IDLE'};
  },{concurrency:4});
  assert.equal(peak,4);
  assert.deepEqual(result.map(x=>x.agent_id),agents.map(x=>x.agent_id));
  assert.equal(result.filter(x=>x.generation_state==='GENERATING').length,64);
});

test('capture failures remain per-agent UNKNOWN rather than aborting an entire fleet snapshot',async()=>{
  const agents=Array.from({length:16},(_,i)=>i);
  const rows=await mapBoundedObservations(agents,async(i)=>{
    try{
      if(i===7)throw Error('remote_capture_failed');
      return {index:i,state:'IDLE'};
    }catch{return {index:i,state:'UNKNOWN'};}
  });
  assert.equal(rows[7].state,'UNKNOWN');
  assert.equal(rows.length,16);
  assert.deepEqual(rows.map(x=>x.index),agents);
});

test('invalid or unbounded observation pool is not silently accepted',async()=>{
  await assert.rejects(mapBoundedObservations([],()=>null,{concurrency:0}),/contract_invalid/);
  await assert.rejects(mapBoundedObservations([1],()=>null,{concurrency:17}),/contract_invalid/);
  await assert.rejects(mapBoundedObservations(null,()=>null),/contract_invalid/);
});

test('observation exception propagates without inventing a successful lease result',async()=>{
  await assert.rejects(mapBoundedObservations([1,2,3],async(i)=>{if(i===2)throw Error('capture_failed');return i;},{concurrency:2}),/capture_failed/);
});

test('a rejected observation drains the remaining owned captures before the tick exits',async()=>{
  let active=0;
  await assert.rejects(mapBoundedObservations([0,1],async(i)=>{
    active++;
    try{
      if(i===0)throw Error('bad_capture');
      await sleep(35);
      return i;
    }finally{active--;}
  },{concurrency:2}),/bad_capture/);
  assert.equal(active,0);
});

test('live supervisor uses bounded concurrency only for capture and keeps durable wake publication serialized',async()=>{
  const s=await readFile(new URL('../src/supervisor-lifecycle-runtime-core.mjs',import.meta.url),'utf8');
  const begin=s.indexOf('async #observeWorkers('),end=s.indexOf('async #observeSendReadback(',begin);
  assert.ok(begin>0&&end>begin);
  const method=s.slice(begin,end);
  assert.match(method,/mapBoundedObservations\(/);
  assert.match(method,/concurrency: 4/);
  assert.match(method,/await this\.#keepalive\.observeWorkers\(signals\)/);
  assert.ok(method.indexOf('await this.#keepalive.observeWorkers(signals)')>method.indexOf('mapBoundedObservations('));
  assert.doesNotMatch(method,/(SEMANTIC_TYPE|TYPED_CLICK|NEW_TAB|SEND)/);
});
