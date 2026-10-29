import {nativeCodingCanonicalJson as canonical,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
const fail=reason=>{throw Error('native_coding_profile_preparation_'+reason);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Private configuration registration, not a public API or physical authority.
export async function prepareNativeCodingSeedProfile({sql,profile,requestContext}={}){
 assertNativeCodingHostRequestOpen(requestContext);
 if(typeof sql?.begin!=='function'||!profile||!UUID.test(profile.profile_id||'')
  ||!['metaengine.native-coding.seed-profile.v1','metaengine.native-coding.seed-profile.v2'].includes(profile.schema)
  ||(profile.schema.endsWith('.v2')&&profile.coordination_mode!=='CHAT_LED'))fail('input_invalid');
 const text=canonical(profile),profileSha=sha(profile),id=profile.profile_id;
 if(Buffer.byteLength(text)>1048576)fail('profile_too_large');
 const result=await sql.begin('isolation level serializable',async tx=>{
  assertNativeCodingHostRequestOpen(requestContext);
  const identity=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
  if(identity.length!==1||identity[0].current_user!=='state_owner'||identity[0].session_user!=='state_owner')fail('state_owner_required');
  assertNativeCodingHostRequestOpen(requestContext);
  await tx.unsafe('set local synchronous_commit=on');
  await tx.unsafe(`insert into destruktion_meta.native_coding_seed_profile_h205f22
   (profile_id,profile,canonical_profile,profile_sha256) values($1::uuid,$2::text::jsonb,$2::text,$3)
   on conflict(profile_id) do nothing`,[id,text,profileSha]);
  assertNativeCodingHostRequestOpen(requestContext);
  const rows=await tx.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1::uuid,true) as value',[id]);
  const value=rows[0]?.value;
  if(rows.length!==1||value?.schema!=='metaengine.native-coding.seed-profile-readback.v1'
   ||value.canonical_profile!==text||value.profile_sha256!==profileSha||canonical(value.profile)!==text
   ||value.revoked_at!==null||value.authority_effect!==false)fail('profile_readback_mismatch');
  assertNativeCodingHostRequestOpen(requestContext);
  return Object.freeze({schema:'metaengine.native-coding.profile-preparation.v1',profile_id:id,profile_sha256:profileSha,
   configuration_registered:true,operator_pin_published:false,physical_execution_proven:false,
   production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
 });
 // Unknown COMMIT outcomes never trigger automatic retries or new identities.
 assertNativeCodingHostRequestOpen(requestContext);return result;
}
export async function readPreparedNativeCodingSeedProfile({sql,profile_id,profile_sha256,requestContext}={}){
 assertNativeCodingHostRequestOpen(requestContext);
 if(typeof sql?.unsafe!=='function'||!UUID.test(profile_id||'')||!/^[a-f0-9]{64}$/.test(profile_sha256||''))fail('selector_invalid');
 const rows=await sql.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1::uuid,true) as value',[profile_id]);
 assertNativeCodingHostRequestOpen(requestContext);
 const value=rows[0]?.value,profile=value?.profile;
 if(rows.length!==1||value?.schema!=='metaengine.native-coding.seed-profile-readback.v1'
  ||profile?.profile_id!==profile_id||value.profile_sha256!==profile_sha256
  ||canonical(profile)!==value.canonical_profile||sha(profile)!==profile_sha256
  ||value.revoked_at!==null||value.authority_effect!==false)fail('profile_readback_mismatch');
 return Object.freeze({schema:'metaengine.native-coding.profile-preparation.v1',profile_id,profile_sha256,
  configuration_registered:true,operator_pin_published:false,physical_execution_proven:false,
  production_qualified:false,automatic_retry_allowed:false,authority_effect:false,readback_only:true});
}
