import {nativeCapacityPrincipal} from './native-coding-capacity-contract.mjs';
import {signNativeCodingDeviceRequest} from './native-coding-device-request.mjs';
import {createHash} from 'node:crypto';
import {createCodexCliRunner} from './codex-cli-runner.mjs';
import {createCodexCliWindowsProcessController} from './codex-cli-windows-process-controller.mjs';
import {createNativeCodingHostIssuer} from './native-coding-host-issuer.mjs';
import {nativeCodingEnvelopeSha256} from './native-coding-transport-proof.mjs';
import {createNativeCodingLeaseExecutor} from './native-coding-lease-executor.mjs';
import {createNativeCodingExecutionPool} from './native-coding-execution-pool.mjs';
import {createNativeCodingHostObservers,createNativeCodingWorkerRegistry,createNativeCodingPermitRegistry,
  createNativeCodingResultStore} from './native-coding-host-observers.mjs';
import {buildNativeCodingExecutionScope} from './native-coding-task-context.mjs';
import {createNativeCodingProjectCheckpointObserver,createNativeCodingProjectRejectionObserver} from './native-coding-project-checkpoints.mjs';
import {createNativeCodingProjectCommitObserver} from './native-coding-project-commits.mjs';
import {prepareNativeCodingAgentRunBridge} from './native-coding-agent-run-bridge.mjs';
import {createNativeCodingServiceHeartbeatPublisher,createNativeCodingServiceHeartbeatPublisherV2} from './native-coding-service-heartbeat-publisher.mjs';

import {defaultNativePhysicalSlotBudget} from './agent-resource-admission.mjs';

const UUID=/^[a-f0-9-]{36}$/,HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw new Error(`native_coding_runtime_${code}`);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const key=lease=>`${lease.task_id}:${lease.lease_generation}`;
const fence=(state,extra={})=>Object.freeze({state,...extra,automatic_retry_allowed:false,authority_effect:false});

/** Native private composition, driven exclusively by the existing W30 heartbeat. */
export function createNativeCodingRuntime({identity,ownPostgres,signedRequest,observerOptions={},runnerOptions,
  resultIndexRoot,capacityOwner=null,capacityDevice=null,physicalSlotBudget=defaultNativePhysicalSlotBudget(),readResourceAdmission,processController=null,permitRegistry=null,resultStore=null,
  // Private dependency injection supports isolated adversarial tests; it is not
  // an IPC option, renderer configuration, or a way to label fixtures native.
  observers=null,issuer=null,workerRegistry=null,runnerFactory=createCodexCliRunner,
  agentBridgeFactory=prepareNativeCodingAgentRunBridge,readServiceControl=null,readRunOwner=null,closeTimeoutMs=25000}={}) {
  if(typeof identity?.snapshot!=='function'||typeof signedRequest!=='function'||!runnerOptions
    ||typeof agentBridgeFactory!=='function'
    ||!['readScope','readLease','registerProvider','agentOperation'].every(name=>typeof ownPostgres?.[name]==='function'))fail('private_dependencies_required');
  if(!ownPostgres.ledger&&!['reserveExecution','advanceExecution','readExecution'].every(name=>typeof ownPostgres[name]==='function'))fail('private_ledger_required');
  if(!Number.isSafeInteger(closeTimeoutMs)||closeTimeoutMs<1||closeTimeoutMs>25000)fail('close_timeout_invalid');
  const ledger=ownPostgres.ledger||{
    reserve:scope=>ownPostgres.reserveExecution(scope),
    advance:(scope,t)=>ownPostgres.advanceExecution(scope,{...t,critic_proof_sha256:t.critic_proof_sha256??null,checkpoint_sha256:t.checkpoint_sha256??null}),
    read:scope=>ownPostgres.readExecution(scope),
  };
  if(!['reserve','advance','read'].every(name=>typeof ledger[name]==='function'))fail('private_ledger_required');
  const permits=permitRegistry||createNativeCodingPermitRegistry({ownPostgres,identity});
  const results=resultStore||createNativeCodingResultStore({journalRoot:runnerOptions.journalRoot,indexRoot:resultIndexRoot});
  const workers=workerRegistry||createNativeCodingWorkerRegistry({processController:processController||createCodexCliWindowsProcessController()});
  const source=observers||createNativeCodingHostObservers({...observerOptions,identity,ownPostgres,permitRegistry:permits,
    readNativeWorker:query=>workers.readNativeWorker(query),readCriticSubject:query=>results.readCriticSubject(query)});
  const nativeIssuer=issuer||createNativeCodingHostIssuer({identity,...source});
  const activeBridges=new Set();
  let closed=false,refresh=null,refreshCursor=0,refreshReason=null,closePromise=null,unsubscribeHost=null;
  let unavailableReason=null,shutdownState='OPEN',workerCleanupConfirmed=null,workerDrainPromise=null,fullDrainPromise=null;
  const localOperations=new Set();
  const trackLocal=operation=>{
    const pending=Promise.resolve().then(operation);localOperations.add(pending);
    const settled=()=>localOperations.delete(pending);pending.then(settled,settled);return pending;
  };
  const assertOpen=()=>{if(closed)fail('host_unavailable');};
  const descriptors=new Map(),providerFences=new Map(),scopes=new Map(),completionAttempts=new Map();
  const checkpoints=['reconcileProject','readProjectCheckpoint'].every(name=>typeof ownPostgres[name]==='function')
    ?createNativeCodingProjectCheckpointObserver({ownPostgres}):null;
  const rejections=typeof ownPostgres.readProjectRejection==='function'?createNativeCodingProjectRejectionObserver({ownPostgres}):null;
  const commits=['finishCheckpoint','readFinishCheckpoint'].every(name=>typeof ownPostgres[name]==='function')
    ?createNativeCodingProjectCommitObserver({ownPostgres}):null;

  const selectors=async()=>{
    const rows=await permits.listProviderSelectors();
    if(!Array.isArray(rows)||rows.some(row=>!UUID.test(row.provider_id||'')||!/^agent_[a-z0-9-]{8,64}$/.test(row.agent_id||'')))fail('provider_roster_invalid');
    return rows;
  };
  const permitFor=async lease=>{
    const match=/^codex-cli:([a-f0-9-]{36})$/.exec(lease?.target_id||'');
    if(!match)fail('native_target_required');
    const permit=await permits.readProvider({provider_id:match[1],agent_id:lease.agent_id});
    if(permit.revoked!==false||permit.provider_id!==match[1]||permit.agent_id!==lease.agent_id
      ||permit.artifact?.cli_executable_sha256!==runnerOptions.expectedExecutableSha256)fail('operator_permit_changed');
    return permit;
  };
  const taskContext=async(lease,permit)=>{
    const reply=await ownPostgres.readLease({workspace_id:permit.workspace_id,project_id:permit.project_id,
      task_id:lease.task_id,agent_id:lease.agent_id,lease_generation:lease.lease_generation,provider_id:permit.provider_id});
    if(reply?.schema!=='metaengine.native-coding.own-pg-lease.v1'||reply.source!=='PRIVATE_RUNTIME_HOST_OWN_PG'
      ||!Number.isFinite(Date.parse(reply.observed_at))||Date.parse(reply.observed_at)<Date.now()-30000
      ||typeof reply.task_prompt!=='string'||Buffer.byteLength(reply.task_prompt)>32000
      ||digest(reply.task_prompt)!==reply.value?.prompt_sha256||reply.value?.task_id!==lease.task_id
      ||reply.value.lease_generation!==lease.lease_generation||reply.value.agent_id!==lease.agent_id
      ||reply.value.target_id!==lease.target_id||reply.value.agent_generation_epoch!==lease.agent_generation_epoch
      ||reply.value.project_id!==permit.project_id||reply.value.workspace_id!==permit.workspace_id)fail('private_task_context_changed');
    return reply;
  };
  async function readBoundLease({request}) {
    assertOpen();
    const permit=await permitFor(request.lease),context=await taskContext(request.lease,permit),lease=context.value;
    assertOpen();
    if(context.task_prompt!==request.prompt||lease.base_sha!==request.lease.base_sha||lease.role!==request.role
      ||request.worktreePath!==permit.worktree.path)fail('prepared_request_changed');
    const host=(await source.readNativeHost({provider_id:permit.provider_id,agent_id:permit.agent_id})).value;
    assertOpen();
    const scope=buildNativeCodingExecutionScope(permit,lease,host.host_process);scopes.set(key(request.lease),scope);
    return {provider_id:permit.provider_id,scope,lease_expires_at:lease.expires_at,permit:{authorized:true,trust_namespace:'LOCAL_OPERATOR_QA',
      task_id:lease.task_id,agent_id:lease.agent_id,lease_generation:lease.lease_generation,agent_generation_epoch:lease.agent_generation_epoch,
      base_sha:lease.base_sha,role:lease.role,permit_id:permit.permit_id,owner_epoch:permit.owner_epoch,user_sid:permit.user_sid,
      workspace_id:permit.workspace_id,project_id:permit.project_id,worktree_path:permit.worktree.path,expires_at:permit.expires_at}};
  }
  const binding=(lease,providerId)=>({task_id:lease.task_id,agent_id:lease.agent_id,lease_generation:lease.lease_generation,
    tab_id:`native-coding:${providerId}`,target_id:`codex-cli:${providerId}`,agent_generation_epoch:lease.agent_generation_epoch});
  async function post(path,payload) {
    assertOpen();
    const response=await signedRequest(path,{payload});
    if(!response?.ok)fail('w30_write_requires_readback');
    const value=await response.json();
    if(value?.task_id!==payload.task_id)fail('w30_ack_binding_invalid');return value;
  }
  const executor=createNativeCodingLeaseExecutor({ledger,issuer:nativeIssuer,readBoundLease,physicalSlotBudget,
    createRunner:({authorizeLease})=>({async run(request,options) {
      assertOpen();
      const permit=await permitFor(request.lease);
      assertOpen();
      const processControl=workers.controllerFor({provider_id:permit.provider_id,agent_id:request.lease.agent_id,
        task_id:request.lease.task_id,lease_generation:request.lease.lease_generation,prompt_sha256:digest(request.prompt)});
      const prepareAgentBridge=async details=>{
        if(closed)fail('closed');
        const current=await permitFor(request.lease);
        if(nativeCodingEnvelopeSha256(current)!==nativeCodingEnvelopeSha256(permit)
          ||typeof source.readAgentMcpLaunchPins!=='function')fail('agent_bridge_scope_changed');
        const pins=await source.readAgentMcpLaunchPins();
        const bridge=await agentBridgeFactory({...details,ownPostgres,permit:structuredClone(permit),pins});
        let bridgeClosePromise=null,bridgeCallbackPromise=null;
        const wrapper=Object.freeze({launch:bridge.launch,
          bindRun:proof=>{if(closed)fail('closed');return bridge.bindRun(proof);},
          close(){
            if(bridgeClosePromise)return bridgeClosePromise;
            let resolveClose,rejectClose;bridgeClosePromise=new Promise((resolve,reject)=>{resolveClose=resolve;rejectClose=reject;});
            void bridgeClosePromise.catch(()=>{});
            // Pending AND failed drains stay registered for explicit quit.
            void(async()=>{await bridge.close();})().then(()=>{resolveClose();void wrapper.drainCallbacks().catch(()=>{});},rejectClose);
            return bridgeClosePromise;
          },
          drainCallbacks(){
            if(bridgeCallbackPromise)return bridgeCallbackPromise;
            let resolveJoin,rejectJoin;bridgeCallbackPromise=new Promise((resolve,reject)=>{resolveJoin=resolve;rejectJoin=reject;});void bridgeCallbackPromise.catch(()=>{});
            void(async()=>{await wrapper.close();await bridge.drainCallbacks?.();activeBridges.delete(wrapper);})().then(resolveJoin,rejectJoin);
            return bridgeCallbackPromise;
          }});
        activeBridges.add(wrapper);if(closed){await wrapper.close();fail('closed');}return wrapper;
      };
      return runnerFactory({...runnerOptions,authorizeLease,processController:processControl,prepareAgentBridge}).run(request,options);
    }}),
    async onJobAttempted({request,job_proof}) {
      const value=await post('/v1/devos/mark-running',{...binding(request.lease,job_proof.payload.provider_id),
        native_coding:{schema:'metaengine.native-coding.mark-running.v1',job_proof}});
      if(value.state!=='RUNNING')fail('w30_running_ack_invalid');
    },
  });
  const readExecutionBinding=lease=>{
      const ctl=readServiceControl?.(),device=identity.snapshot(),host=ownPostgres.snapshot?.();
      if(closed||ctl?.supervisor_mode!=='CONTROL'||ctl.armed!==true||ctl.interrupted_setup_recovery_fenced!==false
        ||!Number.isSafeInteger(ctl.runtime_control_generation)||ctl.runtime_control_generation<0||host?.closed!==false
        ||device?.enrolled!==true||!capacityDevice||device.device_id!==capacityDevice.device_id||device.client_id!==capacityDevice.client_id
        ||device.key_fingerprint_sha256!==capacityDevice.key_fingerprint_sha256)fail('first_dispatch_scope_unavailable');
      const provider=String(lease?.target_id||'').slice('codex-cli:'.length),p=descriptors.get(`${provider}:${lease.agent_id}`)?.payload;
      if(!p||p.provider_id!==provider||p.agent_id!==lease.agent_id||p.agent_generation_epoch!==lease.agent_generation_epoch
        ||!Number.isSafeInteger(p.owner_epoch)||p.owner_epoch<1||!UUID.test(p.permit_id||'')||!UUID.test(p.workspace_id||'')||!UUID.test(p.project_id||'')
        ||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(p.expires_at)<=Date.now())fail('first_dispatch_owner_unavailable');
      return {host_instance_id:host.instance_id,host_pid:host.host_pid,principal_sha256:nativeCapacityPrincipal(capacityDevice),runtime_control_generation:ctl.runtime_control_generation,
        owner_epoch:p.owner_epoch,permit_id:p.permit_id,workspace_id:p.workspace_id,project_id:p.project_id};
  };
  const pool=createNativeCodingExecutionPool({executor,physicalSlotBudget,readResourceAdmission,capacityOwner,readExecutionBinding,
    async prepareRequest(raw) {
      assertOpen();
      // Full installed-byte qualification precedes issuer timestamps. Only
      // physical stat guards and current OS readback run inside its window.
      await source.prepareInstalledImage?.();
      assertOpen();
      const permit=await permitFor(raw);
      if(capacityOwner){
        const held=readExecutionBinding(raw);
        for(const name of ['owner_epoch','permit_id','workspace_id','project_id'])if(held[name]!==permit[name])fail('first_dispatch_owner_changed');
      }
      const context=await taskContext(raw,permit),lease=context.value;
      assertOpen();
      const subject=lease.role==='CRITIC'?await results.resolveRunnerSubject({workspace_id:permit.workspace_id,project_id:permit.project_id,
        verification_subject:lease.verification_subject}):null;
      assertOpen();
      return {lease:{...lease,base_sha:lease.base_sha},role:lease.role,worktreePath:permit.worktree.path,prompt:context.task_prompt,
        ...(subject?{subject}:{}),provider_id:permit.provider_id};
    },
    async readPriorExecution(raw) {
      let scope=scopes.get(key(raw));
      if(scope)return ledger.read(scope);
      assertOpen();
      // A fresh Browser cannot reconstruct the old signed Host birth. Only the
      // private Host selects that scope from the existing durable execution.
      if(typeof ownPostgres.readPriorExecution!=='function')return fence('HOLD',{reason:'PRIVATE_PRIOR_EXECUTION_READBACK_UNAVAILABLE'});
      const permit=await permitFor(raw);assertOpen();
      if(raw.agent_generation_epoch!==permit.agent_generation_epoch)fail('prior_execution_selector_changed');
      const selector={workspace_id:permit.workspace_id,project_id:permit.project_id,task_id:raw.task_id,
        lease_generation:raw.lease_generation,agent_id:permit.agent_id,provider_id:permit.provider_id,
        agent_generation_epoch:permit.agent_generation_epoch};
      const result=await ownPostgres.readPriorExecution(selector);assertOpen();
      const fields=['schema','source','state','reason','selector','execution_scope','execution','receipt_sha256','task_state',
        'task_result_summary','readback_only','physical_effect_replayed','automatic_retry_allowed','authority_effect'];
      if(result?.schema!=='metaengine.native-coding.execution-readback.v1'||result.source!=='PRIVATE_RUNTIME_HOST_OWN_PG'
        ||Object.keys(result).sort().join()!==fields.sort().join()
        ||!['HOLD','READBACK_ONLY'].includes(result.state)||result.readback_only!==true
        ||result.physical_effect_replayed!==false||result.automatic_retry_allowed!==false||result.authority_effect!==false
        ||!result.selector||Object.keys(result.selector).length!==Object.keys(selector).length
        ||Object.keys(selector).some(name=>result.selector[name]!==selector[name]))fail('prior_execution_readback_invalid');
      if(result.state==='READBACK_ONLY'){
        const saved=result.execution_scope,e=result.execution;
        if(result.reason!=='PROTECTED_RESULT_VERIFIED'||!HASH.test(result.receipt_sha256||'')
          ||!saved||!e||!['RESULT_READY','CHECKPOINTED'].includes(e.state)||e.automatic_retry_allowed!==false||e.authority_effect!==false
          ||saved.workspace_id!==selector.workspace_id||saved.task_id!==selector.task_id||saved.agent_id!==selector.agent_id
          ||saved.lease_generation!==selector.lease_generation||saved.agent_generation_epoch!==selector.agent_generation_epoch
          ||saved.target_id!==`codex-cli:${selector.provider_id}`||!HASH.test(saved.scope_sha256||'')
          ||!/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(saved.host_incarnation||'')
          ||Object.keys(saved).some(name=>['lease_generation','agent_generation_epoch'].includes(name)?Number(e[name])!==saved[name]:e[name]!==saved[name]))
          fail('prior_execution_readback_invalid');
      }else if(result.receipt_sha256!==null)fail('prior_execution_readback_invalid');
      // This is observation only: never copy the historical scope into the
      // current runner's scope map, advance its ledger, or POST completion.
      return result;
    },
  });
  if(capacityOwner&&capacityDevice){
    const pinned=structuredClone(capacityDevice),hostBinding=ownPostgres.snapshot();
    capacityOwner.bind({capability:ownPostgres,...hostBinding,poolToken:pool.capacityPoolToken,
      principal_sha256:nativeCapacityPrincipal(pinned),readBinding:()=>ownPostgres.snapshot(),readPrincipal:()=>{
        const current=identity.snapshot();
        if(current?.enrolled!==true||current.device_id!==pinned.device_id||current.client_id!==pinned.client_id
          ||current.key_fingerprint_sha256!==pinned.key_fingerprint_sha256)return null;
        return nativeCapacityPrincipal(pinned);
      }});
  }
  const collectCapacity=()=>capacityOwner?.collect(async owned=>{
    if(closed||typeof ownPostgres.readNativeCapacity!=='function')fail('capacity_reader_unavailable');
    const request=await signNativeCodingDeviceRequest({identity,binding:ownPostgres.snapshot(),operation:'READ_NATIVE_CAPACITY_V1',input:{owned_tasks:owned}});
    assertOpen();return ownPostgres.readNativeCapacity(request);
  });
  const capacityLimits=()=>{
    const resources=readResourceAdmission?.(),value=resources?.physical_start_allowed===true?resources.physical_parallelism:0;
    return {configuredCeiling:physicalSlotBudget,resourceCeiling:Number.isSafeInteger(value)&&value>=0?value:0};
  };
  const capacityObservation=()=>capacityOwner?.snapshot(capacityLimits())??null;
  async function complete(lease,row) {
    if(closed)return fence('STOPPED',{reason:unavailableReason});
    const id=key(lease),prior=completionAttempts.get(id);
    const receipt=row.result?.result;
    if(prior) {
      if(prior.state==='READBACK_REQUIRED'&&receipt?.state==='RESULT_READY') {
        try {
          const scope=scopes.get(id);
          const status=scope?await ledger.read(scope):null,summary=status?.task_result_summary;
          if(closed)return fence('STOPPED',{reason:unavailableReason});
          if(status) {
            if(status.task_state==='RESULT_READY'&&status.state==='RESULT_READY'&&status.task_id===lease.task_id&&Number(status.lease_generation)===lease.lease_generation
              &&summary?.schema==='metaengine.native-coding.result-summary.v1'&&summary.run_id===receipt.run_id
              &&summary.result_sha256===receipt.result_sha256&&summary.receipt_sha256===nativeCodingEnvelopeSha256(receipt)
              &&summary.git_artifact_sha256===receipt.git_after.artifact_sha256&&summary.source_head===receipt.git_after.head) {
              pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:lease.lease_generation,result_sha256:receipt.result_sha256});
              prior.state='RESULT_ACKNOWLEDGED';prior.reason=null;scopes.delete(id);
            }
          }
        } catch { /* Status readback cannot authorize a repeated POST or run. */ }
      }
      return fence(prior.state,{task_id:lease.task_id,lease_generation:lease.lease_generation,reason:prior.reason||null});
    }
    if(row.state!=='RESULT_READY'||receipt?.state!=='RESULT_READY'||!HASH.test(receipt.result_sha256||''))return row;
    const record={state:'COMPLETION_PENDING',reason:null};completionAttempts.set(id,record);
    try {
      if(receipt.role==='IMPLEMENTER'&&receipt.result?.outcome==='DONE')await results.publish(receipt);
      const providerId=row.result.job_proof.payload.provider_id;
      const value=await post('/v1/devos/complete',{...binding(lease,providerId),state:'RESULT_READY',
        native_coding:{schema:'metaengine.native-coding.complete.v1',receipt}});
      assertOpen();
      const ack=value.native_coding_ack;
      if(value.state!=='RESULT_READY'||ack?.state!=='RESULT_READY'||ack.lease_generation!==lease.lease_generation
        ||ack.result_sha256!==receipt.result_sha256)fail('w30_completion_ack_invalid');
      pool.acknowledge(lease,ack);record.state='RESULT_ACKNOWLEDGED';
      scopes.delete(id);
      if(completionAttempts.size>128)for(const [old,entry] of completionAttempts){if(entry.state==='RESULT_ACKNOWLEDGED')completionAttempts.delete(old);if(completionAttempts.size<=128)break;}
      return fence('RESULT_ACKNOWLEDGED',{task_id:lease.task_id,lease_generation:lease.lease_generation,result_sha256:receipt.result_sha256});
    } catch {
      record.state='READBACK_REQUIRED';record.reason='COMPLETION_OUTCOME_UNKNOWN';
      return fence('READBACK_REQUIRED',{task_id:lease.task_id,lease_generation:lease.lease_generation,reason:record.reason});
    }
  }
  const registeredProviderSnapshot=()=>({schema:'metaengine.native-coding.providers.v1',providers:closed?[]:
    [...descriptors.entries()].filter(([id,value])=>!providerFences.has(id)
      &&Date.parse(value.payload.expires_at)>Date.now()).map(([,value])=>structuredClone(value))});
  const serviceHeartbeat=typeof readServiceControl==='function'&&typeof identity.deviceHeaders==='function'
    &&(capacityOwner?['snapshot','serviceHeartbeatV2','readServiceHeartbeatV2']:['snapshot','serviceHeartbeat','readServiceHeartbeat']).every(name=>typeof ownPostgres[name]==='function')
    ? (capacityOwner?createNativeCodingServiceHeartbeatPublisherV2:createNativeCodingServiceHeartbeatPublisher)({identity,ownPostgres,readControl:readServiceControl,
      readCapacity:()=>capacityOwner?.readObservation(capacityLimits()),
      readRuntime:()=>({...pool.snapshot(),shutdown_state:shutdownState,host_unavailable_reason:unavailableReason}),
      readProviders:()=>registeredProviderSnapshot().providers}):null;
  const providerSnapshot=()=>({schema:'metaengine.native-coding.providers.v1',providers:closed?[]:serviceHeartbeat?.admittedProviders()??[]});
  async function refreshProviders() {
    const roster=await selectors();if(closed)return;
    const active=new Set(roster.map(s=>`${s.provider_id}:${s.agent_id}`));
    for(const id of descriptors.keys())if(!active.has(id))descriptors.delete(id);
    if(!roster.length){refreshCursor=0;return;}
    await source.prepareInstalledImage?.();if(closed)return;
    let examined=0,issued=0;
    while(examined<roster.length&&issued<physicalSlotBudget&&!closed) {
      const selector=roster[refreshCursor%roster.length];refreshCursor=(refreshCursor+1)%roster.length;examined++;
      const id=`${selector.provider_id}:${selector.agent_id}`;
      if(providerFences.has(id))continue;
      // Roster removal is not reconciliation of an unknown registration.
      const previous=descriptors.get(id);
      if(previous&&Date.parse(previous.payload.expires_at)>Date.now()+10000)continue;
      issued++;
      const descriptor=await nativeIssuer.issueProvider(selector);if(closed)return;
      const expected=nativeCodingEnvelopeSha256(descriptor);
      try {
        const ack=await ownPostgres.registerProvider(descriptor);if(closed)return;
        if(ack?.registered!==true||ack.provider_id!==selector.provider_id
          ||(ack.descriptor_sha256??ack.envelope_sha256)!==expected)fail('provider_registration_ack_invalid');
      }catch{providerFences.set(id,'REGISTRATION_OUTCOME_UNKNOWN');continue;}
      // Publish each exact ACK immediately; a later slow provider cannot
      // withhold this registered envelope until the whole batch finishes.
      descriptors.set(id,structuredClone(descriptor));
      serviceHeartbeat?.observe();
    }
  }
  function stop(reason=null) {
    if(closePromise)return closePromise;
    let finishClose;
    closePromise=new Promise(resolve=>{finishClose=resolve;});
    // Fence synchronously before any asynchronous drain. Keep the original
    // scopes, pending receipts, provider fences and checkpoint selectors.
    closed=true;unavailableReason=reason;shutdownState='DRAINING';capacityOwner?.invalidate('RUNTIME_DRAINING');
    for(const entry of completionAttempts.values())if(entry.state==='COMPLETION_PENDING'){
      entry.state='READBACK_REQUIRED';entry.reason='HOST_UNAVAILABLE_DURING_COMPLETION';
    }
    checkpoints?.close();rejections?.close();commits?.close();serviceHeartbeat?.close();unsubscribeHost?.();unsubscribeHost=null;
    const begin=operation=>{try{return Promise.resolve(operation());}catch(error){return Promise.reject(error);}};
    // pool.stop fences admission synchronously; workers.close fences the SAME
    // registry synchronously and joins every already-owned/pending spawn. A
    // late authorization cannot create a child through that closed registry.
    const poolDrain=begin(()=>pool.stop());workerDrainPromise=begin(()=>workers.close());
    const pending=[poolDrain,workerDrainPromise,...[()=>nativeIssuer.close(),
      ()=>Promise.all([...activeBridges].map(bridge=>bridge.drainCallbacks())),
      ()=>poolDrain.then(()=>Promise.all([...activeBridges].map(bridge=>bridge.drainCallbacks()))),()=>refresh,()=>capacityOwner?.drain(),
      ()=>Promise.allSettled([...localOperations]),()=>checkpoints?.drain(),()=>rejections?.drain(),()=>commits?.drain(),()=>serviceHeartbeat?.drain()].map(begin)];
    fullDrainPromise=Promise.allSettled(pending).then(values=>{
      const workersResult=values[1];
      workerCleanupConfirmed=workersResult.status==='fulfilled'
        &&workersResult.value?.schema==='metaengine.native-coding.workers-close.v1'
        &&workersResult.value.cleanup_confirmed===true;
      shutdownState=!values.every(value=>value.status==='fulfilled')?'DRAIN_FAILED'
        :workerCleanupConfirmed?'DRAINED':'DRAIN_UNCONFIRMED';
    });
    let timer;
    void Promise.race([fullDrainPromise,new Promise(resolve=>{
      timer=setTimeout(()=>{shutdownState='DRAIN_TIMEOUT';resolve();},closeTimeoutMs);
    })]).then(()=>{clearTimeout(timer);finishClose();});
    return closePromise;
  }
  const runtime=Object.freeze({
    async observeProviders() {
      if(!closed&&!refresh) {
        // The existing heartbeat alone initiates one bounded pass. Neither a
        // full image verifier nor slow native/PG reads hold up that heartbeat.
        refreshReason=null;
        refresh=Promise.resolve().then(refreshProviders).catch(()=>{refreshReason='PROVIDER_REFRESH_REQUIRES_READBACK';})
          .finally(()=>{refresh=null;});
      }
      if(!closed){void collectCapacity();serviceHeartbeat?.observe();}
      return providerSnapshot();
    },
    dispatchLease(lease){if(closed)return fence('STOPPED');return pool.dispatch(lease);},
    advanceUnattemptedLease(lease){if(closed)return fence('STOPPED');return pool.advanceUnattemptedLease(lease);},
    observeProjectCheckpoints(candidates){
      if(closed)return fence('STOPPED',{reason:unavailableReason});
      if(!checkpoints){if(candidates?.length)fail('private_checkpoint_capability_required');return null;}
      return checkpoints.observe(candidates);
    },
    observeProjectRejection(reference){
      if(closed)return fence('STOPPED',{reason:unavailableReason});
      return rejections?.observe(reference)??{state:'PRIVATE_REJECTION_READER_UNAVAILABLE',repair_authorized:false,authority_effect:false};
    },
    observeProjectCommits(candidates){
      if(closed)return fence('STOPPED',{reason:unavailableReason});
      if(!commits){if(candidates?.length)fail('private_commit_capability_required');return null;}
      return commits.observe(candidates);
    },
    readRunOwner(scope){return trackLocal(async()=>{assertOpen();if(typeof readRunOwner!=='function')fail('owner_reader_unbound');return readRunOwner(scope);});},
    observeLease(lease){return trackLocal(async()=>{if(closed)return fence('STOPPED');const row=await pool.observe(lease);return row.state==='RESULT_READY'?complete(lease,row):row;});},
    completeFromTrustedCommand(payload){return trackLocal(async()=>{if(closed)return fence('STOPPED',{reason:unavailableReason});const lease=payload?.lease||payload;if(!UUID.test(lease?.task_id||''))fail('completion_selector_invalid');return complete(lease,await pool.observe(lease));});},
    snapshot(){return {...pool.snapshot(),schema:'metaengine.native-coding.runtime.v1',provider_fences:providerFences.size,
      provider_refresh_running:refresh!==null,provider_refresh_reason:refreshReason,
      capacity_observation:capacityObservation(),
      project_checkpoints:checkpoints?.snapshot()??null,
      project_rejections:rejections?.snapshot()??null,
      project_commits:commits?.snapshot()??null,
      service_heartbeat:serviceHeartbeat?.snapshot()??{state:'PRIVATE_SERVICE_UNBOUND',authority_effect:false},
      completion_readbacks:[...completionAttempts.values()].filter(v=>v.state==='READBACK_REQUIRED').length,
      host_unavailable_reason:unavailableReason,shutdown_state:shutdownState,worker_cleanup_confirmed:workerCleanupConfirmed,
      // Drain completion is not acceptance of an interrupted task or proof
      // that an ambiguous physical effect can be retried.
      execution_outcomes_reconciled:false,
      production_qualified:false,useful_work_verified:false};},
    // Private staged lifecycle only. Never confuse native-tree settlement
    // with the remote-dependent pool/callback/output work below.
    async drainNativeWorkers(){
      stop();const value=await workerDrainPromise;
      if(value?.schema!=='metaengine.native-coding.workers-close.v1'||value.cleanup_confirmed!==true)fail('worker_cleanup_unconfirmed');
      return Object.freeze({schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:closed,
        worker_cleanup_confirmed:true,authority_effect:false});
    },
    async drainClosedWork(){stop();await fullDrainPromise;return runtime.snapshot();},
    async close(){await stop();return runtime.snapshot();},
  });
  if(typeof ownPostgres.onUnavailable==='function'){
    const unsubscribe=ownPostgres.onUnavailable(event=>{
      const reason=['CHILD_EXIT','CHANNEL_CLOSED','SEND_FAILED','RESPONSE_INVALID','CLIENT_CLOSED','SERVER_CLOSED','HOST_TERMINATED'].includes(event?.reason)
        ?event.reason:'CHANNEL_CLOSED';
      void stop(reason);
    });
    if(closed)unsubscribe?.();else unsubscribeHost=unsubscribe;
  }
  return runtime;
}
