import {createHash,randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson as canonical} from './native-coding-task-context.mjs';

// Deny-only data contract. Only the owning controller can observe child close;
// a valid object by itself is NEVER a capability or historical capacity proof.
export const CODEX_CLI_LAUNCH_SCHEMA='metaengine.codex-cli.launch.v2';
export const CODEX_CLI_NATIVE_TERMINAL_SCHEMA='metaengine.codex-cli.native-terminal.v2';
export const CODEX_CLI_JOINED_SETTLEMENT_SCHEMA='metaengine.codex-cli.joined-settlement.v1';
export const CODEX_CLI_JOB_PROTOCOL='REQUEST_BOUND_JOINED_STDIO_V2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=why=>{throw Error('codex_cli_settlement_'+why);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
export const codexCliSettlementSha256=value=>createHash('sha256').update(canonical(value)).digest('hex');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
export function codexCliHelperFileIdentitySha256(stat){
 const keys=['dev','ino','birthtimeNs','ctimeNs','mtimeNs','size','nlink'];
 if(keys.some(k=>typeof stat?.[k]!=='bigint')||stat.nlink!==1n||stat.size<1n)fail('helper_file_identity');
 return codexCliSettlementSha256(keys.map(k=>String(stat[k])));
}
export function codexCliProcessIdentity(value){
  if(!exact(value,['pid','created_at','process_incarnation_id'])||!Number.isSafeInteger(value.pid)||value.pid<1
    ||!Number.isFinite(Date.parse(value.created_at)))fail('process_identity');
  const match=/^pid:([1-9]\d*):created_100ns:([1-9]\d{16,18})$/.exec(value.process_incarnation_id||'');
  if(!match||Number(match[1])!==value.pid||(BigInt(match[2])-116444736000000000n)/10000n!==BigInt(Date.parse(value.created_at)))fail('process_birth');
  return structuredClone(value);
}
export const codexCliPublicProcess=value=>({pid:value.pid,created_at:value.created_at??value.started_at,process_incarnation_id:value.process_incarnation_id});
export function createCodexCliLaunch(spec,{requestId=randomUUID()}={}){
  const body={schema:CODEX_CLI_LAUNCH_SCHEMA,request_id:requestId,run_id:spec.runId,
    executable_path:spec.executablePath,args:spec.args,cwd:spec.cwd,timeout_ms:spec.timeoutMs,
    expected_sha256:spec.expectedExecutableSha256,deadline_ms:spec.deadlineAt==null?'':String(Date.parse(spec.deadlineAt)),
    prompt_sha256:spec.promptSha256??sha(''),binding_sha256:codexCliSettlementSha256(spec.binding??null)};
  const canonical_body=canonical(body);
  const launch={schema:CODEX_CLI_LAUNCH_SCHEMA,canonical_body,request_sha256:sha(canonical_body)};
  validateCodexCliLaunch(launch,spec);return Object.freeze(launch);
}
export function validateCodexCliLaunch(launch,spec=null){
  if(!exact(launch,['schema','canonical_body','request_sha256'])||launch.schema!==CODEX_CLI_LAUNCH_SCHEMA
    ||typeof launch.canonical_body!=='string'||Buffer.byteLength(launch.canonical_body)>131072
    ||!HASH.test(launch.request_sha256||'')||sha(launch.canonical_body)!==launch.request_sha256)fail('launch_digest');
  let body;try{body=JSON.parse(launch.canonical_body);}catch{fail('launch_json');}
  if(!exact(body,['schema','request_id','run_id','executable_path','args','cwd','timeout_ms','expected_sha256','deadline_ms','prompt_sha256','binding_sha256'])
    ||canonical(body)!==launch.canonical_body||body.schema!==CODEX_CLI_LAUNCH_SCHEMA||!UUID.test(body.request_id||'')||!UUID.test(body.run_id||'')
    ||![body.expected_sha256,body.prompt_sha256,body.binding_sha256].every(v=>HASH.test(v||''))
    ||typeof body.executable_path!=='string'||typeof body.cwd!=='string'||!body.executable_path||!body.cwd
    ||!Array.isArray(body.args)||body.args.length>256||body.args.some(v=>typeof v!=='string'||v.includes('\0'))
    ||!Number.isSafeInteger(body.timeout_ms)||body.timeout_ms<100||body.timeout_ms>1800000
    ||(body.deadline_ms!==''&&!/^[1-9]\d{0,15}$/.test(body.deadline_ms)))fail('launch_body');
  if(spec){const expected={...body,run_id:spec.runId,executable_path:spec.executablePath,args:spec.args,cwd:spec.cwd,
      timeout_ms:spec.timeoutMs,expected_sha256:spec.expectedExecutableSha256,
      deadline_ms:spec.deadlineAt==null?'':String(Date.parse(spec.deadlineAt)),prompt_sha256:spec.promptSha256??sha(''),
      binding_sha256:codexCliSettlementSha256(spec.binding??null)};
    if(!same(body,expected))fail('launch_spec_changed');}
  return body;
}
export function codexCliLaunchWire(launch){validateCodexCliLaunch(launch);return {schema:CODEX_CLI_LAUNCH_SCHEMA,body_b64:Buffer.from(launch.canonical_body,'utf8').toString('base64'),request_sha256:launch.request_sha256};}
export function codexCliLaunchIdentity(launch){
  const body=validateCodexCliLaunch(launch);
  return {request_id:body.request_id,request_sha256:launch.request_sha256,run_id:body.run_id,
    binding_sha256:body.binding_sha256,prompt_sha256:body.prompt_sha256};
}
export function validateCodexCliLaunchIdentity(value){
  if(!exact(value,['request_id','request_sha256','run_id','binding_sha256','prompt_sha256'])
    ||!UUID.test(value.request_id||'')||!UUID.test(value.run_id||'')
    ||![value.request_sha256,value.binding_sha256,value.prompt_sha256].every(x=>HASH.test(x||'')))fail('launch_identity');
  return value;
}
export function validateCodexCliNativeTerminal(value,{proof,launch,cancellation=null,resumed=false}={}){
  const fields=['schema','type','launch','helper_process','run_id','job_id','pid','process_incarnation_id','exit_code','reason',
    'never_resumed','process_exit_confirmed','handles_closed','pipes_drained','tree_cleanup_confirmed','process_tree_control','job_accounting','cancellation_id'];
  if(!exact(value,fields)||value.schema!==CODEX_CLI_NATIVE_TERMINAL_SCHEMA||!proof)fail('terminal_shape');
  validateCodexCliLaunchIdentity(value.launch);codexCliProcessIdentity(value.helper_process);
  if(!same(value.launch,launch)||!same(value.helper_process,proof.helper_process)
    ||value.run_id!==launch.run_id||value.job_id!==proof.job_id||value.job_id!==launch.run_id
    ||value.pid!==proof.pid||value.process_incarnation_id!==proof.process_incarnation_id
    ||!Number.isSafeInteger(value.exit_code)||value.exit_code<0||value.exit_code>0xffffffff
    ||value.process_exit_confirmed!==true||value.handles_closed!==true||value.pipes_drained!==true
    ||value.tree_cleanup_confirmed!==true||value.process_tree_control!=='WINDOWS_JOB_OBJECT')fail('terminal_binding');
  const a=value.job_accounting;
  if(!exact(a,['active_processes','total_processes','total_terminated_processes'])||a.active_processes!==0
    ||!Number.isSafeInteger(a.total_processes)||a.total_processes<1||a.total_processes>0xffffffff
    ||!Number.isSafeInteger(a.total_terminated_processes)||a.total_terminated_processes<0||a.total_terminated_processes>a.total_processes)fail('terminal_accounting');
  if(value.type==='suspended_cancelled'){
    if(resumed||!cancellation||!UUID.test(cancellation.id||'')||value.cancellation_id!==cancellation.id||value.reason!==cancellation.reason
      ||value.exit_code!==125||value.never_resumed!==true||a.total_processes!==1)fail('cancel_binding');
  }else if(value.type==='exit'){
    if(!resumed||cancellation||value.cancellation_id!==null||value.never_resumed!==false
      ||![null,'TIMEOUT','CANCELLED'].includes(value.reason))fail('exit_binding');
  }else fail('terminal_type');
  return structuredClone(value);
}
export function validateCodexCliJoinedSettlement(value,{proof,launch}={}){
  if(!exact(value,['schema','scope','launch','helper_process','helper_sha256','helper_file_identity_sha256','runtime_manifest_sha256','worker_process','native_terminal','native_terminal_sha256','parent_join'])
    ||value.schema!==CODEX_CLI_JOINED_SETTLEMENT_SCHEMA||value.scope!=='WINDOWS_HELPER_TREE'||!proof)fail('joined_shape');
  const expectedLaunch=launch?codexCliLaunchIdentity(launch):validateCodexCliLaunchIdentity(proof.launch);
  if(!same(value.launch,expectedLaunch)||!same(value.launch,proof.launch)||!same(value.helper_process,proof.helper_process)
    ||!same(value.worker_process,codexCliPublicProcess(proof))
    ||value.helper_sha256!==proof.helper_sha256||!HASH.test(value.helper_sha256||'')
    ||value.helper_file_identity_sha256!==proof.helper_file_identity_sha256||!HASH.test(value.helper_file_identity_sha256||'')
    ||value.runtime_manifest_sha256!==proof.runtime_manifest_sha256||(value.runtime_manifest_sha256!==null&&!HASH.test(value.runtime_manifest_sha256||'')))fail('joined_binding');
  codexCliProcessIdentity(value.worker_process);codexCliProcessIdentity(value.helper_process);
  if(value.worker_process.pid===value.helper_process.pid||BigInt(value.worker_process.process_incarnation_id.split(':')[3])<BigInt(value.helper_process.process_incarnation_id.split(':')[3]))fail('joined_birth_order');
  const t=value.native_terminal;
  validateCodexCliNativeTerminal(t,{proof,launch:expectedLaunch,resumed:t?.type==='exit',
    cancellation:t?.type==='suspended_cancelled'?{id:t.cancellation_id,reason:t.reason}:null});
  if(value.native_terminal_sha256!==codexCliSettlementSha256(t))fail('joined_terminal_digest');
  const j=value.parent_join;
  if(!exact(j,['event','helper_pid','helper_process_incarnation_id','exit_code','signal','transport'])||j.event!=='close'
    ||j.helper_pid!==value.helper_process.pid||j.helper_process_incarnation_id!==value.helper_process.process_incarnation_id
    ||j.exit_code!==0||j.signal!==null||j.transport!=='STDIO_CLOSE_DRAINED')fail('joined_parent');
  return structuredClone(value);
}

export function codexCliLocalOutputDrain(settlement){return {schema:'metaengine.codex-cli.local-output-drain.v1',scope:'HELPER_TREE_AND_LOCAL_OUTPUT',
 helper_settlement_sha256:codexCliSettlementSha256(settlement),agent_bridge_transport:'ORIGINAL_CLOSE_JOINED',
 host_scope_callbacks:'NOT_ATTESTED',all_effects_cleanup:'UNCONFIRMED',authority_effect:false};}
export function validateCodexCliLocalOutputDrain(receipt){
 if(!same(receipt.local_output_drain,codexCliLocalOutputDrain(receipt.physical_settlement)))fail('local_output_drain');
 return receipt.local_output_drain;
}
export function validateCodexCliProtectedLaunch(receipt,launch){
 const body=validateCodexCliLaunch(launch),identity=codexCliLaunchIdentity(launch);
 const binding=Object.fromEntries(['task_id','agent_id','base_sha','lease_generation','agent_generation_epoch','role'].map(k=>[k,receipt[k]]));
 if(body.run_id!==receipt.run_id||body.prompt_sha256!==receipt.prompt_sha256||body.binding_sha256!==codexCliSettlementSha256(binding)
  ||body.expected_sha256!==receipt.executable_sha256||body.cwd!==receipt.worktree_path||!same(receipt.launch_identity,identity)
  ||(receipt.process&&!same(receipt.process.launch,identity)))fail('protected_launch_scope');
 return identity;
}
export function validateCodexCliProtectedSettlement(receipt,{launch,processReceipt}={}){
  // Legacy bytes remain readable. Absence is explicitly NOT settlement proof.
  if(!receipt?.process?.launch&&!receipt?.physical_settlement)return null;
  if(!receipt.physical_settlement&&receipt.state!=='RESULT_READY')return null;
  if(!launch||!processReceipt||!receipt.physical_settlement||!same(processReceipt.process,receipt.process)||!same(receipt.launch_identity,processReceipt.launch_identity)
    ||!same(receipt.launch_identity,codexCliLaunchIdentity(launch))
    ||processReceipt.run_id!==receipt.run_id||processReceipt.task_id!==receipt.task_id
    ||['lease_generation','agent_id','agent_generation_epoch','base_sha','role','workspace_id','project_id','permit_id','owner_epoch','user_sid','executable_sha256','worktree_path','prompt_sha256'].some(k=>processReceipt[k]!==receipt[k])
    ||receipt.run_id!==validateCodexCliLaunch(launch).run_id
    ||receipt.prompt_sha256!==codexCliLaunchIdentity(launch).prompt_sha256
    ||!same(receipt.physical_settlement,receipt.process_result?.joined_settlement))fail('protected_chain');
  validateCodexCliLocalOutputDrain(receipt);
  if(!HASH.test(receipt.physical_settlement.runtime_manifest_sha256||''))fail('protected_prepared_runtime_required');
  validateCodexCliProtectedLaunch(receipt,launch);
  return validateCodexCliJoinedSettlement(receipt.physical_settlement,{proof:receipt.process,launch});
}
