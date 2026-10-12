import assert from 'node:assert/strict';
import test from 'node:test';
import {BoundedKeyedEffectGate} from '../src/bounded-keyed-effect-gate.mjs';

const defer=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};

test('256 different tabs remain fenced; overflow cannot evict an in-flight lane',async()=>{
  const gate=new BoundedKeyedEffectGate({maxKeys:256,maxPerKey:32});
  const latch=defer();
  let active=0,peak=0;
  const tasks=Array.from({length:256},(_,i)=>gate.run('tab_'+i,async()=>{
    active++;peak=Math.max(peak,active);
    await latch.promise;
    active--;
    return i;
  }));
  assert.equal(gate.snapshot().active_keys,256);
  assert.equal(gate.snapshot().pending_operations,256);
  assert.throws(()=>gate.run('tab_overflow',()=> 'untrusted'),/effect_gate_key_capacity_exceeded/);
  const second=gate.run('tab_0',async()=>{assert.equal(active,0);return 'next';});
  assert.equal(gate.snapshot().pending_operations,257);
  latch.release();
  assert.deepEqual(await Promise.all(tasks),Array.from({length:256},(_,i)=>i));
  assert.equal(await second,'next');
  await Promise.resolve();
  assert.equal(gate.snapshot().active_keys,0);
  assert.equal(gate.snapshot().pending_operations,0);
  assert.equal(peak,256);
});

test('failed same-tab operation still serializes the successor without replay',async()=>{
  const gate=new BoundedKeyedEffectGate({maxKeys:2,maxPerKey:3});
  const latch=defer();
  let active=0,max=0;
  const first=gate.run('tab_a',async()=>{active++;max=Math.max(max,active);await latch.promise;active--;throw Error('effect_unknown');});
  const second=gate.run('tab_a',async()=>{active++;max=Math.max(max,active);active--;return 'reconciled';});
  latch.release();
  await assert.rejects(first,/effect_unknown/);
  assert.equal(await second,'reconciled');
  assert.equal(max,1);
  await Promise.resolve();
  assert.equal(gate.snapshot().active_keys,0);
});

test('bounded per-tab queue refuses a new effect before accepting it',async()=>{
  const gate=new BoundedKeyedEffectGate({maxKeys:2,maxPerKey:2});
  const latch=defer();
  let launched=0;
  const first=gate.run('tab_a',async()=>{launched++;await latch.promise;});
  const second=gate.run('tab_a',async()=>{launched++;});
  assert.throws(()=>gate.run('tab_a',async()=>{launched++;}),/effect_gate_per_key_capacity_exceeded/);
  latch.release();
  await Promise.all([first,second]);
  assert.equal(launched,2);
});

test('invalid keys and capacities fail before side effects',async()=>{
  assert.throws(()=>new BoundedKeyedEffectGate({maxKeys:0}),/effect_gate_limits_invalid/);
  const gate=new BoundedKeyedEffectGate();
  for(const key of ['',null,'x'.repeat(257)]){
    let called=false;
    assert.throws(()=>gate.run(key,()=>{called=true;}),/effect_gate_binding_invalid/);
    assert.equal(called,false);
  }
});

test('live DevOS dispatch uses bounded non-evicting per-tab gate',async()=>{
  const {readFile}=await import('node:fs/promises');
  const s=await readFile(new URL('../src/devos-native-task-cycle-core.mjs',import.meta.url),'utf8');
  assert.match(s,/import \{ BoundedKeyedEffectGate \}/);
  assert.match(s,/#tabGate = new BoundedKeyedEffectGate/);
  assert.match(s,/return this\.#tabGate\.run\(tabId, fn\)/);
  assert.doesNotMatch(s,/#tabGates\.delete\(/);
});
