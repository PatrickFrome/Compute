import postgres from 'npm:postgres@3.4.7';
import { normalizeEnrollmentMetadata } from './enrollment-metadata.mjs';
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
import { resolveSelfHostedSupervisorConfig } from './self-hosted-config.mjs';

const localRuntime=resolveSelfHostedSupervisorConfig((name:string)=>Deno.env.get(name));
const DB_URL=localRuntime.local?localRuntime.databaseUrl:Deno.env.get('SUPABASE_DB_URL')||'';
const DB_SESSION_URL=localRuntime.local?localRuntime.databaseUrl:Deno.env.get('SUPABASE_DB_SESSION_URL')||'';
const SUPABASE_URL=localRuntime.local?localRuntime.apiBase:String(Deno.env.get('SUPABASE_URL')||'').replace(/\/+$/,'');
function serverSecretKey(){
  const modern=String(Deno.env.get('SUPABASE_SECRET_KEYS')||'').trim();
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      const value=String(parsed?.default||'').trim();
      if(value)return value;
    }catch{/* legacy env below */}
  }
  return String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'').trim();
}
const SERVICE_ROLE=localRuntime.local?localRuntime.key:serverSecretKey();
const REST_BASE=SUPABASE_URL?SUPABASE_URL+'/rest/v1':'';
const REALTIME_API_KEY=localRuntime.local?'':Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY')||'';
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
const NONCE_RPC='h205f22_a2_browser_device_consume_nonce_v3';
const ENROLL_TABLE='compute_fabric_a2_browser_device_enrollment_request_h205f22';
const STATE_TABLE='compute_fabric_a2_browser_supervisor_state_h205f22';
const COMMAND_TABLE='compute_fabric_a2_browser_supervisor_command_h205f22';
const LEASE_RPC='h205f22_a2_browser_supervisor_lease_v3';
const COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_v5';
const BATCH_LEASE_RPC='h205f22_a2_browser_supervisor_lease_batch_v1';
const BATCH_COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_batch_v1';
const BIND_EFFECT_RPC='h205f22_a2_browser_supervisor_bind_effect_v1';
const ISSUE_NATIVE_RPC='h205f22_a2_browser_supervisor_issue_native_v1';
const ISSUE_COMPUTER_RPC='h205f22_a2_browser_supervisor_issue_computer_v1';
// Agent Toolbelt issue allowlist (Tier 2 break #3): read-heavy observation +
// bounded navigation only. Conversation mutation (SEMANTIC_TYPE) stays
// dispatch-only — the task prompt remains the only text the supervisor types
// into an agent conversation.
const TOOL_ISSUE_ACTIONS=new Set(['CAPTURE','READ_TRANSCRIPT','TAB_TELEMETRY','SYSTEM_TELEMETRY','SCROLL','SEMANTIC_FOCUS','COMPUTER_OBSERVE','COMPUTER_ACTION']);
const TOOL_REQUEST_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$/;
const TOOL_AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const TOOL_TAB_RE=/^tab_[0-9a-f-]{36}$/i;
const TOOL_TASK_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EFFECT_BINDING_SCHEMAS=new Set(['metaengine.native-supervisor.effect-binding.v1','metaengine.native-supervisor.effect-binding.v2','metaengine.native-supervisor.computer-effect-binding.v1']);
const ACTIVATE_RPC='h205f22_a2_browser_device_activate_approved_v1';
const GUARDIAN_TICKET_ISSUE_RPC='client_v1_guardian_enrollment_ticket_issue_v1';
const GUARDIAN_TICKET_CONSUME_RPC='client_v1_guardian_enrollment_ticket_consume_v1';
const MESH_SYNC_RPC='h205f22_a2_supervisor_mesh_sync_v1';
const HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS=1500;
const MAX_REALTIME_WAIT_MS=15000;
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-a2-chat-bridge-client,x-a2-device-profile,x-a2-device-id,x-a2-device-timestamp,x-a2-device-nonce,x-a2-device-body-sha256,x-a2-device-signature,x-metaengine-enroll-timestamp,x-metaengine-enroll-nonce,x-metaengine-enroll-signature','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}});
if(!DB_URL)throw new Error('supabase_db_url_missing');
if(!REST_BASE||!SERVICE_ROLE)throw new Error('supabase_postgrest_service_identity_missing');
// Direct Postgres is retained only for explicit DB-inspect diagnostics. Normal
// enrollment/auth/heartbeat/command/RPC traffic below uses PostgREST so an Edge
// isolate does not consume a query session merely to serve the Native Browser.
const querySql=postgres(DB_URL,{max:1,prepare:false,connect_timeout:4,idle_timeout:20});
const sql=localRuntime.local?{unsafe:(text:string,args:any[]=[])=>querySql.begin('read only',async(tx:any)=>{
  await tx.unsafe('SET LOCAL ROLE service_role');
  await tx.unsafe("SET LOCAL statement_timeout = '5s'");
  return tx.unsafe(text,args);
})}:querySql;
// LISTEN holds a dedicated connection. Keep it isolated from the query pool so a
// held command-wake subscription cannot starve durable lease/heartbeat queries.
const wakeSql=DB_SESSION_URL?postgres(DB_SESSION_URL,{max:1,prepare:false,connect_timeout:4,idle_timeout:null}):null;
const postgresWakeHub=createPostgresCommandWakeHub({listen:(channel:string,onNotify:(payload:string)=>void,onListen:()=>void)=>{
  if(!wakeSql)throw new Error('postgres_session_wake_url_unavailable');
  return wakeSql.listen(channel,onNotify,onListen);
}});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function serviceHeaders(extra:Record<string,string>={}){
  const headers:Record<string,string>={'apikey':SERVICE_ROLE,'accept':'application/json',...extra};
  // Legacy service_role JWTs may be used as Bearer tokens. Modern sb_secret_*
  // keys are deliberately NOT placed in Authorization because they are not JWTs.
  if(SERVICE_ROLE.split('.').length===3)headers.authorization=`Bearer ${SERVICE_ROLE}`;
  return headers;
}
async function rest(path:string,{method='GET',body=null,prefer=null}:{method?:string,body?:any,prefer?:string|null}={}){
  if(!String(path||'').startsWith('/'))throw new Error('postgrest_path_invalid');
  const headers=serviceHeaders(body===null?{}:{'content-type':'application/json'});
  if(prefer)headers.prefer=prefer;
  const response=await fetch(REST_BASE+path,{
    method,
    headers,
    body:body===null?undefined:JSON.stringify(body),
    cache:'no-store',
  });
  const text=await response.text();
  if(!response.ok)throw new Error(`postgrest_http_${response.status}:${text.slice(0,240)}`);
  if(!text)return null;
  try{return JSON.parse(text)}catch{throw new Error('postgrest_json_invalid')}
}
async function rpc(name:string,args:any={}){
  if(!/^[a-z0-9_]+$/i.test(name))throw new Error('rpc_name_invalid');
  return rest('/rpc/'+encodeURIComponent(name),{method:'POST',body:args});
}
async function boundedRpc(name:string,args:any,ms:number){
  let timer:any;
  try{return await Promise.race([
    rpc(name,args),
    new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error('rpc_deadline');e.name='TimeoutError';reject(e)},ms)}),
  ])}finally{if(timer)clearTimeout(timer)}
}

const eq=(value:any)=>encodeURIComponent(String(value??''));
async function enrollmentExisting(client:string,fingerprint:string){
  const now=encodeURIComponent(new Date().toISOString());
  return rest(`/${ENROLL_TABLE}?client_id=eq.${eq(client)}&key_fingerprint_sha256=eq.${eq(fingerprint)}&status=in.(PENDING,APPROVED)&expires_at=gt.${now}&select=request_id,status,requested_at,expires_at,key_fingerprint_sha256&order=requested_at.desc&limit=1`);
}
async function enrollmentInsert(client:string,jwk:any,fingerprint:string,metadata:any){
  return rest(`/${ENROLL_TABLE}?select=request_id,status,requested_at,expires_at,key_fingerprint_sha256`,{
    method:'POST',
    prefer:'return=representation',
    body:{client_id:client,profile:PROFILE,public_jwk:jwk,key_fingerprint_sha256:fingerprint,status:'PENDING',metadata:metadata||{},authority_effect:false},
  });
}
async function enrollmentById(requestId:string,client:string,fingerprint:string){
  return rest(`/${ENROLL_TABLE}?request_id=eq.${eq(requestId)}&client_id=eq.${eq(client)}&key_fingerprint_sha256=eq.${eq(fingerprint)}&select=request_id,status,requested_at,expires_at,approved_at,device_id&limit=1`);
}
async function deviceLookup(deviceId:string,client:string){
  return rest(`/${DEVICE_TABLE}?device_id=eq.${eq(deviceId)}&client_id=eq.${eq(client)}&select=device_id,client_id,profile,public_jwk,enrollment_pairing_token_hash,active,revoked_at,access_tier,admin_scopes,admin_grant_epoch,admin_granted_at,admin_revoked_at&limit=1`);
}
async function pairingLookup(hash:string){
  return rest(`/compute_fabric_a2_chat_bridge_remote_pairing_h205f22?token_hash=eq.${eq(hash)}&active=eq.true&select=token_hash&limit=1`);
}
async function commandLookup(commandId:string){
  return rest(`/${COMMAND_TABLE}?workspace_id=eq.${eq(WORKSPACE_ID)}&command_id=eq.${eq(commandId)}&select=command_id,action&limit=1`);
}
async function commandReceiptLookup({workspaceId,commandId,clientId}:{workspaceId:string,commandId:string,clientId:string}){
  const rows=await rest(`/${COMMAND_TABLE}?workspace_id=eq.${eq(workspaceId)}&command_id=eq.${eq(commandId)}&leased_by=eq.${eq(clientId)}&select=command_id,leased_by,status,receipt,error&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}
const rsiReceiptReadback=createRsiResultReceiptReadback({lookupCommand:commandReceiptLookup});
async function upsertStateRow(row:any){
  const merged=await rpc('client_v1_native_supervisor_state_merge_v1',{
    p_client_id:row.client_id,
    p_workspace_id:row.workspace_id,
    p_extension_version:row.extension_version,
    p_operator_runtime:row.operator_runtime,
    p_supervisor_mode:row.supervisor_mode,
    p_armed:row.armed,
    p_operator_mode:row.operator_mode,
    p_ordering_policy:row.ordering_policy,
    p_last_command_id:row.last_command_id,
    p_last_command_status:row.last_command_status,
    p_state:row.state,
    p_authority_effect:row.authority_effect,
  });
  if(merged?.accepted!==true)throw new Error('supervisor_state_merge_rejected');
  return merged;
}
async function statusRows(){
  const states=await rest(`/${STATE_TABLE}?workspace_id=eq.${eq(WORKSPACE_ID)}&select=client_id,workspace_id,last_seen_at,extension_version,operator_runtime,supervisor_mode,armed,operator_mode,ordering_policy,last_command_id,last_command_status,state,authority_effect&order=last_seen_at.desc&limit=8`);
  const commands=await rest(`/${COMMAND_TABLE}?workspace_id=eq.${eq(WORKSPACE_ID)}&select=command_id,idempotency_key,action,platform,status,issued_by,issued_at,expires_at,leased_by,leased_at,completed_at,authority_effect,receipt,error&order=issued_at.desc&limit=40`);
  return{states:Array.isArray(states)?states:[],commands:Array.isArray(commands)?commands:[]};
}

async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function randomGuardianTicket(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64urlBytes(v:string){if(!/^[A-Za-z0-9_-]+$/.test(v))throw new Error('signature_encoding_invalid');const pad='='.repeat((4-v.length%4)%4);const bin=atob(v.replace(/-/g,'+').replace(/_/g,'/')+pad);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
function canonicalJwk(value:any){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('jwk_invalid');const jwk={crv:String(value.crv||''),ext:value.ext===true,key_ops:Array.isArray(value.key_ops)?value.key_ops.map(String):[],kty:String(value.kty||''),x:String(value.x||''),y:String(value.y||'')};if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.ext||jwk.key_ops.length!==1||jwk.key_ops[0]!=='verify'||!/^[A-Za-z0-9_-]{43}$/.test(jwk.x)||!/^[A-Za-z0-9_-]{43}$/.test(jwk.y))throw new Error('jwk_invalid');return jwk}
async function verifyP256(jwk:any,material:string,signatureText:string){const sig=b64urlBytes(signatureText);if(sig.byteLength!==64)return false;const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,new TextEncoder().encode(material)).catch(()=>false)}
function clientId(req:Request){return String(req.headers.get('x-a2-chat-bridge-client')||'').trim().slice(0,160)}
function modeOf(v:any){const m=String(v||'OFF').toUpperCase();return ['OFF','MONITOR','CONTROL'].includes(m)?m:'OFF'}
function parseJson(text:string){try{return text?JSON.parse(text):{}}catch{return null}}
function boundedObject(value:any,maxBytes:number){if(!value||typeof value!=='object'||Array.isArray(value))return null;try{const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>maxBytes)return null;return JSON.parse(text)}catch{return null}}
function boundedCount(value:any){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function boundedText(value:any,max=160){const out=String(value??'').trim();return out?out.slice(0,max):null}
function boundedRealtimeProcessPlane(value:any){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const s=value;
  const semantic=s.semantic_plane&&typeof s.semantic_plane==='object'&&!Array.isArray(s.semantic_plane)?s.semantic_plane:{};
  const brain=s.browser_brain&&typeof s.browser_brain==='object'&&!Array.isArray(s.browser_brain)?s.browser_brain:{};
  const collaboration=brain.collaboration_fabric&&typeof brain.collaboration_fabric==='object'&&!Array.isArray(brain.collaboration_fabric)?brain.collaboration_fabric:{};
  const workbench=collaboration.workbench&&typeof collaboration.workbench==='object'&&!Array.isArray(collaboration.workbench)?collaboration.workbench:{};
  const cognitive=s.cognitive_delta_bus&&typeof s.cognitive_delta_bus==='object'&&!Array.isArray(s.cognitive_delta_bus)?s.cognitive_delta_bus:{};
  return{
    schema:boundedText(s.schema,96)||'metaengine.browser.realtime-process-plane.v1',
    running:s.running===true,
    sequence:boundedCount(s.sequence),
    observed_at:boundedText(s.observed_at,64),
    sample_interval_ms:boundedCount(s.sample_interval_ms),
    process_count:boundedCount(s.process_count),
    web_contents_count:boundedCount(s.web_contents_count),
    exact_tab_bound_web_contents_count:boundedCount(s.exact_tab_bound_web_contents_count),
    unbound_live_web_contents_count:boundedCount(s.unbound_live_web_contents_count),
    semantic_root_target_capacity:boundedCount(s.semantic_root_target_capacity),
    chromium_subtarget_count:boundedCount(s.chromium_subtarget_count),
    chromium_attached_subtarget_count:boundedCount(s.chromium_attached_subtarget_count),
    semantic_plane:{
      schema:boundedText(semantic.schema,96)||'metaengine.browser.realtime-semantic-plane.v1',
      running:semantic.running===true,
      state:boundedText(semantic.state,96),
      sequence:boundedCount(semantic.sequence),
      observed_at:boundedText(semantic.observed_at,64),
      target_count:boundedCount(semantic.target_count),
      ready_count:boundedCount(semantic.ready_count),
      dirty_count:boundedCount(semantic.dirty_count),
      target_capacity:boundedCount(semantic.target_capacity),
      chromium_subtarget_count:boundedCount(semantic.chromium_subtarget_count),
      chromium_attached_subtarget_count:boundedCount(semantic.chromium_attached_subtarget_count),
      persistent_cdp_sessions:semantic.persistent_cdp_sessions===true,
      attach_per_command:semantic.attach_per_command===true,
      control_authority:false,command_leasing:false,authority_effect:false,
    },
    browser_brain:{
      schema:boundedText(brain.schema,96),
      edge_count:boundedCount(brain.edge_count),
      reconcile_count:boundedCount(brain.reconcile_count),
      continuous_autonomous_work:brain.continuous_autonomous_work===true,
      durable_collaboration_memory:brain.durable_collaboration_memory===true,
      episodic_collaboration_memory:brain.episodic_collaboration_memory===true,
      routing_v2:brain.routing_v2===true,
      adaptive_sparse_fanout:brain.adaptive_sparse_fanout===true,
      collaboration_fabric:{
        schema:boundedText(collaboration.schema,96),
        task_count:boundedCount(collaboration.task_count),
        agent_count:boundedCount(collaboration.agent_count),
        workbench:{
          schema:boundedText(workbench.schema,96),
          context_count:boundedCount(workbench.context_count),
          visible_context_count:boundedCount(workbench.visible_context_count),
          total_task_count:boundedCount(workbench.total_task_count),
          visible_task_count:boundedCount(workbench.visible_task_count),
          contexts_truncated:workbench.contexts_truncated===true,
          bounded:workbench.bounded===true,
          projection_is_authority:false,scheduler_authority:false,execution_authority:false,command_leasing:false,authority_effect:false,
        },
        authority_effect:false,
      },
      scheduler_authority:false,execution_authority:false,authority_effect:false,
    },
    cognitive_delta_bus:{
      schema:boundedText(cognitive.schema,96),
      state:boundedText(cognitive.state,96),
      sequence:boundedCount(cognitive.sequence??cognitive.latest_sequence),
      oldest_sequence:boundedCount(cognitive.oldest_sequence??cognitive.earliest_sequence),
      dropped_events:boundedCount(cognitive.dropped_events??cognitive.dropped_total),
      control_authority:false,command_leasing:false,authority_effect:false,
    },
    processes_embedded:false,web_contents_embedded:false,events_embedded:false,collaboration_history_embedded:false,
    full_snapshot_retained_locally:true,full_snapshot_available_by_command:true,transport_projection:true,
    projection_is_authority:false,control_authority:false,command_leasing:false,authority_effect:false,
  }
}
function boundedMesh(value:any){if(!value||typeof value!=='object'||Array.isArray(value)||String(value.schema||'')!=='metaengine.supervisor-mesh-runtime.v1'||value.authority_effect===true)return null;const mesh=value.mesh;if(!mesh||typeof mesh!=='object'||Array.isArray(mesh)||String(mesh.schema||'')!=='metaengine.supervisor-mesh.state.v1'||!Array.isArray(mesh.supervisors)||mesh.supervisors.length>16)return null;const supervisors=[];for(const row of mesh.supervisors){const supervisor_id=String(row?.supervisor_id||'').toLowerCase();const conversation_url_sha256=String(row?.conversation_url_sha256||'').toLowerCase();const status=String(row?.status||'LOST').toUpperCase();const tab_id=row?.tab_id==null?null:String(row.tab_id).slice(0,160);if(!/^sup_[a-f0-9]{24}$/.test(supervisor_id)||!/^[a-f0-9]{64}$/.test(conversation_url_sha256)||supervisor_id!==`sup_${conversation_url_sha256.slice(0,24)}`||!['ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION'].includes(status)||row?.authority_effect===true)return null;supervisors.push({supervisor_id,conversation_url_sha256,status,tab_id:status==='LOST'||status==='AMBIGUOUS_INCARNATION'?null:tab_id,selected:row?.selected===true,authority_effect:false})}const preferred=mesh.preferred_supervisor_id==null?null:String(mesh.preferred_supervisor_id).toLowerCase();if(preferred!==null&&!/^sup_[a-f0-9]{24}$/.test(preferred))return null;return{schema:'metaengine.supervisor-mesh-runtime.v1',running:value.running===true,last_reconcile_at:value.last_reconcile_at||null,last_error:String(value.last_error||'').slice(0,500)||null,authority_effect:false,mesh:{schema:'metaengine.supervisor-mesh.state.v1',version:String(mesh.version||'').slice(0,32),mesh_epoch:Math.max(1,Number(mesh.mesh_epoch)||1),preferred_supervisor_id:preferred,supervisors,authority_effect:false}}}
async function verifyEnrollment(req:Request,bodyText:string,body:any){const id=clientId(req);if(!id)return{ok:false,reason:'CLIENT_ID_REQUIRED'};let jwk;try{jwk=canonicalJwk(body?.public_jwk)}catch{return{ok:false,reason:'JWK_INVALID'}};if(String(body?.profile||'')!==PROFILE)return{ok:false,reason:'PROFILE_INVALID'};const fingerprint=await sha256(JSON.stringify(jwk));if(String(body?.key_fingerprint_sha256||'')!==fingerprint)return{ok:false,reason:'FINGERPRINT_MISMATCH'};const timestamp=String(req.headers.get('x-metaengine-enroll-timestamp')||'');const nonce=String(req.headers.get('x-metaengine-enroll-nonce')||'');const signature=String(req.headers.get('x-metaengine-enroll-signature')||'');const parsed=Date.parse(timestamp);if(!Number.isFinite(parsed)||Math.abs(Date.now()-parsed)>120000)return{ok:false,reason:'TIMESTAMP_OUT_OF_WINDOW'};if(!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)||!/^[A-Za-z0-9_-]{80,128}$/.test(signature))return{ok:false,reason:'ENROLL_HEADERS_INVALID'};const material=['METAENGINE_NATIVE_ENROLLMENT_V1',`client_id:${id}`,`profile:${PROFILE}`,`fingerprint:${fingerprint}`,`timestamp:${timestamp}`,`nonce:${nonce}`,`body_sha256:${await sha256(bodyText)}`].join('\n');if(!await verifyP256(jwk,material,signature))return{ok:false,reason:'INVALID_SIGNATURE'};return{ok:true,id,jwk,fingerprint}}
function enrollmentMetadata(body:any){
  return normalizeEnrollmentMetadata(body);
}
async function enrollmentRequest(req:Request,bodyText:string,body:any){const proof=await verifyEnrollment(req,bodyText,body);if(!proof.ok)return json(401,{error:'enrollment_proof_required',reason:proof.reason});const existing=await enrollmentExisting(proof.id!,proof.fingerprint!);if(existing[0])return json(existing[0].status==='APPROVED'?200:202,{accepted:true,...existing[0],reason:'EXISTING_REQUEST',authority_effect:false});const rows=await enrollmentInsert(proof.id!,proof.jwk,proof.fingerprint!,enrollmentMetadata(body));const row=rows[0];if(!row)throw new Error('enrollment_insert_failed');return json(202,{accepted:true,...row,reason:'APPROVAL_REQUIRED',authority_effect:false})}
async function enrollmentStatus(req:Request,bodyText:string,body:any){const proof=await verifyEnrollment(req,bodyText,body);if(!proof.ok)return json(401,{error:'enrollment_proof_required',reason:proof.reason});const requestId=String(body?.request_id||'');if(!/^[0-9a-f-]{36}$/i.test(requestId))return json(400,{error:'request_id_invalid'});const rows=await enrollmentById(requestId,proof.id!,proof.fingerprint!);const row=rows[0];if(!row)return json(404,{error:'enrollment_request_not_found'});if(row.status==='PENDING')return json(202,{accepted:false,request_id:row.request_id,status:'PENDING',reason:'APPROVAL_REQUIRED',expires_at:row.expires_at,authority_effect:false});if(row.status==='REJECTED'||row.status==='EXPIRED')return json(409,{accepted:false,request_id:row.request_id,status:row.status,reason:`REQUEST_${row.status}`,authority_effect:false});const activated=await rpc(ACTIVATE_RPC,{p_request_id:row.request_id,p_client_id:proof.id,p_profile:PROFILE,p_key_fingerprint_sha256:proof.fingerprint,p_public_jwk:proof.jwk});return json(activated?.accepted===true?200:409,{...activated,request_id:row.request_id,authority_effect:false})}
async function authenticateDevice(req:Request,path:string,bodyText:string){
  const id=clientId(req);
  if(!id)return{ok:false,reason:'CLIENT_ID_REQUIRED'};
  const profile=String(req.headers.get('x-a2-device-profile')||'');
  const deviceId=String(req.headers.get('x-a2-device-id')||'');
  const timestamp=String(req.headers.get('x-a2-device-timestamp')||'');
  const nonce=String(req.headers.get('x-a2-device-nonce')||'');
  const bodyHash=String(req.headers.get('x-a2-device-body-sha256')||'').toLowerCase();
  const signature=String(req.headers.get('x-a2-device-signature')||'');
  if(profile!==PROFILE||!/^[0-9a-f-]{36}$/i.test(deviceId)||!Number.isFinite(Date.parse(timestamp))||!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)||!/^[0-9a-f]{64}$/.test(bodyHash)||!/^[A-Za-z0-9_-]{80,128}$/.test(signature))return{ok:false,reason:'DEVICE_HEADERS_INVALID'};
  if(await sha256(bodyText)!==bodyHash)return{ok:false,reason:'BODY_HASH_MISMATCH'};
  const rows=await deviceLookup(deviceId,id);
  const device=Array.isArray(rows)?rows[0]:null;
  if(!device)return{ok:false,reason:'DEVICE_NOT_FOUND'};
  if(device.active!==true||device.revoked_at)return{ok:false,reason:'DEVICE_REVOKED'};
  const adminEpoch=Number(device.admin_grant_epoch);
  const adminScopes=Array.isArray(device.admin_scopes)?device.admin_scopes.map(String):[];
  if(
    String(device.access_tier||'')!=='ADMIN'
    || device.admin_revoked_at
    || !Number.isSafeInteger(adminEpoch)
    || adminEpoch<1
    || !adminScopes.includes('CONTROL_PLANE')
  )return{ok:false,reason:'ADMIN_GRANT_REQUIRED'};
  let jwk;
  try{jwk=canonicalJwk(device.public_jwk)}catch{return{ok:false,reason:'DEVICE_KEY_INVALID'}}
  const material=[PROFILE,`device_id:${deviceId}`,`method:${req.method.toUpperCase()}`,`path:${path}`,`timestamp:${timestamp}`,`nonce:${nonce}`,`body_sha256:${bodyHash}`].join('\n');
  if(!await verifyP256(jwk,material,signature))return{ok:false,reason:'INVALID_SIGNATURE'};
  const grant=String(device.enrollment_pairing_token_hash||'');
  const grants=await pairingLookup(grant);
  if(!Array.isArray(grants)||grants.length!==1)return{ok:false,reason:'PAIRING_REVOKED'};
  const nr=await rpc(NONCE_RPC,{p_device_id:deviceId,p_client_id:id,p_nonce_sha256:await sha256(nonce),p_request_timestamp:timestamp});
  if(nr?.accepted!==true)return{ok:false,reason:String(nr?.reason||'NONCE_REJECTED')};
  return{
    ok:true,
    id,
    device_id:deviceId,
    profile:PROFILE,
    key_fingerprint_sha256:nr.key_fingerprint_sha256||device.key_fingerprint_sha256||null,
    access_tier:'ADMIN',
    admin_scopes:adminScopes,
    admin_grant_epoch:adminEpoch,
    admin_ready:true,
  };
}
async function adminStatus(identity:any){
  const readback=await rpc('client_v1_device_admin_readback_v1',{
    p_device_id:identity.device_id,
    p_client_id:identity.id,
    p_key_fingerprint_sha256:identity.key_fingerprint_sha256,
  });
  if(
    readback?.found!==true
    || readback?.admin_ready!==true
    || readback?.access_tier!=='ADMIN'
    || Number(readback?.admin_grant_epoch)!==Number(identity.admin_grant_epoch)
  )throw new Error('admin_device_readback_not_exact');
  return{
    schema:'metaengine.client-v1.admin-connection.v1',
    connected:true,
    device_id:identity.device_id,
    client_id:identity.id,
    profile:identity.profile,
    access_tier:'ADMIN',
    admin_scopes:Array.isArray(readback.admin_scopes)?readback.admin_scopes:[],
    admin_grant_epoch:Number(readback.admin_grant_epoch),
    admin_ready:true,
    backend_transport:'POSTGREST_RPC',
    direct_postgres_query_plane:false,
    direct_postgres_notify_only:Boolean(DB_SESSION_URL),
    master_secret_embedded:false,
    service_role_embedded:false,
    cloudflare_token_embedded:false,
    automatic_effect_retry_allowed:false,
    authority_effect:false,
  };
}
async function issueGuardianEnrollmentTicket(identity:any){
  if(identity?.admin_ready!==true||identity?.access_tier!=='ADMIN')return json(403,{accepted:false,error:'admin_device_required',authority_effect:false});
  const ticket=randomGuardianTicket();
  const ticketSha256=await sha256(ticket);
  const issued=await rpc(GUARDIAN_TICKET_ISSUE_RPC,{
    p_client_id:identity.id,
    p_device_id:identity.device_id,
    p_key_fingerprint_sha256:identity.key_fingerprint_sha256,
    p_admin_grant_epoch:Number(identity.admin_grant_epoch),
    p_ticket_sha256:ticketSha256,
    p_ttl_seconds:90,
  });
  if(issued?.accepted!==true)return json(409,{accepted:false,error:'guardian_enrollment_ticket_issue_rejected',authority_effect:false});
  return json(200,{
    ...issued,
    ticket,
    ticket_sha256:ticketSha256,
    ticket_transport:'HTTPS_BODY_ONLY',
    ticket_persisted_server_side:false,
    owner_sid_supplied_by_server:false,
    owner_sid_must_come_from_impersonated_pipe_token:true,
    authority_effect:false,
  });
}
async function redeemGuardianEnrollmentTicket(body:any){
  const ticket=String(body?.ticket||'');
  const fingerprint=String(body?.key_fingerprint_sha256||'').trim().toLowerCase();
  const ownerSidSha256=String(body?.owner_sid_sha256||'').trim().toLowerCase();
  if(!/^[A-Za-z0-9_-]{43}$/.test(ticket)
      || !/^[0-9a-f]{64}$/.test(fingerprint)
      || !/^[0-9a-f]{64}$/.test(ownerSidSha256)){
    return json(400,{schema:'metaengine.guardian-enrollment-ticket-redemption.v1',accepted:false,reason:'REDEMPTION_INPUT_INVALID',authority_effect:false});
  }
  const redeemed=await rpc(GUARDIAN_TICKET_CONSUME_RPC,{
    p_ticket_sha256:await sha256(ticket),
    p_key_fingerprint_sha256:fingerprint,
    p_owner_sid_sha256:ownerSidSha256,
  });
  const accepted=redeemed?.accepted===true;
  return json(accepted?200:409,{
    ...redeemed,
    plaintext_ticket_returned:false,
    owner_sid_plaintext_returned:false,
    service_role_exposed:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
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
function boundedState(value:any){const s=value&&typeof value==='object'?value:{};const tabs=Array.isArray(s.tabs)?s.tabs.slice(0,64).map((t:any)=>({tab_id:String(t?.tab_id||'').slice(0,80),url:String(t?.url||'').slice(0,1200),title:String(t?.title||'').slice(0,240),kind:String(t?.kind||'').slice(0,40),selected:t?.selected===true})):[];const row:any={schema:'metaengine.native-browser-supervisor.state.v1',client_kind:'METAENGINE_BROWSER_ELECTRON_NATIVE',shell_version:String(s.shell_version||'').slice(0,32),supervisor_mode:modeOf(s.supervisor_mode),armed:s.armed===true,operator_mode:String(s.operator_mode||'CONTROL').slice(0,32),active_tab:s.active_tab&&typeof s.active_tab==='object'?s.active_tab:null,realtime_observation_push:s.realtime_observation_push===true,last_error:String(s.last_error||'').slice(0,500)||null,started_at:s.started_at||null,heartbeat_at:new Date().toISOString()};if('tabs'in s)row.tabs=tabs;if('development_plane'in s)row.development_plane=boundedObject(s.development_plane,32768);if('compute'in s)row.compute=boundedObject(s.compute,32768);if('fleet'in s)row.fleet=boundedObject(s.fleet,65536);if('perception'in s)row.perception=boundedObject(s.perception,32768);if('supervisor_lifecycle'in s)row.supervisor_lifecycle=boundedObject(s.supervisor_lifecycle,32768);if('supervisor_mesh'in s)row.supervisor_mesh=boundedMesh(s.supervisor_mesh);if('self_update'in s)row.self_update=boundedObject(s.self_update,32768);if('host_resilience'in s)row.host_resilience=boundedObject(s.host_resilience,32768);if('realtime_process_plane'in s)row.realtime_process_plane=boundedObject(boundedRealtimeProcessPlane(s.realtime_process_plane),32768);if('control_latency'in s)row.control_latency=boundedObject(s.control_latency,32768);if('rsi'in s)row.rsi=boundedObject(s.rsi,16384);if('rsi_outcome_river'in s)row.rsi_outcome_river=boundedObject(s.rsi_outcome_river,16384);if('rsi_operator_steering'in s)row.rsi_operator_steering=boundedObject(s.rsi_operator_steering,16384);return row}
async function upsertState(req:Request,body:any,identity:any){
  const id=clientId(req);
  const s=boundedState(body?.state);
  if(s.supervisor_mesh)await rpc(MESH_SYNC_RPC,{p_client_id:id,p_mesh:s.supervisor_mesh});
  const row={
    client_id:id,
    workspace_id:WORKSPACE_ID,
    extension_version:s.shell_version||null,
    operator_runtime:'native-electron-supervisor-v1',
    supervisor_mode:s.supervisor_mode,
    armed:s.armed,
    operator_mode:s.operator_mode,
    ordering_policy:'NATIVE_TYPED_COMMAND_LANES_V1',
    last_command_id:body?.last_command_id||null,
    last_command_status:body?.last_command_status||null,
    state:{
      ...s,
      transport_identity:{
        profile:identity.profile,
        device_id:identity.device_id,
        key_fingerprint_sha256:identity.key_fingerprint_sha256,
        access_tier:identity.access_tier,
        admin_grant_epoch:identity.admin_grant_epoch,
        admin_ready:identity.admin_ready===true,
      },
    },
    authority_effect:s.supervisor_mode==='CONTROL'||s.armed===true,
  };
  const merged=await upsertStateRow(row);
  return{...row,last_seen_at:merged?.last_seen_at||new Date().toISOString()};
}
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
    if(!DB_SESSION_URL){
      await sleep(waitMs);
      const fallback=await leaseBatch(req,body);
      return{...fallback,wake_reason:'DB_POLL_SESSION_WAKE_UNAVAILABLE',transport_delivery_is_authority:false,authority_effect:false};
    }
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
  const computerAction=action==='COMPUTER_OBSERVE'||action==='COMPUTER_ACTION';
  if(computerAction){
    const declaredAgent=toolPayload.agent_id==null?agentId:String(toolPayload.agent_id).toLowerCase();
    if(declaredAgent!==agentId)return json(400,{accepted:false,error:'agent_tool_computer_agent_mismatch',authority_effect:false});
    toolPayload.agent_id=agentId;
  }
  const idem=`tool:${(await sha256(`${agentId}:${taskId}:${requestId}`)).slice(0,40)}`;
  try{
    const result=computerAction
      ? await rpc(ISSUE_COMPUTER_RPC,{p_client_id:clientId(req),p_action:action,p_payload:toolPayload,p_ttl_seconds:120,p_issued_by:`agent:${agentId}`,p_idempotency_key:idem})
      : await rpc(ISSUE_NATIVE_RPC,{p_client_id:clientId(req),p_action:action,p_platform:'CHATGPT',p_payload:toolPayload,p_ttl_seconds:120,p_issued_by:`agent:${agentId}`,p_idempotency_key:idem});
    if(!result||typeof result!=='object'||result.accepted!==true)return json(409,{accepted:false,error:'agent_tool_issue_rejected',reason:String(result?.error||result?.reason||'unknown').slice(0,160),authority_effect:false});
    return json(200,{accepted:true,command_id:result.command_id,status:result.status||'PENDING',idempotency_key:idem,replayed:result.replayed===true,issued_by:`agent:${agentId}`,rsi_task_bound:true,computer_authority:computerAction,authority_effect:false});
  }catch(error){
    return json(409,{accepted:false,error:'agent_tool_issue_failed',reason:String((error as any)?.message||error).slice(0,160),authority_effect:false});
  }
}
async function health(){const capability=await projectNativeSupervisorRuntimeCapabilityHealth({rpc:(name:any,args:any)=>name==='devos_runtime_capabilities_v1'?boundedRpc(name,args,HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS):Promise.reject(new Error('health_capability_rpc_not_allowed'))});return{ok:true,authority_effect:false,schema:'metaengine.native-browser-supervisor.health.v1',backend_transport:'POSTGREST_RPC',direct_postgres_query_plane:false,direct_postgres_diagnostics_only:true,profile:PROFILE,approval_enrollment:true,admin_device_grant_required:true,guardian_enrollment_ticket_v1:true,guardian_enrollment_ticket_single_use:true,typed_commands_only:true,arbitrary_eval:false,supervisor_mesh:true,devos_routes:true,devos_promotion_routes:true,meta_orchestrator_routes:true,command_batch_transport:true,command_wait_batch:(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN)?'REALTIME_BROADCAST_PROXY':(DB_SESSION_URL?'POSTGRES_NOTIFY_PROXY':'BOUNDED_DB_POLL'),effect_intent_sealing:true,effect_intent_binding_schemas:['v1','v2','computer-v1'],result_receipt_readback:true,result_receipt_readback_is_authority:false,result_receipt_terminal_statuses:['COMPLETED','FAILED'],agent_tool_issue:true,agent_tool_issue_allowlist:[...TOOL_ISSUE_ACTIONS].sort(),realtime_process_plane:true,realtime_process_state_projection:true,realtime_observation_push:true,cognitive_delta_route:true,cognitive_delta_acceptor_required:true,cognitive_delta_delivery_is_authority:false,emergency_wait_route:true,emergency_wait_delivery_is_authority:false,realtime_public_api_key_present:Boolean(REALTIME_API_KEY),realtime_access_token_compatible:Boolean(REALTIME_ACCESS_TOKEN),realtime_url_uses_service_role:false,postgres_notify_wake:Boolean(DB_SESSION_URL),postgres_notify_delivery_is_authority:false,command_wake_delivery_is_authority:false,realtime_observation_push_is_authority:false,...runtimeCapabilityHealthResponseFields(capability)}}
async function status(){const {states,commands}=await statusRows();return{schema:'metaengine.native-browser-supervisor.status.v1',workspace_id:WORKSPACE_ID,backend_transport:'POSTGREST_RPC',direct_postgres_query_plane:false,direct_postgres_diagnostics_only:true,device_auth_required:true,admin_device_grant_required:true,approval_enrollment:true,typed_commands_only:true,arbitrary_eval:false,supervisor_mesh:true,devos_routes:true,devos_promotion_routes:true,meta_orchestrator_routes:true,command_batch_transport:true,command_wait_batch:(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN)?'REALTIME_BROADCAST_PROXY':(DB_SESSION_URL?'POSTGRES_NOTIFY_PROXY':'BOUNDED_DB_POLL'),effect_intent_sealing:true,effect_intent_binding_schemas:['v1','v2','computer-v1'],result_receipt_readback:true,result_receipt_readback_is_authority:false,result_receipt_terminal_statuses:['COMPLETED','FAILED'],agent_tool_issue:true,agent_tool_issue_allowlist:[...TOOL_ISSUE_ACTIONS].sort(),realtime_process_plane:true,realtime_observation_push:true,cognitive_delta_route:true,cognitive_delta_acceptor_required:true,cognitive_delta_delivery_is_authority:false,realtime_public_api_key_present:Boolean(REALTIME_API_KEY),realtime_url_uses_service_role:false,postgres_notify_wake:Boolean(DB_SESSION_URL),postgres_notify_delivery_is_authority:false,states,commands}}
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

function routedServicePath(pathname:string){
  let raw=String(pathname||'');
  const hostedPrefix='/functions/v1/';
  if(raw.startsWith(hostedPrefix))raw=raw.slice(hostedPrefix.length-1);
  const firstSlash=raw.indexOf('/',1);
  const mount=firstSlash>0?raw.slice(1,firstSlash):raw.slice(1);
  const deployedMount=/^a2-browser-native-supervisor-v[0-9]+(?:-[a-z0-9][a-z0-9-]{0,63})?$/;
  if(deployedMount.test(mount))return firstSlash>0?(raw.slice(firstSlash)||'/'):'/';
  if(raw===SERVICE_MARKER)return'/';
  if(raw.startsWith(`${SERVICE_MARKER}/`))return raw.slice(SERVICE_MARKER.length)||'/';
  return raw;
}

Deno.serve(localRuntime.serverOptions,async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  const path=routedServicePath(url.pathname);
  if (
    (url.pathname.includes('/health') && path!=='/health')
    || (url.pathname.includes('/v1/device/enrollment/request') && path!=='/v1/device/enrollment/request')
  ) {
    console.warn('native_supervisor_route_mismatch',JSON.stringify({method:req.method,pathname:url.pathname,routed_path:path}));
  }
  try{
    if(req.method==='GET'&&path==='/health')return json(200,{...await health(),...(localRuntime.local?{backend_transport:'LOCAL_POSTGRES_RPC',state_provider:'LOCAL_POSTGRES',instance_id:localRuntime.instanceId,hosted_supabase_required:false}: {})});
    const bodyText=req.method==='GET'?'':await req.text();
    const body=parseJson(bodyText);
    if(body===null)return json(400,{error:'invalid_json'});
    if(req.method==='POST'&&path==='/v1/device/enrollment/request')return enrollmentRequest(req,bodyText,body);
    if(req.method==='POST'&&path==='/v1/device/enrollment/status')return enrollmentStatus(req,bodyText,body);
    // Guardian LocalSystem has no Browser private key. This one route is protected
    // by the 256-bit, <=120s, single-use ticket whose digest is stored server-side.
    // The consume RPC revalidates the exact ADMIN grant before atomically burning it.
    if(req.method==='POST'&&path==='/v1/guardian/enrollment/redeem')return redeemGuardianEnrollmentTicket(body);
    const canonicalPath=`${SERVICE_MARKER}${path}`;
    const identity=await authenticateDevice(req,canonicalPath,bodyText);
    if(identity.ok!==true)return json(401,{error:'device_auth_required',reason:identity.reason});
    if(req.method==='GET'&&path==='/v1/admin/status')return json(200,await adminStatus(identity));
    if(req.method==='POST'&&path==='/v1/device/guardian-enrollment/ticket')return issueGuardianEnrollmentTicket(identity);
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
    if(req.method==='GET'&&path==='/v1/status')return json(200,{...await status(),...(localRuntime.local?{backend_transport:'LOCAL_POSTGRES_RPC',state_provider:'LOCAL_POSTGRES',instance_id:localRuntime.instanceId,hosted_supabase_required:false}: {})});
    return json(404,{error:'not_found'});
  }catch(e){
    console.error('native_supervisor_request_failure',String((e as any)?.message||e));
    return json(502,{error:'native_supervisor_failure',backend_transport:localRuntime.local?'LOCAL_POSTGRES_RPC':'POSTGREST_RPC'});
  }
});
