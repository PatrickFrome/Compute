import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteBrowserPoolV1, RemoteBrowserPoolError } from '../coordination/browser-shared/remote-browser-pool-v1.mjs';

const node = (id, extra={}) => ({ node_id:id,node_epoch:1,process_incarnation_id:`proc.${id}`,surface:'REMOTE_BROWSER_NODE',health:'HEALTHY',capabilities:['CLICK','PERCEPTION'],context_isolation:true,raw_engine_exposed:false,region:'us-east-2',max_leases:2,...extra });
const lease = (id,res='resource.001',extra={}) => ({lease_id:id,action_id:`action.${id}`,resource_id:res,required_capabilities:['CLICK'],now_ms:1000,ttl_ms:10000,...extra});
const code=(fn,c)=>assert.throws(fn,e=>e instanceof RemoteBrowserPoolError&&e.code===c);

test('eligible node is isolated, typed and selected deterministically by load then id',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.b')); p.registerNode(node('node.a'));
 const a=p.acquireLease(lease('lease.001','resource.1')); assert.equal(a.node_id,'node.a');
 const b=p.acquireLease(lease('lease.002','resource.2')); assert.equal(b.node_id,'node.b');
});

test('unisolated or raw-engine-exposed nodes are never eligible',()=>{
 for(const bad of [node('node.unisolated',{context_isolation:false}),node('node.raw',{raw_engine_exposed:true})]){
  const p=createRemoteBrowserPoolV1(); p.registerNode(bad); code(()=>p.acquireLease(lease('lease.bad')), 'pool_no_eligible_node');
 }
});

test('one resource has at most one active lease',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a'));
 p.acquireLease(lease('lease.1','resource.shared')); code(()=>p.acquireLease(lease('lease.2','resource.shared')), 'pool_resource_already_leased');
});

test('dispatch binds exact node epoch and process incarnation',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const l=p.acquireLease(lease('lease.1'));
 const ok=p.validateDispatch({lease_id:l.lease_id,node_id:l.node_id,node_epoch:l.node_epoch,process_incarnation_id:l.process_incarnation_id,now_ms:2000});
 assert.equal(ok.routing_eligible,true); assert.equal(ok.actuation_eligible,false);
 code(()=>p.validateDispatch({lease_id:l.lease_id,node_id:l.node_id,node_epoch:l.node_epoch,process_incarnation_id:'proc.other',now_ms:2000}),'pool_dispatch_incarnation_mismatch');
});

test('node loss before actuation is NO_EFFECT without automatic retry',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const l=p.acquireLease(lease('lease.1'));
 p.setNodeHealth({node_id:'node.a',node_epoch:1,process_incarnation_id:'proc.node.a',health:'UNHEALTHY'});
 const x=p.getLease(l.lease_id); assert.equal(x.terminal_outcome,'NO_EFFECT'); assert.equal(x.automatic_retry_allowed,false);
});

test('node loss after actuation started is terminal AMBIGUOUS',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const l=p.acquireLease(lease('lease.1'));
 p.markActuationStarted({lease_id:l.lease_id,node_id:l.node_id,node_epoch:l.node_epoch,process_incarnation_id:l.process_incarnation_id,now_ms:2000});
 p.setNodeHealth({node_id:'node.a',node_epoch:1,process_incarnation_id:'proc.node.a',health:'UNHEALTHY'});
 const x=p.getLease(l.lease_id); assert.equal(x.terminal_outcome,'AMBIGUOUS'); assert.equal(x.automatic_retry_allowed,false);
});

test('expiration preserves pre/post effect uncertainty boundary',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a'));
 const a=p.acquireLease(lease('lease.pre','resource.pre',{ttl_ms:1000})); p.sweepExpired(2000); assert.equal(p.getLease(a.lease_id).terminal_outcome,'NO_EFFECT');
 p.registerNode(node('node.a',{node_epoch:2,process_incarnation_id:'proc.node.a.2'}));
 const b=p.acquireLease(lease('lease.post','resource.post',{now_ms:3000,ttl_ms:1000}));
 p.markActuationStarted({lease_id:b.lease_id,node_id:b.node_id,node_epoch:b.node_epoch,process_incarnation_id:b.process_incarnation_id,now_ms:3500}); p.sweepExpired(4000);
 assert.equal(p.getLease(b.lease_id).terminal_outcome,'AMBIGUOUS');
});

test('node replacement requires advanced epoch and invalidates old active leases',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const l=p.acquireLease(lease('lease.1'));
 code(()=>p.registerNode(node('node.a')),'pool_node_epoch_not_advanced');
 p.registerNode(node('node.a',{node_epoch:2,process_incarnation_id:'proc.node.a.2'}));
 assert.equal(p.getLease(l.lease_id).terminal_outcome,'NO_EFFECT');
});

test('post-actuation NO_EFFECT is rejected and terminal lease cannot be rewritten',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const l=p.acquireLease(lease('lease.1'));
 p.markActuationStarted({lease_id:l.lease_id,node_id:l.node_id,node_epoch:l.node_epoch,process_incarnation_id:l.process_incarnation_id,now_ms:2000});
 code(()=>p.completeLease({lease_id:l.lease_id,outcome:'NO_EFFECT'}),'pool_post_actuation_no_effect_invalid');
 p.completeLease({lease_id:l.lease_id,outcome:'COMMITTED'}); code(()=>p.completeLease({lease_id:l.lease_id,outcome:'AMBIGUOUS'}),'pool_lease_terminal');
});

test('snapshot exposes no auth migration, raw engine or authority',()=>{
 const p=createRemoteBrowserPoolV1(); p.registerNode(node('node.a')); const x=p.snapshot();
 assert.equal(x.auth_state_migration,false); assert.equal(x.raw_engine_transport_exposed,false); assert.equal(x.automatic_retry_allowed,false); assert.equal(x.authority_effect,false); assert.equal(x.actuation_eligible,false);
});
