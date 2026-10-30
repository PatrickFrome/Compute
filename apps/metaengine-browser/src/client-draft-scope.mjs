import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {nativeCodingCanonicalJson as canonical} from './native-coding-task-context.mjs';
export const CLIENT_DRAFT_SCOPE_TTL_MS=5000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const keys=['device_id','client_id','key_fingerprint_sha256','enrolled'];
const fail=()=>{throw Error('client_draft_scope_unknown');};
// A presentation namespace, not human login, a confidentiality boundary against
// same-origin script, execution authority, or permission to submit a draft.
export async function readClientDraftScope({identity,readRepository,readVerifiedRoute,assertOpen=()=>{},
 now=Date.now,monotonicNow=()=>performance.now(),dispatchedAt=now(),dispatchedMonotonic=monotonicNow()}={}){
 const base={schema:'metaengine.client.draft-scope.v1',observed_at:new Date(dispatchedAt).toISOString(),
  authority_effect:false,automatic_retry_allowed:false};
 const unknown=()=>({...base,state:'UNKNOWN',scope:null,expires_at:null});
 try{
  const snapshot=identity?.snapshot?.(),before=snapshot?Object.freeze(Object.fromEntries(keys.map(key=>[key,snapshot[key]]))):null;
  if(before?.enrolled!==true||!UUID.test(before.device_id||'')||!UUID.test(before.client_id||'')||!SHA.test(before.key_fingerprint_sha256||''))return unknown();
  const assertCurrent=()=>{
   assertOpen();const current=identity.snapshot(),wall=now(),elapsed=monotonicNow()-dispatchedMonotonic;
   if(!current||keys.some(key=>current[key]!==before[key])||!Number.isFinite(wall)||!Number.isFinite(elapsed)
    ||wall<dispatchedAt||wall>=dispatchedAt+CLIENT_DRAFT_SCOPE_TTL_MS||elapsed<0||elapsed>=CLIENT_DRAFT_SCOPE_TTL_MS)fail();
  };
  assertCurrent();const repository=await readRepository();assertCurrent();
  if(!repository||!UUID.test(repository.coordination_workspace_id||''))return unknown();
  const proof=await readVerifiedRoute({repository,identity,assertCurrent});assertCurrent();
  if(proof?.authority_effect!==false||typeof proof.retained_intent!=='boolean'||proof.scope_resolved!==true)fail();
  const after=await readRepository();assertCurrent();if(canonical(after)!==canonical(repository))fail();
  const principal_id=createHash('sha256').update('metaengine.client.draft-principal.v1\0').update(canonical({
   device_id:before.device_id,client_id:before.client_id,key_fingerprint_sha256:before.key_fingerprint_sha256})).digest('hex');
  return {...base,state:'READY',scope:{principal_kind:'ENROLLED_NATIVE_DEVICE',principal_id,
   workspace_id:repository.coordination_workspace_id,project_id:null},expires_at:new Date(dispatchedAt+CLIENT_DRAFT_SCOPE_TTL_MS).toISOString()};
 }catch{return unknown();}
}
