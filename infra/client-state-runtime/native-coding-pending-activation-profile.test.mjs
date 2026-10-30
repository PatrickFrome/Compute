// New regression suite: configuration evidence is never activation authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {generatedStage} from './test/native-workspace-preparation-fixture.mjs';
import {nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {readPendingActivationProfile} from './native-coding-pending-activation-profile.mjs';
function fixture(change=()=>{}){
 const configuration=generatedStage(),device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),admin_grant_epoch:1};
 const profile={schema:'metaengine.native-coding.seed-profile.v2',coordination_mode:'CHAT_LED',trust_namespace:'LOCAL_OPERATOR_QA',profile_id:randomUUID(),device_id:device.device_id,client_id:device.client_id,device_key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:1,owner_epoch:1,
  workspace_id:configuration.workspace_id,user_sid:configuration.user_sid,expires_at:configuration.expires_at,artifact:configuration.artifact,postgres:configuration.postgres,agents:configuration.agents,primary_provider_id:configuration.agents[0].provider_id,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 change(profile);
 const pin={schema:'metaengine.native-coding.seed-operator.v1',profile_id:profile.profile_id,profile_sha256:sha(profile)};
 const input={preparation_id:configuration.preparation_id,configuration_sha256:sha(configuration),request_id:randomUUID(),objective:'Saved objective',activation_id:randomUUID(),profile_id:pin.profile_id,profile_sha256:pin.profile_sha256};
 let reads=0,revalidated=0;const queries=[];
 const options={stateDirectory:os.tmpdir(),input,configuration,device,readOperator:async()=>{reads++;return {value:pin};},revalidate:async()=>{revalidated++;},tx:{unsafe:async(q,args)=>{queries.push(q);assert.deepEqual(args,[pin.profile_id]);return q.includes('for share')?[{profile_id:pin.profile_id}]:[{value:{schema:'metaengine.native-coding.seed-profile-readback.v1',profile,profile_sha256:pin.profile_sha256,canonical_profile:json(profile),revoked_at:null,authority_effect:false}}];}}};
 return {options,pin,profile,input,get reads(){return reads;},get revalidated(){return revalidated;},queries};
}
test('profile validation locks current exact row, double-reads protected pin and grants no execution',async()=>{
 const f=fixture(),out=await readPendingActivationProfile(f.options);assert.equal(f.reads,2);assert.equal(f.revalidated,2);assert.equal(f.queries.length,2);assert.equal(out.configuration_only,true);assert.equal(out.owner_incarnation_verified,false);assert.equal(out.execution_ready,false);assert.equal(out.production_qualified,false);
});
for(const [name,change] of [
 ['device',p=>p.device_id=randomUUID()],['client',p=>p.client_id=randomUUID()],['epoch',p=>p.owner_epoch=2],['workspace',p=>p.workspace_id=randomUUID()],['source',p=>p.artifact={...p.artifact,source_sha:'f'.repeat(40)}],['expired',p=>p.expires_at=new Date(0).toISOString()],['production',p=>p.production_qualified=true],['mode',p=>p.coordination_mode='AUTOMATIC'],['writer',p=>p.primary_provider_id=p.agents[1].provider_id],
])test('profile rejects '+name+' mismatch despite internally matching profile digest',async()=>{
 const f=fixture(change);await assert.rejects(readPendingActivationProfile(f.options));
});
test('pin changing after locked profile read cannot authorize a different profile',async()=>{
 const f=fixture();let n=0;f.options.readOperator=async()=>({value:++n===1?f.pin:{...f.pin,profile_sha256:'f'.repeat(64)}});await assert.rejects(readPendingActivationProfile(f.options),/operator_changed/);
});
test('cancelled profile read cannot return even valid configuration',async()=>{
 const f=fixture(),abort=new AbortController();f.options.requestContext={signal:abort.signal};f.options.readOperator=async()=>{abort.abort();return{value:f.pin};};await assert.rejects(readPendingActivationProfile(f.options),/cancel|abort/);
});
