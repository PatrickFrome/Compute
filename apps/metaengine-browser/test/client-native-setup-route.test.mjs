import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readClientNativeSetupRoute} from '../src/client-native-setup-route.mjs';
import {nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
function fixture(){
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),enrolled:true},binding={instance_id:randomUUID(),host_pid:12345};
 const repository={coordination_workspace_id:randomUUID(),repo_id:'fixture:repo',repo_root:'/repo',managed_root:'/managed'};
 const identity={snapshot:()=>device,deviceHeaders:async()=>({'content-type':'application/json','x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
  'x-a2-chat-bridge-client':device.client_id,'x-a2-device-id':device.device_id,'x-a2-device-timestamp':new Date().toISOString(),
  'x-a2-device-nonce':'a'.repeat(32),'x-a2-device-body-sha256':'b'.repeat(64),'x-a2-device-signature':'A'.repeat(86)})};
 const value={schema:'metaengine.native-coding.setup-route.v1',workspace_id:repository.coordination_workspace_id,
  device_id:device.device_id,client_id:device.client_id,key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:1,
  repository_scope_sha256:sha({...repository,device_id:device.device_id,client_id:device.client_id,admin_grant_epoch:1}),
  host_instance_id:binding.instance_id,host_pid:binding.host_pid,retained_intent:false,scope_resolved:true,
  prepared:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 const capability={snapshot:()=>binding,readNativeSetupRoute:async()=>structuredClone(value)};
 return{device,binding,repository,identity,value,capability,read:()=>readClientNativeSetupRoute({repository,identity,capability})};
}
test('readonly route binds current device, Host, repository and fresh grant without paths in response',async()=>{
 const f=fixture();assert.deepEqual(await f.read(),{retained_intent:false,scope_resolved:true,authority_effect:false});
 f.value.retained_intent=true;assert.equal((await f.read()).retained_intent,true);
});
for(const [key,value] of Object.entries({workspace_id:randomUUID(),device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'b'.repeat(64),
 host_instance_id:randomUUID(),host_pid:12346,admin_grant_epoch:2,repository_scope_sha256:'c'.repeat(64),scope_resolved:false,prepared:true,execution_ready:true,authority_effect:true,arbitrary:true}))
 test(`route projection refuses changed/forged ${key}`,async()=>{const f=fixture();f.value[key]=value;await assert.rejects(f.read(),/unverified/);});
test('missing configuration requires explicit null-scope absence or unresolved retained intent',async()=>{
 const f=fixture();f.value.workspace_id=null;f.value.repository_scope_sha256=null;
 const read=()=>readClientNativeSetupRoute({...f,repository:null});assert.equal((await read()).retained_intent,false);
 f.value.retained_intent=true;await assert.rejects(read(),/unverified/);f.value.scope_resolved=false;assert.equal((await read()).scope_resolved,false);
});
test('identity changing during route response is never accepted as absence',async()=>{
 const f=fixture();f.capability.readNativeSetupRoute=async()=>{f.device.key_fingerprint_sha256='f'.repeat(64);return f.value;};await assert.rejects(f.read(),/unverified/);
});
