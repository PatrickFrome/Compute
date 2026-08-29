import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAdaptiveV1, AdaptiveRouterError } from '../coordination/browser-shared/adaptive-router-v1.mjs';

const ex=(id,extra={})=>({executor_id:id,executor_incarnation_id:`inc.${id}`,surface:'COMPUTE_BROWSER_PRIMARY',health:'HEALTHY',trust_class:'TRUSTED_LOCAL',session_class:'A2_DEDICATED',capabilities:['CLICK','PERCEPTION'],raw_engine_exposed:false,locality:'LOCAL',region:'us-east-2',active_leases:0,max_leases:4,observed_latency_ms:20,...extra});
const req=(extra={})=>({action_id:'action.r16.001',resource_id:'resource.r16.001',effect_state:'PRE_EFFECT',required_capabilities:['CLICK'],allowed_surfaces:['COMPUTE_BROWSER_PRIMARY','REMOTE_BROWSER_POOL','EXTENSION_COMPAT'],allowed_trust_classes:['TRUSTED_LOCAL','ATTESTED_REMOTE','COMPAT_USER_SESSION'],allowed_session_classes:['A2_DEDICATED','REMOTE_ISOLATED','USER_EXISTING'],local_required:false,prefer_local:true,preferred_region:'us-east-2',sticky_executor_id:null,...extra});
const policy=(extra={})=>({policy_id:'policy.r16.001',surface_preference:['COMPUTE_BROWSER_PRIMARY','EXTENSION_COMPAT','REMOTE_BROWSER_POOL'],...extra});
const code=(fn,c)=>assert.throws(fn,e=>e instanceof AdaptiveRouterError&&e.code===c);

test('fast raw-engine executor can never beat slower safe executor',()=>{
 const unsafe=ex('exec.fast',{surface:'REMOTE_BROWSER_POOL',trust_class:'ATTESTED_REMOTE',session_class:'REMOTE_ISOLATED',locality:'REMOTE',raw_engine_exposed:true,observed_latency_ms:1});
 const safe=ex('exec.safe',{observed_latency_ms:100});
 const r=routeAdaptiveV1({request:req(),executors:[unsafe,safe],policy:policy()});
 assert.equal(r.executor_id,'exec.safe'); assert.deepEqual(r.rejected,[{executor_id:'exec.fast',reason:'RAW_ENGINE_EXPOSED'}]);
});

test('trust and session classes are hard filters, not scores',()=>{
 const remote=ex('exec.remote',{surface:'REMOTE_BROWSER_POOL',trust_class:'ATTESTED_REMOTE',session_class:'REMOTE_ISOLATED',locality:'REMOTE',observed_latency_ms:1});
 const local=ex('exec.local',{observed_latency_ms:50});
 const r=routeAdaptiveV1({request:req({allowed_trust_classes:['TRUSTED_LOCAL'],allowed_session_classes:['A2_DEDICATED']}),executors:[remote,local],policy:policy()});
 assert.equal(r.executor_id,'exec.local'); assert.equal(r.rejected[0].reason,'TRUST');
});

test('local-required privacy policy eliminates every remote executor',()=>{
 const remote=ex('exec.remote',{surface:'REMOTE_BROWSER_POOL',trust_class:'ATTESTED_REMOTE',session_class:'REMOTE_ISOLATED',locality:'REMOTE',observed_latency_ms:1});
 const local=ex('exec.local');
 const r=routeAdaptiveV1({request:req({local_required:true}),executors:[remote,local],policy:policy()});
 assert.equal(r.executor_id,'exec.local'); assert.equal(r.rejected[0].reason,'LOCALITY');
});

test('missing capability and unhealthy capacity are filtered before scoring',()=>{
 const noCap=ex('exec.nocap',{capabilities:['PERCEPTION'],observed_latency_ms:1});
 const unhealthy=ex('exec.unhealthy',{health:'UNHEALTHY',observed_latency_ms:1});
 const full=ex('exec.full',{active_leases:4,max_leases:4,observed_latency_ms:1});
 const safe=ex('exec.safe',{observed_latency_ms:100});
 const r=routeAdaptiveV1({request:req(),executors:[noCap,unhealthy,full,safe],policy:policy()});
 assert.equal(r.executor_id,'exec.safe');
 assert.deepEqual(Object.fromEntries(r.rejected.map(x=>[x.executor_id,x.reason])),{'exec.nocap':'CAPABILITY','exec.unhealthy':'HEALTH','exec.full':'CAPACITY'});
});

test('eligible sticky executor wins but stale/ineligible stickiness never overrides filters',()=>{
 const a=ex('exec.a',{observed_latency_ms:5}); const b=ex('exec.b',{observed_latency_ms:50});
 let r=routeAdaptiveV1({request:req({sticky_executor_id:'exec.b'}),executors:[a,b],policy:policy()});
 assert.equal(r.executor_id,'exec.b'); assert.equal(r.selection_reason,'STICKY_ELIGIBLE');
 const bad=ex('exec.b',{health:'UNHEALTHY',observed_latency_ms:1});
 r=routeAdaptiveV1({request:req({sticky_executor_id:'exec.b'}),executors:[a,bad],policy:policy()});
 assert.equal(r.executor_id,'exec.a'); assert.equal(r.selection_reason,'FILTER_THEN_SCORE');
});

test('surface preference precedes load and latency only among already eligible executors',()=>{
 const local=ex('exec.local',{surface:'COMPUTE_BROWSER_PRIMARY',active_leases:3,max_leases:4,observed_latency_ms:200});
 const remote=ex('exec.remote',{surface:'REMOTE_BROWSER_POOL',trust_class:'ATTESTED_REMOTE',session_class:'REMOTE_ISOLATED',locality:'REMOTE',active_leases:0,max_leases:10,observed_latency_ms:1});
 const r=routeAdaptiveV1({request:req({prefer_local:false,preferred_region:null}),executors:[remote,local],policy:policy({surface_preference:['COMPUTE_BROWSER_PRIMARY','REMOTE_BROWSER_POOL','EXTENSION_COMPAT']})});
 assert.equal(r.executor_id,'exec.local');
});

test('within same policy class lower load wins before latency, then deterministic id tie break',()=>{
 const busy=ex('exec.busy',{active_leases:3,max_leases:4,observed_latency_ms:1}); const idle=ex('exec.idle',{active_leases:0,max_leases:4,observed_latency_ms:100});
 let r=routeAdaptiveV1({request:req(),executors:[busy,idle],policy:policy()}); assert.equal(r.executor_id,'exec.idle');
 const a=ex('exec.a',{observed_latency_ms:10}); const b=ex('exec.b',{observed_latency_ms:10}); r=routeAdaptiveV1({request:req(),executors:[b,a],policy:policy()}); assert.equal(r.executor_id,'exec.a');
});

test('router refuses any post-effect or ambiguous rerouting attempt',()=>{
 code(()=>routeAdaptiveV1({request:req({effect_state:'POST_EFFECT_AMBIGUOUS'}),executors:[ex('exec.a')],policy:policy()}),'router_post_effect_routing_forbidden');
});

test('no eligible executor fails closed',()=>{
 code(()=>routeAdaptiveV1({request:req({local_required:true}),executors:[ex('exec.remote',{surface:'REMOTE_BROWSER_POOL',trust_class:'ATTESTED_REMOTE',session_class:'REMOTE_ISOLATED',locality:'REMOTE'})],policy:policy()}),'router_no_eligible_executor');
});

test('decision binds exact incarnation and requires fresh authority plus lease',()=>{
 const r=routeAdaptiveV1({request:req(),executors:[ex('exec.a')],policy:policy()});
 assert.equal(r.executor_incarnation_id,'inc.exec.a'); assert.equal(r.fresh_authority_required,true); assert.equal(r.lease_required,true); assert.equal(r.automatic_retry_allowed,false); assert.equal(r.authority_effect,false); assert.equal(r.actuation_eligible,false);
});
