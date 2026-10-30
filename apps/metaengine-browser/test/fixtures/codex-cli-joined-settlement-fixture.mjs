import {createCodexCliLaunch,codexCliLaunchIdentity,codexCliPublicProcess,codexCliSettlementSha256,
  CODEX_CLI_NATIVE_TERMINAL_SCHEMA,CODEX_CLI_JOINED_SETTLEMENT_SCHEMA} from '../../src/codex-cli-physical-settlement.mjs';

// Generated data ONLY. No native handles, process birth, file/manifest, cleanup
// or Windows behavior is proved by this fixture. Production has no such mint.
export function joinedSettlementFixture(spec,{pid=12345,birth='133333333333333333',sid='S-1-5-21-123-456-789-1001'}={}){
 const defaults={executablePath:'/fixture/worker.exe',cwd:'/fixture/worktree',args:[],timeoutMs:10000,expectedExecutableSha256:'a'.repeat(64),...spec};
 const launch=spec.launch??createCodexCliLaunch(defaults),identity=codexCliLaunchIdentity(launch);
 const date=n=>new Date(Number((BigInt(n)-116444736000000000n)/10000n)).toISOString();
 const helperBirth=String(BigInt(birth)-1n),helper={pid:pid+1,created_at:date(helperBirth),process_incarnation_id:`pid:${pid+1}:created_100ns:${helperBirth}`};
 const proof={pid,started_at:date(birth),process_incarnation_id:`pid:${pid}:created_100ns:${birth}`,
  user_sid:sid,job_id:defaults.runId,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true,process_tree_control:'WINDOWS_JOB_OBJECT',
  executable_sha256:defaults.expectedExecutableSha256,executable_path:defaults.executablePath,launch:identity,helper_process:helper,
  helper_sha256:'b'.repeat(64),helper_file_identity_sha256:'c'.repeat(64),runtime_manifest_sha256:'d'.repeat(64)};
 const complete=({exit_code=0,reason=null,cancellation=null}={})=>{
  const terminal={schema:CODEX_CLI_NATIVE_TERMINAL_SCHEMA,type:cancellation?'suspended_cancelled':'exit',launch:identity,helper_process:helper,
   run_id:defaults.runId,job_id:defaults.runId,pid,process_incarnation_id:proof.process_incarnation_id,exit_code,reason,
   never_resumed:!!cancellation,cancellation_id:cancellation?.id??null,process_exit_confirmed:true,handles_closed:true,pipes_drained:true,
   tree_cleanup_confirmed:true,process_tree_control:'WINDOWS_JOB_OBJECT',
   job_accounting:{active_processes:0,total_processes:cancellation?1:2,total_terminated_processes:1}};
  const joined={schema:CODEX_CLI_JOINED_SETTLEMENT_SCHEMA,scope:'WINDOWS_HELPER_TREE',launch:identity,helper_process:helper,helper_sha256:proof.helper_sha256,
   helper_file_identity_sha256:proof.helper_file_identity_sha256,runtime_manifest_sha256:proof.runtime_manifest_sha256,
   worker_process:codexCliPublicProcess(proof),native_terminal:terminal,native_terminal_sha256:codexCliSettlementSha256(terminal),
   parent_join:{event:'close',helper_pid:helper.pid,helper_process_incarnation_id:helper.process_incarnation_id,exit_code:0,signal:null,transport:'STDIO_CLOSE_DRAINED'}};
  return {...terminal,signal:null,joined_settlement:joined};
 };
 return {launch,proof,complete};
}
