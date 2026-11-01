import {nativeCodingCanonicalJson as canonical} from './native-coding-task-context.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=reason=>{throw Error('native_coding_prepared_custody_'+reason);};
const same=(a,b)=>canonical(a)===canonical(b);
const leaseKeys=['task_id','agent_id','base_sha','lease_generation','agent_generation_epoch','role'];
const runnerMethods=['describePrepared','runPrepared','abandonPrepared'];

// Private Main/runtime composition. Default publication remains CLOSED even
// when this adapter is wired. A descriptor is NOT evidence: the original IPC
// client still owns its six Owner phases, COMMIT/readback/ACK/terminal checks.
// No SQL, IPC fallback, retry, scheduler, directory proof or trust promotion.
export function createNativeCodingPreparedCustodyAdapter({ownPostgres,ownerCallback,assertOpen}={}){
  if(!['prepareAgentRunCustody','reservePreparedExecution','takePreparedAgentRunCustody','abandonPreparedAgentRunCustody']
    .every(key=>typeof ownPostgres?.[key]==='function')||typeof ownerCallback!=='function'||typeof assertOpen!=='function')fail('dependencies_required');
  const descriptors=new WeakMap(),runners=new WeakMap(),rows=new Set(),pending=new Set();
  let closed=false,cleanupFailed=false;
  const open=()=>{if(closed)fail('closed');assertOpen();};
  const check=row=>{open();if(row.fenced||row.signal?.aborted)fail('fenced');};
  const retain=promise=>{pending.add(promise);const done=()=>pending.delete(promise);promise.then(done,done);return promise;};
  const attempt=async operation=>{try{await operation();return true;}catch{cleanupFailed=true;return false;}};
  function cleanup(row){
    if(row.cleanup)return row.cleanup;
    // Register before awaiting BOUND or bridge preflight. A late handoff is
    // reclaimed by this SAME owner, never discarded or promoted after close.
    row.cleanup=retain(Promise.resolve().then(async()=>{
      let ok=true;
      await row.claim?.catch(()=>{});
      if(row.token&&!row.facet)ok=await attempt(()=>ownPostgres.abandonPreparedAgentRunCustody(row.token))&&ok;
      await row.bridgeWork?.catch(()=>{});
      if(row.bridge){
        ok=await attempt(()=>row.bridge.close())&&ok;
        // Bridge callbacks must register/join before finish seals their journal.
        ok=await attempt(()=>row.bridge.drainCallbacks())&&ok;
      }
      if(row.facet){
        ok=await attempt(()=>row.facet.fence())&&ok;
        ok=await attempt(()=>row.facet.finish())&&ok;
      }
      row.signal?.removeEventListener('abort',row.abort);
      if(ok&&!row.fenceFailed)rows.delete(row);
      else fail('cleanup_unconfirmed');
    }));
    return row.cleanup;
  }
  function fence(row){
    if(!row.fenced){
      row.fenced=true;
      try{row.runner.abandonPrepared(row.handle);}catch{row.fenceFailed=true;cleanupFailed=true;}
      // Immediate dispatch fence; the separate retained cleanup joins callbacks.
      if(row.facet)try{retain(Promise.resolve(row.facet.fence()).catch(()=>{row.fenceFailed=true;cleanupFailed=true;}));}
      catch{row.fenceFailed=true;cleanupFailed=true;}
    }
    void cleanup(row).catch(()=>{});
  }
  function bindRunner({runner,handle,permit,signal}={}){
    open();if(!runnerMethods.every(key=>typeof runner?.[key]==='function')||!handle||typeof handle!=='object')fail('runner_required');
    let handles=runners.get(runner);if(!handles){handles=new WeakSet();runners.set(runner,handles);}
    if(handles.has(handle))fail('runner_reused');handles.add(handle);
    const descriptor=runner.describePrepared(handle),owned=value=>{if(value!==handle)fail('handle_unbound');};
    if(descriptor?.state==='READBACK_ONLY')return Object.freeze({
      describePrepared(value){owned(value);return descriptor;},
      runPrepared(){fail('readback_only');},
      abandonPrepared(value){owned(value);return runner.abandonPrepared(handle);},
      prepareBridge(){fail('readback_only');},
    });
    const p=structuredClone(permit),b=descriptor?.binding;
    if(!descriptor||!Object.isFrozen(descriptor)||descriptor.schema!=='metaengine.codex-cli.prepared-run.v1'
      ||descriptor.state!=='PREPARED'||!Object.isFrozen(b)||!UUID.test(descriptor.runId||'')
      ||!descriptor.callbackJournal||typeof descriptor.callbackJournal.snapshot!=='function'
      ||descriptor.sql_reservation!=='NOT_ATTESTED'||descriptor.authority_effect!==false
      ||descriptor.automatic_retry_allowed!==false||descriptor.production_qualified!==false
      ||p.revoked!==false||p.trust_namespace!=='LOCAL_OPERATOR_QA'
      ||!['workspace_id','project_id','provider_id','permit_id'].every(key=>UUID.test(p[key]||''))
      ||['agent_id','agent_generation_epoch','role'].some(key=>p[key]!==b[key])
      ||p.worktree?.base_sha!==b.base_sha||p.worktree?.path!==descriptor.worktreePath
      ||!Number.isFinite(Date.parse(descriptor.expiresAt))||Date.parse(descriptor.expiresAt)<=Date.now()
      ||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(descriptor.expiresAt)>Date.parse(p.expires_at))fail('descriptor_unbound');
    const binding=Object.freeze({run_id:descriptor.runId,workspace_id:p.workspace_id,project_id:p.project_id,
      task_id:b.task_id,lease_generation:b.lease_generation,agent_id:b.agent_id,agent_generation_epoch:b.agent_generation_epoch,
      provider_id:p.provider_id,role:b.role});
    const row={runner,handle,descriptor,permit:p,binding,signal,state:'PREPARED',fenced:false,fenceFailed:false,
      token:null,facet:null,claim:null,bridge:null,bridgeWork:null,cleanup:null,bridgeStarted:false,taken:false};
    rows.add(row);descriptors.set(descriptor,row);row.abort=()=>fence(row);
    signal?.addEventListener('abort',row.abort,{once:true});if(signal?.aborted)fence(row);
    return Object.freeze({
      describePrepared(value){owned(value);return descriptor;},
      runPrepared(value){
        owned(value);check(row);if(row.state!=='RESERVED')fail('reservation_required');
        row.state='RUNNING'; // consume before the first await; never join/replay
        return retain(Promise.resolve().then(()=>{check(row);return runner.runPrepared(handle);}).finally(()=>fence(row)));
      },
      abandonPrepared(value){owned(value);fence(row);return Object.freeze({state:'FENCED',physical_settlement:'NOT_ATTESTED',authority_effect:false});},
      prepareBridge(details,prepare){
        check(row);if(row.state!=='RUNNING'||row.bridgeStarted||typeof prepare!=='function')fail('bridge_unbound');
        row.bridgeStarted=true;
        let fixed;
        try{fixed=Object.freeze({runId:details?.runId,callbackJournal:details?.callbackJournal,deadlineAt:details?.deadlineAt,
          binding:Object.freeze(structuredClone(details?.binding)),authorization:Object.freeze(structuredClone(details?.authorization))});}
        catch(error){fence(row);return Promise.reject(error);}
        // Every current-permit/pins/platform/broker preflight is INSIDE this
        // retained operation; a failure before take still abandons the token.
        row.bridgeWork=retain(Promise.resolve().then(async()=>{
          check(row);
          if(fixed.runId!==descriptor.runId||fixed.callbackJournal!==descriptor.callbackJournal
            ||!same(fixed.binding,b)||leaseKeys.some(key=>fixed.authorization?.[key]!==b[key])
            ||['permit_id','owner_epoch','workspace_id','project_id','user_sid'].some(key=>fixed.authorization?.[key]!==p[key])
            ||fixed.authorization?.worktree_path!==p.worktree.path
            ||!Number.isFinite(Date.parse(fixed.deadlineAt))||Date.parse(fixed.deadlineAt)<=Date.now()
            ||Date.parse(fixed.deadlineAt)>Date.parse(descriptor.expiresAt))fail('bridge_binding_changed');
          let taking=true;
          const takePreparedCustody=()=>{
            check(row);if(!taking||row.taken)fail('custody_consumed');row.taken=true;
            row.facet=ownPostgres.takePreparedAgentRunCustody(row.token);
            return row.facet;
          };
          try{row.bridge=await prepare(takePreparedCustody,fixed);}finally{taking=false;}
          check(row);
          if(!row.taken||!row.facet||!row.bridge||typeof row.bridge.close!=='function'||typeof row.bridge.drainCallbacks!=='function')fail('bridge_custody_required');
          return row.bridge;
        }));
        return row.bridgeWork.catch(error=>{fence(row);throw error;});
      },
    });
  }
  function reserve(rawScope,{prepared}={}){
    const row=descriptors.get(prepared);
    if(!row||row.state!=='PREPARED')return Promise.reject(Error('native_coding_prepared_custody_descriptor_unbound'));
    row.state='RESERVING'; // consume even an invalid first scope; never fallback
    let scope;
    try{
      check(row);scope=Object.freeze(structuredClone(rawScope));const b=row.binding;
      if(['workspace_id','task_id','lease_generation','agent_id','agent_generation_epoch'].some(key=>scope[key]!==b[key])
        ||scope.target_id!==`codex-cli:${b.provider_id}`)fail('scope_changed');
    }catch(error){fence(row);return Promise.reject(error);}
    return retain(Promise.resolve().then(async()=>{
      try{
        check(row);const b=row.binding;
        row.claim=retain(Promise.resolve().then(()=>{check(row);return ownPostgres.prepareAgentRunCustody({binding:b,journal:prepared.callbackJournal});})
          .then(token=>{row.token=token;return token;}));
        await row.claim;check(row);
        const value=await ownPostgres.reservePreparedExecution(scope,row.token,async tx=>{
          check(row);const result=await ownerCallback(tx);check(row);return result;
        });
        check(row);
        if(value?.state==='READBACK_ONLY'){fence(row);return value;}
        if(value?.state!=='RESERVED')fail('reservation_unconfirmed');
        row.state='RESERVED';return value;
      }catch(error){fence(row);throw error;}
    }));
  }
  return Object.freeze({bindRunner,reserve,
    close(){if(!closed){closed=true;for(const row of rows)fence(row);}},
    async drain(){
      if(!closed)fail('close_required');
      while(pending.size)await Promise.allSettled([...pending]);
      if(cleanupFailed||rows.size)fail('cleanup_unconfirmed');
      return Object.freeze({schema:'metaengine.native-coding.prepared-custody-drain.v1',local_work_joined:true,
        physical_settlement:'NOT_ATTESTED',authority_effect:false,automatic_retry_allowed:false});
    },
    snapshot:()=>Object.freeze({schema:'metaengine.native-coding.prepared-custody-adapter.v1',closed,runs:rows.size,pending:pending.size,
      cleanup_failed:cleanupFailed,physical_settlement:'NOT_ATTESTED',authority_effect:false,automatic_retry_allowed:false}),
  });
}
