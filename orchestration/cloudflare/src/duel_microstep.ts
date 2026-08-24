import type { WorkflowStep } from "cloudflare:workers";
import type { Env, JsonObject } from "./types";
import { rpc } from "./supabase";

type Actor = "GPT" | "GLM";
type Lease = {
  leased:boolean; duel_id?:string; duel_key?:string; milestone_key?:string;
  checkpoint_id?:string; payload_root_sha256?:string; base_github_sha?:string;
  subject?:JsonObject; gpt_model?:string; glm_model?:string; protocol_version?:string;
  current_tick?:number; current_checkpoint_sha256?:string; max_ticks?:number; lease_generation?:number;
};
type Readback = JsonObject & { status?:string; current_tick?:number; current_checkpoint_sha256?:string; events?:JsonObject[] };

const GPT="openai/gpt-5.6-sol";
const GLM="@cf/zai-org/glm-5.2";
const VOTES=new Set(["WIN_GPT","WIN_GLM","SYNTHESIS","NO_ACTION"]);

function asObj(v:unknown):JsonObject{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("duel_object_required");return v as JsonObject;}
function parseJson(text:string):JsonObject{const s=text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");try{return asObj(JSON.parse(s));}catch{}const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<=a)throw new Error(`duel_json_missing:${s.slice(0,300)}`);return asObj(JSON.parse(s.slice(a,b+1)));}
function gptText(body:JsonObject):string{if(typeof body.output_text==="string")return body.output_text;const parts:string[]=[];for(const x of Array.isArray(body.output)?body.output:[])if(x&&typeof x==="object"&&!Array.isArray(x)){const c=(x as JsonObject).content;if(Array.isArray(c))for(const y of c)if(y&&typeof y==="object"&&!Array.isArray(y)&&typeof (y as JsonObject).text==="string")parts.push(String((y as JsonObject).text));}return parts.join("\n");}

const SYSTEM=`You are one of two equal adversarial engineering contenders in METAENGINE H205F22 MICROSTEP_LOCKSTEP_V2.
This is active co-development, not chat. Produce exactly ONE observable engineering step per invocation.
Private chain-of-thought is never shared; put all peer-relevant reasoning into the structured observable step.
Both actors start each tick from the exact same persisted checkpoint and ledger. You must explicitly address the peer's immediately previous event hash when one exists.
Do not optimize for agreement. Prefer falsifiable claims, executable patches/tests, concrete counterexamples, or security vetoes.
Never claim canonical authority, merge authority, VERIFIED, or live evidence absent from the ledger.
Return exactly one JSON object and no markdown.`;

async function gpt(env:Env,model:string,prompt:string):Promise<JsonObject>{if(!env.CF_ACCOUNT_ID||!env.CF_AI_TOKEN)throw new Error("duel_ai_not_configured");const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/responses`,{method:"POST",headers:{authorization:`Bearer ${env.CF_AI_TOKEN}`,"content-type":"application/json",...(env.AOP_AI_GATEWAY_ID?{"cf-aig-gateway-id":env.AOP_AI_GATEWAY_ID}:{})},body:JSON.stringify({model,instructions:SYSTEM,input:prompt,reasoning:{effort:"medium"},max_output_tokens:1800,store:false})});const t=await r.text();if(!r.ok)throw new Error(`duel_gpt:${r.status}:${t.slice(0,800)}`);return parseJson(gptText(asObj(JSON.parse(t))));}
async function glm(env:Env,model:string,prompt:string):Promise<JsonObject>{if(!env.CF_ACCOUNT_ID||!env.CF_AI_TOKEN)throw new Error("duel_ai_not_configured");const m=model.startsWith("@cf/")?model:GLM;const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${m}`,{method:"POST",headers:{authorization:`Bearer ${env.CF_AI_TOKEN}`,"content-type":"application/json","cf-aig-gateway-id":env.AOP_AI_GATEWAY_ID||"default"},body:JSON.stringify({messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}],max_completion_tokens:1800,reasoning_effort:"medium",stream:false})});const t=await r.text();if(!r.ok)throw new Error(`duel_glm:${r.status}:${t.slice(0,800)}`);const b=asObj(JSON.parse(t)),q=(b.result&&typeof b.result==="object"&&!Array.isArray(b.result)?b.result:b) as JsonObject;let out=typeof q.response==="string"?q.response:"";if(!out&&Array.isArray(q.choices)&&q.choices[0]&&typeof q.choices[0]==="object"){const msg=(q.choices[0] as JsonObject).message;if(msg&&typeof msg==="object"&&!Array.isArray(msg)&&typeof (msg as JsonObject).content==="string")out=String((msg as JsonObject).content);}if(!out)throw new Error("duel_glm_empty");return parseJson(out);}
async function actor(env:Env,a:Actor,l:Lease,p:string){return a==="GPT"?gpt(env,l.gpt_model||GPT,p):glm(env,l.glm_model||GLM,p);}

function recentPeerHash(read:Readback,actorName:Actor):string|null{const events=Array.isArray(read.events)?read.events:[];for(let i=events.length-1;i>=0;i--){const e=events[i];if(e&&typeof e==="object"&&!Array.isArray(e)&&String((e as JsonObject).actor||"")!==actorName&&typeof (e as JsonObject).event_sha256==="string")return String((e as JsonObject).event_sha256);}return null;}
function prompt(a:Actor,l:Lease,r:Readback):string{const peer=recentPeerHash(r,a);return `ACTOR=${a}\nDUEL=${l.duel_key}\nNEXT_TICK=${Number(r.current_tick||0)+1}\nSEEN_CHECKPOINT=${String(r.current_checkpoint_sha256||"")}\nPEER_PREVIOUS_EVENT_HASH=${peer||"NONE"}\nSUBJECT=${JSON.stringify(l.subject||{})}\nBASE_SHA=${l.base_github_sha}\nLEDGER=${JSON.stringify(r)}\n\nReturn keys: step_type, summary, evidence_used, peer_event_hash_addressed, action, falsifier, risk_delta, ready_to_resolve, terminal_vote, need_canary, resolution.\nstep_type examples: OBSERVE,HYPOTHESIS,COUNTEREXAMPLE,SQL_DESIGN,PATCH_DELTA,TEST_DESIGN,SECURITY_VETO,PERFORMANCE_NOTE,REBUTTAL,ARBITRATION,STOP.\nIf PEER_PREVIOUS_EVENT_HASH is not NONE, peer_event_hash_addressed MUST equal it. terminal_vote may be WIN_GPT,WIN_GLM,SYNTHESIS,NO_ACTION or null.`;}
function st(v:JsonObject):string{const s=typeof v.step_type==="string"?v.step_type.trim().toUpperCase():"OBSERVE";return /^[A-Z0-9_]{2,48}$/.test(s)?s:"OBSERVE";}
function vote(v:JsonObject):string|null{const s=typeof v.terminal_vote==="string"?v.terminal_vote:"";return VOTES.has(s)?s:null;}
function peerAckOk(v:JsonObject,expected:string|null):boolean{return !expected||v.peer_event_hash_addressed===expected;}

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
      const both=await step.do(`microstep-dual-${tick}`,{retries:{limit:2,delay:"1 second",backoff:"exponential"},timeout:"15 minutes"},async()=>{const [g,l]=await Promise.all([actor(env,"GPT",lease,gp),actor(env,"GLM",lease,lp)]);return JSON.stringify({g,l});});
      const pair=JSON.parse(String(both)) as {g:JsonObject;l:JsonObject};
      if(!peerAckOk(pair.g,gPeer)||!peerAckOk(pair.l,lPeer))throw new Error(`microstep_peer_hash_ack_failed:${tick}`);
      const pt=await step.do(`microstep-persist-${tick}`,{retries:{limit:3,delay:"1 second",backoff:"exponential"}},async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_submit_pair_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_tick_no:tick,p_seen_checkpoint_sha256:checkpoint,p_gpt_step_type:st(pair.g),p_gpt_payload:pair.g,p_glm_step_type:st(pair.l),p_glm_payload:pair.l})));
      const receipt=JSON.parse(pt) as JsonObject;checkpoint=String(receipt.output_checkpoint_sha256||checkpoint);lastTick=tick;
      const gv=vote(pair.g),lv=vote(pair.l),ready=pair.g.ready_to_resolve===true&&pair.l.ready_to_resolve===true;
      if(ready&&gv&&lv&&gv===lv){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"RESOLVED",winner:gv,final_tick:tick,final_checkpoint_sha256:checkpoint,gpt_resolution:pair.g.resolution??null,glm_resolution:pair.l.resolution??null,canonical:false,authority_effect:false};return await step.do(`microstep-complete-${tick}`,async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"RESOLVED",p_result:result})));}
      if(pair.g.need_canary===true&&pair.l.need_canary===true){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"CANARY_REQUIRED",final_tick:tick,final_checkpoint_sha256:checkpoint,gpt:pair.g,glm:pair.l,canonical:false,authority_effect:false};return await step.do(`microstep-canary-${tick}`,async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"CANARY_REQUIRED",p_result:result})));}
    }
    const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"CANARY_REQUIRED",reason:"MAX_MICROSTEPS",final_tick:lastTick,final_checkpoint_sha256:checkpoint,canonical:false,authority_effect:false};return await step.do("microstep-max",async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"CANARY_REQUIRED",p_result:result})));
  }catch(error){const result:JsonObject={schema:"metaengine.compute.duel-microstep-result.h205f22.v2",outcome:"FAILED",error:String(error).slice(0,3000),final_tick:lastTick,final_checkpoint_sha256:checkpoint,canonical:false,authority_effect:false};try{return await step.do("microstep-failed",async()=>JSON.stringify(await rpc<JsonObject>(env,"h205f22_duel_complete_lockstep_v2",{p_duel_id:duelId,p_worker:workerId,p_lease_generation:leaseGeneration,p_status:"FAILED",p_result:result})));}catch{throw error;}}
}
