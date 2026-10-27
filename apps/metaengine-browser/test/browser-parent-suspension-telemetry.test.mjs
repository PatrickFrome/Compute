import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures/browser-parent-suspension-fixture.mjs';
import { nativeSupervisorTransportState } from '../src/native-supervisor-client-base.mjs';
import { reservedBrowserParentTelemetry } from '../src/browser-parent-suspension-telemetry.mjs';
import { assertLiveLeaseBinding } from '../src/devos-native-task-cycle.mjs';
test('exact reserved restoration publishes genuine ACTIVE admission without making local RESUMING dispatchable',async()=>{
 const h=await fixture(),receipt=await h.transport.withQuiescentParent({lease:h.lease,checkpointContext:h.context},async c=>h.receipt(c));
 assert.equal(nativeSupervisorTransportState({fleet:h.fleet().snapshot()}).fleet.agents.length,0,'logical suspended parents do not consume bounded physical census');
 await h.transport.resumeStored({receipt:{...receipt,state:'READY_TO_RESUME'},control_generation:1},async()=>receipt);
 const local=h.fleet().snapshot(),row=local.agents[0],published=nativeSupervisorTransportState({fleet:local}).fleet.agents[0];
 assert.equal(row.lifecycle_state,'RESUMING');assert.equal(published.lifecycle_state,'ACTIVE');
 assert.equal(published.browser_parent_restoration.suspension_id,receipt.suspension_id);
 assert.throws(()=>assertLiveLeaseBinding({...h.lease,tab_id:row.tab_id,target_id:row.target_id,agent_generation_epoch:row.generation_epoch},local));
 assert.equal(reservedBrowserParentTelemetry({...row,target_id:'webcontents:999'}),null);
 assert.equal(reservedBrowserParentTelemetry({...row,browser_parent_restoration:{...row.browser_parent_restoration,authority_effect:true}}),null);
 assert.equal(reservedBrowserParentTelemetry({...row,parent_restoration:{...row.parent_restoration,checkpoint_sha256:'0'.repeat(64)}}),null);
});
