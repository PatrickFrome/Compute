import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeClientProjectSnapshot} from './client-project-continuity.mjs';
import {NativeCodingHostIpcError} from './native-coding-host-ipc-client.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
const fail=reason=>{throw Error('client_native_goal_'+reason);};
const digest=s=>createHash('sha256').update(s).digest('hex');
const equal=isDeepStrictEqual;
const ADMISSION_KEYS=['schema','state','request_id','objective','profile_id','profile_sha256','workspace_id','project_id','root_task_id',
  'goal_id','goal_sha256','task_spec_sha256','permit_ids','logical_policy','physical_execution_proven','global_actuation_granted',
  'production_qualified','automatic_retry_allowed','authority_effect'];
const STATES=new Set(['READY','LEASED','RUNNING','SUSPENDED','RESULT_READY','BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED']);
const routerStates=new WeakMap();

function nativeProfileStatusReason(error){
  // Only the private transport's typed, bounded reasons become presentation
  // data. Never expose native error messages, profile paths, SQL or credentials.
  if(error instanceof NativeCodingHostIpcError){
    if(error.reason==='UNSUPPORTED_ACTION')return 'NATIVE_PROFILE_CAPABILITY_UNAVAILABLE';
    if(error.reason==='REQUEST_TIMEOUT')return 'NATIVE_PROFILE_STATUS_TIMEOUT';
    if(['CHANNEL_CLOSED','CHILD_EXIT','HOST_TERMINATED','SERVER_CLOSED','CLIENT_CLOSED','SEND_FAILED'].includes(error.reason))
      return 'NATIVE_PROFILE_HOST_UNAVAILABLE';
    if(error.reason==='OPERATION_FAILED')return 'NATIVE_PROFILE_VERIFICATION_FAILED';
  }
  return 'NATIVE_PROFILE_STATUS_UNAVAILABLE';
}

export async function readClientGoalSubmissionMode({readSummary,lstat=fs.lstat,readNativeBusy}={}){
  const base={schema:'metaengine.client.goal-submission-mode.v1',automatic_retry_allowed:false,authority_effect:false};
  const summary=readSummary?.();
  if(!summary?.status_file)return {...base,kind:'UNAVAILABLE',state:'HOLD',reason:'OWNED_RUNTIME_HOST_UNAVAILABLE'};
  let file;try{file=await lstat(path.join(path.dirname(summary.status_file),'native-coding-seed-operator-v1.json'));}
  catch(error){if(error?.code==='ENOENT')return {...base,kind:'BROWSER',state:'HOST_VERIFICATION_REQUIRED',reason:null};
    return {...base,kind:'UNAVAILABLE',state:'HOLD',reason:'NATIVE_PROFILE_PRESENCE_UNAVAILABLE'};}
  // Presence selects a route, never grants admission. Malformed/protected data
  // remains a native HOLD; it cannot silently downgrade into the browser path.
  if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)return {...base,kind:'NATIVE_CODING',state:'HOLD',reason:'NATIVE_PROFILE_NOT_REGULAR_FILE'};
  if(readNativeBusy){
    let busy;try{busy=await readNativeBusy();}catch(error){return {...base,kind:'NATIVE_CODING',state:'HOLD',reason:nativeProfileStatusReason(error)};}
    if(busy?.busy===true)return {...base,kind:'NATIVE_CODING',state:'HOLD',reason:'NATIVE_PROFILE_BUSY',
      project_id:UUID.test(busy.project_id||'')?busy.project_id:null};
    if(busy?.coordination_mode!==undefined&&!['CHAT_LED','CLI_LED'].includes(busy.coordination_mode))return {...base,kind:'NATIVE_CODING',state:'HOLD',reason:'NATIVE_PROFILE_VERIFICATION_FAILED'};
    if(['CHAT_LED','CLI_LED'].includes(busy?.coordination_mode))return {...base,kind:'NATIVE_CODING',state:'HOST_VERIFICATION_REQUIRED',reason:null,coordination_mode:busy.coordination_mode};
  }
  return {...base,kind:'NATIVE_CODING',state:'HOST_VERIFICATION_REQUIRED',reason:null};
}

export function normalizeNativeCodingGoalAdmission(value,{request_id,objective}={}){
  if(!exact(value,ADMISSION_KEYS)||value.schema!=='metaengine.native-coding.goal-admission.v1'||value.state!=='ADMITTED'
    ||value.request_id!==request_id||value.objective!==objective
    ||!['request_id','profile_id','workspace_id','project_id','root_task_id','goal_id'].every(k=>UUID.test(value[k]||''))
    ||!['profile_sha256','goal_sha256','task_spec_sha256'].every(k=>SHA.test(value[k]||''))
    ||!Array.isArray(value.permit_ids)||value.permit_ids.length<2
    ||value.permit_ids.some(id=>!UUID.test(id||''))||new Set(value.permit_ids).size!==value.permit_ids.length
    ||!exact(value.logical_policy,['max_depth','max_tasks','max_children'])
    ||Object.entries(value.logical_policy).some(([key,v])=>v!==null&&(!Number.isSafeInteger(v)||v<(key==='max_depth'?0:1)))
    ||['physical_execution_proven','global_actuation_granted','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>value[k]!==false))fail('admission_invalid');
  return Object.freeze(structuredClone(value));
}

export function normalizeNativeCodingSeedRejection(value,input){
  if(!exact(value,['schema','state','request_id','objective','profile_id','profile_sha256','body_sha256',
    'admission_absent','semantic_fence_absent','automatic_retry_allowed','authority_effect'])
    ||value.schema!=='metaengine.native-coding.seed-rejection.v1'||value.state!=='REJECTED_BEFORE_DISPATCH'
    ||value.request_id!==input.request_id||value.objective!==input.objective
    ||!UUID.test(value.request_id||'')||!UUID.test(value.profile_id||'')||!SHA.test(value.profile_sha256||'')
    ||value.body_sha256!==digest(JSON.stringify({objective:input.objective,request_id:input.request_id}))
    ||value.admission_absent!==true||value.semantic_fence_absent!==true
    ||value.automatic_retry_allowed!==false||value.authority_effect!==false)fail('rejection_invalid');
  return Object.freeze(structuredClone(value));
}
export function normalizeNativeCodingSeedResult(raw,input){
  if(raw?.state==='REJECTED_BEFORE_DISPATCH'){
    if(!exact(raw,['state','admission','rejection','production_qualified','automatic_retry_allowed','authority_effect'])
      ||raw.admission!==null||['production_qualified','automatic_retry_allowed','authority_effect'].some(k=>raw[k]!==false))fail('seed_rejection_invalid');
    return normalizeNativeCodingSeedRejection(raw.rejection,input);
  }
  if(!exact(raw,['state','admission','production_qualified','automatic_retry_allowed','authority_effect'])
    ||!['ADMITTED','READBACK_ONLY','READBACK_REQUIRED'].includes(raw.state)
    ||['production_qualified','automatic_retry_allowed','authority_effect'].some(k=>raw[k]!==false))fail('seed_result_invalid');
  const value=raw.admission;
  if(value===null){if(raw.state==='ADMITTED')fail('admission_missing');return null;}
  if(raw.state==='READBACK_REQUIRED'||!exact(value,['schema','profile_id','request_id','body','canonical_body_text','body_sha256',
    'receipt','canonical_receipt','receipt_sha256','readback_only','physical_effect_replayed','authority_effect'])
    ||value.schema!=='metaengine.native-coding.seed-readback.v1'||value.request_id!==input.request_id
    ||!exact(value.body,['request_id','objective'])||!equal(value.body,input)||!UUID.test(value.profile_id||'')
    ||typeof value.canonical_body_text!=='string'||Buffer.byteLength(value.canonical_body_text)>4096
    ||typeof value.canonical_receipt!=='string'||Buffer.byteLength(value.canonical_receipt)>32768
    ||!SHA.test(value.body_sha256||'')||!SHA.test(value.receipt_sha256||'')
    ||digest(value.canonical_body_text)!==value.body_sha256||digest(value.canonical_receipt)!==value.receipt_sha256
    ||value.readback_only!==true||value.physical_effect_replayed!==false||value.authority_effect!==false)fail('readback_invalid');
  let body,receipt;try{body=JSON.parse(value.canonical_body_text);receipt=JSON.parse(value.canonical_receipt);}catch{fail('canonical_json_invalid');}
  if(!equal(body,input)||!equal(receipt,value.receipt))fail('canonical_binding_invalid');
  const normalized=normalizeNativeCodingGoalAdmission(value.receipt,input);
  if(normalized.profile_id!==value.profile_id)fail('profile_changed');
  return normalized;
}

export function nativeCodingGoalProject(receipt){
  return Object.freeze({schema:'metaengine.client.native-coding-project.v1',request_id:receipt.request_id,
    project_id:receipt.project_id,root_task_id:receipt.root_task_id,authority_effect:false});
}

export function normalizeNativeCodingGoalProgress(raw,entry){
  const receipt=normalizeNativeCodingGoalAdmission(entry.receipt,{request_id:entry.request_id,objective:entry.goal});
  const snapshot=normalizeClientProjectSnapshot(raw,{project_id:receipt.project_id});
  if(snapshot.found!==true||snapshot.root_task_id!==receipt.root_task_id||snapshot.request_id!==entry.request_id
    ||snapshot.goal!==entry.goal||snapshot.selected_task?.task_id!==receipt.root_task_id||!STATES.has(snapshot.selected_task.state))fail('project_binding_invalid');
  return Object.freeze({schema:'metaengine.client.native-coding-goal-progress.v1',request_id:entry.request_id,found:true,
    project_id:receipt.project_id,task_id:receipt.root_task_id,task_state:snapshot.selected_task.state,
    project_state:snapshot.state,total_tasks:snapshot.total_tasks,last_seq:snapshot.last_seq,
    observed_at:new Date().toISOString(),source:'OWN_PG_PROJECT_SNAPSHOT',
    ...(snapshot.native_review_rejection?{blocked_reason:'NATIVE_REVIEW_REJECTED',review_rejection:snapshot.native_review_rejection}:{}),
    terminal:['COMPLETED','FAILED','CANCELLED'].includes(snapshot.state),reconciliation_required:false,physical_execution_proven:false,
    automatic_retry_allowed:false,authority_effect:false});
}

// Narrow effect/readback router. A saved native request is never sent again,
// including after a lost IPC reply or a restart; refresh only calls READ_SEED.
export function createClientNativeCodingGoalRouter({journal,request,projectSnapshot,onAdmitted=async()=>{}}={}){
  if(!journal||typeof request!=='function'||typeof projectSnapshot!=='function')fail('router_configuration');
  if(!routerStates.has(journal))routerStates.set(journal,{inFlight:false,mount:null});
  const state=routerStates.get(journal);
  async function observe(entry,raw){
    const input={request_id:entry.request_id,objective:entry.goal};
    const receipt=normalizeNativeCodingSeedResult(raw,input);
    if(receipt?.schema==='metaengine.native-coding.seed-rejection.v1')return journal.recordNativeRejection(receipt);
    if(!receipt){await journal.markReconcileRequired(entry.request_id,'native_seed_readback_required');return journal.get(entry.request_id);}
    await journal.recordNativeAdmission(receipt);
    // A receipt proves admission, not that this Browser still has an open
    // runtime. Recheck after every verified read, including restored journals.
    // Only concurrent observations join; successful mounts are never cached
    // here because the private runtime/capability can subsequently close.
    if(!state.mount){
      const pending=Promise.resolve().then(()=>onAdmitted());state.mount=pending;
      const settled=()=>{if(state.mount===pending)state.mount=null;};
      pending.then(settled,settled);
    }
    try{await state.mount;}catch{/* Mount failure does not revoke a committed admission. */}
    try{const progress=normalizeNativeCodingGoalProgress(await projectSnapshot({project_id:receipt.project_id,task_after_seq:0,limit:1}),journal.get(entry.request_id));
      await journal.recordNativeProgress(progress);}catch{
      // Preserve the last observation, explicitly label it stale, and never
      // downgrade a durable admission into an apparent submission failure.
      await journal.recordProjectError(entry.request_id,'Native project observation unavailable').catch(()=>{});
    }
    return journal.get(entry.request_id);
  }
  return Object.freeze({
    async submit({request_id,goal}){
      if(state.inFlight)fail('operation_pending');state.inFlight=true;
      try{
        await journal.load();
        if(journal.snapshot().entries.some(e=>e.kind==='NATIVE_CODING'&&['SUBMITTING','RECONCILE_REQUIRED'].includes(e.state)))fail('previous_request_requires_readback');
        const prior=journal.get(request_id);
        if(prior)fail('request_already_recorded');
        const entry=await journal.begin({request_id,goal,kind:'NATIVE_CODING'});
        try{
          const observed=await observe(entry,await request('SEED_GOAL',{request_id,objective:entry.goal}));
          if(observed.native_rejection)fail('rejected_before_dispatch:'+request_id);
          if(!observed.receipt)fail('seed_readback_required');
          return observed.receipt;
        }catch(error){
          if(journal.get(request_id)?.native_rejection)throw error;
          await journal.markReconcileRequired(request_id,error).catch(()=>{});
          try{await observe(entry,await request('READ_SEED',{request_id,objective:entry.goal}));}catch{}
          if(journal.get(request_id)?.native_rejection)fail('rejected_before_dispatch:'+request_id);
          fail('submit_requires_reconciliation:'+request_id);
        }
      }finally{state.inFlight=false;}
    },
    async refresh(entry){
      if(entry?.kind!=='NATIVE_CODING')fail('kind_invalid');
      const durable=journal.get(entry.request_id);
      // A terminal, validated pre-dispatch rejection has no running project to
      // observe. It remains readable after Host/profile replacement or offline.
      if(durable?.kind==='NATIVE_CODING'&&durable.state==='FAILED'&&durable.native_rejection)return durable;
      try{return await observe(entry,await request('READ_SEED',{request_id:entry.request_id,objective:entry.goal}));}
      catch(error){await journal.recordProjectError(entry.request_id,'Native goal observation unavailable').catch(()=>{});throw error;}
    },
  });
}
