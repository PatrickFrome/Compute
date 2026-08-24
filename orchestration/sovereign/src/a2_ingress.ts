import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Pool, Client } from "pg";
import { verifyEd25519RawPublicKey } from "./a2_protocol.js";

type Json=Record<string,unknown>;
type EmitBody={
  event_id:string;session_id:string;agent_seq:number;semantic_point:string;event_type:string;priority:number;
  parent_hashes:string[];payload:Json;visibility_proof_id:string|null;model_provenance:Json;
  event_hash:string;signature_base64:string;signature_key_fingerprint_sha256:string;
};
const DATABASE_URL=req("DATABASE_URL");
const HOST=process.env.A2_INGRESS_HOST||"127.0.0.1";
const PORT=int(process.env.A2_INGRESS_PORT,8092,1,65535);
const TOKEN=process.env.A2_INGRESS_TOKEN||"";
if(!TOKEN&&!loopback(HOST))throw new Error("A2_INGRESS_TOKEN_required_for_non_loopback");
const pool=new Pool({connectionString:DATABASE_URL,max:12});
const listener=new Client({connectionString:DATABASE_URL});
const streams=new Map<string,Set<ServerResponse>>();
let listenReady=false;
const PEER_RPC=new Set([
  "h205f22_a2_register_peer_session_v1","h205f22_a2_close_peer_session_v1","h205f22_a2_create_visibility_proof_v1",
  "h205f22_a2_next_agent_seq_v1","h205f22_a2_read_frontier_v1","h205f22_a2_read_frontier_at_v1",
  "h205f22_a2_prepare_event_v1","h205f22_a2_update_cursor_v1","h205f22_a2_read_events_v1",
  "h205f22_a2_read_snapshot_v1","h205f22_a2_read_visibility_proof_v1","h205f22_a2_read_event_ancestry_v1"
]);

function req(n:string){const v=process.env[n];if(!v)throw new Error(`${n}_required`);return v;}
function int(v:string|undefined,f:number,min:number,max:number){const n=Number(v??f);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):f;}
function loopback(h:string){return ["127.0.0.1","localhost","::1","[::1]"].includes(h.toLowerCase());}
function eq(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function authorized(r:IncomingMessage){if(!TOKEN)return loopback(HOST);const h=r.headers.authorization||"";return h.startsWith("Bearer ")&&eq(h.slice(7),TOKEN);}
function uuid(v:unknown){return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
function hash64(v:unknown){return typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);}
function epoch6(d:Date){return (d.getTime()/1000).toFixed(6);}
function json(res:ServerResponse,status:number,body:unknown){res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");res.end(JSON.stringify(body));}
function sendSse(res:ServerResponse,data:unknown,id?:number){if(id!==undefined)res.write(`id: ${id}\n`);res.write(`data: ${JSON.stringify(data)}\n\n`);}
async function bodyJson(req:IncomingMessage,max=1_000_000):Promise<any>{const parts:Buffer[]=[];let total=0;for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=b.length;if(total>max)throw new Error("body_too_large");parts.push(b);}return JSON.parse(Buffer.concat(parts).toString("utf8")||"{}");}
async function privilegedRpc<T=any>(fn:string,args:any[]):Promise<T>{const slots=args.map((_,i)=>`$${i+1}`).join(",");const r=await pool.query<{v:T}>(`select public.${fn}(${slots}) as v`,args);return r.rows[0]!.v;}
async function peerRpc<T=any>(fn:string,args:any[]):Promise<T>{if(!PEER_RPC.has(fn))throw new Error("a2_peer_rpc_not_allowed");const c=await pool.connect();try{await c.query("begin");await c.query("set local role a2_peer_runtime");const slots=args.map((_,i)=>`$${i+1}`).join(",");const r=await c.query<{v:T}>(`select public.${fn}(${slots}) as v`,args);await c.query("commit");return r.rows[0]!.v;}catch(e){await c.query("rollback").catch(()=>{});throw e;}finally{c.release();}}
async function readBody(req:IncomingMessage):Promise<EmitBody>{const x=await bodyJson(req);if(!uuid(x.event_id)||!uuid(x.session_id)||!Number.isInteger(x.agent_seq)||x.agent_seq<1||typeof x.semantic_point!=="string"||typeof x.event_type!=="string"||![0,1,2,3].includes(Number(x.priority))||!Array.isArray(x.parent_hashes)||!hash64(x.event_hash)||typeof x.signature_base64!=="string"||!hash64(x.signature_key_fingerprint_sha256))throw new Error("emit_body_invalid");return{event_id:x.event_id,session_id:x.session_id,agent_seq:x.agent_seq,semantic_point:x.semantic_point,event_type:x.event_type,priority:Number(x.priority),parent_hashes:x.parent_hashes,payload:x.payload&&typeof x.payload==="object"?x.payload:{},visibility_proof_id:x.visibility_proof_id??null,model_provenance:x.model_provenance&&typeof x.model_provenance==="object"?x.model_provenance:{},event_hash:x.event_hash,signature_base64:x.signature_base64,signature_key_fingerprint_sha256:x.signature_key_fingerprint_sha256};}
async function emitVerified(body:EmitBody){
  const sr=await pool.query<any>("select public_key_base64,key_fingerprint_sha256,status from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=$1",[body.session_id]);
  const s=sr.rows[0];
  if(!s||s.status!=="ACTIVE")throw new Error("a2_ingress_session_not_active");
  if(s.key_fingerprint_sha256!==body.signature_key_fingerprint_sha256)throw new Error("a2_ingress_key_fingerprint_mismatch");
  const prep=await peerRpc<any>("h205f22_a2_prepare_event_v1",[body.event_id,body.session_id,body.agent_seq,body.semantic_point,body.event_type,body.priority,body.parent_hashes,body.payload,body.visibility_proof_id,body.model_provenance]);
  if(prep.event_hash!==body.event_hash)throw new Error("a2_ingress_event_hash_mismatch");
  if(!verifyEd25519RawPublicKey(s.public_key_base64,body.event_hash,body.signature_base64))throw new Error("a2_ingress_ed25519_invalid");
  const signatureBytes=Buffer.from(body.signature_base64,"base64");
  if(signatureBytes.length!==64)throw new Error("a2_ingress_ed25519_signature_length_invalid");
  const signatureSha256=createHash("sha256").update(signatureBytes).digest("hex");
  const kr=await pool.query<{k:string}>("select decrypted_secret as k from vault.decrypted_secrets where name='a2_ingress_hmac_v1' order by created_at desc limit 1");
  const key=kr.rows[0]?.k;if(!key)throw new Error("a2_ingress_hmac_secret_unavailable");
  const issued=new Date(),expires=new Date(issued.getTime()+60_000),nonce=randomBytes(24).toString("hex"),verifier="A2_TRUSTED_ED25519_INGRESS_V2";
  const msg=["A2_INGRESS_RECEIPT_V2",body.event_hash,body.session_id,body.signature_key_fingerprint_sha256,verifier,epoch6(issued),epoch6(expires),nonce,signatureSha256].join("\n");
  const mac=createHmac("sha256",key).update(msg).digest("hex");
  return privilegedRpc("h205f22_a2_emit_agent_event_v3",[body.event_id,body.session_id,body.agent_seq,body.semantic_point,body.event_type,body.priority,body.parent_hashes,body.payload,body.visibility_proof_id,body.model_provenance,body.event_hash,body.signature_base64,body.signature_key_fingerprint_sha256,verifier,issued.toISOString(),expires.toISOString(),nonce,mac]);
}
async function readEvents(workspaceId:string,after:number,limit=1000){const r=await peerRpc<any>("h205f22_a2_read_events_v1",[workspaceId,after,limit]);return Array.isArray(r.events)?r.events:[];}
async function startListen(){await listener.connect();await listener.query("listen h205f22_a2_event");listener.on("notification",async(msg:any)=>{try{const p=JSON.parse(msg.payload||"{}");const ws=String(p.workspace_id||"");const seq=Number(p.commit_seq||0);if(!uuid(ws)||!seq)return;const clients=streams.get(ws);if(!clients?.size)return;const events=await readEvents(ws,seq-1,4);const event=events.find((e:any)=>Number(e.commit_seq)===seq);if(!event)return;for(const res of clients)sendSse(res,event,seq);}catch(e){console.error("a2_ingress_notify_error",e);}});listenReady=true;}
void startListen().catch(e=>console.error("a2_ingress_listen_failed",e));
setInterval(()=>{for(const clients of streams.values())for(const res of clients)sendSse(res,{type:"heartbeat",ts:new Date().toISOString()});},15000).unref();

const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url||"/",`http://${req.headers.host||`${HOST}:${PORT}`}`);
  if(u.pathname==="/healthz"){json(res,200,{status:"ok",service:"a2-trusted-ingress",verification:"ED25519_THEN_SIGNATURE_BOUND_HMAC_V3",listen_ready:listenReady,peer_db_access:"NOLOGIN_CAPABILITY_ROLE"});return;}
  if(!authorized(req)){json(res,401,{error:"unauthorized"});return;}
  if(req.method==="POST"&&u.pathname==="/v1/a2/emit"){json(res,200,await emitVerified(await readBody(req)));return;}
  if(req.method==="POST"&&u.pathname==="/v1/a2/rpc"){const x=await bodyJson(req);if(typeof x.fn!=="string"||!Array.isArray(x.args)||!PEER_RPC.has(x.fn))throw new Error("a2_peer_rpc_not_allowed");json(res,200,{value:await peerRpc(x.fn,x.args)});return;}
  if(req.method==="GET"&&u.pathname==="/v1/a2/stream"){const ws=u.searchParams.get("workspace_id")||"";if(!uuid(ws)){json(res,400,{error:"workspace_id_invalid"});return;}const after=Math.max(0,Number(u.searchParams.get("after")||0));res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache, no-transform",connection:"keep-alive","x-accel-buffering":"no"});let set=streams.get(ws);if(!set){set=new Set();streams.set(ws,set);}set.add(res);for(const e of await readEvents(ws,after,1000))sendSse(res,e,Number(e.commit_seq));req.on("close",()=>{set!.delete(res);if(!set!.size)streams.delete(ws);});return;}
  json(res,404,{error:"not_found"});
}catch(e){json(res,400,{error:e instanceof Error?e.message:String(e)});}});
server.listen(PORT,HOST,()=>console.log(`A2 trusted ingress http://${HOST}:${PORT}`));
process.on("SIGTERM",async()=>{server.close();await Promise.allSettled([pool.end(),listener.end()]);process.exit(0);});
