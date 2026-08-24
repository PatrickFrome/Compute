import type { WorkflowStep } from "cloudflare:workers";
import type { Env, JsonObject } from "./types";
import { rpc } from "./supabase";

type Actor = "GPT" | "GLM";
type Rail = "VERCEL_AI_GATEWAY" | "CLOUDFLARE_AI";
type Lease = {
  leased:boolean; duel_id?:string; duel_key?:string; milestone_key?:string;
  checkpoint_id?:string; payload_root_sha256?:string; base_github_sha?:string;
  subject?:JsonObject; gpt_model?:string; glm_model?:string; protocol_version?:string;
  current_tick?:number; current_checkpoint_sha256?:string; max_ticks?:number; lease_generation?:number;
};
type Readback = JsonObject & { status?:string; current_tick?:number; current_checkpoint_sha256?:string; events?:JsonObject[] };
type RailSuccess = { rail:Rail; payload:JsonObject; latencyMs:number; model:string };
type RailFailure = { rail:Rail; latencyMs:number; model:string; error:string; errorClass:string };
type RailTask = { rail:Rail; controller:AbortController; promise:Promise<RailSuccess> };
type ActorResult = { payload:JsonObject; executorError:boolean };

const GPT="openai/gpt-5.6-sol";
const GLM_CF="@cf/zai-org/glm-5.2";
const GLM_VERCEL="zai/glm-5.2";
const VOTES=new Set(["WIN_GPT","WIN_GLM","SYNTHESIS","NO_ACTION"]);

function asObj(v:unknown):JsonObject{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("duel_object_required");return v as JsonObject;}
function parseJson(text:string):JsonObject{const s=text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");try{return asObj(JSON.parse(s));}catch{}const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<=a)throw new Error(`duel_json_missing:${s.slice(0,300)}`);return asObj(JSON.parse(s.slice(a,b+1)));}
function responseText(body:JsonObject):string{if(typeof body.output_text==="string")return body.output_text;const parts:string[]=[];for(const x of Array.isArray(body.output)?body.output:[])if(x&&typeof x==="object"&&!Array.isArray(x)){const c=(x as JsonObject).content;if(Array.isArray(c))for(const y of c)if(y&&typeof y==="object"&&!Array.isArray(y)&&typeof (y as JsonObject).text==="string")parts.push(String((y as JsonObject).text));}return parts.join("\n");}

const SYSTEM=`You are one of two equal adversarial engineering contenders in METAENGINE H205F22 MICROSTEP_LOCKSTEP_V2.
This is active co-development, not chat. Produce exactly ONE observable engineering step per invocation.
Private chain-of-thought is never shared; put all peer-relevant engineering rationale into the structured observable step.
Both actors start each tick from the exact same persisted checkpoint and ledger. You must explicitly address the peer's immediately previous event hash when one exists.
Do not optimize for agreement. Prefer falsifiable claims, executable patches/tests, concrete counterexamples, or security vetoes.
Never claim canonical authority, merge authority, VERIFIED, or live evidence absent from the ledger.
Return exactly one JSON object and no markdown.`;

function timeoutMs(env:Env):number{const n=Number(env.DUEL_MODEL_TIMEOUT_MS||90000);return Number.isFinite(n)?Math.max(5000,Math.min(n,300000)):90000;}
function criticalShadowMs(env:Env):number{const n=Number(env.DUEL_CRITICAL_SHADOW_MS||1500);return Number.isFinite(n)?Math.max(0,Math.min(n,15000)):1500;}
function sleep(ms:number):Promise<void>{return new Promise((resolve)=>setTimeout(resolve,ms));}
function classifyError(error:unknown):string{const s=String(error);return s.includes("AbortError")||s.includes("duel_model_timeout")||s.includes("rail_loser")?"TIMEOUT_OR_ABORT":"PROVIDER_ERROR";}

function modelForRail(actor:Actor,lease:Lease,rail:Rail):string{
  if(actor==="GPT") return lease.gpt_model||GPT;
  const configured=lease.glm_model||"";
  if(rail==="VERCEL_AI_GATEWAY"){
    if(configured.startsWith("@cf/zai-org/")) return `zai/${configured.slice("@cf/zai-org/".length)}`;
    if(configured.startsWith("zai/")) return configured;
    return GLM_VERCEL;
  }
  if(configured.startsWith("@cf/")) return configured;
  if(configured.startsWith("zai/")) return `@cf/zai-org/${configured.slice("zai/".length)}`;
  return GLM_CF;
}
function availableRails(env:Env):Rail[]{const rails:Rail[]=[];if(env.VERCEL_AI_GATEWAY_API_KEY)rails.push("VERCEL_AI_GATEWAY");if(env.CF_ACCOUNT_ID&&env.CF_AI_TOKEN)rails.push("CLOUDFLARE_AI");return rails;}

async function vercel(env:Env,model:string,prompt:string,signal:AbortSignal):Promise<JsonObject>{
  if(!env.VERCEL_AI_GATEWAY_API_KEY)throw new Error("vercel_gateway_key_missing");
  const normalized=model.startsWith("@cf/zai-org/")?`zai/${model.slice("@cf/zai-org/".length)}`:model;
  const r=await fetch("https://ai-gateway.vercel.sh/v1/responses",{method:"POST",signal,headers:{authorization:`Bearer ${env.VERCEL_AI_GATEWAY_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({model:normalized,instructions:SYSTEM,input:prompt,max_output_tokens:1800,store:false})});
  const t=await r.text();if(!r.ok)throw new Error(`vercel_${normalized}:${r.status}:${t.slice(0,800)}`);const out=responseText(asObj(JSON.parse(t)));if(!out)throw new Error(`vercel_${normalized}_empty`);return parseJson(out);
}
async function gptCloudflare(env:Env,model:string,prompt:string,signal:AbortSignal):Promise<JsonObject>{if(!env.CF_ACCOUNT_ID||!env.CF_AI_TOKEN)throw new Error("cloudflare_ai_not_configured");const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/responses`,{method:"POST",signal,headers:{authorization:`Bearer ${env.CF_AI_TOKEN}`,"content-type":"application/json",...(env.AOP_AI_GATEWAY_ID?{"cf-aig-gateway-id":env.AOP_AI_GATEWAY_ID}:{})},body:JSON.stringify({model,instructions:SYSTEM,input:prompt,reasoning:{effort:"medium"},max_output_tokens:1800,store:false})});const t=await r.text();if(!r.ok)throw new Error(`cloudflare_gpt:${r.status}:${t.slice(0,800)}`);const out=responseText(asObj(JSON.parse(t)));if(!out)throw new Error("cloudflare_gpt_empty");return parseJson(out);}
async function glmCloudflare(env:Env,model:string,prompt:string,signal:AbortSignal):Promise<JsonObject>{if(!env.CF_ACCOUNT_ID||!env.CF_AI_TOKEN)throw new Error("cloudflare_ai_not_configured");const m=model.startsWith("@cf/")?model:GLM_CF;const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${m}`,{method:"POST",signal,headers:{authorization:`Bearer ${env.CF_AI_TOKEN}`,"content-type":"application/json","cf-aig-gateway-id":env.AOP_AI_GATEWAY_ID||"default"},body:JSON.stringify({messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}],max_completion_tokens:1800,reasoning_effort:"medium",stream:false})});const t=await r.text();if(!r.ok)throw new Error(`cloudflare_glm:${r.status}:${t.slice(0,800)}`);const b=asObj(JSON.parse(t)),q=(b.result&&typeof b.result==="object"&&!Array.isArray(b.result)?b.result:b) as JsonObject;let out=typeof q.response==="string"?q.response:"";if(!out&&Array.isArray(q.choices)&&q.choices[0]&&typeof q.choices[0]==="object"){const msg=(q.choices[0] as JsonObject).message;if(msg&&typeof msg==="object"&&!Array.isArray(msg)&&typeof (msg as JsonObject).content==="string")out=String((msg as JsonObject).content);}if(!out)throw new Error("cloudflare_glm_empty");return parseJson(out);}
async function callRail(env:Env,actor:Actor,lease:Lease,prompt:string,rail:Rail,signal:AbortSignal):Promise<JsonObject>{const model=modelForRail(actor,lease,rail);if(rail==="VERCEL_AI_GATEWAY")return vercel(env,model,prompt,signal);return actor==="GPT"?gptCloudflare(env,model,prompt,signal):glmCloudflare(env,model,prompt,signal);}

function startRail(env:Env,actor:Actor,lease:Lease,prompt:string,rail:Rail,failures:RailFailure[]):RailTask{
  const controller=new AbortController();const started=Date.now();const model=modelForRail(actor,lease,rail);const timeout=setTimeout(()=>controller.abort("duel_model_timeout"),timeoutMs(env));
  const promise=callRail(env,actor,lease,prompt,rail,controller.signal).then((payload)=>({rail,payload,latencyMs:Date.now()-started,model})).catch((error)=>{const failure:RailFailure={rail,latencyMs:Date.now()-started,model,error:String(error).slice(0,1200),errorClass:classifyError(error)};failures.push(failure);throw failure;}).finally(()=>clearTimeout(timeout));
  return{rail,controller,promise};
}
function criticalStep(payload:JsonObject):boolean{const st=typeof payload.step_type==="string"?payload.step_type.toUpperCase():"";return st==="SECURITY_VETO"||st==="ARBITRATION"||st==="STOP"||payload.ready_to_resolve===true||payload.need_canary===true||typeof payload.terminal_vote==="string";}
function failureJson(f:RailFailure):JsonObject{return{rail:f.rail,model:f.model,latency_ms:f.latencyMs,error_class:f.errorClass,error:f.error};}
function successJson(s:RailSuccess):JsonObject{return{rail:s.rail,model:s.model,latency_ms:s.latencyMs,payload:s.payload};}

async function raceActor(env:Env,actor:Actor,lease:Lease,prompt:string):Promise<JsonObject>{
  const rails=availableRails(env);if(!rails.length)throw new Error("duel_no_inference_rail_configured");const failures:RailFailure[]=[];const tasks=rails.map((rail)=>startRail(env,actor,lease,prompt,rail,failures));
  let winner:RailSuccess;
  try{winner=await Promise.any(tasks.map((t)=>t.promise));}catch(error){for(const t of tasks)t.controller.abort("all_rails_failed");const details=error instanceof AggregateError?error.errors:failures;throw new Error(`duel_all_rails_failed:${actor}:${JSON.stringify(details).slice(0,2200)}`);}
  const critical=criticalStep(winner.payload);let shadow:JsonObject|null=null;const alternate=tasks.find((t)=>t.rail!==winner.rail);
  if(critical&&alternate&&criticalShadowMs(env)>0){const shadowResult=await Promise.race([alternate.promise.then((s)=>({kind:"SUCCESS",success:s} as const)).catch((e)=>({kind:"ERROR",error:e} as const)),sleep(criticalShadowMs(env)).then(()=>({kind:"TIMEOUT"} as const))]);if(shadowResult.kind==="SUCCESS")shadow={status:"SUCCESS",...successJson(shadowResult.success)};else if(shadowResult.kind==="ERROR")shadow={status:"ERROR",error:String(shadowResult.error).slice(0,1200)};else shadow={status:"TIMEOUT",wait_ms:criticalShadowMs(env)};}
  for(const t of tasks)if(t.rail!==winner.rail)t.controller.abort("rail_loser");
  const executor:JsonObject={mode:"DUAL_RAIL_RACE",winner_rail:winner.rail,winner_model:winner.model,winner_latency_ms:winner.latencyMs,rails_started:rails,failures_before_winner:failures.map(failureJson),critical_step:critical,critical_shadow:shadow};
  return{...winner.payload,_executor:executor};
}
function visibleExecutorError(a:Actor,error:unknown,peerHash:string|null):JsonObject{return{step_type:"EXECUTOR_ERROR",summary:`${a} execution slot did not return a model microstep on any configured rail`,evidence_used:[],peer_event_hash_addressed:peerHash,action:{kind:"BLOCKED_EXECUTOR",backend:"DUAL_RAIL_RACE"},falsifier:"A later exact-model invocation succeeds under the same immutable subject",risk_delta:"No model reasoning was fabricated; this is a SYSTEM-observed executor failure.",ready_to_resolve:false,terminal_vote:null,need_canary:false,resolution:null,synthetic:true,model_response:false,error_class:classifyError(error),error:String(error).slice(0,2200),canonical:false,authority_effect:false};}
async function actorVisible(env:Env,a:Actor,l:Lease,p:string,peerHash:string|null):Promise<ActorResult>{try{return{payload:await raceActor(env,a,l,p),executorError:false};}catch(error){return{payload:visibleExecutorError(a,error,peerHash),executorError:true};}}

function recentPeerHash(read:Readback,actorName:Actor):string|null{const events=Array.isArray(read.events)?read.events:[];for(let i=events.length-1;i>=0;i--){const e=events[i];if(e&&typeof e==="object"&&!Array.isArray(e)&&String((e as JsonObject).actor||"")!==actorName&&typeof (e as JsonObject).event_sha256==="string")return String((e as JsonObject).event_sha256);}return null;}
function prompt(a:Actor,l:Lease,r:Readback):string{const peer=recentPeerHash(r,a);return `ACTOR=${a}\nDUEL=${l.duel_key}\nNEXT_TICK=${Number(r.current_tick||0)+1}\nSEEN_CHECKPOINT=${String(r.current_checkpoint_sha256||"")}\nPEER_PREVIOUS_EVENT_HASH=${peer||"NONE"}\nSUBJECT=${JSON.stringify(l.subject||{})}\nBASE_SHA=${l.base_github_sha}\nLEDGER=${JSON.stringify(r)}\n\nReturn keys: step_type, summary, evidence_used, peer_event_hash_addressed, action, falsifier, risk_delta, ready_to_resolve, terminal_vote, need_canary, resolution.\nstep_type examples: OBSERVE,HYPOTHESIS,COUNTEREXAMPLE,SQL_DESIGN,PATCH_DELTA,TEST_DESIGN,SECURITY_VETO,PERFORMANCE_NOTE,REBUTTAL,ARBITRATION,STOP.\nIf PEER_PREVIOUS_EVENT_HASH is not NONE, peer_event_hash_addressed MUST equal it. terminal_vote may be WIN_GPT,WIN_GLM,SYNTHESIS,NO_ACTION or null.`;}
function st(v:JsonObject):string{const s=typeof v.step_type==="string"?v.step_type.trim().toUpperCase():"OBSERVE";return /^[A-Z0-9_]{2,48}$/.test(s)?s:"OBSERVE";}
function vote(v:JsonObject):string|null{const s=typeof v.terminal_vote==="string"?v.terminal_vote:"";return VOTES.has(s)?s:null;}
function peerAckOk(v:JsonObject,expected:string|null):boolean{return !expected||v.peer_event_hash_addressed===expected;}
function executorMeta(v:JsonObject):JsonObject|null{return v._executor&&typeof v._executor==="object"&&!Array.isArray(v._executor)?v._executor as JsonObject:null;}

export async function runMicrostepDuel(env:Env,step:WorkflowStep,workerId:string):Promise<unknown>{
  const lt=await step.do("microstep-lease",{retries:{limit:4,delay:"1 second",backoff:"exponential"}},async()=>JSON.stringify(await rpc<Lease>(env,"h205f22_duel_lease_lockstep_v2",{p_worker:workerId,p_lease_seconds:3600})));
  const lease=JSON.parse(lt) as Lease;if(!lease.leased)return{status:"MICROSTEP_IDLE"};if(!lease.duel_id||lease.lease_generation==null||lease.protocol_version!=="LOCKSTEP_V2")throw new Error("microstep_bad_lease");
  const duelId=lease.duel_id,leaseGeneration=lease.lease_generation;
  let checkpoint=String(lease.current_checkpoint_sha256||""),lastTick=Number(lease.current_tick||0);const max=Math.min(Number(lease.max_ticks||32),64);
  try{
    for(let tick=lastTick+1;tick<=max;tick++){
      const rt=await step.do(`microstep-read-${tick}`,async()=>JSON.stringify(await rpc<Readback>(env,"h205f22_duel_read_lockstep_v2",{p_duel_id:duelId,p_after_tick:Math.max(0,tick-9)})));
      const read=JSON.parse(rt) as Readback;if(read.status!=="RUNNING")return{status:"MICROSTEP_TERMINAL",terminal_status:read.status};checkpoint=String(read.current_checkpoint_sha256||checkpoint);
      const gp=prompt("GPT",lease,read),lp=prompt("GLM",lease,read),gPeer=recentPeerHash(read,"GPT"),lPeer=recentPeerHash(read,"GLM");
      const both=await step.do(`microstep-dual-${tick}`,{retries:{limit:1,delay:"1 second",backoff:"exponential"},timeout:"7 minutes"},async()=>{const [g,l]=await Promise.all([actorVisible(env,"GPT",lease,gp,gPeer),actorVisible(env,"GLM",lease,lp,lPeer)]);return JSON.stringify({g,l});});
      const pair=JSON.parse(String(both)) as {g:ActorResult;l:ActorResult};
      if(!peerAckOk(pair.g.payload,gPeer)||!peerAckOk(pair.l.payload,lPeer))throw new Error(`microstep_peer_hash_ack_failed:${tick}`);
      const pt=await step.do(`microstep-persist-${tick}`,{retries:{limit:3,delay:"1 second",backoff:"exponential"}},async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_submit_pair_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_tick_no:tick,p_seen_checkpoint_sha256:checkpoint,p_gpt_step_type:st(pair.g.payload),p_gpt_payload:pair.g.payload,p_glm_step_type:st(pair.l.payload),p_glm_payload:pair.l.payload})));
      const receipt=JSON.parse(pt) as JsonObject;checkpoint=String(receipt.output_checkpoint_sha256||checkpoint);lastTick=tick;
      if(pair.g.executorError||pair.l.executorError){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"BLOCKED_EXECUTOR",inference_backend:"DUAL_RAIL_RACE",final_tick:tick,final_checkpoint_sha256:checkpoint,gpt_step:pair.g.payload,glm_step:pair.l.payload,canonical:false,authority_effect:false};return await step.do(`microstep-blocked-${tick}`,async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"BLOCKED",p_result:result})));}
      const gv=vote(pair.g.payload),lv=vote(pair.l.payload),ready=pair.g.payload.ready_to_resolve===true&&pair.l.payload.ready_to_resolve===true;
      if(ready&&gv&&lv&&gv===lv){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"RESOLVED",winner:gv,inference_backend:"DUAL_RAIL_RACE",final_tick:tick,final_checkpoint_sha256:checkpoint,gpt_executor:executorMeta(pair.g.payload),glm_executor:executorMeta(pair.l.payload),gpt_resolution:pair.g.payload.resolution??null,glm_resolution:pair.l.payload.resolution??null,canonical:false,authority_effect:false};return await step.do(`microstep-complete-${tick}`,async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"RESOLVED",p_result:result})));}
      if(pair.g.payload.need_canary===true&&pair.l.payload.need_canary===true){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"CANARY_REQUIRED",inference_backend:"DUAL_RAIL_RACE",final_tick:tick,final_checkpoint_sha256:checkpoint,gpt:pair.g.payload,glm:pair.l.payload,canonical:false,authority_effect:false};return await step.do(`microstep-canary-${tick}`,async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"CANARY_REQUIRED",p_result:result})));}
    }
    const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"CANARY_REQUIRED",reason:"MAX_MICROSTEPS",inference_backend:"DUAL_RAIL_RACE",final_tick:lastTick,final_checkpoint_sha256:checkpoint,canonical:false,authority_effect:false};return await step.do("microstep-max",async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"CANARY_REQUIRED",p_result:result})));
  }catch(error){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"FAILED",error:String(error).slice(0,3000),inference_backend:"DUAL_RAIL_RACE",final_tick:lastTick,final_checkpoint_sha256:checkpoint,canonical:false,authority_effect:false};try{return await step.do("microstep-failed",async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"FAILED",p_result:result})));}catch{throw error;}}
}
