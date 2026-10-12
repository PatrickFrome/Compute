import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import { LiveUiSlots, LIVE_UI_SCHEMA } from '../src/live-ui-slots.mjs';

const example=mark=>'<!doctype html><html><head><title>METAENGINE DevFleet</title></head><body><aside>'+mark+'</aside><script>window.devfleet.list();</script></body></html>';
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-live-ui-test-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'root'), data=path.join(dir,'data');
 await fs.mkdir(path.join(root,'src'),{recursive:true});
 const builtin=path.join(dir,'builtin.html');
 await fs.writeFile(builtin,example('built-in'));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'metaengine-devfleet'}));
 await fs.writeFile(path.join(root,'src','index.html'),example('candidate A'));
 const slots=new LiveUiSlots({dataDir:data,builtinHtml:builtin});
 await slots.init();
 return {dir,root,data,builtin,slots,
  change:mark=>fs.writeFile(path.join(root,'src','index.html'),example(mark))};
}
test('one staged UI swaps without reinstall and rolls back to built-in UI',async t=>{
 const f=await fixture(t);
 assert.equal(f.slots.status().state,'PACKAGED');
 await f.slots.attach(f.root);
 const staged=await f.slots.stage();
 assert.equal(staged.staged_sha256.length,64);
 let loaded=[];
 const active=await f.slots.activate(async file=>{
   loaded.push(file);
   assert.match(await fs.readFile(file,'utf8'),/candidate A/);
 });
 assert.equal(active.state,'ACTIVE_CONFIRMED');
 assert.equal(active.generation,1);
 assert.equal(loaded.length,1);
 assert.equal(f.slots.status().active_sha256,staged.staged_sha256);
 const next=new LiveUiSlots({dataDir:f.data,builtinHtml:f.builtin});
 const onRestart=await next.init();
 assert.equal(onRestart,loaded[0]);
 await f.change('candidate B');
 await next.stage();
 const b=await next.activate(async file=>{
  assert.match(await fs.readFile(file,'utf8'),/candidate B/);
 });
 assert.equal(b.state,'ACTIVE_CONFIRMED');
 assert.equal(b.generation,2);
 const prior=await next.rollback(async file=>{
   assert.match(await fs.readFile(file,'utf8'),/candidate A/);
 });
 assert.equal(prior.state,'ACTIVE_CONFIRMED');
 assert.equal(prior.generation,3);
 assert.equal(prior.active_sha256,staged.staged_sha256);
});
test('invalid package, remote scripts, symlinks and broken JS cannot activate',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.slots.activate(()=>{}),/no_staged_candidate/);
 await fs.writeFile(path.join(f.root,'package.json'),JSON.stringify({name:'unrelated'}));
 await assert.rejects(f.slots.attach(f.root),/package_identity_invalid/);
 await fs.writeFile(path.join(f.root,'package.json'),JSON.stringify({name:'metaengine-devfleet'}));
 await f.slots.attach(f.root);
 for(const mark of [
  '</aside><script src="https://remote.example/script.js"></script><script>window.devfleet.list()</script>',
  '</aside><iframe src="https://evil.example/"></iframe><script>window.devfleet.list()</script>',
 ]) {
  await fs.writeFile(path.join(f.root,'src','index.html'),'<!doctype html><html><head><title>METAENGINE DevFleet</title></head><body><aside>'+mark+'</body></html>');
  await assert.rejects(f.slots.stage(),/external_execution_disallowed/);
 }
 await fs.writeFile(path.join(f.root,'src','index.html'),'<!doctype html><html><head><title>METAENGINE DevFleet</title></head><body><p>broken javascript syntax probe</p><script>window.devfleet. )</script></body></html>');
 await assert.rejects(f.slots.stage(),/javascript_syntax_invalid/);
});
test('file integrity tamper falls back to packaged UI on restart and fails closed',async t=>{
 const f=await fixture(t);
 await f.slots.attach(f.root);
 const staged=await f.slots.stage();
 await f.slots.activate(async()=>{});
 const slot=path.join(f.data,'live-ui','slots',staged.staged_sha256+'.html');
 await fs.writeFile(slot,example('TAMPER'));
 const next=new LiveUiSlots({dataDir:f.data,builtinHtml:f.builtin});
 assert.equal(await next.init(),f.builtin);
 assert.equal(next.status().state,'RECONCILIATION_REQUIRED');
 await assert.rejects(next.stage(),/busy_or_blocked/);
});
test('unknown activation failure triggers rollback and ambiguous fence',async t=>{
 const f=await fixture(t);
 await f.slots.attach(f.root);
 await f.slots.stage();
 let n=0;
 const result=await f.slots.activate(async file=>{n++;if(n===1)throw Error('renderer_crash');});
 assert.equal(result.state,'ACTIVATION_AMBIGUOUS');
 assert.equal(n,2);
 assert.equal(f.slots.status().pending_activation,true);
 await assert.rejects(f.slots.activate(async()=>{}),/reconciliation_required/);
 const recovery=new LiveUiSlots({dataDir:f.data,builtinHtml:f.builtin});
 assert.equal(await recovery.init(),f.builtin);
 assert.equal(recovery.status().state,'RECONCILIATION_REQUIRED');
 await assert.rejects(recovery.reconcile(async()=> 'file:///invalid'), /reconciliation_readback_mismatch/);
 const receipt=await recovery.reconcile(async file=>pathToFileURL(file).href);
 assert.equal(receipt.state,'LAST_GOOD_RESTORED');
 assert.equal(receipt.pending_activation,false);
 const again=new LiveUiSlots({dataDir:f.data,builtinHtml:f.builtin});
 assert.equal(await again.init(),f.builtin);
 assert.equal(again.status().state,'PACKAGED');
});
test('module staging keeps source SHA and has no arbitrary run/shell/DB capability',async t=>{
 const f=await fixture(t);
 await f.slots.attach(f.root);
 const staged=await f.slots.stage();
 const bytes=await fs.readFile(path.join(f.root,'src','index.html'));
 assert.equal(staged.staged_sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.equal(staged.hosted_provider,false);
 assert.equal(staged.raw_shell_available,false);
 assert.equal(staged.effect_authority,false);
 assert.equal(staged.schema,LIVE_UI_SCHEMA);
});
