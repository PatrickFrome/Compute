import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNativeRuntimeBadge as badge} from './client-native-runtime-badge.ts';
const now=Date.parse('2026-10-29T00:00:00Z');
const observation=()=>({schema:'metaengine.client.native-runtime-observation.v1',observed_at:new Date(now).toISOString(),state:'OBSERVED',closed:false,
 physical_slot_budget:8,retained_records:2,counts:{preparing:0,running:1,result_ready:0,readback_required:1,other:0},logical_agent_limit:null,readback_only:true,
 physical_execution_proven:false,useful_work_verified:false,authority_effect:false});
const connection=()=>({local_runtime_ready:true,native_runtime:observation()});
test('native badge describes records independently of chat readiness without claiming OS execution',()=>{
 const v=badge(connection(),{now});assert.equal(v.state,'OBSERVED');assert.equal(v.label,'Native: 1 need readback');assert.equal(v.attention,true);
 assert.match(v.detail,/require separate verification/);assert.doesNotMatch(v.label,/ready|verified|autonomous/i);
 const c=connection();c.native_runtime.closed=true;assert.equal(badge(c,{now}).label,'Native: admission closed');
});
test('missing, stale, malformed and authority-bearing observations never show zero workers or retain old counts',()=>{
 for(const c of [null,{}, {...connection(),local_runtime_ready:false},
  {...connection(),native_runtime:{...observation(),physical_execution_proven:true}},
  {...connection(),native_runtime:{...observation(),observed_at:new Date(now-30001).toISOString()}},
  {...connection(),native_runtime:{...observation(),retained_records:3}},
  {...connection(),native_runtime:{...observation(),counts:{...observation().counts,secret:'never-leak'}}}]){
  const v=badge(c,{now});assert.equal(v.state,'UNAVAILABLE');assert.equal(v.label,'Native: unknown');assert.doesNotMatch(JSON.stringify(v),/never-leak/);
 }
 assert.equal(badge(connection(),{now,live:false}).state,'UNAVAILABLE');
});
test('an explicitly unbound runtime is not interpreted as an empty process census',()=>{
 const c=connection();c.native_runtime={...observation(),state:'UNBOUND',closed:null,physical_slot_budget:null,retained_records:null,counts:null};
 const v=badge(c,{now});assert.equal(v.state,'UNBOUND');assert.equal(v.label,'Native: not mounted');assert.match(v.detail,/not an OS process census/);
});

test('unbound mount explanation is explicitly historical and fixed rather than a raw failure',()=>{
 const c=connection();c.native_runtime={...observation(),state:'UNBOUND',closed:null,physical_slot_budget:null,retained_records:null,counts:null,
  last_mount_attempt:{reason:'OPERATOR_CONFIGURATION_MISSING',attempted_at:new Date(now-86400000).toISOString()}};
 const v=badge(c,{now});assert.equal(v.label,'Native: last setup blocked');assert.equal(v.attention,true);
 assert.match(v.detail,/historical setup observation/);assert.match(v.detail,/protected native setup was missing/);
 for(const attempt of [{reason:'/private/error',attempted_at:new Date(now).toISOString()},{reason:'HOST_UNAVAILABLE',attempted_at:new Date(now+5001).toISOString()}]){
  c.native_runtime.last_mount_attempt=attempt;const value=badge(c,{now});assert.equal(value.state,'UNAVAILABLE');assert.doesNotMatch(value.detail,/private/);
 }
});
