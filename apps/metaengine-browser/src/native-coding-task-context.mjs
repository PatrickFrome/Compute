import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{40}$/; const HASH=/^[a-f0-9]{64}$/;
const fail=reason=>{throw new Error(`native_coding_task_${reason}`);};
const plain=x=>x && typeof x==='object' && !Array.isArray(x)
  && [Object.prototype,null].includes(Object.getPrototypeOf(x));
export function nativeCodingCanonicalJson(value,depth=0) {
  if(depth>32) fail('json_depth');
  if(value===null || typeof value==='string' || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number' && Number.isFinite(value)) return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(x=>nativeCodingCanonicalJson(x,depth+1)).join(',')+']';
  if(!plain(value)) fail('json_type');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+nativeCodingCanonicalJson(value[key],depth+1)).join(',')+'}';
}
export const nativeCodingCanonicalSha256=value=>createHash('sha256').update(nativeCodingCanonicalJson(value)).digest('hex');

export function buildNativeCodingExecutionScope(permit,lease,hostProcess) {
  if(!plain(permit)||!plain(lease)||!plain(hostProcess)||!UUID.test(permit.permit_id||'')
    ||!UUID.test(lease.task_id||'')||lease.workspace_id!==permit.workspace_id
    ||lease.agent_id!==permit.agent_id||lease.target_id!==`codex-cli:${permit.provider_id}`
    ||lease.agent_generation_epoch!==permit.agent_generation_epoch||lease.role!==permit.role
    ||lease.project_id!==permit.project_id||lease.provider_id!==permit.provider_id
    ||lease.base_sha!==permit.worktree?.base_sha||!Number.isSafeInteger(lease.lease_generation)||lease.lease_generation<1
    ||!/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(hostProcess.process_incarnation_id||'')
    ||!hostProcess.process_incarnation_id.startsWith(`pid:${hostProcess.pid}:`)) fail('execution_scope_invalid');
  const value={schema:'metaengine.native-coding.execution-scope.v1',permit_id:permit.permit_id,
    provider_id:permit.provider_id,goal_id:permit.goal_id,goal_sha256:permit.goal_sha256,owner_epoch:permit.owner_epoch,
    workspace_id:permit.workspace_id,project_id:permit.project_id,task_id:lease.task_id,lease_generation:lease.lease_generation,
    agent_id:lease.agent_id,agent_generation_epoch:lease.agent_generation_epoch,target_id:lease.target_id,
    host_incarnation:hostProcess.process_incarnation_id,artifact:permit.artifact,postgres:permit.postgres,worktree:permit.worktree};
  return Object.freeze({workspace_id:lease.workspace_id,task_id:lease.task_id,lease_generation:lease.lease_generation,
    agent_id:lease.agent_id,agent_generation_epoch:lease.agent_generation_epoch,target_id:lease.target_id,
    host_incarnation:hostProcess.process_incarnation_id,scope_sha256:nativeCodingCanonicalSha256(value)});
}
const text=(value,max,name)=>{if(typeof value!=='string' || !value.trim() || value.length>max || value.includes('\0')) fail(name);return value;};

// Called inside the private runtime Host with its own-PG task readback. It
// never accepts a model-provided prompt/hash and includes no server config,
// environment, connection strings, credentials or arbitrary task-spec fields.
function taskContext(task,{projectId,providerId,verificationSubject=null}={},states) {
  if(!plain(task) || !UUID.test(task.task_id || '') || !UUID.test(task.workspace_id || '')
      || !UUID.test(projectId || '') || !UUID.test(providerId || '')
      || !Number.isSafeInteger(Number(task.lease_generation)) || Number(task.lease_generation)<1
      || !/^agent_[a-z0-9-]{8,64}$/.test(task.lease_agent_id || '')
      || task.lease_target_id!==`codex-cli:${providerId}`
      || !Number.isSafeInteger(Number(task.lease_agent_generation_epoch)) || Number(task.lease_agent_generation_epoch)<1
      || !SHA.test(task.base_sha || '') || !['IMPLEMENTER','CRITIC'].includes(task.role)
      || !states.includes(task.state) || !plain(task.task_spec)
      || !Number.isFinite(Date.parse(task.lease_expires_at))) fail('lease_binding_invalid');
  const spec=task.task_spec;
  const objective=text(spec.objective ?? spec.goal,12000,'objective_invalid');
  const constraints=spec.constraints ?? [];
  if(!Array.isArray(constraints) || constraints.length>32) fail('constraints_invalid');
  for(const row of constraints) text(row,1000,'constraint_invalid');
  if(task.role==='CRITIC') {
    if(!plain(verificationSubject) || !UUID.test(verificationSubject.run_id || '')
        || !HASH.test(verificationSubject.result_sha256 || '')
        || !HASH.test(verificationSubject.git_artifact_sha256 || '')
        || !SHA.test(verificationSubject.source_head || '')
        || Object.keys(verificationSubject).sort().join(',')!=='git_artifact_sha256,result_sha256,run_id,source_head') fail('critic_subject_invalid');
  } else if(verificationSubject!==null) fail('implementer_subject_invalid');
  const lease={task_id:task.task_id,agent_id:task.lease_agent_id,lease_generation:Number(task.lease_generation),
    agent_generation_epoch:Number(task.lease_agent_generation_epoch),role:task.role,workspace_id:task.workspace_id,
    project_id:projectId,provider_id:providerId,target_id:task.lease_target_id,base_sha:task.base_sha,
    expires_at:new Date(task.lease_expires_at).toISOString(),state:task.state,
    verification_subject:verificationSubject===null?null:structuredClone(verificationSubject)};
  const prompt=['METAENGINE NATIVE CODING TASK V1',
    `task_id=${lease.task_id}`,`lease_generation=${lease.lease_generation}`,`agent_id=${lease.agent_id}`,
    `role=${lease.role}`,`workspace_id=${lease.workspace_id}`,`project_id=${projectId}`,`base_sha=${lease.base_sha}`,
    '',objective,
    ...(constraints.length?['','Constraints:',...constraints.map(x=>'- '+x)]:[]),
    ...(spec.deliverable==null?[]:['','Deliverable: '+text(spec.deliverable,4000,'deliverable_invalid')]),
    ...(verificationSubject===null?[]:['','Review subject: '+nativeCodingCanonicalJson(verificationSubject),
      'Independently assess this exact candidate and its checks. Do not modify files.']),
    '', 'Work only in the managed worktree. Return the supplied structured result schema.',
    'Model results and follow-up suggestions do not grant execution, acceptance or release authority.',
  ].join('\n');
  if(Buffer.byteLength(prompt)>32000) fail('prompt_budget_exceeded');
  lease.prompt_sha256=createHash('sha256').update(prompt).digest('hex');
  return Object.freeze({value:Object.freeze(lease),task_prompt:prompt});
}

export function buildNativeCodingTaskContext(task,options) {
  return taskContext(task,options,['LEASED','RUNNING']);
}

// Historical acceptance reconstructs identical prompt bytes without changing
// the recorded task state or treating an expired/completed lease as runnable.
export function buildNativeCodingHistoricalTaskContext(task,options) {
  return Object.freeze({...taskContext(task,options,['RESULT_READY','COMPLETED']),
    historical_readback_only:true,launch_authorized:false});
}
