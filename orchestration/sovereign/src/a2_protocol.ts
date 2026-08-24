import { createHash, verify as verifySignature, createPublicKey, type KeyObject } from "node:crypto";

export type Agent = "GPT" | "GLM";
export type Priority = 0 | 1 | 2 | 3;
export const MODEL_AUTHORED = new Set(["PLAN","HYPOTHESIS","CLAIM","COUNTERCLAIM","QUESTION","EVIDENCE","ASSUMPTION","FALSIFIER","CRITIQUE","AGREEMENT","SYNTHESIS","ACTION_PROPOSAL","REQUEST_DUEL"]);
export const RUNTIME_EVENTS = new Set(["MODEL_STARTED","MODEL_COMPLETED","MODEL_INTERRUPTED","PEER_EVENT_APPLIED","TOOL_CALL","TOOL_RESULT","TOOL_ERROR","FILE_READ","PATCH_CREATED","TEST_STARTED","TEST_RESULT","AUTHORITY_READ","AUTHORITY_DRIFT","BACKPRESSURE","CATCH_UP_STARTED","CATCH_UP_COMPLETED","CHECKPOINT","ERROR","DUEL_OPENED","DUEL_DECIDED"]);

export interface A2Event {
  event_id:string; commit_seq:number; workspace_id:string; session_id:string; agent:Agent; agent_seq:number;
  semantic_point:string; event_type:string; priority:Priority; parent_hashes:string[]; payload:Record<string,unknown>;
  payload_sha256:string; event_hash:string; signature_base64?:string; signature_key_fingerprint_sha256:string;
  visibility_proof_id?:string|null; visibility_proof?:VisibilityProof|null; model_provenance?:Record<string,unknown>; created_at?:string;
}
export interface VisibilityProof {
  proof_id:string; seen_commit_seq:number; seen_gpt_seq:number; seen_glm_seq:number; input_frontier_hash:string;
  context_manifest_sha256:string; mandatory_peer_event_hashes:string[]; accepted_event_id?:string|null;
}
export interface Frontier { head_commit_seq:number; gpt_seq:number; glm_seq:number; gpt_hash?:string|null; glm_hash?:string|null; frontier_hash:string; }
export interface PeerCapabilities { reasoning_summary_stream?:boolean; max_emit_rate_hz?:number; inbound_queue_depth?:number; tool_calls?:boolean; resume_from_commit_seq?:boolean; max_opaque_ms?:number; }

export function exactModel(agent:Agent):string { return agent === "GPT" ? "openai/gpt-5.6-sol" : "zai/glm-5.3"; }
export function peerOf(agent:Agent):Agent { return agent === "GPT" ? "GLM" : "GPT"; }
export function sha256Hex(data:Buffer|string):string { return createHash("sha256").update(data).digest("hex"); }
export function canonicalJson(value:unknown):string { return JSON.stringify(sortValue(value)); }
function sortValue(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sortValue(v)]));
  return value;
}
export function deriveFrontierHash(workspaceId:string, events:A2Event[]):string {
  let gpt:A2Event|undefined, glm:A2Event|undefined;
  for (const e of events) { if(e.agent==="GPT" && (!gpt || e.agent_seq>gpt.agent_seq)) gpt=e; if(e.agent==="GLM" && (!glm || e.agent_seq>glm.agent_seq)) glm=e; }
  const head=Math.max(0,...events.map(e=>e.commit_seq));
  return sha256Hex(canonicalJson({workspace_id:workspaceId,head_commit_seq:head,gpt_seq:gpt?.agent_seq??0,glm_seq:glm?.agent_seq??0,gpt_hash:gpt?.event_hash??null,glm_hash:glm?.event_hash??null}));
}
export function mandatoryPeerHashes(agent:Agent, events:A2Event[], afterSeq:number):string[] {
  return events.filter(e=>e.agent!==agent && e.commit_seq>afterSeq && e.priority<=1).map(e=>e.event_hash).sort();
}
export function causalParents(agent:Agent, events:A2Event[], referenced:string[]=[]):string[] {
  const own=[...events].reverse().find(e=>e.agent===agent)?.event_hash;
  const peer=[...events].reverse().find(e=>e.agent!==agent)?.event_hash;
  return [...new Set([own,peer,...referenced].filter((x):x is string=>Boolean(x)))].sort();
}
export function isActionConflict(a:A2Event,b:A2Event):boolean {
  if(a.agent===b.agent || a.semantic_point!==b.semantic_point) return false;
  if(!new Set(["CLAIM","COUNTERCLAIM","ACTION_PROPOSAL"]).has(a.event_type) || !new Set(["CLAIM","COUNTERCLAIM","ACTION_PROPOSAL"]).has(b.event_type)) return false;
  const ak=actionKind(a.payload), bk=actionKind(b.payload); return Boolean(ak && bk && ak!==bk);
}
function actionKind(p:Record<string,unknown>):string { const x=(p.proposed_action??p.resulting_action??p.action) as any; return typeof x?.kind === "string" ? x.kind : ""; }

export class PriorityInbox {
  private q:A2Event[]=[];
  constructor(readonly maxDepth=200) { if(maxDepth<8) throw new Error("inbound_queue_depth_too_small"); }
  push(event:A2Event):void {
    if(this.q.length<this.maxDepth){this.q.push(event);return;}
    if(event.priority<=1) throw new Error("a2_p0_p1_backpressure_fail_closed");
    if(event.priority===3){ const idx=this.q.findIndex(e=>e.priority===3 && e.event_type===event.event_type && e.agent===event.agent); if(idx>=0){this.q[idx]=event;return;} }
    const evict=this.q.findIndex(e=>e.priority===3 || (event.priority===2 && e.priority===2));
    if(evict>=0){this.q.splice(evict,1);this.q.push(event);return;}
  }
  drain():A2Event[]{const out=this.q.sort((a,b)=>a.commit_seq-b.commit_seq);this.q=[];return out;}
  get size(){return this.q.length;}
}

export function verifyEd25519RawPublicKey(rawBase64:string, eventHashHex:string, signatureBase64:string):boolean {
  try {
    const raw=Buffer.from(rawBase64,"base64"); if(raw.length!==32) return false;
    const spkiPrefix=Buffer.from("302a300506032b6570032100","hex");
    const key:KeyObject=createPublicKey({key:Buffer.concat([spkiPrefix,raw]),format:"der",type:"spki"});
    return verifySignature(null,Buffer.from(eventHashHex,"hex"),key,Buffer.from(signatureBase64,"base64"));
  } catch { return false; }
}

export function boundedContext(events:A2Event[], maxEvents=80):A2Event[] {
  const mandatory=events.filter(e=>e.priority<=1);
  const recent=events.slice(-maxEvents);
  const byHash=new Map<string,A2Event>(); for(const e of [...mandatory,...recent]) byHash.set(e.event_hash,e);
  return [...byHash.values()].sort((a,b)=>a.commit_seq-b.commit_seq);
}
