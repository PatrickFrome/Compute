import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserParentSuspensionMutationGate} from '../src/browser-parent-suspension-mutation-gate.mjs';
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
test('private suspension operation fences concurrent effects but permits its own nested mutation',async()=>{
 const gate=createBrowserParentSuspensionMutationGate(),entered=deferred(),release=deferred();let effects=0;
 const operation=gate.exclusive(async()=>{entered.resolve();await release.promise;await gate.mutation(async()=>{effects++;});});
 await entered.promise;await assert.rejects(gate.mutation(async()=>{effects++;}),/mutation_fenced/);
 await assert.rejects(gate.exclusive(async()=>{effects++;}),/mutation_busy/);
 assert.equal(effects,0);release.resolve();await operation;assert.equal(effects,1);
 assert.deepEqual(gate.snapshot(),{held:false,physical_mutations:0,authority_effect:false});
});
test('an in-flight effect prevents suspension before its first operation and failure releases only owned gate',async()=>{
 const gate=createBrowserParentSuspensionMutationGate(),entered=deferred(),release=deferred();
 const effect=gate.mutation(async()=>{entered.resolve();await release.promise;});await entered.promise;
 await assert.rejects(gate.exclusive(async()=>assert.fail('must not begin checkpoint')),/mutation_busy/);
 release.resolve();await effect;
 await assert.rejects(gate.exclusive(async()=>{throw Error('readback unknown');}),/readback unknown/);
 await gate.mutation(async()=>{});assert.equal(gate.snapshot().held,false);
});
