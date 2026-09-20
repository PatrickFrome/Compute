import postgres from 'npm:postgres@3.4.7';
import { createDevosSupervisorRoutes, readDevosRuntimeControl, unavailableDevosRuntimeControl } from './devos-routes.mjs';
import { createDbInspectRoutes } from './db-inspect-routes.mjs';
import { createDevosPromotionRoutes } from './devos-promotion-routes.mjs';
import { createMetaSupervisorRoutes } from './meta-routes.mjs';
import { createCognitiveDeltaRoutes } from './cognitive-delta-routes.mjs';
import { createEmergencyCommandRoutes } from './emergency-routes.mjs';
import { projectNativeSupervisorRuntimeCapabilityHealth, runtimeCapabilityHealthResponseFields } from './runtime-capability-health.mjs';
import { openRealtimeCommandWake } from './realtime-command-wake.mjs';
import { createPostgresCommandWakeHub } from './postgres-command-wake.mjs';
import { createRsiResultReceiptReadback } from './result-receipt-readback.mjs';

const DB_URL=Deno.env.get('SUPABASE_DB_URL')||'';
const SERVICE_ROLE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const REALTIME_API_KEY=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY')||'';
// Modern Supabase sb_secret_* values are API keys, not JWT access tokens. Realtime
// private-channel auth therefore stays disabled unless a legacy JWT-shaped token is
// explicitly present. Durable DB leasing remains the authority; when private Realtime
// auth is unavailable the existing Postgres NOTIFY pulse becomes a wake-only hint,
// followed by the same authoritative lease recheck.
const REALTIME_ACCESS_TOKEN=SERVICE_ROLE.split('.').length===3?SERVICE_ROLE:'';
const WORKSPACE_ID='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const PROFILE='A2_DEVICE_HTTP_SIGNATURE_V1';
const SERVICE_MARKER='/a2-browser-native-supervisor-v1';
const DEVICE_TABLE='compute_fabric_a2_browser_device_h205f22';
const NONCE_RPC='h205f22_a2_browser_device_consume_nonce_v2';
const ENROLL_TABLE='compute_fabric_a2_browser_device_enrollment_request_h205f22';
const STATE_TABLE='compute_fabric_a2_browser_supervisor_state_h205f22';
const COMMAND_TABLE='compute_fabric_a2_browser_supervisor_command_h205f22';
const LEASE_RPC='h205f22_a2_browser_supervisor_lease_v3';
const COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_v5';
const BATCH_LEASE_RPC='h205f22_a2_browser_supervisor_lease_batch_v1';
const BATCH_COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_batch_v1';
const BIND_EFFECT_RPC='h205f22_a2_browser_supervisor_bind_effect_v1';
const ISSUE_NATIVE_RPC='h205f22_a2_browser_supervisor_issue_native_v1';
// Agent Toolbelt issue allowlist (Tier 2 break #3): read-heavy observation +
// bounded navigation only. Conversation mutation (SEMANTIC_TYPE) stays
// dispatch-only — the task prompt remains the only text the supervisor types
// into an agent conversation.
const TOOL_ISSUE_ACTIONS=new Set(['CAPTURE','READ_TRANSCRIPT','TAB_TELEMETRY','SYSTEM_TELEMETRY','SCROLL','SEMANTIC_FOCUS']);
const TOOL_REQUEST_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$/;
const TOOL_AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const TOOL_TAB_RE=/^tab_[0-9a-f-]{36}$/i;
const TOOL_TASK_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EFFECT_BINDING_SCHEMAS=new Set(['metaengine.native-supervisor.effect-binding.v1','metaengine.native-supervisor.effect-binding.v2']);
const ACTIVATE_RPC='h205f22_a2_browser_device_activate_approved_v1';
const MESH_SYNC_RPC='h205f22_a2_supervisor_mesh_sync_v1';
const HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS=1500;
const MAX_REALTIME_WAIT_MS=15000;
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-a2-chat-bridge-client,x-a2-device-profile,x-a2-device-id,x-a2-device-timestamp,x-a2-device-nonce,x-a2-device-body-sha256,x-a2-device-signature,x-metaengine-enroll-timestamp,x-metaengine-enroll-nonce,x-metaengine-enroll-signature','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}});
if(!DB_URL)throw new Error('supabase_db_url_missing');
const sql=postgres(DB_URL,{max:2,prepare:false,connect_timeout:4,idle_timeout:20});
// LISTEN holds a dedicated connection. Keep it isolated from the query pool so a
// held command-wake subscription cannot starve durable lease/heartbeat queries.
const wakeSql=postgres(DB_URL,{max:1,prepare:false,connect_timeout:4,idle_timeout:null});
const postgresWakeHub=createPostgresCommandWakeHub({listen:(channel:string,onNotify:(payload:string)=>void,onListen:()=>void)=>wakeSql.listen(channel,onNotify,onListen)});
const rpcMetaCache=new Map<string,any>();
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function rpcParam(value:any,_type:string){return value}
async function rpcMeta(name:string,args:any={}){
  if(!/^[a-z0-9_]+$/i.test(name))throw new Error('rpc_name_invalid');
  const key=name+':'+Object.keys(args).sort().join(',');
  if(rpcMetaCache.has(key))return rpcMetaCache.get(key);
  const rows=await sql`
    select p.oid::text as oid,p.pronargs,p.pronargdefaults,p.proretset,
      coalesce(p.proargnames[1:p.pronargs],array[]::text[]) as arg_names,
      array(select format_type(t.oid,null)
            from unnest(p.proargtypes::oid[]) with ordinality u(type_oid,ord)
            join pg_type t on t.oid=u.type_oid order by u.ord) as arg_types
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=${name}`;
  const supplied=new Set(Object.keys(args));
  const candidates=rows.filter((r:any)=>{
    const names=[...(r.arg_names||[])];
    const required=names.slice(0,Math.max(0,Number(r.pronargs)-Number(r.pronargdefaults||0)));
    return [...supplied].every(k=>names.includes(k))&&required.every((k:string)=>supplied.has(k));
  });
  if(candidates.length!==1)throw new Error(`rpc_signature_ambiguous:${name}:${candidates.length}`);
  rpcMetaCache.set(key,candidates[0]);
  return candidates[0];
}
async function rpc(name:string,args:any={}){
  const m=await rpcMeta(name,args);
  const names=[...m.arg_names];
  const types=[...m.arg_types];
  const params:any[]=[];
  const clauses:string[]=[];
  for(const [k,v] of Object.entries(args)){
    const i=names.indexOf(k);
    if(i<0)throw new Error(`rpc_arg_missing:${name}:${k}`);
    params.push(rpcParam(v,types[i]));
    clauses.push(`\"${k}\" => $${params.length}::${types[i]}`);
  }
  const call=`public.\"${name}\"(${clauses.join(',')})`;
  if(m.proretset){
    const rows=await sql.unsafe(`select to_jsonb(x) as value from ${call} x`,params);
    return rows.map((r:any)=>r.value);
  }
  const rows=await sql.unsafe(`select to_jsonb(${call}) as value`,params);
  return rows[0]?.value??null;
}
async function boundedRpc(name:string,args:any,ms:number){
  let timer:any;
  try{return await Promise.race([
    rpc(name,args),
    new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error('rpc_deadline');e.name='TimeoutError';reject(e)},ms)}),
  ])}finally{if(timer)clearTimeout(timer)}
}

async function enrollmentExisting(client:string,fingerprint:string){return sql.unsafe(`select request_id::text,status,requested_at,expires_at,key_fingerprint_sha256 from public.${ENROLL_TABLE} where client_id=$1 and key_fingerprint_sha256=$2 and status in ('PENDING','APPROVED') and expires_at>clock_timestamp() order by requested_at desc limit 1`,[client,fingerprint])}
async function enrollmentInsert(client:string,jwk:any,fingerprint:string,metadata:any){return sql.unsafe(`insert into public.${ENROLL_TABLE}(client_id,profile,public_jwk,key_fingerprint_sha256,status,metadata,authority_effect) values($1,$2,$3::jsonb,$4,'PENDING',$5::jsonb,false) returning request_id::text,status,requested_at,expires_at,key_fingerprint_sha256`,[client,PROFILE,jwk,fingerprint,metadata||{}])}
async function enrollmentById(requestId:string,client:string,fingerprint:string){return sql.unsafe(`select request_id::text,status,requested_at,expires_at,approved_at,device_id::text from public.${ENROLL_TABLE} where request_id=$1::uuid and client_id=$2 and key_fingerprint_sha256=$3 limit 1`,[requestId,client,fingerprint])}
async function deviceLookup(deviceId:string,client:string){return sql.unsafe(`select device_id::text,client_id,profile,public_jwk,enrollment_pairing_token_hash,active,revoked_at from public.${DEVICE_TABLE} where device_id=$1::uuid and client_id=$2 limit 1`,[deviceId,client])}
async function pairingLookup(hash:string){return sql.unsafe('select token_hash from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 where token_hash=$1 and active=true limit 1',[hash])}
async function commandLookup(commandId:string){return sql.unsafe(`select command_id::text,action from public.${COMMAND_TABLE} where workspace_id=$1::uuid and command_id=$2::uuid limit 1`,[WORKSPACE_ID,commandId])}
async function commandReceiptLookup({workspaceId,commandId,clientId}:{workspaceId:string,commandId:string,clientId:string}){const rows=await sql.unsafe(`select command_id::text,leased_by,status,receipt,error from public.${COMMAND_TABLE} where workspace_id=$1::uuid and command_id=$2::uuid and leased_by=$3 limit 1`,[workspaceId,commandId,clientId]);return rows[0]||null}
const rsiReceiptReadback=createRsiResultReceiptReadback({lookupCommand:commandReceiptLookup});
async function upsertStateRow(row:any){
  // P1-2 multi-writer repair: per-plane shallow jsonb merge instead of a full
  // replacement. Keys present in the incoming payload (including explicit
  // nulls, e.g. supervisor_mesh:null when the mesh is not running) overwrite;
  // keys the writer omitted are preserved from the stored state. This is what
  // makes plane ownership possible: the 5s heartbeat, the realtime
  // observation push, and the bootstrap heartbeat can each own their planes
  // without erasing the others.
  await sql.unsafe(`insert into public.${STATE_TABLE} as target(client_id,workspace_id,last_seen_at,extension_version,operator_runtime,supervisor_mode,armed,operator_mode,ordering_policy,last_command_id,last_command_status,state,authority_effect) values($1,$2::uuid,clock_timestamp(),$3,$4,$5,$6::boolean,$7,$8,$9::uuid,$10,$11::jsonb,$12::boolean) on conflict(client_id) do update set workspace_id=excluded.workspace_id,last_seen_at=excluded.last_seen_at,extension_version=excluded.extension_version,operator_runtime=excluded.operator_runtime,supervisor_mode=excluded.supervisor_mode,armed=excluded.armed,operator_mode=excluded.operator_mode,ordering_policy=excluded.ordering_policy,last_command_id=excluded.last_command_id,last_command_status=excluded.last_command_status,state=coalesce(target.state,'{}'::jsonb)||excluded.state,authority_effect=excluded.authority_effect`,[row.client_id,row.workspace_id,row.extension_version,row.operator_runtime,row.supervisor_mode,row.armed,row.operator_mode,row.ordering_policy,row.last_command_id,row.last_command_status,row.state,row.authority_effect]);
  return row;
}
async function statusRows(){
  const states=await sql.unsafe(`select client_id,workspace_id::text,last_seen_at,extension_version,operator_runtime,supervisor_mode,armed,operator_mode,ordering_policy,last_command_id::text,last_command_status,state,authority_effect from public.${STATE_TABLE} where workspace_id=$1::uuid order by last_seen_at desc limit 8`,[WORKSPACE_ID]);
  const commands=await sql.unsafe(`select command_id::text,idempotency_key,action,platform,status,issued_by,issued_at,expires_at,leased_by,leased_at,completed_at,authority_effect,receipt,error from public.${COMMAND_TABLE} where workspace_id=$1::uuid order by issued_at desc limit 40`,[WORKSPACE_ID]);
  return{states,commands};
}

async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function b64urlBytes(v:string){if(!/^[A-Za-z0-9_-]+$/.test(v))throw new Error('signature_encoding_invalid');const pad='='.repeat((4-v.length%4)%4);const bin=atob(v.replace(/-/g,'+').replace(/_/g,'/')+pad);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
function canonicalJwk(value:any){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('jwk_invalid');const jwk={crv:String(value.crv||''),ext:value.ext===true,key_ops:Array.isArray(value.key_ops)?value.key_ops.map(String):[],kty:String(value.kty||''),x:String(value.x||''),y:String(value.y||'')};if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.ext||jwk.key_ops.length!==1||jwk.key_ops[0]!=='verify'||!/^[A-Za-z0-9_-]{43}$/.test(jwk.x)||!/^[A-Za-z0-9_-]{43}$/.test(jwk.y))throw new Error('jwk_invalid');return jwk}
async function verifyP256(jwk:any,material:string,signatureText:string){const sig=b64urlBytes(signatureText);if(sig.byteLength!==64)return false;const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,new TextEncoder().encode(material)).catch(()=>false)}
function clientId(req:Request){return String(req.headers.get('x-a2-chat-bridge-client')||'').trim().slice(0,160)}
function modeOf(v:any){const m=String(v||'OFF').toUpperCase();return ['OFF','MONITOR','CONTROL'].includes(m)?m:'OFF'}
function parseJson(text:string){try{return text?JSON.parse(text):{}}catch{return null}}
function boundedObject(value:any,maxBytes:number){if(!value||typeof value!=='object'||Array.isArray(value))return null;try{const text=JSON.stringify(value);if(text.length>maxBytes)return null;return JSON.parse(text)}catch{return null}}
function boundedMesh(value:any){if(!value||typeof value!=='object'||Array.isArray(value)||String(value.schema||'')!=='metaengine.supervisor-mesh-runtime.v1'||value.authority_effect===true)return null;const mesh=value.mesh;if(!mesh||typeof mesh!=='object'||Array.isArray(mesh)||String(mesh.schema||'')!=='metaengine.supervisor-mesh.state.v1'||!Array.isArray(mesh.supervisors)||mesh.supervisors.length>16)return null;const supervisors=[];for(const row of mesh.supervisors){const supervisor_id=String(row?.supervisor_id||'').toLowerCase();const conversation_url_sha256=String(row?.conversation_url_sha256||'').toLowerCase();const status=String(row?.status||'LOST').toUpperCase();const tab_id=row?.tab_id==null?null:String(row.tab_id).slice(0,160);if(!/^sup_[a-f0-9]{24}$/.test(supervisor_id)||!/^[a-f0-9]{64}$/.test(conversation_url_sha256)||supervisor_id!==`sup_${conversation_url_sha256.slice(0,24)}`||!['ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION'].includes(status)||row?.authority_effect===true)return null;supervisors.push({supervisor_id,conversation_url_sha256,status,tab_id:status==='LOST'||status==='AMBIGUOUS_INCARNATION'?null:tab_id,selected:row?.selected===true,authority_effect:false})}const preferred=mesh.preferred_supervisor_id==null?null:String(mesh.preferred_supervisor_id).toLowerCase();if(preferred!==null&&!/^sup_[a-f0-9]{24}$/.test(preferred))return null;return{schema:'metaengine.supervisor-mesh-runtime.v1',running:value.running===true,last_reconcile_at:value.last_reconcile_at||null,last_error:String(value.last_error||'').slice(0,500)||null,authority_effect:false,mesh:{schema:'metaengine.supervisor-mesh.state.v1',version:String(mesh.version||'').slice(0,32),mesh_epoch:Math.max(1,Number(mesh.mesh_epoch)||1),preferred_supervisor_id:preferred,supervisors,authority_effect:false}}}
async function verifyEnrollment(req:Request,bodyText:string,body:any){const id=clientId(req);if(!id)return{ok:false,reason:'CLIENT_ID_REQUIRED'};let jwk;try{jwk=canonicalJwk(body?.public_jwk)}catch{return{ok:false,reason:'JWK_INVALID'}};if(String(body?.profile||'')!==PROFILE)return{ok:false,reason:'PROFILE_INVALID'};const fingerprint=await sha256(JSON.stringify(jwk));if(String(body?.key_fingerprint_sha256||'')!==fingerprint)return{ok:false,reason:'FINGERPRINT_MISMATCH'};const timestamp=String(req.headers.get('x-metaengine-enroll-timestamp')||'');const nonce=String(req.headers.get('x-metaengine-enroll-nonce')||'');const signature=String(req.headers.get('x-metaengine-enroll-signature')||'');const parsed=Date.parse(timestamp);if(!Number.isFinite(parsed)||Math.abs(Date.now()-parsed)>120000)return{ok:false,reason:'TIMESTAMP_OUT_OF_WINDOW'};if(!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)||!/^[A-Za-z0-9_-]{80,128}$/.test(signature))return{ok:false,reason:'ENROLL_HEADERS_INVALID'};const material=['METAENGINE_NATIVE_ENROLLMENT_V1',`client_id:${id}`,`profile:${PROFILE}`,`fingerprint:${fingerprint}`,`timestamp:${timestamp}`,`nonce:${nonce}`,`body_sha256:${await sha256(bodyText)}`].join('\n');if(!await verifyP256(jwk,material,signature))return{ok:false,reason:'INVALID_SIGNATURE'};return{ok:true,id,jwk,fingerprint}}
async function enrollmentRequest(req:Request,bodyText:string,body:any){const proof=await verifyEnrollment(req,bodyText,body);if(!proof.ok)return json(401,{error:'enrollment_proof_required',reason:proof.reason});const existing=await enrollmentExisting(proof.id!,proof.fingerprint!);if(existing[0])return json(existing[0].status==='APPROVED'?200:202,{accepted:true,...existing[0],reason:'EXISTING_REQUEST',authority_effect:false});const rows=await enrollmentInsert(proof.id!,proof.jwk,proof.fingerprint!,{client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',shell_version:String(body?.metadata?.shell_version||'').slice(0,32)});const row=rows[0];if(!row)throw new Error('enrollment_insert_failed');return json(202,{accepted:true,...row,reason:'APPROVAL_REQUIRED',authority_effect:false})}
async function enrollmentStatus(req:Request,bodyText:string,body:any){const proof=await verifyEnrollment(req,bodyText,body);if(!proof.ok)return json(401,{error:'enrollment_proof_required',reason:proof.reason});const requestId=String(body?.request_id||'');if(!/^[0-9a-f-]{36}$/i.test(requestId))return json(400,{error:'request_id_invalid'});const rows=await enrollmentById(requestId,proof.id!,proof.fingerprint!);const row=rows[0];if(!row)return json(404,{error:'enrollment_request_not_found'});if(row.status==='PENDING')return json(202,{accepted:false,request_id:row.request_id,status:'PENDING',reason:'APPROVAL_REQUIRED',expires_at:row.expires_at,authority_effect:false});if(row.status==='REJECTED'||row.status==='EXPIRED')return json(409,{accepted:false,request_id:row.request_id,status:row.status,reason:`REQUEST_${row.status}`,authority_effect:false});const activated=await rpc(ACTIVATE_RPC,{p_request_id:row.request_id,p_client_id:proof.id,p_profile:PROFILE,p_key_fingerprint_sha256:proof.fingerprint,p_public_jwk:proof.jwk});return json(activated?.accepted===true?200:409,{...activated,request_id:row.request_id,authority_effect:false})}
async function authenticateDevice(req:Request,path:string,bodyText:string){const id=clientId(req);if(!id)return{ok:false,reason:'CLIENT_ID_REQUIRED'};const profile=String(req.headers.get('x-a2-device-profile')||'');const deviceId=String(req.headers.get('x-a2-device-id')||'');const timestamp=String(req.headers.get('x-a2-device-timestamp')||'');const nonce=String(req.headers.get('x-a2-device-nonce')||'');const bodyHash=String(req.headers.get('x-a2-device-body-sha256')||'').toLowerCase();const signature=String(req.headers.get('x-a2-device-signature')||'');if(profile!==PROFILE||!/^[0-9a-f-]{36}$/i.test(deviceId)||!Number.isFinite(Date.parse(timestamp))||!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)||!/^[0-9a-f]{64}$/.test(bodyHash)||!/^[A-Za-z0-9_-]{80,128}$/.test(signature))return{ok:false,reason:'DEVICE_HEADERS_INVALID'};if(await sha256(bodyText)!==bodyHash)return{ok:false,reason:'BODY_HASH_MISMATCH'};const rows=await deviceLookup(deviceId,id);const device=rows[0];if(!device)return{ok:false,reason:'DEVICE_NOT_FOUND'};if(device.active!==true||device.revoked_at)return{ok:false,reason:'DEVICE_REVOKED'};let jwk;try{jwk=canonicalJwk(device.public_jwk)}catch{return{ok:false,reason:'DEVICE_KEY_INVALID'}};const material=[PROFILE,`device_id:${deviceId}`,`method:${req.method.toUpperCase()}`,`path:${path}`,`timestamp:${timestamp}`,`nonce:${nonce}`,`body_sha256:${bodyHash}`].join('\n');if(!await verifyP256(jwk,material,signature))return{ok:false,reason:'INVALID_SIGNATURE'};const grant=String(device.enrollment_pairing_token_hash||'');const grants=await pairingLookup(grant);if(grants.length!==1)return{ok:false,reason:'PAIRING_REVOKED'};const nr=await rpc(NONCE_RPC,{p_device_id:deviceId,p_client_id:id,p_nonce_sha256:await sha256(nonce),p_request_timestamp:timestamp});if(nr?.accepted!==true)return{ok:false,reason:String(nr?.reason||'NONCE_REJECTED')};return{ok:true,id,device_id:deviceId,profile:PROFILE,key_fingerprint_sha256:nr.key_fingerprint_sha256||null}}
// P1-2 multi-writer repair: plane ownership semantics for the persisted state.
// /v1/state accepts three writers (bootstrap heartbeat, 5s supervisor heartbeat,
// realtime observation push). The former full-JSON replacement meant any writer
// that omitted a plane erased it server-side (live-observed as supervisor_mesh
// flapping). The persisted state now merges per top-level plane:
//   - a key present in the incoming payload (even explicit null) overwrites;
//   - a key ABSENT from the incoming payload is preserved.
// boundedState therefore keeps the absent-vs-null distinction: identity and
// scalar fields are always emitted (they are mandatory for every writer), while
// plane keys are emitted only when the writer actually included them.
const PLANE_KEYS=['tabs','development_plane','compute','fleet','perception','supervisor_lifecycle','supervisor_mesh','self_update','host_resilience','realtime_process_plane','control_latency'] as const;
function boundedState(value:any){const s=value&&typeof value==='object'?value:{};const tabs=Array.isArray(s.tabs)?s.tabs.slice(0,64).map((t:any)=>({tab_id:String(t?.tab_id||'').slice(0,80),url:String(t?.url||'').slice(0,1200),title:String(t?.title||'').slice(0,240),kind:String(t?.kind||'').slice(0,40),selected:t?.selected===true})):[];const row:any={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',shell_version:String(s.shell_version||'').slice(0,32),supervisor_mode:modeOf(s.supervisor_mode),armed:s.armed===true,operator_mode:String(s.operator_mode||'CONTROL').slice(0,32),active_tab:s.active_tab&&typeof s.active_tab==='object'?s.active_tab:null,realtime_observation_push:s.realtime_observation_push===true,last_error:String(s.last_error||'').slice(0,500)||null,started_at:s.started_at||null,heartbeat_at:new Date().toISOString()};if('tabs'in s)row.tabs=tabs;if('development_plane'in s)row.development_plane=boundedObject(s.development_plane,32768);if('compute'in s)row.compute=boundedObject(s.compute,32768);if('fleet'in s)row.fleet=boundedObject(s.fleet,65536);if('perception'in s)row.perception=boundedObject(s.perception,32768);if('supervisor_lifecycle'in s)row.supervisor_lifecycle=boundedObject(s.supervisor_lifecycle,32768);if('supervisor_mesh'in s)row.supervisor_mesh=boundedMesh(s.supervisor_mesh);if('self_update'in s)row.self_update=boundedObject(s.self_update,32768);if('host_resilience'in s)row.host_resilience=boundedObject(s.host_resilience,32768);if('realtime_process_plane'in s)row.realtime_process_plane=boundedObject(s.realtime_process_plane,262144);if('control_latency'in s)row.control_latency=boundedObject(s.control_latency,32768);if('rsi'in s)row.rsi=boundedObject(s.rsi,16384);if('rsi_outcome_river'in s)row.rsi_outcome_river=boundedObject(s.rsi_outcome_river,16384);if('rsi_operator_steering'in s)row.rsi_operator_steering=boundedObject(s.rsi_operator_steering,16384);return row}
async function upsertState(req:Request,body:any,identity:any){const id=clientId(req);const s=boundedState(body?.state);if(s.supervisor_mesh)await rpc(MESH_SYNC_RPC,{p_client_id:id,p_mesh:s.supervisor_mesh});const row={client_id:id,workspace_id:WORKSPACE_ID,extension_version:s.shell_version||null,operator_runtime:'native-electron-supervisor-v1',supervisor_mode:s.supervisor_mode,armed:s.armed,operator_mode:s.operator_mode,ordering_policy:'NATIVE_TYPED_COMMAND_LANES_V1',last_command_id:body?.last_command_id||null,last_command_status:body?.last_command_status||null,state:{...s,transport_identity:{profile:identity.profile,device_id:identity.device_id,key_fingerprint_sha256:identity.key_fingerprint_sha256}},authority_effect:s.supervisor_mode==='CONTROL'||s.armed===true};await upsertStateRow(row);return{...row,last_seen_at:new Date().toISOString()}}
async function lease(req:Request,body:any){return rpc(LEASE_RPC,{p_workspace_id:WORKSPACE_ID,p_client_id:clientId(req),p_supervisor_mode:modeOf(body?.supervisor_mode),p_lease_timeout_seconds:120})}
async function leaseBatch(req:Request,body:any){return rpc(BATCH_LEASE_RPC,{p_workspace_id:WORKSPACE_ID,p_client_id:clientId(req),p_supervisor_mode:modeOf(body?.supervisor_mode),p_lease_timeout_seconds:120,p_max_batch:Math.max(1,Math.min(64,Number(body?.max_batch)||64)),p_max_tab_mutations:Math.max(1,Math.min(16,Number(body?.max_tab_mutations)||8))})}
function realtimeTopic(client:string){return`metaengine-control:${WORKSPACE_ID}:${client}`}
function realtimeAllTopic(){return`metaengine-control:${WORKSPACE_ID}:all`}
async function waitBatch(req:Request,body:any){
  const initial=await leaseBatch(req,body);
  if(Array.isArray(initial?.commands)&&initial.commands.length>0)return{...initial,wake_reason:'IMMEDIATE',transport_delivery_is_authority:false,authority_effect:false};
  const waitMs=Math.max(250,Math.min(MAX_REALTIME_WAIT_MS,Number(body?.wait_ms)||4000));
  const client=clientId(req);

  if(!REALTIME_API_KEY||!REALTIME_ACCESS_TOKEN){
    const subscription=postgresWakeHub.open({clientId:client,timeoutMs:waitMs});
    try{
      const joined=await subscription.subscribed;
      const afterSubscribe=await leaseBatch(req,body);
      if(Array.isArray(afterSubscribe?.commands)&&afterSubscribe.commands.length>0){
        return{...afterSubscribe,wake_reason:'POSTGRES_SUBSCRIBED_RECHECK',transport_delivery_is_authority:false,authority_effect:false};
      }
      if(joined?.ok!==true){
        // LISTEN degradation must not create a zero-delay lease spin. Burn one
        // bounded idle wait, then perform the same durable DB recheck as before.
        await sleep(waitMs);
        const fallback=await leaseBatch(req,body);
        return{...fallback,wake_reason:`POSTGRES_${String(joined?.reason||'LISTEN_UNAVAILABLE')}_DB_POLL_FALLBACK`,transport_delivery_is_authority:false,authority_effect:false};
      }
      const wake=await subscription.wake;
      const afterWake=await leaseBatch(req,body);
      return{...afterWake,wake_reason:String(wake?.reason||'POSTGRES_UNKNOWN'),transport_delivery_is_authority:false,authority_effect:false};
    }finally{subscription.close()}
  }

  const wsUrl=`${String(Deno.env.get('SUPABASE_URL')||'').replace(/^https:/,'wss:').replace(/\/+$/,'')}/realtime/v1/websocket?apikey=${encodeURIComponent(REALTIME_API_KEY)}&vsn=1.0.0`;
  const subscription=openRealtimeCommandWake({createSocket:()=>new WebSocket(wsUrl),topics:[realtimeTopic(client),realtimeAllTopic()],accessToken:REALTIME_ACCESS_TOKEN,timeoutMs:waitMs});
  try{
    const joined=await subscription.subscribed;
    if(joined?.ok!==true){const fallback=await leaseBatch(req,body);return{...fallback,wake_reason:String(joined?.reason||'SUBSCRIBE_FAILED'),transport_delivery_is_authority:false,authority_effect:false}}
    const afterSubscribe=await leaseBatch(req,body);
    if(Array.isArray(afterSubscribe?.commands)&&afterSubscribe.commands.length>0)return{...afterSubscribe,wake_reason:'SUBSCRIBED_RECHECK',transport_delivery_is_authority:false,authority_effect:false};
    const wake=await subscription.wake;
    const afterWake=await leaseBatch(req,body);
    return{...afterWake,wake_reason:String(wake?.reason||'UNKNOWN'),transport_delivery_is_authority:false,authority_effect:false}
  }finally{subscription.close()}
}
async function bindEffect(req:Request,commandId:string,body:any){const binding=boundedObject(body?.binding,16384);if(!binding)return json(400,{accepted:false,error:'effect_binding_required',authority_effect:false});if(!EFFECT_BINDING_SCHEMAS.has(String(binding.schema||'')))return json(400,{accepted:false,error:'effect_binding_schema_invalid',authority_effect:false});if(String(binding.command_id||'').toLowerCase()!==String(commandId||'').toLowerCase())return json(409,{accepted:false,error:'effect_binding_command_mismatch',authority_effect:false});if(String(binding.client_id||'')!==clientId(req))return json(409,{accepted:false,error:'effect_binding_client_mismatch',authority_effect:false});try{const result=await rpc(BIND_EFFECT_RPC,{p_workspace_id:WORKSPACE_ID,p_command_id:commandId,p_client_id:clientId(req),p_binding:binding,p_authority_effect:false});if(!result||typeof result!=='object'||result.accepted!==true||!result.effect_binding)return json(409,{accepted:false,error:'effect_binding_not_accepted',authority_effect:false});return json(200,{...result,authority_effect:false})}catch{return json(409,{accepted:false,error:'effect_binding_rejected',authority_effect:false})}}
async function readCommandReceipt(req:Request,commandId:string){try{const value=await rsiReceiptReadback.read({workspaceId:WORKSPACE_ID,commandId,clientId:clientId(req)});return json(200,value)}catch(error){const message=String((error as any)?.message||error);if(message.includes('_invalid')||message.includes('_required'))return json(400,{error:'result_receipt_readback_invalid',authority_effect:false});throw error}}
async function complete(req:Request,commandId:string,body:any){const rows=await commandLookup(commandId);if(!rows[0])return json(404,{error:'command_not_found'});const r=await rpc(COMPLETE_RPC,{p_workspace_id:WORKSPACE_ID,p_command_id:commandId,p_client_id:clientId(req),p_ok:body?.ok===true,p_receipt:body?.receipt&&typeof body.receipt==='object'?body.receipt:{},p_error:body?.ok===true?null:String(body?.error||'command_failed').slice(0,500),p_authority_effect:false});return json(r?.accepted===true?200:409,r)}
async function completeBatch(req:Request,body:any){if(!Array.isArray(body?.results)||body.results.length>64)return json(400,{error:'command_batch_results_invalid'});const r=await rpc(BATCH_COMPLETE_RPC,{p_workspace_id:WORKSPACE_ID,p_client_id:clientId(req),p_results:body.results});return json(200,r)}
// Agent Toolbelt issue route (Tier 2 break #3): a device-authenticated
// supervisor issues ONE command-plane command on behalf of a fleet agent.
// Every issued command carries per-agent attribution (issued_by=agent:<id>)
// and the Outcome River task context (payload.rsi_task), so the command
// leases back to this same device, executes through the normal lane
// machinery, and its terminal receipt ingests as a candidate-bound,
// credit-eligible episode (one tool command = one experience case).
async function issueTool(req:Request,body:any){
  const action=String(body?.action||'').toUpperCase();
  if(!TOOL_ISSUE_ACTIONS.has(action))return json(400,{accepted:false,error:'agent_tool_action_not_allowed',allowed:[...TOOL_ISSUE_ACTIONS].sort(),authority_effect:false});
  const agentId=String(body?.agent_id||'').toLowerCase();
  if(!TOOL_AGENT_RE.test(agentId))return json(400,{accepted:false,error:'agent_tool_agent_id_invalid',authority_effect:false});
  const requestId=String(body?.request_id||'');
  if(!TOOL_REQUEST_ID_RE.test(requestId))return json(400,{accepted:false,error:'agent_tool_request_id_invalid',authority_effect:false});
  const taskId=String(body?.task_id||'').toLowerCase();
  if(!TOOL_TASK_RE.test(taskId))return json(400,{accepted:false,error:'agent_tool_task_id_invalid',authority_effect:false});
  const payload=boundedObject(body?.payload,4096);
  if(!payload)return json(400,{accepted:false,error:'agent_tool_payload_invalid',authority_effect:false});
  const tabIdRaw=body?.tab_id==null?'':String(body.tab_id);
  if(tabIdRaw!==''&&!TOOL_TAB_RE.test(tabIdRaw))return json(400,{accepted:false,error:'agent_tool_tab_id_invalid',authority_effect:false});
  const toolPayload:any={...payload};
  if(tabIdRaw!==''&&toolPayload.tab_id==null)toolPayload.tab_id=tabIdRaw;
  // Outcome River binding context: the issuing supervisor binds this command
  // to the task trajectory before execution (client-side river), keyed by the
  // same task_id/agent_id declared here.
  toolPayload.rsi_task={schema:'metaengine.rsi.command-task-context.v1',task_id:taskId,agent_id:agentId};
  const idem=`tool:${(await sha256(`${agentId}:${taskId}:${requestId}`)).slice(0,40)}`;
  try{
    const result=await rpc(ISSUE_NATIVE_RPC,{p_client_id:clientId(req),p_action:action,p_platform:'GLM_ZAI',p_payload:toolPayload,p_ttl_seconds:120,p_issued_by:`agent:${agentId}`,p_idempotency_key:idem});
    if(!result||typeof result!=='object'||result.accepted!==true)return json(409,{accepted:false,error:'agent_tool_issue_rejected',reason:String(result?.error||result?.reason||'unknown').slice(0,160),authority_effect:false});
    return json(200,{accepted:true,command_id:result.command_id,status:result.status||'PENDING',idempotency_key:idem,replayed:result.replayed===true,issued_by:`agent:${agentId}`,rsi_task_bound:true,authority_effect:false});
  }catch(error){
    return json(409,{accepted:false,error:'agent_tool_issue_failed',reason:String((error as any)?.message||error).slice(0,160),authority_effect:false});
  }
}
async function health(){const capability=await projectNativeSupervisorRuntimeCapabilityHealth({rpc:(name:any,args:any)=>name==='devos_runtime_capabilities_v1'?boundedRpc(name,args,HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS):Promise.reject(new Error('health_capability_rpc_not_allowed'))});return{ok:true,schema:'metaengine.native-browser-supervisor.health.v1',backend_transport:'DIRECT_POSTGRES',profile:PROFILE,approval_enrollment:true,typed_commands_only:true,arbitrary_eval:false,supervisor_mesh:true,devos_routes:true,devos_promotion_routes:true,meta_orchestrator_routes:true,command_batch_transport:true,command_wait_batch:(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN)?'REALTIME_BROADCAST_PROXY':'POSTGRES_NOTIFY_PROXY',effect_intent_sealing:true,effect_intent_binding_schemas:['v1','v2'],result_receipt_readback:true,result_receipt_readback_is_authority:false,result_receipt_terminal_statuses:['COMPLETED','FAILED'],agent_tool_issue:true,agent_tool_issue_allowlist:[...TOOL_ISSUE_ACTIONS].sort(),realtime_process_plane:true,realtime_process_state_projection:true,realtime_observation_push:true,cognitive_delta_route:true,cognitive_delta_acceptor_required:true,cognitive_delta_delivery_is_authority:false,emergency_wait_route:true,emergency_wait_delivery_is_authority:false,realtime_public_api_key_present:Boolean(REALTIME_API_KEY),realtime_access_token_compatible:Boolean(REALTIME_ACCESS_TOKEN),realtime_url_uses_service_role:false,postgres_notify_wake:true,postgres_notify_delivery_is_authority:false,command_wake_delivery_is_authority:false,realtime_observation_push_is_authority:false,...runtimeCapabilityHealthResponseFields(capability)}}
async function status(){const {states,commands}=await statusRows();return{schema:'metaengine.native-browser-supervisor.status.v1',workspace_id:WORKSPACE_ID,backend_transport:'DIRECT_POSTGRES',device_auth_required:true,approval_enrollment:true,typed_commands_only:true,arbitrary_eval:false,supervisor_mesh:true,devos_routes:true,devos_promotion_routes:true,meta_orchestrator_routes:true,command_batch_transport:true,command_wait_batch:(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN)?'REALTIME_BROADCAST_PROXY':'POSTGRES_NOTIFY_PROXY',effect_intent_sealing:true,effect_intent_binding_schemas:['v1','v2'],result_receipt_readback:true,result_receipt_readback_is_authority:false,result_receipt_terminal_statuses:['COMPLETED','FAILED'],agent_tool_issue:true,agent_tool_issue_allowlist:[...TOOL_ISSUE_ACTIONS].sort(),realtime_process_plane:true,realtime_observation_push:true,cognitive_delta_route:true,cognitive_delta_acceptor_required:true,cognitive_delta_delivery_is_authority:false,realtime_public_api_key_present:Boolean(REALTIME_API_KEY),realtime_url_uses_service_role:false,postgres_notify_wake:true,postgres_notify_delivery_is_authority:false,states,commands}}
const runtimeControl=()=>readDevosRuntimeControl({rpc,workspaceId:WORKSPACE_ID}).catch(()=>unavailableDevosRuntimeControl('READ_FAILED'));
const devosRoutes=createDevosSupervisorRoutes({rpc,workspaceId:WORKSPACE_ID,readRuntimeControl:runtimeControl});
const devosPromotionRoutes=createDevosPromotionRoutes({rpc,workspaceId:WORKSPACE_ID});
const metaRoutes=createMetaSupervisorRoutes({rpc,workspaceId:WORKSPACE_ID});
const cognitiveRoutes=createCognitiveDeltaRoutes({rpc,workspaceId:WORKSPACE_ID,json});
const dbInspectRoutes=createDbInspectRoutes({sql,json});
// Emergency transport wiring (closed-loop audit): the dedicated emergency
// wait route is now MOUNTED. The browser's normal wait-batch already leases
// EMERGENCY-lane commands with lane priority 0 (lease_batch_v1); this route
// exists for external operator tooling that must not contend with the
// general scheduler. The lease RPC is a real migration
// (20260921000000_browser_emergency_lane_and_lease_v1.sql).
const emergencyRoutes=createEmergencyCommandRoutes({
  rpc,
  workspaceId:WORKSPACE_ID,
  openWake:({clientId,waitMs}:{clientId:string,waitMs:number})=>postgresWakeHub.open({clientId,timeoutMs:waitMs}),
  json,
});

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  const i=url.pathname.indexOf(SERVICE_MARKER);
  const path=i>=0?(url.pathname.slice(i+SERVICE_MARKER.length)||'/'):url.pathname;
  try{
    if(req.method==='GET'&&path==='/health')return json(200,await health());
    const bodyText=req.method==='GET'?'':await req.text();
    const body=parseJson(bodyText);
    if(body===null)return json(400,{error:'invalid_json'});
    if(req.method==='POST'&&path==='/v1/device/enrollment/request')return enrollmentRequest(req,bodyText,body);
    if(req.method==='POST'&&path==='/v1/device/enrollment/status')return enrollmentStatus(req,bodyText,body);
    const canonicalPath=`${SERVICE_MARKER}${path}`;
    const identity=await authenticateDevice(req,canonicalPath,bodyText);
    if(identity.ok!==true)return json(401,{error:'device_auth_required',reason:identity.reason});
    const cognitive=await cognitiveRoutes({req,path,body,bodyText,identity});if(cognitive)return cognitive;
    const emergency=await emergencyRoutes({req,path,body,clientId:identity.id});if(emergency)return emergency;
    const dbInspect=await dbInspectRoutes({req,path});if(dbInspect)return dbInspect;
    const promotion=await devosPromotionRoutes({req,path,body,clientId:identity.id});if(promotion)return promotion;
    const meta=await metaRoutes({req,path,body,clientId:identity.id});if(meta)return meta;
    const devos=await devosRoutes({req,path,body,clientId:identity.id});if(devos)return devos;
    if(req.method==='POST'&&path==='/v1/state'){const state=await upsertState(req,body,identity);return json(202,{accepted:true,state,runtime_control:await runtimeControl()})}
    if(req.method==='POST'&&path==='/v1/commands/next')return json(200,await lease(req,body));
    if(req.method==='POST'&&path==='/v1/commands/next-batch')return json(200,await leaseBatch(req,body));
    if(req.method==='POST'&&path==='/v1/commands/wait-batch')return json(200,await waitBatch(req,body));
    if(req.method==='POST'&&path==='/v1/commands/result-batch')return completeBatch(req,body);
    if(req.method==='POST'&&path==='/v1/commands/issue-tool')return issueTool(req,body);
    const effect=path.match(/^\/v1\/commands\/([^/]+)\/effect-intent$/);
    if(req.method==='POST'&&effect)return bindEffect(req,decodeURIComponent(effect[1]),body);
    const receipt=path.match(/^\/v1\/commands\/([^/]+)\/receipt$/);
    if(req.method==='GET'&&receipt)return readCommandReceipt(req,decodeURIComponent(receipt[1]));
    const m=path.match(/^\/v1\/commands\/([^/]+)\/result$/);
    if(req.method==='POST'&&m)return complete(req,decodeURIComponent(m[1]),body);
    if(req.method==='GET'&&path==='/v1/status')return json(200,await status());
    return json(404,{error:'not_found'});
  }catch(e){
    console.error('native_supervisor_direct_postgres_failure',String((e as any)?.message||e));
    return json(502,{error:'native_supervisor_failure',backend_transport:'DIRECT_POSTGRES'});
  }
});
