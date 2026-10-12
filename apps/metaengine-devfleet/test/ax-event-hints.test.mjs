import test from 'node:test';
import assert from 'node:assert/strict';
import { AxEventHints } from '../src/ax-event-hints.mjs';

test('unknown, dirty, fresh hint, rescan due: silence never proves completion',()=>{
 let now=100;
 const hints=new AxEventHints({quietMs:2000,clock:()=>now});
 assert.deepEqual(hints.poll('tab-A','webcontents:3'),{
   hint:'UNINITIALIZED',age_ms:null,authority_effect:false});
 hints.register('tab-A','webcontents:3');
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'DIRTY_HINT');
 const before=hints.sequence('tab-A');
 assert.equal(hints.acknowledge('tab-A','webcontents:3',before),true);
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'QUIET_HINT');
 now+=1999;
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'QUIET_HINT');
 now+=2;
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'RESCAN_DUE');
 assert.equal(hints.poll('tab-A','webcontents:3').authority_effect,false);
});

test('native AX update during full-tree capture prevents quiet baseline',()=>{
 const hints=new AxEventHints();
 hints.register('tab-A','webcontents:3');
 const before=hints.sequence('tab-A');
 hints.invalidate('tab-A'); // Accessibility.nodesUpdated or reload
 assert.equal(hints.acknowledge('tab-A','webcontents:3',before),false);
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'DIRTY_HINT');
 assert.equal(hints.acknowledge('tab-A','webcontents:3',hints.sequence('tab-A')),true);
 hints.invalidate('tab-A'); // Accessibility.loadComplete or debugger detach
 assert.equal(hints.poll('tab-A','webcontents:3').hint,'DIRTY_HINT');
});

test('different native target and reincarnated cell cannot inherit quiet status',()=>{
 const hints=new AxEventHints();
 hints.register('tab-A','webcontents:8');
 const seq=hints.sequence('tab-A');
 assert.equal(hints.acknowledge('tab-A','webcontents:9',seq),false);
 assert.equal(hints.poll('tab-A','webcontents:9').hint,'UNINITIALIZED');
 assert.equal(hints.acknowledge('tab-A','webcontents:8',seq),true);
 hints.unregister('tab-A');
 assert.equal(hints.poll('tab-A','webcontents:8').hint,'UNINITIALIZED');
 hints.register('tab-A','webcontents:9');
 assert.equal(hints.poll('tab-A','webcontents:9').hint,'DIRTY_HINT');
});

test('independent tab hints are not global, invalid clock cannot be quiet',()=>{
 let now=3000;
 const hints=new AxEventHints({quietMs:1000,clock:()=>now});
 hints.register('tab-A','webcontents:8');
 hints.register('tab-B','webcontents:9');
 hints.acknowledge('tab-A','webcontents:8',0);
 hints.acknowledge('tab-B','webcontents:9',0);
 hints.invalidate('tab-A');
 assert.equal(hints.poll('tab-A','webcontents:8').hint,'DIRTY_HINT');
 assert.equal(hints.poll('tab-B','webcontents:9').hint,'QUIET_HINT');
 now=1000; // monotonic clock unexpectedly moved backward
 assert.equal(hints.poll('tab-B','webcontents:9').hint,'RESCAN_DUE');
 assert.throws(()=>hints.register('tab-A','webcontents:8'),/registration_invalid/);
});
