import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAdaptiveV1, AdaptiveRouterError } from '../coordination/browser-shared/adaptive-router-v1.mjs';

const ex=(id,extra={})=>({executor_id:id,executor_incarnation_id:`inc.${id}`,surface:'COMPUTE_BROWSER_PRIMARY',health:'HEALTHY',trust_class:'TRUSTED_LOCAL',session_class:'A2_DEDICATED',capabilities:['CLICK','PERCEPTION'],raw_engine_exposed:false,locality:'LOCAL',region:'us-east-2',active_leases:0,max_leases:4,observed_latency_ms:20,...extra});
const req=(extra={})=>({action_id:'action.r16.hard',resource_id:'resource.r16.hard',effect_state:'PRE_EFFECT',required_capabilities:['CLICK'],allowed_surfaces:['COMPUTE_BROWSER_PRIMARY','REMOTE_BROWSER_POOL','EXTENSION_COMPAT'],allowed_trust_classes:['TRUSTED_LOCAL','ATTESTED_REMOTE','COMPAT_USER_SESSION'],allowed_session_classes:['A2_DEDICATED','REMOTE_ISOLATED','USER_EXISTING'],local_required:false,prefer_local:false,preferred_region:null,sticky_executor_id:null,...extra});
const policy=()=>({policy_id:'policy.r16.hard',surface_preference:['COMPUTE_BROWSER_PRIMARY','REMOTE_BROWSER_POOL','EXTENSION_COMPAT']});
const code=(fn,c)=>assert.throws(fn,e=>e instanceof AdaptiveRouterError&&e.code===c);

test('a draining executor is a hard rejection even when it is fastest and sticky',()=>{
  const draining=ex('exec.drain',{health:'DRAINING',observed_latency_ms:0});
  const healthy=ex('exec.healthy',{observed_latency_ms:500});
  const r=routeAdaptiveV1({request:req({sticky_executor_id:'exec.drain'}),executors:[draining,healthy],policy:policy()});
  assert.equal(r.executor_id,'exec.healthy');
  assert.deepEqual(r.rejected,[{executor_id:'exec.drain',reason:'DRAINING'}]);
});

test('decision receipt is deterministic across executor input order',()=>{
  const a=ex('exec.a',{active_leases:1,max_leases:4,observed_latency_ms:40});
  const b=ex('exec.b',{active_leases:1,max_leases:4,observed_latency_ms:40});
  const raw=ex('exec.raw',{raw_engine_exposed:true,observed_latency_ms:1});
  const drain=ex('exec.drain',{health:'DRAINING',observed_latency_ms:0});
  const one=routeAdaptiveV1({request:req(),executors:[raw,b,drain,a],policy:policy()});
  const two=routeAdaptiveV1({request:req(),executors:[a,drain,b,raw],policy:policy()});
  assert.deepEqual(one,two);
  assert.equal(one.executor_id,'exec.a');
  assert.deepEqual(one.rejected,[{executor_id:'exec.drain',reason:'DRAINING'},{executor_id:'exec.raw',reason:'RAW_ENGINE_EXPOSED'}]);
});

test('load ordering uses exact integer ratios before latency',()=>{
  const halfSlow=ex('exec.half',{active_leases:1,max_leases:2,observed_latency_ms:999});
  const thirdFast=ex('exec.third',{active_leases:1,max_leases:3,observed_latency_ms:1});
  const r=routeAdaptiveV1({request:req(),executors:[halfSlow,thirdFast],policy:policy()});
  assert.equal(r.executor_id,'exec.third');
  assert.equal(r.score_inputs.active_leases,1);
  assert.equal(r.score_inputs.max_leases,3);
});

test('fractional or non-finite latency metrics are rejected instead of introducing cross-runtime score ambiguity',()=>{
  code(()=>routeAdaptiveV1({request:req(),executors:[ex('exec.bad',{observed_latency_ms:1.25})],policy:policy()}),'router_latency_invalid');
  code(()=>routeAdaptiveV1({request:req(),executors:[ex('exec.nan',{observed_latency_ms:Number.NaN})],policy:policy()}),'router_latency_invalid');
});

test('router remains pre-effect only and emits routing evidence without actuation authority',()=>{
  const r=routeAdaptiveV1({request:req(),executors:[ex('exec.a')],policy:policy()});
  assert.equal(r.safety_filter_complete,true);
  assert.equal(r.fresh_authority_required,true);
  assert.equal(r.lease_required,true);
  assert.equal(r.automatic_retry_allowed,false);
  assert.equal(r.authority_effect,false);
  assert.equal(r.actuation_eligible,false);
  code(()=>routeAdaptiveV1({request:req({effect_state:'IN_FLIGHT'}),executors:[ex('exec.a')],policy:policy()}),'router_post_effect_routing_forbidden');
});
