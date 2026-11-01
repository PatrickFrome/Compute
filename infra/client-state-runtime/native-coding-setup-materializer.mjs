import {createManagedTaskProjectCommandAdapter,validateManagedProjectAdmission} from '../../apps/metaengine-browser/src/managed-task-project-command-adapter.mjs';
import {normalizeManagedProjectAuthorityRequest,managedProjectEffectKey} from '../../apps/metaengine-browser/src/managed-task-project-authority-resolver.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';

const fail=reason=>{throw Error('native_setup_materializer_'+reason);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const same=(a,b)=>json(a)===json(b);
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const identityKeys=['workspace_id','workspace_generation','worktree_id','coordination_workspace_id','task_id','claim_id','point_id',
 'claim_class','repo_id','repo_root','managed_root','worktree_path','base_sha','branch_name','agent_id','tab_id','target_id',
 'agent_generation_epoch','lease_generation'];
const materializerDrains=new WeakMap();
// Consumer-only lookup of the actual constructor closure. A generic job
// callback with look-alike take/consume properties cannot acquire this origin.
export function takeNativeSetupMaterializerDrain(runJob,scope){return materializerDrains.get(runJob)?.take(scope)??null;}
export function consumeNativeSetupMaterializerDrain(runJob,token,scope,consumer){
 const owner=materializerDrains.get(runJob);if(!owner)fail('original_materializer_required');return owner.consume(token,scope,consumer);
}

// Private CONSUMER of the existing Main admission and Owner custody path. The
// selector/source pin must belong to the original signed setup operation. A
// missing selector is not permission to allocate a task/lease or pick a newer
// one. These callbacks are constructor bindings, never IPC/request fields.
//
// withOwnerCustody retains the existing local native Owner custody until its
// callback joins. assertOwnerCurrent must synchronously reject stop/replacement.
// executePlan must join every started native resource before resolving/rejecting,
// or markNativePhysicalSettlementUnconfirmed. No default executor is selected:
// the existing single-child Git executor does not attest Windows descendants.
export function createNativeCodingSetupMaterializer({readAdmittedRequest,withOwnerCustody,resolveProjectBinding,
 executePlan,journal,reserveBinding,finalizeBinding,readSource}={}){
 if([readAdmittedRequest,withOwnerCustody,resolveProjectBinding,executePlan,reserveBinding,finalizeBinding,readSource]
  .some(value=>typeof value!=='function')||typeof journal?.find!=='function'||typeof journal?.append!=='function')fail('private_dependencies_required');
 // Optional ORIGINAL native-resource-owner facet. The current Git executor has
 // none. Capture the closure once; neither a request flag nor a later property
 // replacement can qualify this factory. No public/identifier-based mint exists.
 const joinOriginalDrain=typeof executePlan.joinOriginalDrain==='function'?executePlan.joinOriginalDrain.bind(executePlan):null;
 const completedJobs=new WeakMap(),handoffs=new WeakMap();
 async function runJob(scope){
  if(!scope||typeof scope.revalidate!=='function'||!scope.signal||scope.input?.operation_id!==scope.operation_id
   ||scope.input.workspace_id!==scope.observation?.workspace_id||!scope.actor)fail('private_scope_required');
  let completion=null;
  if(joinOriginalDrain){
   if(completedJobs.has(scope))fail('original_job_reentered');
   completion={scope,state:'RUNNING'};completedJobs.set(scope,completion);
  }
  const nativeInvocations=[];let originalMutation=false;
  async function executeOriginal(plan,options={}){
   if(plan.effect==='WORKTREE_CREATE_LOCKED')originalMutation=true;
   try{const result=await executePlan(plan,{...options,originalJob:scope});nativeInvocations.push(result);return result;}
   catch(error){nativeInvocations.push(error);throw error;}
  }
  const open=()=>{if(scope.signal.aborted)fail('cancelled');};
  const revalidate=async()=>{open();await scope.revalidate();open();};
  await revalidate();
  const admitted=await readAdmittedRequest(scope);open();
  if(admitted===null)return {cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};
  if(!exact(admitted,['request','source'])||!exact(admitted.source,['head','artifact_sha256'])
   ||!SHA.test(admitted.source.head||'')||!HASH.test(admitted.source.artifact_sha256||''))fail('admitted_request_invalid');
  const selected=Object.freeze({request:structuredClone(admitted.request),source:Object.freeze(structuredClone(admitted.source))}),
   original=normalizeManagedProjectAuthorityRequest(selected.request);
  const request=Object.freeze({...original,idempotency_key:managedProjectEffectKey(original)});
  if(request.coordination_workspace_id!==scope.input.workspace_id)fail('workspace_changed');
  const repo=scope.observation.repository;
  let retainedBinding=null,lastAdmission=null;
  async function resolve(input){
   await revalidate();
   const value=structuredClone(await resolveProjectBinding(input));open();
   validateManagedProjectAdmission(value,input,retainedBinding);
   if(value?.device_id!==scope.actor.device_id||value.client_id!==scope.actor.client_id
    ||value.admin_grant_epoch!==scope.actor.admin_grant_epoch)fail('principal_changed');
   const binding=value.workspace_binding;
   if(!binding||['repo_id','repo_root','managed_root'].some(key=>binding[key]!==repo[key])
    ||binding.coordination_workspace_id!==scope.input.workspace_id||binding.base_sha!==selected.source.head)fail('repository_or_source_changed');
   const identity=Object.fromEntries(identityKeys.map(key=>[key,binding[key]]));
   if(retainedBinding&&!same(identity,retainedBinding))fail('admission_changed');
   retainedBinding=identity;lastAdmission=value;
   return value;
  }
  async function source(){
   const proof=await readSource({repo_root:repo.repo_root,signal:scope.signal,originalJob:scope});open();
   if(proof?.clean!==true||proof.head!==selected.source.head||proof.artifact_sha256!==selected.source.artifact_sha256)fail('source_changed');
  }
  const adapter=createManagedTaskProjectCommandAdapter({journal,reserveBinding,finalizeBinding,
   executeCommand:()=>fail('command_denied'),resolveProjectBinding:resolve,
   async executePlan(plan){
    if(!['WORKTREE_INVENTORY_READ','WORKTREE_CREATE_LOCKED'].includes(plan?.effect))fail('plan_denied');
    // After cancellation the existing runtime may still inventory an uncertain
    // create. That read is cleanup/readback; it cannot launch another mutation.
    if(plan.effect==='WORKTREE_INVENTORY_READ')return executeOriginal(plan);
    await revalidate();
    let accepting=true,entered=false,work=null;
    try{
     await withOwnerCustody({scope,request,source:selected.source},assertOwnerCurrent=>{
      if(!accepting||entered)fail('owner_callback_replayed');entered=true;
      work=Promise.resolve().then(async()=>{
       if(typeof assertOwnerCurrent!=='function')fail('owner_custody_required');
       await resolve(request);await revalidate();await source();
       // No await between the local native custody check and the fixed effect.
       // A promise/boolean/serialized proof is not an Owner custody assertion.
       if(!accepting)fail('owner_custody_ended');
       if(!Number.isFinite(Date.parse(lastAdmission?.claim?.lease_expires_at))
        ||Date.parse(lastAdmission.claim.lease_expires_at)<=Date.now())fail('lease_expired');
       const assertion=assertOwnerCurrent();
       if(assertion!==undefined){await Promise.allSettled([assertion]);fail('owner_custody_invalid');}
       open();return executeOriginal(plan,{signal:scope.signal});
      });
      work.catch(()=>{});return work;
     });
     accepting=false;
     if(!work)fail('owner_custody_required');
     return await work;
    }finally{
     // Even a lost custody ACK or a wrapper swallowing the effect rejection
     // cannot release this job before its already-started physical callback.
     accepting=false;await work?.catch(()=>{});
    }
   },
  });
  // The shared adapter journals RESERVED before the effect and preserves its
  // original PROVEN/AMBIGUOUS receipt on unknown outcomes. This setup lifecycle
  // does not create a CLI permit, sandbox evidence, seed profile or readiness.
  let adapterError=null;
  try{await adapter({action:'PROJECT_CREATE',payload:request});}catch(error){adapterError=error;}
  if(joinOriginalDrain){
   // These are actual executor return/error OBJECT IDENTITIES and the exact
   // original job object, not reconstituted IDs or serialized settlement rows.
   // Join every original native lane even when another lane rejects. The facet
   // owns helper/children/output/cancellation settlement for this original job.
   const joined=await Promise.allSettled(nativeInvocations.map(value=>Promise.resolve().then(()=>joinOriginalDrain(value,scope))));
   if(joined.some(value=>value.status==='rejected'||value.value!==undefined)){
    completion.state='HOLD';throw markNativePhysicalSettlementUnconfirmed(Error('native_setup_materializer_original_drain_unconfirmed'));
   }
  }
  if(adapterError){if(completion)completion.state='HOLD';throw adapterError;}
  if(completion)completion.state=originalMutation?'READY':'READBACK_ONLY';
  return {cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'};
 }
 function assertOriginalJobDrained(scope){
  // This private service veto is checked only after native joins. A durable
  // SQL terminal/cleanup boolean cannot supply the missing native producer.
  if(typeof scope.assertJobResourcesDrained!=='function'||scope.assertJobResourcesDrained()!==undefined)fail('original_job_not_drained');
 }
 function takeJobDrain(scope){
  const row=completedJobs.get(scope);
  if(!row||row.state!=='READY')return null;
  try{assertOriginalJobDrained(scope);}catch{return null;}
  const token=Object.freeze(Object.create(null));row.state='TAKEN';handoffs.set(token,row);return token;
 }
 function consumeJobDrain(token,scope,consumer){
  const row=token&&(typeof token==='object'||typeof token==='function')?handoffs.get(token):null;
  if(!row||row.scope!==scope||row.state!=='TAKEN'||typeof consumer!=='function')fail('job_drain_handoff_invalid');
  // Burn before any external callback/await. Failure or a lost ACK cannot be
  // retried with this token, a cloned token, or identifiers from its job.
  handoffs.delete(token);row.state='CONSUMED';assertOriginalJobDrained(scope);
  const original=Object.freeze({scope,materialization_outcome:'UNKNOWN',automatic_retry_allowed:false,authority_effect:false});
  return Promise.resolve().then(()=>{assertOriginalJobDrained(scope);return consumer(original);});
 }
 materializerDrains.set(runJob,{take:takeJobDrain,consume:consumeJobDrain});
 return Object.freeze(Object.defineProperties(runJob,{takeJobDrain:{value:takeJobDrain},consumeJobDrain:{value:consumeJobDrain}}));
}
