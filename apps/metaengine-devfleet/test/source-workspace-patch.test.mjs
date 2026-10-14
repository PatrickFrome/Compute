import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DevFleetSourceWorkspace} from '../src/source-workspace-patch.mjs';

const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function fixture(fn){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-source-hot-'));
  await fs.mkdir(path.join(root,'src'));
  await fs.mkdir(path.join(root,'test'));
  await fs.writeFile(path.join(root,'src','view.mjs'),'export const value=1;\n');
  const svc=new DevFleetSourceWorkspace({getWorkspace:()=>root});
  try{await fn({root,svc});}finally{await fs.rm(root,{recursive:true,force:true});}
}
test('developer CAS edits only pinned workspace and emits durable receipt',()=>fixture(async({root,svc})=>{
  const before=await svc.inspect({path:'src/view.mjs'});
  assert.equal(before.live_runtime_reloaded,false);
  const receipt=await svc.patch({request_id:'devfleet-hot-patch-001',path:'src/view.mjs',
    expected_sha256:before.sha256,content:'export const value=2;\n'});
  assert.equal(receipt.state,'PATCHED');
  assert.equal(receipt.live_runtime_reloaded,false);
  const observed=await svc.inspect({path:'src/view.mjs'});
  assert.equal(observed.sha256,receipt.after_sha256);
  assert.equal((await svc.status()).state,'READY');
  assert.equal((await fs.readFile(path.join(root,'src','view.mjs'),'utf8')),'export const value=2;\n');
  const repeated=await svc.patch({request_id:'devfleet-hot-patch-001',path:'src/view.mjs',
    expected_sha256:before.sha256,content:'export const value=2;\n'});
  assert.equal(repeated.already_applied,true);
  await assert.rejects(svc.patch({request_id:'devfleet-hot-patch-002',path:'src/view.mjs',
    expected_sha256:before.sha256,content:'export const value=3;\n'}),/compare_and_swap_failed/);
}));
test('workspace prohibits traversal, sensitive paths and symlink escape',()=>fixture(async({root,svc})=>{
  const before=await svc.inspect({path:'src/view.mjs'});
  for(const name of ['../outside.mjs','src/../../outside.mjs','src/private-key.mjs',
    'src/credentials.json','operator-state.json','src//view.mjs']) {
    await assert.rejects(svc.patch({request_id:'devfleet-invalid-path-001',path:name,
      expected_sha256:before.sha256,content:'evil'}),/path_denied/);
  }
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-source-outside-'));
  try {
    await fs.writeFile(path.join(outside,'victim.mjs'),'important');
    await fs.symlink(outside,path.join(root,'src','escape'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(svc.inspect({path:'src/escape/victim.mjs'}),/link_denied/);
    assert.equal(await fs.readFile(path.join(outside,'victim.mjs'),'utf8'),'important');
  } finally {await fs.rm(outside,{recursive:true,force:true});}
}));
test('prepared but unacknowledged edit remains fenced until positive exact-file readback',()=>fixture(async({root,svc})=>{
  const before=await svc.inspect({path:'src/view.mjs'});
  const first=await svc.patch({request_id:'devfleet-pending-seed-001',path:'src/view.mjs',
    expected_sha256:before.sha256,content:'export const value=4;\n'});
  const journalFile=path.join(root,'.devfleet-source-patches','state.json');
  const journal=JSON.parse(await fs.readFile(journalFile,'utf8'));
  journal.pending={schema:'metaengine.devfleet.source-patch.v1',request_id:'devfleet-pending-receipt-002',
    path:'src/view.mjs',before_sha256:first.before_sha256,after_sha256:sha('export const value=4;\n')};
  await fs.writeFile(journalFile,JSON.stringify(journal));
  const status=await svc.status();
  assert.equal(status.state,'RECONCILIATION_REQUIRED');
  await assert.rejects(svc.patch({request_id:'devfleet-no-blind-retry-003',path:'src/view.mjs',
    expected_sha256:first.after_sha256,content:'export const value=5;\n'}),/reconciliation_required/);
  const reconciled=await svc.reconcile({request_id:'devfleet-pending-receipt-002'});
  assert.equal(reconciled.state,'PATCHED');
  assert.equal(reconciled.reconciled,true);
}));
