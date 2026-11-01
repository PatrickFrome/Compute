import {validateNativeRepositoryPreparationBinding,planNativeRepositoryPreparation,planNativeRepositoryPreparationInventory,readNativeRepositoryPreparationInventory} from '../../apps/metaengine-browser/src/native-coding-repository-preparation-plan.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
const fail=reason=>{throw Error('native_setup_preparation_'+reason);};
const same=(a,b)=>json(a)===json(b);

// Consumer of the original Host setup scope. This is not a task admission,
// signer, native executor, or proof that the original resource tree drained.
export async function prepareNativeRepository({scope,request,source,executePlan}={}){
 if(!scope||request!==scope.preparationBinding||typeof scope.recordPreparationEffect!=='function'
  ||typeof scope.revalidatePreparation!=='function'||typeof executePlan!=='function')fail('original_scope_required');
 validateNativeRepositoryPreparationBinding(request);
 if(!same(source,request.source))fail('source_changed');
 const snapshot=json(request),plan=planNativeRepositoryPreparation(request),inventory=planNativeRepositoryPreparationInventory(request);
 const current=async()=>{
  if(json(request)!==snapshot)fail('binding_changed');
  if(scope.signal?.aborted)fail('cancelled');
  if(request.original_request.deadlineAt<=Date.now())fail('expired');
  const observed=await scope.revalidatePreparation();
  if(json(request)!==snapshot||!same(observed,request))fail('binding_changed');
  if(scope.signal?.aborted||request.original_request.deadlineAt<=Date.now())fail('expired_or_cancelled');
 };
 const effect=async(action,value={})=>{
  const response=await scope.recordPreparationEffect(action,value);
  if(json(request)!==snapshot||!same(response?.binding,request))fail('ledger_binding_changed');
  if(response.effect&&(!same(response.effect.binding,request)||response.effect.operation_id!==request.operation_id
   ||response.effect.custody_id!==request.custody_id))fail('ledger_effect_changed');
  return response;
 };
 const readExisting=row=>{
  if(row.state!=='PROVEN')fail('effect_ambiguous');
  // A retained receipt is not current native cleanup evidence. Do not launch
  // another child, re-create a worktree or promote this to runtime readiness.
  const keys=['schema','operation_id','custody_id','worktree_path','head','branch','lock_reason','preparation_binding_sha256','automatic_retry_allowed','authority_effect'];
  if(!row.readback||Object.keys(row.readback).sort().join('|')!==keys.sort().join('|')
   ||row.readback.schema!=='metaengine.native-coding.repository-preparation-readback.v1'
   ||row.readback.operation_id!==request.operation_id||row.readback.custody_id!==request.custody_id
   ||row.readback.worktree_path!==plan.worktree_path||row.readback.head!==request.source.head
   ||row.readback.branch!=='refs/heads/'+plan.branch_name||row.readback.lock_reason!==plan.argv[4]
   ||row.readback.preparation_binding_sha256!==plan.preparation_binding_sha256
   ||row.readback.authority_effect!==false||row.readback.automatic_retry_allowed!==false)fail('retained_readback_changed');
  return Object.freeze({state:'PROVEN',readback:structuredClone(row.readback),authority_effect:false});
 };
 const prior=await effect('READ');if(prior.effect)return readExisting(prior.effect);
 await current();
 // Only a successful original RESERVE acknowledgement permits one mutation.
 // A lost ACK, concurrent winner or a retained RESERVED row never does.
 const reserved=await effect('RESERVE');
 if(reserved.created!==true||reserved.effect?.state!=='RESERVED'){
  if(reserved.effect)return readExisting(reserved.effect);
  fail('reservation_unconfirmed');
 }
 let terminal;
 try{
  await current();
  await executePlan(plan);
  const result=await executePlan(inventory);
  if(result?.code!==0||typeof result.stdout!=='string')fail('inventory_failed');
  const readback=readNativeRepositoryPreparationInventory(request,result.stdout);
  if(!readback)fail('inventory_missing');
  terminal={state:'PROVEN',readback,reason:null};
 }catch(error){
  terminal={state:'AMBIGUOUS',readback:null,reason:String(error?.message||'effect_failed').slice(0,240)};
 }
 try{
  const written=await effect('TERMINAL',terminal);
  if(!written.effect||!same({state:written.effect.state,readback:written.effect.readback,reason:written.effect.reason},terminal))fail('terminal_unconfirmed');
 }catch(error){
  // Read back a potentially committed terminal without replaying its mutation.
  const retained=await effect('READ');
  if(!retained.effect||!same({state:retained.effect.state,readback:retained.effect.readback,reason:retained.effect.reason},terminal))throw error;
 }
 if(terminal.state!=='PROVEN')fail('effect_ambiguous');
 return Object.freeze({state:'PROVEN',readback:terminal.readback,authority_effect:false});
}
