import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDeviceBootstrapRoutes} from '../../../coordination/client-v1/edge/native-device-bootstrap-routes.mjs';
import {createDevosPromotionRoutes} from '../supabase/a2-browser-native-supervisor-v1/devos-promotion-routes-core.mjs';
const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const device='719bf900-9e50-44ec-b13b-fd998f33ba95';
const binding={agent_id:'agent_12345678',tab_id:'tab_dfa1fcc6-dbdb-4140-8b64-3fdd16160977',target_id:'webcontents:2',agent_generation_epoch:28};
const context=()=>({req:{method:'POST'},path:'/v1/devos/promotion-lease',body:{...binding},clientId:'client',identity:{ok:true,id:'client',device_id:device}});
const lease=()=>({schema:'metaengine.devos.transport-promotion-lease.v1',leased:true,...binding,
 lease_id:'5e4f8ed4-4144-4c2d-a61f-be5e81e4e402',status:'ACTIVE',effect_scope:'BROWSER_CLIENT_ACTUATION',
 effect_key:'fleet.transport-promotion:agent_12345678',expires_at:new Date(Date.now()+45000).toISOString(),
 not_expired:true,holder_verified:true,target_verified:true,authority_effect:false,automatic_retry_allowed:false});
const route=(rpc)=>createNativeDeviceBootstrapRoutes({rpc,workspaceId,createPromotionRoutes:createDevosPromotionRoutes});
test('bootstrap uses the verified signed device and preserves the v1 client response',async()=>{
 const calls=[];const r=await route(async(name,args)=>{calls.push({name,args});return lease();})(context());
 assert.equal(r.status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'devos_fleet_transport_promotion_lease_v2');
 assert.equal(calls[0].args.p_device,device);assert.equal(calls[0].args.p_client,'client');assert.equal(calls[0].args.p_target,binding.target_id);
});
test('caller payload cannot override the authenticated device or client',async()=>{
 const c=context();c.body.device_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';c.body.p_device=c.body.device_id;c.body.p_client='other';
 await route(async(_,args)=>{assert.equal(args.p_device,device);assert.equal(args.p_client,'client');return lease();})(c);
});
for(const [name,identity] of [['missing',null],['unverified',{ok:false,id:'client',device_id:device}],
 ['wrong client',{ok:true,id:'other',device_id:device}],['invalid device',{ok:true,id:'client',device_id:'bad'}]]) {
 test(`bootstrap refuses ${name} identity before RPC`,async()=>{
  const c=context();c.identity=identity;let called=false;const r=await route(async()=>{called=true;})(c);
  assert.equal(r.status,401);assert.equal(called,false);
 });
}
test('bootstrap leaves release and unrelated routes to existing handlers',async()=>{
 for(const path of ['/v1/devos/promotion-release','/v1/state','/v1/commands/wait-batch']) {
  assert.equal(await route(()=>assert.fail('unexpected RPC'))({...context(),path}),null);
 }
});
test('bootstrap fences wrong agent target without passing a false lease',async()=>{
 await assert.rejects(route(async()=>({...lease(),target_id:'webcontents:3'}))(context()),/promotion_lease_readback_invalid/);
});
test('installed qualification applies only to its configured client',async()=>{
 const r=createNativeDeviceBootstrapRoutes({workspaceId,clientId:'qualified',rpc:()=>assert.fail('unexpected RPC'),createPromotionRoutes:createDevosPromotionRoutes});
 assert.equal(await r(context()),null);
});
test('bootstrap surfaces authority refusal once and never retries a failed RPC',async()=>{
 let called=0;const r=await route(async()=>{called++;throw new Error('native_bootstrap_admission_fenced');})(context());
 assert.equal(r.status,409);assert.equal(called,1);assert.equal((await r.json()).authority_effect,false);
});
test('unknown transport failure remains ambiguous with no legacy retry',async()=>{
 let called=0;await assert.rejects(route(async()=>{called++;throw new Error('connection lost');})(context()),/connection lost/);
 assert.equal(called,1);
});
