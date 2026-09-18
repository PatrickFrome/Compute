import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteBrowserPoolV1, RemoteBrowserPoolError } from '../coordination/browser-shared/remote-browser-pool-v1.mjs';

const node = (id, extra={}) => ({
  node_id:id,
  node_epoch:1,
  process_incarnation_id:`proc.${id}`,
  surface:'REMOTE_BROWSER_NODE',
  health:'HEALTHY',
  capabilities:['CLICK','PERCEPTION'],
  context_isolation:true,
  raw_engine_exposed:false,
  region:'us-east-2',
  max_leases:2,
  ...extra,
});
const lease = (id,res,extra={}) => ({
  lease_id:id,
  action_id:`action.${id}`,
  resource_id:res,
  required_capabilities:['CLICK'],
  now_ms:1000,
  ttl_ms:10000,
  ...extra,
});
const code=(fn,c)=>assert.throws(fn,e=>e instanceof RemoteBrowserPoolError&&e.code===c);

test('DRAINING stops new allocation but preserves an already reserved lease on the same incarnation',()=>{
  const p=createRemoteBrowserPoolV1();
  p.registerNode(node('node.a'));
  p.registerNode(node('node.b'));
  const existing=p.acquireLease(lease('lease.existing','resource.existing'));
  assert.equal(existing.node_id,'node.a');

  p.setNodeHealth({node_id:'node.a',node_epoch:1,process_incarnation_id:'proc.node.a',health:'DRAINING'});
  assert.equal(p.getLease(existing.lease_id).state,'RESERVED');

  const next=p.acquireLease(lease('lease.next','resource.next'));
  assert.equal(next.node_id,'node.b');

  const dispatch=p.validateDispatch({
    lease_id:existing.lease_id,
    node_id:existing.node_id,
    node_epoch:existing.node_epoch,
    process_incarnation_id:existing.process_incarnation_id,
    now_ms:2000,
  });
  assert.equal(dispatch.routing_eligible,true);

  p.markActuationStarted({
    lease_id:existing.lease_id,
    node_id:existing.node_id,
    node_epoch:existing.node_epoch,
    process_incarnation_id:existing.process_incarnation_id,
    now_ms:2100,
  });
  const done=p.completeLease({lease_id:existing.lease_id,outcome:'COMMITTED'});
  assert.equal(done.terminal_outcome,'COMMITTED');
});

test('UNHEALTHY still terminalizes the exact active incarnation after a graceful drain',()=>{
  const p=createRemoteBrowserPoolV1();
  p.registerNode(node('node.a'));
  const l=p.acquireLease(lease('lease.1','resource.1'));
  p.setNodeHealth({node_id:'node.a',node_epoch:1,process_incarnation_id:'proc.node.a',health:'DRAINING'});
  p.markActuationStarted({lease_id:l.lease_id,node_id:l.node_id,node_epoch:l.node_epoch,process_incarnation_id:l.process_incarnation_id,now_ms:2000});
  p.setNodeHealth({node_id:'node.a',node_epoch:1,process_incarnation_id:'proc.node.a',health:'UNHEALTHY'});
  const x=p.getLease(l.lease_id);
  assert.equal(x.terminal_outcome,'AMBIGUOUS');
  assert.equal(x.automatic_retry_allowed,false);
});

test('DRAINING-only pool is unavailable for new work rather than stealing a draining slot',()=>{
  const p=createRemoteBrowserPoolV1();
  p.registerNode(node('node.a',{health:'DRAINING'}));
  code(()=>p.acquireLease(lease('lease.new','resource.new')),'pool_no_eligible_node');
});
