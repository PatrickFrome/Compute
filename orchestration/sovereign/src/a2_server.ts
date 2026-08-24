import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { Pool, Client } from "pg";

type Json=Record<string,unknown>;
const DATABASE_URL=req("DATABASE_URL");
const HOST=process.env.A2_HTTP_HOST||"127.0.0.1";
const PORT=num(process.env.A2_HTTP_PORT,8091,1,65535);
const TOKEN=process.env.A2_OBSERVER_TOKEN||process.env.SOVEREIGN_CONTROL_TOKEN||"";
const pool=new Pool({connectionString:DATABASE_URL,max:8});
const listenClient=new Client({connectionString:DATABASE_URL});
const __dirname=dirname(fileURLToPath(import.meta.url));
const uiDir=join(__dirname,"..","ui");
const sse=new Map<string,Set<ServerResponse>>();
let listenReady=false;

function req(n:string){const v=process.env[n];if(!v)throw new Error(`${n}_required`);return v;}
function num(v:string|undefined,f:number,min:number,max:number){const n=Number(v??f);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):f;}
function uuid(v:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
function loopback(h:string){return ["127.0.0.1","localhost","::1","[::1]"].includes(h.toLowerCase());}
function eq(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function authorized(r:IncomingMessage){if(!TOKEN)return loopback(HOST);const h=r.headers.authorization||"";return h.startsWith("Bearer ")&&eq(h.slice(7),TOKEN);}
function json(res:ServerResponse,status:number,body:unknown){res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");res.end(JSON.stringify(body));}
function file(res:ServerResponse,path:string,type:string){try{const b=readFileSync(path);res.statusCode=200;res.setHeader("content-type",type);res.setHeader("cache-control","no-store");res.end(b);}catch{json(res,404,{error:"not_found"});}}
async function rpc<T=Json>(fn:string,args:any[]):Promise<T>{const slots=args.map((_,i)=>`$${i+1}`).join(",");const r=await pool.query<{v:T}>(`select public.${fn}(${slots}) as v`,args);return r.rows[0]!.v;}
async function authority():Promise<Json>{const r=await pool.query<{v:Json}>("select public.compute_fabric_roadmap_status_h205f22() as v");const v=r.rows[0]?.v||{};const h=(v.semantic_head||{}) as Json;return {fresh:v.definition_integrity===true,definition_integrity:v.definition_integrity,checkpoint_id:h.checkpoint_id,payload_root_sha256:h.payload_root_sha256,roadmap_definition_sha256:v.current_definition_sha256||v.sealed_definition_sha256,next_mainline:(v.next_mainline as Json)?.milestone_key};}
function peerMap(peers:any[],cursors:any[]){const out:Record<string,Json>={};for(const p of peers||[]){const c=(cursors||[]).find((x:any)=>x.session_id===p.session_id)||{};out[p.agent]={model:p.requested_model,runtime_id:p.runtime_id,status:p.status,lastSeen:Number(c.last_applied_commit_seq||0),received:Number(c.last_received_commit_seq||0),frontier:c.causal_frontier_hash,capabilities:p.capabilities};}return out;}
async function snapshot(workspaceId:string):Promise<Json>{const snap=await rpc<any>("h205f22_a2_read_snapshot_v1",[workspaceId,250]);const ws=snap.workspace||{};return {...snap,semantic_point:ws.semantic_point,mode:ws.mode,events:snap.events||[],peers:peerMap(snap.peers||[],snap.cursors||[]),authority:await authority()};}
async function oneEvent(workspaceId:string,after:number){const r=await rpc<any>("h205f22_a2_read_events_v1",[workspaceId,after,10]);return Array.isArray(r.events)?r.events:[];}
function sendSse(res:ServerResponse,data:unknown,id?:number){if(id!==undefined)res.write(`id: ${id}\n`);res.write(`data: ${JSON.stringify(data)}\n\n`);}
async function startListen(){await listenClient.connect();await listenClient.query("listen h205f22_a2_event");listenClient.on("notification",async(msg:any)=>{try{const p=JSON.parse(msg.payload||"{}");const ws=String(p.workspace_id||"");const seq=Number(p.commit_seq||0);if(!uuid(ws)||!seq)return;const clients=sse.get(ws);if(!clients?.size)return;const events=await oneEvent(ws,seq-1);const e=events.find((x:any)=>Number(x.commit_seq)===seq);if(!e)return;for(const res of clients)sendSse(res,e,seq);}catch{}});listenReady=true;}
void startListen().catch(e=>console.error("a2_listen_failed",e));
setInterval(()=>{for(const clients of sse.values())for(const res of clients)sendSse(res,{type:"heartbeat",ts:new Date().toISOString()});},15000).unref();

const server=createServer(async(req,res)=>{const u=new URL(req.url||"/",`http://${req.headers.host||`${HOST}:${PORT}`}`);try{
  if(u.pathname==="/healthz"){json(res,200,{status:"ok",service:"a2-observer",listen_ready:listenReady});return;}
  if(u.pathname.startsWith("/a2")&&!authorized(req)){json(res,401,{error:"unauthorized"});return;}
  if(req.method==="GET"&&u.pathname==="/a2"){file(res,join(uiDir,"index.html"),"text/html; charset=utf-8");return;}
  if(req.method==="GET"&&u.pathname==="/a2/app.js"){file(res,join(uiDir,"app.js"),"text/javascript; charset=utf-8");return;}
  if(req.method==="GET"&&u.pathname==="/a2/styles.css"){file(res,join(uiDir,"styles.css"),"text/css; charset=utf-8");return;}
  if(req.method==="GET"&&u.pathname==="/a2/api/authority"){json(res,200,await authority());return;}
  if(req.method==="GET"&&u.pathname==="/a2/api/snapshot"){const id=u.searchParams.get("workspace_id")||"";if(!uuid(id)){json(res,400,{error:"workspace_id_invalid"});return;}json(res,200,await snapshot(id));return;}
  if(req.method==="GET"&&u.pathname==="/a2/api/events"){const id=u.searchParams.get("workspace_id")||"";if(!uuid(id)){json(res,400,{error:"workspace_id_invalid"});return;}const after=Math.max(0,Number(u.searchParams.get("after")||0));res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache, no-transform",connection:"keep-alive","x-accel-buffering":"no"});for(const e of await oneEvent(id,after))sendSse(res,e,Number((e as any).commit_seq));let set=sse.get(id);if(!set){set=new Set();sse.set(id,set);}set.add(res);req.on("close",()=>{set!.delete(res);if(!set!.size)sse.delete(id);});return;}
  const m=u.pathname.match(/^\/a2\/api\/events\/([0-9a-f-]+)\/ancestry$/i);if(req.method==="GET"&&m){if(!uuid(m[1])){json(res,400,{error:"event_id_invalid"});return;}json(res,200,await rpc("h205f22_a2_read_event_ancestry_v1",[m[1],48]));return;}
  json(res,404,{error:"not_found"});
}catch(e){json(res,500,{error:e instanceof Error?e.message:String(e)});}});
server.listen(PORT,HOST,()=>console.log(`A2 observer http://${HOST}:${PORT}/a2`));
process.on("SIGTERM",async()=>{server.close();await Promise.allSettled([pool.end(),listenClient.end()]);process.exit(0);});
