import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { exactModel, verifyEd25519RawPublicKey, INGRESS_VERIFIER_ID, type Agent } from "./a2_protocol.js";

type Json=Record<string,unknown>;
const INGRESS_URL=req("A2_INGRESS_URL").replace(/\/$/,"");
const INGRESS_TOKEN=process.env.A2_INGRESS_TOKEN||"";
const WORKSPACE_ID=req("A2_WORKSPACE_ID");
const AGENT=(process.env.A2_CANARY_AGENT||"GPT").toUpperCase() as Agent;
if(!["GPT","GLM"].includes(AGENT))throw new Error("A2_CANARY_AGENT_invalid");
const MODEL=exactModel(AGENT);
const RUNTIME_ID=`a2-http-ed25519-canary-${AGENT.toLowerCase()}-${Date.now()}`;
const EPOCH=Number(process.env.A2_CANARY_CAPABILITY_EPOCH||Date.now());
let sessionId="";

function req(name:string){const value=process.env[name];if(!value)throw new Error(`${name}_required`);return value;}
function headers(){return {"content-type":"application/json",...(INGRESS_TOKEN?{authorization:`Bearer ${INGRESS_TOKEN}`}:{})};}
function rawPublic(key:ReturnType<typeof generateKeyPairSync>["publicKey"]){const der=key.export({format:"der",type:"spki"}) as Buffer;if(der.length<32)throw new Error("ed25519_spki_invalid");return der.subarray(der.length-32);}
async function peerRpc<T=any>(fn:string,args:any[]):Promise<T>{const response=await fetch(`${INGRESS_URL}/v1/a2/rpc`,{method:"POST",headers:headers(),body:JSON.stringify({fn,args})});const text=await response.text();if(!response.ok)throw new Error(`a2_peer_rpc_${response.status}:${text.slice(0,700)}`);return JSON.parse(text).value as T;}
async function submit(body:Json){const response=await fetch(`${INGRESS_URL}/v1/a2/emit`,{method:"POST",headers:headers(),body:JSON.stringify(body)});return{ok:response.ok,status:response.status,text:await response.text()};}

async function main(){
  const snapshot=await peerRpc<any>("h205f22_a2_read_snapshot_v1",[WORKSPACE_ID,1]);
  const workspace=snapshot?.workspace;
  if(!workspace)throw new Error("a2_canary_workspace_not_found");
  if(workspace.mode!=="COLLABORATE")throw new Error(`a2_canary_workspace_not_collaborating:${String(workspace.mode)}`);
  const beforeHead=Number(snapshot.head_commit_seq||0);
  const semanticPoint=String(workspace.semantic_point||"");
  if(!semanticPoint)throw new Error("a2_canary_semantic_point_missing");

  const keypair=generateKeyPairSync("ed25519");
  const publicRaw=rawPublic(keypair.publicKey);
  const publicBase64=publicRaw.toString("base64");
  const fingerprint=createHash("sha256").update(publicRaw).digest("hex");
  const capabilities={canary_only:true,http_ingress_only:true,direct_database_access:false,trusted_ingress:INGRESS_VERIFIER_ID};
  const registered=await peerRpc<any>("h205f22_a2_register_peer_session_v1",[WORKSPACE_ID,AGENT,RUNTIME_ID,AGENT==="GPT"?"openai":"z.ai",MODEL,MODEL,capabilities,EPOCH,publicBase64]);
  sessionId=String(registered.session_id||"");
  if(!sessionId)throw new Error("a2_canary_session_registration_failed");

  const next=await peerRpc<any>("h205f22_a2_next_agent_seq_v1",[sessionId]);
  const agentSeq=Number(next.next_agent_seq);
  const eventId=randomUUID();
  const payload={state:"A2_HTTP_ED25519_INGRESS_CANARY",canary_only:true,negative_then_positive:true};
  const provenance={provider:AGENT==="GPT"?"openai":"z.ai",requested_model:MODEL,reported_model:MODEL,runtime_id:RUNTIME_ID,capability_epoch:EPOCH,canary_only:true};
  const prepared=await peerRpc<any>("h205f22_a2_prepare_event_v1",[eventId,sessionId,agentSeq,semanticPoint,"CHECKPOINT",0,[],payload,null,provenance]);
  const eventHash=String(prepared.event_hash||"");
  if(!/^[0-9a-f]{64}$/.test(eventHash))throw new Error("a2_canary_event_hash_invalid");
  const signature=sign(null,Buffer.from(eventHash,"hex"),keypair.privateKey).toString("base64");
  if(!verifyEd25519RawPublicKey(publicBase64,eventHash,signature))throw new Error("a2_canary_local_signature_verify_failed");

  const baseBody={event_id:eventId,session_id:sessionId,agent_seq:agentSeq,semantic_point:semanticPoint,event_type:"CHECKPOINT",priority:0,parent_hashes:[],payload,visibility_proof_id:null,model_provenance:provenance,event_hash:eventHash,signature_key_fingerprint_sha256:fingerprint};
  const tampered=Buffer.from(signature,"base64");
  tampered[0]^=1;
  const negative=await submit({...baseBody,signature_base64:tampered.toString("base64")});
  if(negative.ok||!negative.text.includes("a2_ingress_ed25519_invalid"))throw new Error(`a2_canary_tampered_signature_not_rejected:${negative.status}:${negative.text.slice(0,500)}`);
  const afterNegative=await peerRpc<any>("h205f22_a2_read_events_v1",[WORKSPACE_ID,beforeHead,100]);
  if((afterNegative.events||[]).some((event:any)=>event.event_id===eventId))throw new Error("a2_canary_tampered_signature_persisted");

  const positive=await submit({...baseBody,signature_base64:signature});
  if(!positive.ok)throw new Error(`a2_canary_valid_signature_rejected:${positive.status}:${positive.text.slice(0,700)}`);
  const emitted=JSON.parse(positive.text);
  if(emitted.ingress_verification!==INGRESS_VERIFIER_ID||emitted.signature_bound!==true)throw new Error("a2_canary_ingress_receipt_missing_or_unbound");
  const afterPositive=await peerRpc<any>("h205f22_a2_read_events_v1",[WORKSPACE_ID,beforeHead,100]);
  const persisted=(afterPositive.events||[]).find((event:any)=>event.event_id===eventId);
  if(!persisted)throw new Error("a2_canary_valid_event_not_persisted");
  if(persisted.signature_base64!==signature||!verifyEd25519RawPublicKey(publicBase64,String(persisted.event_hash),String(persisted.signature_base64)))throw new Error("a2_canary_persisted_ed25519_verify_failed");
  if(persisted.canonical!==undefined&&persisted.canonical!==false)throw new Error("a2_canary_canonical_violation");
  if(persisted.authority_effect!==undefined&&persisted.authority_effect!==false)throw new Error("a2_canary_authority_violation");

  console.log(JSON.stringify({schema:"metaengine.compute.a2-http-ed25519-canary.v1",workspace_id:WORKSPACE_ID,agent:AGENT,event_id:eventId,event_hash:eventHash,commit_seq:persisted.commit_seq,ingress_receipt_id:emitted.ingress_receipt_id,negative_rejected:true,positive_persisted:true,persisted_ed25519_verified:true,canonical:false,authority_effect:false},null,2));
}

void main().finally(async()=>{if(sessionId){try{await peerRpc("h205f22_a2_close_peer_session_v1",[sessionId]);}catch(e){console.error("a2_canary_session_close_failed",String(e));}}}).catch(e=>{console.error(e);process.exitCode=1;});
