import {createHash} from 'node:crypto';
import {createNativeCodingAgentMcpBroker,nativeCodingAgentMcpIntentBodySha256} from './native-coding-agent-mcp-broker.mjs';
import {createNativeCodingAgentMcpLaunch} from './native-coding-agent-mcp-launch.mjs';
import {validateNativeCodingAgentHostRequest} from './native-coding-agent-host-contract.mjs';
import {nativeCodingCanonicalJson as canonical} from './native-coding-task-context.mjs';

const fail=()=>{throw Error('native_coding_agent_run_bridge_denied');};
const same=(a,b)=>canonical(a)===canonical(b);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** One private capability per actual leased run; no allocator or provider API. */
export async function prepareNativeCodingAgentRunBridge({ownPostgres,runId,binding,permit,authorization,deadlineAt,pins}={}){
  if(typeof ownPostgres?.agentOperation!=='function'||!UUID.test(runId||'')||!permit||!authorization
    ||permit.permit_id!==authorization.permit_id||permit.owner_epoch!==authorization.owner_epoch
    ||permit.workspace_id!==authorization.workspace_id||permit.project_id!==authorization.project_id
    ||permit.user_sid!==authorization.user_sid||permit.revoked!==false||permit.trust_namespace!=='LOCAL_OPERATOR_QA'
    ||authorization.authorized!==true||authorization.trust_namespace!=='LOCAL_OPERATOR_QA'
    ||['task_id','lease_generation','agent_id','role','agent_generation_epoch','base_sha'].some(key=>authorization[key]!==binding?.[key])
    ||['agent_id','role','agent_generation_epoch'].some(key=>permit[key]!==binding?.[key])
    ||permit.worktree?.base_sha!==binding.base_sha||permit.worktree?.path!==authorization.worktree_path
    ||!Number.isFinite(Date.parse(deadlineAt))||Date.parse(deadlineAt)<=Date.now()
    ||Date.parse(deadlineAt)>Date.parse(permit.expires_at))fail();
  const scope=Object.freeze({run_id:runId,workspace_id:permit.workspace_id,project_id:permit.project_id,
    task_id:binding.task_id,lease_generation:binding.lease_generation,agent_id:binding.agent_id,
    agent_generation_epoch:binding.agent_generation_epoch,provider_id:permit.provider_id,role:binding.role});
  let closed=false,job=null,broker=null;
  const open=()=>{if(closed||Date.now()>=Date.parse(deadlineAt))fail();};
  const host=async(operation,args)=>{
    open();if(!job)fail();
    const result=await ownPostgres.agentOperation(validateNativeCodingAgentHostRequest({binding:scope,job_binding:job,operation,args}));
    open();return result;
  };
  const checkContext=context=>{
    open();if(!job||!same(context.binding,scope)||!same(context.jobBinding,job)||context.signal?.aborted)fail();
  };
  const assertAuthorized=async context=>{
    checkContext(context);const value=await host('CHECK',{});
    if(value?.schema!=='metaengine.native-coding.agent-authorized.v1'||value.run_id!==runId||value.authorized!==true||value.authority_effect!==false)fail();
    checkContext(context);
  };
  const tools=['project_overview','project_history_page','agent_send_message','agent_ack_message',...(binding.role==='IMPLEMENTER'?['project_propose_children']:[])];
  const operations=Object.fromEntries(tools.map(tool=>[tool,async(args,context)=>{
    checkContext(context);return host(tool,args);
  }]));
  try{
    broker=await createNativeCodingAgentMcpBroker({maxRuns:1,operations,assertInvocationAuthorized:assertAuthorized,
      async readIntentReceipt(context){
        checkContext(context);const row=await host('READ_INTENT',{request_id:context.request_id});
        if(row?.schema!=='metaengine.native-coding.agent-intent.v1'||row.found!==true||row.run_id!==runId
          ||row.request_id!==context.request_id||!UUID.test(row.original_request_id||'')
          ||row.readback_only!==true||row.physical_effect_replayed!==false||row.authority_effect!==false
          ||typeof row.canonical_body_text!=='string'||Buffer.byteLength(row.canonical_body_text)>32768
          ||!SHA.test(row.body_sha256||'')||hash(row.canonical_body_text)!==row.body_sha256
          ||!same(JSON.parse(row.canonical_body_text),row.body)||!row.receipt||typeof row.receipt!=='object'||Array.isArray(row.receipt))fail();
        const tool=({MESSAGE:'agent_send_message',ACK:'agent_ack_message',SPAWN:'project_propose_children'})[row.operation];
        const args={...row.body,request_id:context.request_id};
        if(tool!==context.tool||nativeCodingAgentMcpIntentBodySha256(tool,args)!==context.intent_body_sha256)fail();
        return {schema:'metaengine.native-coding.agent-tool-receipt.v1',run_id:runId,tool,request_id:context.request_id,
          intent_body_sha256:context.intent_body_sha256,state:'CONFIRMED',result:row.receipt,authority_effect:false};
      }});
    const registration=broker.issueRun({binding:scope,jobBinding:null,expiresAt:deadlineAt,allowedTools:tools});
    const launch=await createNativeCodingAgentMcpLaunch({registration,...pins});
    return Object.freeze({launch,
      async bindRun(proof){
        open();if(job)fail();
        const candidate=Object.freeze({job_id:proof?.job_id,pid:proof?.pid,process_incarnation_id:proof?.process_incarnation_id,
          executable_sha256:proof?.executable_sha256});
        validateNativeCodingAgentHostRequest({binding:scope,job_binding:candidate,operation:'CHECK',args:{}});
        if(candidate.executable_sha256!==permit.artifact.cli_executable_sha256||proof.user_sid!==permit.user_sid
          ||proof.tree_control_bound!==true||proof.started_suspended!==true||proof.job_bound_before_resume!==true)fail();
        // W30 RUNNING and protected ATTEMPTED registration must already exist.
        // A failure here leaves the process suspended and the token unbound.
        const value=await ownPostgres.agentOperation({binding:scope,job_binding:candidate,operation:'CHECK',args:{}});
        open();if(value?.schema!=='metaengine.native-coding.agent-authorized.v1'||value.run_id!==runId
          ||value.authorized!==true||value.authority_effect!==false)fail();
        job=candidate;broker.bindRun(runId,job);
      },
      async reconcileIntent(requestId){open();return broker.reconcileIntent(runId,requestId);},
      async close(){if(closed)return;closed=true;broker.revokeRun(runId);await broker.close();job=null;},
    });
  }catch(error){closed=true;await broker?.close();throw error;}
}
