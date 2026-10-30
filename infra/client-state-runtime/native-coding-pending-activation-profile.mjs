// Private Host configuration preflight only. This module creates no profile,
// permit, project, execution intent or activation authority. Its callers must
// still run fresh native Owner custody and physical checks under the SAME
// reserved transaction before an independently reviewed activation transition.
import path from 'node:path';
import {readNativeCodingSeedOperator} from './native-coding-host-seed-service.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const same=(a,b)=>json(a)===json(b);
const fail=reason=>{throw Error('native_pending_activation_'+reason);};
export function validatePendingActivationInput(value){
 if(!exact(value,['preparation_id','configuration_sha256','request_id','objective','activation_id','profile_id','profile_sha256'])
  ||![value.preparation_id,value.request_id,value.activation_id,value.profile_id].every(v=>UUID.test(v||''))
  ||!HASH.test(value.profile_sha256||'')||!HASH.test(value.configuration_sha256||'')||typeof value.objective!=='string'||!value.objective
  ||value.objective!==value.objective.trim()||[...value.objective].length>480||Buffer.byteLength(value.objective)>1920
  ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.objective))fail('input_invalid');
 return Object.freeze(structuredClone(value));
}

/** tx is the already owned reserved transaction, never a pool or nested begin.
 * readOperator is a private constructor/test dependency, not a request field.
 * The authenticated device and protected workspace config must be supplied by
 * the Host workspace scope, never deserialized from the renderer's input. */
export async function readPendingActivationProfile({tx,stateDirectory,input,configuration,device,requestContext,
 revalidate,readOperator=readNativeCodingSeedOperator,verifyStorage}={}){
 const checked=validatePendingActivationInput(input);
 if(typeof tx?.unsafe!=='function'||!path.isAbsolute(stateDirectory||'')||typeof revalidate!=='function'
  ||typeof readOperator!=='function'||!configuration||!device)fail('private_dependencies_required');
 const open=()=>assertNativeCodingHostRequestOpen(requestContext);
 const read=async()=>{
  open();const result=await readOperator(stateDirectory,
   {maximumBytes:8192,...(verifyStorage?{verifyStorage}:{}),signal:requestContext?.signal});open();
  const pin=result?.value;
  if(!exact(pin,['schema','profile_id','profile_sha256'])||pin.schema!=='metaengine.native-coding.seed-operator.v1'
   ||pin.profile_id!==checked.profile_id||pin.profile_sha256!==checked.profile_sha256)fail('operator_changed');
  return structuredClone(pin);
 };
 await revalidate(tx);open();
 const stage=await read();
 // Lock the immutable profile row including revocation. Its existing validator
 // owns exact v2 shape, roster, independent pairs, policy and live grant checks.
 const locked=await tx.unsafe('select profile_id from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=$1::uuid for share',[stage.profile_id]);
 open();if(locked.length!==1||locked[0].profile_id!==stage.profile_id)fail('profile_unavailable');
 const rows=await tx.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1::uuid,true) as value',[stage.profile_id]);
 open();const value=rows[0]?.value,p=value?.profile;
 if(rows.length!==1||value?.schema!=='metaengine.native-coding.seed-profile-readback.v1'
  ||value.revoked_at!==null||value.authority_effect!==false||!p
  ||p.schema!=='metaengine.native-coding.seed-profile.v2'||p.coordination_mode!=='CHAT_LED'
  ||p.trust_namespace!=='LOCAL_OPERATOR_QA'||p.profile_id!==stage.profile_id
  ||value.profile_sha256!==stage.profile_sha256||sha(p)!==stage.profile_sha256||json(p)!==value.canonical_profile
  ||p.production_qualified!==false||p.automatic_retry_allowed!==false||p.authority_effect!==false)fail('profile_unverified');
 // An explicit v2 activation requires this exact W74 epoch contract. This does
 // not modify or reinterpret any historical v1/v2 seed profile semantics.
 if(p.device_id!==device.device_id||p.client_id!==device.client_id||p.admin_grant_epoch!==device.admin_grant_epoch
  ||p.device_key_fingerprint_sha256!==device.key_fingerprint_sha256||p.owner_epoch!==device.admin_grant_epoch
  ||!Number.isSafeInteger(device.admin_grant_epoch)||device.admin_grant_epoch<1)fail('profile_device_changed');
 if(sha(configuration)!==checked.configuration_sha256||configuration.preparation_id!==checked.preparation_id
  ||['workspace_id','user_sid','expires_at'].some(k=>p[k]!==configuration[k])
  ||['artifact','postgres','agents'].some(k=>!same(p[k],configuration[k]))
  ||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(p.expires_at)<=Date.now())fail('profile_workspace_changed');
 // Existing pending root base is agents[0].base_sha; do not silently switch the
 // saved goal's source revision when selecting a primary writer.
 const primary=p.agents.find(a=>a.provider_id===p.primary_provider_id&&a.role==='IMPLEMENTER');
 if(!primary||primary.worktree.base_sha!==configuration.agents[0].worktree.base_sha)fail('profile_root_base_changed');
 await revalidate(tx);open();if(!same(await read(),stage))fail('operator_changed');
 return Object.freeze({schema:'metaengine.native-coding.pending-activation-profile.v1',input:checked,
  profile:structuredClone(p),profile_id:stage.profile_id,profile_sha256:stage.profile_sha256,
  configuration_only:true,owner_incarnation_verified:false,execution_ready:false,
  production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
}
