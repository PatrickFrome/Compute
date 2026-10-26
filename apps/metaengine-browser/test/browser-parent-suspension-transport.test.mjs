import { EventEmitter } from 'node:events';
import { closeExactBrowserParentView } from '../src/browser-parent-suspension-transport.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './fixtures/browser-parent-suspension-fixture.mjs';

test('one physical slot suspends only acknowledged parent and restores original conversation after reservation admission',async()=>{
  const h=await fixture();const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  assert.equal(h.tabs.size,0);assert.equal(h.fleet().snapshot().counts.SUSPENDED,1);
  const ready={...r,state:'READY_TO_RESUME'};
  const pending=await h.transport.resumeStored({receipt:ready,control_generation:1},async()=>ready);
  assert.equal(pending.status,'SUSPENDED');let row=h.fleet().snapshot().agents[0];
  assert.equal(row.lifecycle_state,'RESUMING');assert.equal(h.tabs.size,1);assert.equal(h.urls.at(-1),r.checkpoint.conversation_url);
  assert.equal(row.browser_parent_restoration.task_id,r.task_id);assert.ok(h.frozen.has(row.tab_id));
  const generation=row.generation_epoch, tab=row.tab_id;
  await h.transport.hibernateStored(ready);assert.equal(h.tabs.size,1);assert.equal(h.closed.length,1);
  const resumed=await h.transport.resumeStored({receipt:ready,control_generation:1},async restoration=>({...ready,status:'RESUMED',state:'RESUMED',
    lease:{task_id:r.task_id,agent_id:restoration.agent_id,tab_id:restoration.tab_id,target_id:restoration.target_id,
      agent_generation_epoch:restoration.agent_generation_epoch,lease_generation:2,conversation_url_sha256:r.checkpoint.conversation_url_sha256}}));
  row=h.fleet().snapshot().agents[0];assert.equal(resumed.status,'RESUMED');assert.equal(row.lifecycle_state,'ACTIVE');
  assert.equal(row.tab_id,tab);assert.equal(row.generation_epoch,generation);assert.equal(h.urls.length,2);
  assert.equal(h.frozen.has(tab),false);
});

test('lost suspension ACK retains physical slot and durable SUSPENDING, then exact readback may close',async()=>{
  const h=await fixture();let saved;
  await assert.rejects(h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>{saved=h.receipt(c);throw Error('lost_ack');}),/lost_ack/);
  assert.equal(h.tabs.size,1);assert.equal(h.closed.length,0);assert.equal(h.fleet().snapshot().counts.SUSPENDING,1);
  await h.transport.hibernateStored(saved);assert.equal(h.tabs.size,0);assert.equal(h.fleet().snapshot().counts.SUSPENDED,1);
});

test('restart preserves pending checkpoint and readback closes no unrelated view',async()=>{
  const h=await fixture();let saved;
  await assert.rejects(h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>{saved=h.receipt(c);throw Error('lost_ack');}));
  await h.restart();assert.equal(h.fleet().snapshot().counts.SUSPENDING,1);
  await h.transport.hibernateStored(saved);assert.deepEqual(h.closed,[h.lease.tab_id], 'only idempotent cleanup of the known absent old tab');assert.equal(h.fleet().snapshot().counts.SUSPENDED,1);
});

test('changed restored transcript never calls resume authority or activates',async()=>{
  const h=await fixture();const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  h.drift();let called=false;
  await assert.rejects(h.transport.resumeStored({receipt:{...r,state:'READY_TO_RESUME'},control_generation:1},async()=>{called=true;}),/restoration_changed/);
  assert.equal(called,false);assert.equal(h.fleet().snapshot().counts.RESUMING,1);
});


test('one-slot parent child grandchild unwinds only after exact completion ACK frees the leaf',async()=>{
  const h=await fixture();
  const parent=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  const child=await h.spawn(id(20));
  const childReceipt=await h.transport.withQuiescentParent({lease:child,checkpointContext:h.context},async c=>({...h.receipt(c),task_id:child.task_id,suspension_id:id(21)}));
  const grandchild=await h.spawn(id(30));assert.equal(h.tabs.size,1);
  await assert.rejects(h.transport.releaseCompletedBrowserChild({lease:grandchild,receipt:{state:'AMBIGUOUS',task_id:grandchild.task_id,lease_generation:1}}),/completion_unconfirmed/);
  assert.equal(h.tabs.size,1);
  const complete=lease=>({...lease,schema:'metaengine.devos.browser-child-retirement.v1',retired:true,retirement_id:id(99),claim_class:'READ_ONLY',state:'RESULT_READY',automatic_retry_allowed:false,authority_effect:false});
  await h.transport.releaseCompletedBrowserChild({lease:grandchild,receipt:complete(grandchild)});
  assert.equal(h.tabs.size,0);
  async function resume(receipt) {
    return h.transport.resumeStored({receipt:{...receipt,state:'READY_TO_RESUME'},control_generation:1},async r=>({...receipt,status:'RESUMED',state:'RESUMED',
      lease:{task_id:receipt.task_id,agent_id:r.agent_id,tab_id:r.tab_id,target_id:r.target_id,agent_generation_epoch:r.agent_generation_epoch,
        lease_generation:2,conversation_url_sha256:receipt.checkpoint.conversation_url_sha256}}));
  }
  const resumedChild=await resume(childReceipt);assert.equal(h.tabs.size,1);
  await h.transport.releaseCompletedBrowserChild({lease:resumedChild.lease,receipt:complete(resumedChild.lease)});
  assert.equal(h.tabs.size,0);
  await resume(parent);assert.equal(h.tabs.size,1);
  assert.equal(h.fleet().snapshot().counts.ACTIVE,1);assert.equal(h.fleet().snapshot().counts.RETIRED,2);
  assert.equal(h.urls.length,5,'root parent, child, grandchild, original child, original parent only');
});


test('lost resume ACK retains exact frozen reservation and never creates a second physical generation',async()=>{
  const h=await fixture();const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  const ready={...r,state:'READY_TO_RESUME'};let first;
  await assert.rejects(h.transport.resumeStored({receipt:ready,control_generation:1},async restoration=>{first=restoration;throw Error('resume_unknown');}),/resume_unknown/);
  const row=h.fleet().snapshot().agents[0];assert.equal(row.lifecycle_state,'RESUMING');assert.ok(h.frozen.has(row.tab_id));
  await h.transport.resumeStored({receipt:ready,control_generation:1},async restoration=>{assert.deepEqual(restoration,first);return ready;});
  assert.equal(h.urls.length,2);assert.equal(h.tabs.size,1);
  await h.restart();
  await assert.rejects(h.transport.resumeStored({receipt:ready,control_generation:1},async()=>assert.fail('no resume without physical readback')),/physical_readback_required/);
  assert.equal(h.urls.length,2,'no replay or replacement physical generation after uncertain resume restart');
});


test('physical destroy ACK precedes registry close; canceled beforeunload retains census binding',async()=>{
  const wc=new EventEmitter();let destroyed=false,registryClosed=false;
  wc.isDestroyed=()=>destroyed;wc.close=()=>{};
  await assert.rejects(closeExactBrowserParentView({view:{webContents:wc},tabId:'old',timeoutMs:5,
    closeTab:async()=>{registryClosed=true;}}),/destroy_readback_required/);
  assert.equal(registryClosed,false);assert.equal(wc.listenerCount('destroyed'),0);
  wc.close=()=>{destroyed=true;wc.emit('destroyed');};
  await closeExactBrowserParentView({view:{webContents:wc},tabId:'old',closeTab:async()=>{
    assert.equal(destroyed,true);registryClosed=true;
  }});
  assert.equal(registryClosed,true);
});

test('signed old suspension receipt cannot close a changed physical conversation on readback',async()=>{
  const h=await fixture();let saved;
  await assert.rejects(h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>{saved=h.receipt(c);throw Error('lost_ack');}));
  h.drift();
  await assert.rejects(h.transport.hibernateStored(saved),/old_conversation_changed/);
  assert.equal(h.closed.length,0);assert.equal(h.tabs.size,1);
});

test('acknowledged ACTIVE resume accepts growing transcript on repeated heartbeat without freeze or callback',async()=>{
  const h=await fixture();const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  const resumed=await h.transport.resumeStored({receipt:{...r,state:'READY_TO_RESUME'},control_generation:1},async x=>({...r,status:'RESUMED',state:'RESUMED',
    lease:{task_id:r.task_id,agent_id:x.agent_id,tab_id:x.tab_id,target_id:x.target_id,agent_generation_epoch:x.agent_generation_epoch,
      lease_generation:2,conversation_url_sha256:r.checkpoint.conversation_url_sha256}}));
  h.drift();
  assert.equal(await h.transport.resumeStored({receipt:resumed,control_generation:1},async()=>assert.fail('no resume SQL callback')),resumed);
  assert.equal(h.frozen.has(resumed.lease.tab_id),false);assert.equal(h.urls.length,2);
  await assert.rejects(h.transport.resumeStored({receipt:{...resumed,lease:{...resumed.lease,lease_generation:3}},control_generation:1},async()=>{}),/active_resume_binding_changed/);
});

test('ready parent capacity wait does not abort observing the live one-slot child',async()=>{
  const h=await fixture();const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  const child=await h.spawn(id(40));const ready={...r,state:'READY_TO_RESUME'};
  assert.equal(await h.transport.resumeStored({receipt:ready,control_generation:1},async()=>assert.fail('capacity denial cannot post resume')),ready);
  assert.equal(h.tabs.size,1);assert.equal(h.fleet().snapshot().agents.find(a=>a.agent_id===child.agent_id).lifecycle_state,'ACTIVE');
  assert.equal(h.fleet().snapshot().agents.find(a=>a.agent_id===h.lease.agent_id).lifecycle_state,'SUSPENDED');
  assert.equal(h.urls.length,2);
});

test('same logical parent can suspend again without reusing earlier restoration receipt',async()=>{
  const h=await fixture();
  const r=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
  async function resume(receipt,generation) {
    return h.transport.resumeStored({receipt:{...receipt,state:'READY_TO_RESUME'},control_generation:1},async x=>({...receipt,status:'RESUMED',state:'RESUMED',
      lease:{task_id:receipt.task_id,agent_id:x.agent_id,tab_id:x.tab_id,target_id:x.target_id,agent_generation_epoch:x.agent_generation_epoch,
        lease_generation:generation,conversation_url_sha256:receipt.checkpoint.conversation_url_sha256}}));
  }
  const first=await resume(r,2);h.drift();
  const second=await h.transport.withQuiescentParent({lease:first.lease,checkpointContext:h.context},async c=>({...h.receipt(c),suspension_id:id(88),old_lease_generation:2}));
  assert.equal(h.fleet().snapshot().agents[0].parent_restoration,null);
  const restored=await resume(second,3);
  assert.equal(restored.lease.lease_generation,3);assert.equal(h.tabs.size,1);assert.equal(h.urls.length,3);
});
