import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeCodingPreparedCustodyAdapter} from '../src/native-coding-prepared-custody-adapter.mjs';
const id=()=>randomUUID(),tick=()=>new Promise(resolve=>setImmediate(resolve)),gate=()=>Promise.withResolvers();
// GENERATED lifecycle doubles only: no SQL/publication/Owner trust and no
// production bridge mount. Original IPC protocol is tested in its own suite.
function fixture(options={}){
 const calls=[],expiry=new Date(Date.now()+60000).toISOString(),signal=new AbortController();
 const permit={permit_id:id(),provider_id:id(),workspace_id:id(),project_id:id(),agent_id:'agent_generated123',
  agent_generation_epoch:1,role:'IMPLEMENTER',owner_epoch:1,user_sid:'S-1-5-21-111-1001',revoked:false,
  trust_namespace:'LOCAL_OPERATOR_QA',worktree:{path:path.resolve('generated-worktree'),base_sha:'a'.repeat(40)},expires_at:expiry};
 const binding=Object.freeze({task_id:id(),agent_id:permit.agent_id,base_sha:permit.worktree.base_sha,
  lease_generation:1,agent_generation_epoch:1,role:permit.role});
 const journal=Object.freeze({snapshot:()=>({fixture_only:true})});
 const descriptor=Object.freeze({schema:'metaengine.codex-cli.prepared-run.v1',state:'PREPARED',runId:id(),binding,
  callbackJournal:journal,worktreePath:permit.worktree.path,expiresAt:expiry,sql_reservation:'NOT_ATTESTED',
  authority_effect:false,automatic_retry_allowed:false,production_qualified:false});
 const scope={workspace_id:permit.workspace_id,task_id:binding.task_id,agent_id:binding.agent_id,lease_generation:1,
  agent_generation_epoch:1,target_id:`codex-cli:${permit.provider_id}`,host_incarnation:'pid:123:created_100ns:134000000000000000',scope_sha256:'a'.repeat(64)};
 const handle=Object.freeze({}),token=Object.freeze({}),callbacks=new Set();let taken=false,finishWork=null,closed=false;
 const facet=Object.freeze({agentOperation:async()=>({fixture_only:true}),
  trackCallback(operation){const work=Promise.resolve().then(operation);callbacks.add(work);work.then(()=>callbacks.delete(work),()=>callbacks.delete(work));return work;},
  fence(){calls.push('facet-fence');return options.facetFence?.()||Promise.resolve();},
  finish(){if(!finishWork)finishWork=(async()=>{calls.push('facet-finish');while(callbacks.size)await Promise.allSettled([...callbacks]);await options.finish?.();return {state:'SCOPED_REQUESTS_JOINED',all_effects_cleanup:'UNCONFIRMED'};})();return finishWork;}});
 const host={async prepareAgentRunCustody(value){calls.push('claim');assert.equal(value.journal,journal);assert.equal(value.binding.project_id,permit.project_id);
   assert.equal(value.binding.provider_id,permit.provider_id);assert.equal(value.binding.run_id,descriptor.runId);await options.claim?.();calls.push('BOUND');return token;},
  async reservePreparedExecution(value,input,owner){calls.push('reserve');assert.equal(input,token);assert.deepEqual(value,scope);
   await owner({original_scope:true});await options.reserve?.();if(options.unknown)throw Error('generated_unknown');
   return options.readback?{state:'READBACK_ONLY'}:{state:'RESERVED',scope:{...value,reservation_id:id()}};},
  takePreparedAgentRunCustody(input){assert.equal(input,token);if(taken)throw Error('fixture_duplicate_take');taken=true;calls.push('take');return facet;},
  async abandonPreparedAgentRunCustody(input){assert.equal(input,token);calls.push('abandon');await options.abandon?.();},
  reserveExecution(){throw Error('legacy reserve forbidden');},drainPhysical(){throw Error('global drain forbidden');},withRunOwnerScope(){throw Error('nested Owner IPC forbidden');}};
 const adapter=createNativeCodingPreparedCustodyAdapter({ownPostgres:host,assertOpen(){if(closed)throw Error('fixture_host_closed');},
  ownerCallback:async tx=>{assert.equal(tx.original_scope,true);calls.push('owner');await options.owner?.();return {fixture_only:true};}});
 let bound;const runner={describePrepared(value){assert.equal(value,handle);return descriptor;},
  async runPrepared(value){assert.equal(value,handle);calls.push('run');return options.run?options.run({bound,details,takeBridge,facet}):{state:'GENERATED_RESULT'};},
  abandonPrepared(value){assert.equal(value,handle);calls.push('runner-fence');if(options.fenceFailure)throw Error('generated_runner_fence_failed');}};
 const details={runId:descriptor.runId,binding,callbackJournal:journal,deadlineAt:expiry,authorization:{...binding,
  permit_id:permit.permit_id,owner_epoch:permit.owner_epoch,workspace_id:permit.workspace_id,project_id:permit.project_id,user_sid:permit.user_sid,worktree_path:permit.worktree.path}};
 const takeBridge=take=>{assert.equal(take(),facet);return {close:async()=>{calls.push('bridge-close');await options.bridgeClose?.();},drainCallbacks:async()=>{calls.push('bridge-drain');await options.bridgeDrain?.();}};};
 bound=adapter.bindRunner({runner,handle,permit,signal:signal.signal});
 return {adapter,bound,runner,descriptor,handle,permit,scope,signal,calls,details,facet,token,host,takeBridge,
  reserve:()=>adapter.reserve(scope,{prepared:bound.describePrepared(handle)}),run:()=>bound.runPrepared(handle),close:()=>{closed=true;adapter.close();}};
}
async function joined(f){f.adapter.close();await f.adapter.drain();assert.equal(f.adapter.snapshot().runs,0);}

test('exact original descriptor and same permit bind one reserve/take without nested Owner IPC or legacy fallback',async()=>{
 const f=fixture({run:({bound,details,takeBridge})=>bound.prepareBridge(details,takeBridge)});
 assert.equal(f.bound.describePrepared(f.handle),f.descriptor);await f.reserve();await f.run();await joined(f);
 for(const event of ['claim','reserve','owner','take'])assert.equal(f.calls.filter(x=>x===event).length,1);
 assert.ok(f.calls.indexOf('BOUND')<f.calls.indexOf('reserve'));
});
for(const forged of ['clone','journal-replacement','foreign'])test('unregistered '+forged+' descriptor cannot reserve',async()=>{
 const f=fixture(),other=fixture(),prepared=forged==='foreign'?other.descriptor:Object.freeze({...f.descriptor,...(forged==='journal-replacement'?{callbackJournal:{}}:{})});
 await assert.rejects(f.adapter.reserve(f.scope,{prepared}),/descriptor_unbound/);assert.equal(f.calls.includes('claim'),false);await joined(f);await joined(other);
});
test('runner/handle cannot rebind and foreign handle cannot describe/run/abandon',async()=>{
 const f=fixture();assert.throws(()=>f.adapter.bindRunner({runner:f.runner,handle:f.handle,permit:f.permit}),/runner_reused/);
 for(const method of ['describePrepared','runPrepared','abandonPrepared'])assert.throws(()=>f.bound[method]({}),/handle_unbound/);await joined(f);
});
test('concurrent reserve consumes before await without disturbing original operation',async()=>{
 const hold=gate(),entered=gate(),f=fixture({reserve:async()=>{entered.resolve();await hold.promise;}});
 const first=f.reserve();await entered.promise;await assert.rejects(f.reserve(),/descriptor_unbound/);hold.resolve();await first;
 assert.equal(f.calls.filter(x=>x==='reserve').length,1);await joined(f);
});
for(const stage of ['claim','reserve','reserved'])test('cancel '+stage+' retains pre-bridge custody and prevents late resurrection',async()=>{
 const hold=gate(),entered=gate(),f=fixture({[stage]:async()=>{entered.resolve();await hold.promise;}});
 const work=f.reserve();work.catch(()=>{});if(stage==='reserved')await work;else await entered.promise;
 f.signal.abort();if(stage!=='reserved'){hold.resolve();await assert.rejects(work);}assert.throws(()=>f.run(),/fenced/);await joined(f);
 assert.equal(f.calls.includes('take'),false);assert.equal(f.calls.includes('run'),false);assert.equal(f.calls.filter(x=>x==='abandon').length,1);
});
for(const stage of ['claim','reserve','owner'])test('close during '+stage+' joins original callback and never global drain',async()=>{
 const hold=gate(),entered=gate(),f=fixture({[stage]:async()=>{entered.resolve();await hold.promise;}});
 const work=f.reserve();work.catch(()=>{});await entered.promise;f.close();let done=false;const drain=f.adapter.drain().then(()=>done=true);
 await tick();assert.equal(done,false);hold.resolve();await assert.rejects(work);await drain;assert.equal(f.calls.includes('take'),false);
 assert.equal(f.calls.filter(x=>x==='abandon').length,1);
});
for(const mode of ['unknown','readback'])test(mode+' reserve cannot launch, reclaim or retry',async()=>{
 const f=fixture({[mode]:true});if(mode==='unknown')await assert.rejects(f.reserve(),/unknown/);else assert.equal((await f.reserve()).state,'READBACK_ONLY');
 assert.throws(()=>f.run(),/fenced/);await assert.rejects(f.reserve());await joined(f);assert.equal(f.calls.includes('run'),false);assert.equal(f.calls.includes('take'),false);
});
for(const stage of ['permit','pins','platform','broker','launch'])test('bridge '+stage+' failure retains custody before registration',async()=>{
 const active=['broker','launch'].includes(stage),f=fixture({run:({bound,details})=>bound.prepareBridge(details,take=>{if(active)take();throw Error('generated_'+stage+'_refused');})});
 await f.reserve();await assert.rejects(f.run(),new RegExp(stage+'_refused'));await joined(f);
 assert.equal(f.calls.includes('take'),active);assert.equal(f.calls.includes('abandon'),!active);assert.equal(f.calls.includes('facet-finish'),active);
});
for(const stage of ['before-take','after-take'])test('close during bridge '+stage+' reclaims late completion',async()=>{
 const hold=gate(),entered=gate();let takeLater;const f=fixture({run:({bound,details,takeBridge})=>bound.prepareBridge(details,async take=>{
  takeLater=take;const bridge=stage==='after-take'?takeBridge(take):null;entered.resolve();await hold.promise;return bridge||takeBridge(take);})});
 await f.reserve();const work=f.run();work.catch(()=>{});await entered.promise;f.close();assert.throws(()=>takeLater(),/closed/);
 let done=false;const drain=f.adapter.drain().then(()=>done=true);await tick();assert.equal(done,false);hold.resolve();await assert.rejects(work);await drain;
 assert.equal(f.calls.includes('facet-finish'),stage==='after-take');assert.equal(f.calls.includes('abandon'),stage==='before-take');
});
test('take is single use and cannot escape its bridge-factory window',async()=>{
 let retained;const f=fixture({run:({bound,details,takeBridge})=>bound.prepareBridge(details,take=>{retained=take;const bridge=takeBridge(take);assert.throws(()=>take(),/custody_consumed/);return bridge;})});
 await f.reserve();await f.run();assert.throws(()=>retained(),/fenced|custody_consumed/);await joined(f);assert.equal(f.calls.filter(x=>x==='take').length,1);
});
test('bridge without custody consumption is refused and still closed/drained',async()=>{
 const f=fixture({run:({bound,details})=>bound.prepareBridge(details,()=>({close:async()=>{f.calls.push('empty-close');},drainCallbacks:async()=>{f.calls.push('empty-drain');}}))});
 await f.reserve();await assert.rejects(f.run(),/bridge_custody_required/);await joined(f);
 for(const event of ['empty-close','empty-drain','abandon'])assert.ok(f.calls.includes(event));
});
for(const mutation of ['journal','run','binding','authorization','deadline'])test('changed bridge '+mutation+' cannot take',async()=>{
 const f=fixture({run:({bound,details,takeBridge})=>{const changed={...details};
  if(mutation==='journal')changed.callbackJournal={};if(mutation==='run')changed.runId=id();if(mutation==='binding')changed.binding={...details.binding,task_id:id()};
  if(mutation==='authorization')changed.authorization={...details.authorization,project_id:id()};if(mutation==='deadline')changed.deadlineAt=new Date(Date.now()+3600000).toISOString();
  return bound.prepareBridge(changed,takeBridge);}});await f.reserve();await assert.rejects(f.run(),/bridge_binding_changed/);await joined(f);assert.equal(f.calls.includes('take'),false);
});
test('runner return and callback join stay separate; local join is not physical settlement',async()=>{
 const hold=gate(),entered=gate(),f=fixture({run:({bound,details,takeBridge,facet})=>bound.prepareBridge(details,take=>{
  const bridge=takeBridge(take);facet.trackCallback(async()=>{entered.resolve();await hold.promise;});return bridge;})});
 await f.reserve();await f.run();await entered.promise;f.adapter.close();let done=false;
 const drain=f.adapter.drain().then(value=>{done=true;assert.equal(value.physical_settlement,'NOT_ATTESTED');});await tick();assert.equal(done,false);hold.resolve();await drain;
 assert.equal(f.calls.filter(x=>x==='facet-finish').length,1);
});
for(const failure of ['abandon','bridgeClose','bridgeDrain','finish','facetFence','fenceFailure'])test('failed '+failure+' cleanup remains retained HOLD',async()=>{
 const active=!['abandon','fenceFailure'].includes(failure),f=fixture({[failure]:failure==='fenceFailure'?true:async()=>{throw Error('generated_cleanup_failure');},
  ...(active?{run:({bound,details,takeBridge})=>bound.prepareBridge(details,takeBridge)}:{})});
 await f.reserve();if(active)await f.run();f.adapter.close();await assert.rejects(f.adapter.drain(),/cleanup_unconfirmed/);
 assert.equal(f.adapter.snapshot().cleanup_failed,true);assert.ok(f.adapter.snapshot().runs>0);
});
test('closed adapter cannot bind or start custody',async()=>{
 const f=fixture();f.adapter.close();assert.equal((await f.adapter.drain()).physical_settlement,'NOT_ATTESTED');
 assert.throws(()=>f.adapter.bindRunner({runner:f.runner,handle:{},permit:f.permit}),/closed/);await assert.rejects(f.reserve());assert.equal(f.calls.includes('claim'),false);
});

test('caller mutation after reserve invocation cannot redirect original task or Host scope',async()=>{
 const f=fixture(),scope={...f.scope},work=f.adapter.reserve(scope,{prepared:f.descriptor});
 scope.task_id=id();scope.host_incarnation='pid:999:created_100ns:134000000000000000';scope.scope_sha256='b'.repeat(64);
 await work;await joined(f);assert.equal(f.calls.filter(x=>x==='reserve').length,1);
});

test('bridge snapshots original binding/authorization/deadline before its first await while retaining journal identity',async()=>{
 const f=fixture({run:({bound,details,takeBridge})=>{const original={...details,authorization:{...details.authorization}};
  const work=bound.prepareBridge(original,(take,fixed)=>{assert.equal(fixed.callbackJournal,details.callbackJournal);assert.equal(fixed.runId,details.runId);
   assert.deepEqual(fixed.authorization,details.authorization);assert.equal(fixed.deadlineAt,details.deadlineAt);return takeBridge(take);});
  original.runId=id();original.callbackJournal={};original.authorization.project_id=id();original.deadlineAt=new Date(Date.now()+3600000).toISOString();return work;
 }});await f.reserve();await f.run();await joined(f);
});
test('malformed original bridge without callback drain remains HOLD after facet and close are joined',async()=>{
 const f=fixture({run:({bound,details})=>bound.prepareBridge(details,take=>{take();return {close:async()=>{f.calls.push('raw-close');}};})});
 await f.reserve();await assert.rejects(f.run(),/bridge_custody_required/);f.adapter.close();await assert.rejects(f.adapter.drain(),/cleanup_unconfirmed/);
 assert.ok(f.calls.includes('raw-close'));assert.ok(f.calls.includes('facet-finish'));
});
