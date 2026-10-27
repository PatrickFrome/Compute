// Private owned-Host backend only. This is NOT a native Guardian admission
// receipt: installed-code authentication of a native broker is still missing.
import {createHash,createPublicKey,verify} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {readNativeCodingWindowsProcess} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {nativeCodingDeviceKeyFingerprint} from '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';

const SCHEMA='metaengine.private.guardian-owner-consume.v1';
const SIGNING_PATH='/private/guardian/owner-ticket/consume';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const TICKETS='public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22';
const DEVICES='public.compute_fabric_a2_browser_device_h205f22';
const HEADERS=['content-type','x-a2-chat-bridge-client','x-a2-device-profile','x-a2-device-id',
  'x-a2-device-timestamp','x-a2-device-nonce','x-a2-device-body-sha256','x-a2-device-signature'];
const BODY=['schema','request_id','host_instance_id','host_pid','parent_pid','launch_nonce','challenge_sha256',
  'ticket','ticket_sha256','owner_sid_sha256','key_fingerprint_sha256','admin_grant_epoch'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=reason=>{const code='guardian_owner_consume_'+reason;throw Object.assign(Error(code),{code});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function requestShape(request,binding){
  if(!exact(request,['body','headers'])||!exact(request.body,BODY)||!exact(request.headers,HEADERS))fail('request_invalid');
  const {body:b,headers:h}=request;
  if(b.schema!==SCHEMA||!UUID.test(b.request_id)||!UUID.test(b.host_instance_id)||!UUID.test(b.launch_nonce)
    ||b.host_instance_id!==binding.host_instance_id||b.host_pid!==binding.host_pid||b.parent_pid!==binding.parent_pid
    ||b.launch_nonce!==binding.launch_nonce||!SHA.test(b.challenge_sha256)||!SHA.test(b.owner_sid_sha256)
    ||!SHA.test(b.key_fingerprint_sha256)||!SHA.test(b.ticket_sha256)||!/^[-_a-zA-Z0-9]{43}$/.test(b.ticket)
    ||hash(b.ticket)!==b.ticket_sha256||!Number.isSafeInteger(b.admin_grant_epoch)||b.admin_grant_epoch<1
    ||Object.values(h).some(v=>typeof v!=='string'||v.length>256)||h['content-type']!=='application/json'
    ||h['x-a2-device-profile']!=='A2_DEVICE_HTTP_SIGNATURE_V1'||!UUID.test(h['x-a2-device-id'])
    ||!UUID.test(h['x-a2-chat-bridge-client'])||!/^[-_a-zA-Z0-9]{32,96}$/.test(h['x-a2-device-nonce'])
    ||!/^[-_a-zA-Z0-9]{86}$/.test(h['x-a2-device-signature'])||h['x-a2-device-body-sha256']!==hash(json(b)))fail('request_binding_invalid');
  return structuredClone(request);
}
function fresh(headers){
  const timestamp=Date.parse(headers['x-a2-device-timestamp']);
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString()===headers['x-a2-device-timestamp']
    &&timestamp<=Date.now()+5000&&Date.now()-timestamp<=30000;
}

// Pure deny-only admission before any lazy native/config/SQL acquisition.
export function validateGuardianOwnerConsumeEnvelope(request,binding){
  const checked=requestShape(request,binding);
  if(!fresh(checked.headers))fail('timestamp_invalid');
  return checked;
}

function boundedGuardianWait(promise,milliseconds=6000){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(
    Object.assign(Error('guardian_owner_consume_cleanup_unconfirmed'),{code:'guardian_owner_consume_cleanup_unconfirmed'})),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}

// Unexported transaction engine. Only the production acquisition below can
// supply its reserved state_owner connection/current OS+PG custody checker.
// Test-only loader access is deliberately outside the shipped source closure.
function createGuardianConsumeTransaction({sql,binding,verifyCustody}){
  let closed=false,active=null;const requests=new Set(),nonces=new Set();
  const check=async()=>{if(closed)fail('closed');const value=await verifyCustody(sql);if(closed)fail('closed');return value;};
  const result=(state,body,extra={})=>Object.freeze({schema:'metaengine.private.guardian-owner-consume-result.v1',
    state,request_id:body.request_id,host_instance_id:binding.host_instance_id,host_pid:binding.host_pid,
    parent_pid:binding.parent_pid,launch_nonce:binding.launch_nonce,challenge_sha256:body.challenge_sha256,
    ticket_sha256:body.ticket_sha256,guardian_ready:false,native_bridge_authenticated:false,
    automatic_retry_allowed:false,authority_effect:false,...extra});
  async function run({body:b,headers:h}){
    let began=false,consumeAttempted=false,commitAttempted=false;
    try{
      const custody=await check();
      if(!fresh(h)||custody.owner_sid_sha256!==b.owner_sid_sha256)fail('owner_or_freshness_changed');
      began=true;await sql.unsafe('BEGIN');
      await sql.unsafe("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'");
      // Lock in the same order as the existing consume function (ticket then
      // device). Never choose another pending ticket or reinterpret a key.
      const tickets=await sql.unsafe(`select *,expires_at>clock_timestamp() as fresh from ${TICKETS}
        where ticket_sha256=$1::text for update`,[b.ticket_sha256]);
      const ticket=tickets[0];
      if(tickets.length!==1||ticket.consumed_at||ticket.fresh!==true||ticket.authority_effect!==false
        ||ticket.device_id!==h['x-a2-device-id']||ticket.client_id!==h['x-a2-chat-bridge-client']
        ||ticket.key_fingerprint_sha256!==b.key_fingerprint_sha256||Number(ticket.admin_grant_epoch)!==b.admin_grant_epoch)fail('ticket_unavailable');
      const devices=await sql.unsafe(`select d.*,(current_user='state_owner' and session_user='state_owner'
        and d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
        and d.admin_scopes @> '["CONTROL_PLANE"]'::jsonb
        and exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p
          where p.token_hash=d.enrollment_pairing_token_hash and p.active)) as admitted
        from ${DEVICES} d where device_id=$1::uuid and client_id=$2::text for share`,[ticket.device_id,ticket.client_id]);
      const device=devices[0];
      if(devices.length!==1||device.admitted!==true||device.profile!=='A2_DEVICE_HTTP_SIGNATURE_V1'
        ||device.key_fingerprint_sha256!==b.key_fingerprint_sha256||Number(device.admin_grant_epoch)!==b.admin_grant_epoch
        ||device.public_jwk?.d!==undefined)fail('device_unavailable');
      const pairings=await sql.unsafe(`select token_hash,active from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
        where token_hash=$1::text for share`,[device.enrollment_pairing_token_hash]);
      if(pairings.length!==1||pairings[0].active!==true)fail('pairing_unavailable');
      const key=createPublicKey({key:device.public_jwk,format:'jwk'});
      if(nativeCodingDeviceKeyFingerprint(key)!==b.key_fingerprint_sha256)fail('key_changed');
      const material=['A2_DEVICE_HTTP_SIGNATURE_V1',`device_id:${device.device_id}`,'method:POST',`path:${SIGNING_PATH}`,
        `timestamp:${h['x-a2-device-timestamp']}`,`nonce:${h['x-a2-device-nonce']}`,`body_sha256:${h['x-a2-device-body-sha256']}`].join('\n');
      if(!verify('sha256',Buffer.from(material),{key,dsaEncoding:'ieee-p1363'},Buffer.from(h['x-a2-device-signature'],'base64url')))fail('signature_invalid');
      const nonce=hash(device.device_id+'\n'+h['x-a2-device-nonce']);
      if(nonces.has(nonce)||nonces.size>=512)fail('nonce_reused');nonces.add(nonce);
      if((await check()).owner_sid_sha256!==b.owner_sid_sha256||!fresh(h))fail('custody_changed');
      consumeAttempted=true;
      const [row]=await sql.unsafe('select public.client_v1_guardian_enrollment_ticket_consume_v1($1::text,$2::text,$3::text) as value',
        [b.ticket_sha256,b.key_fingerprint_sha256,b.owner_sid_sha256]);
      const receipt=row?.value;
      if(receipt?.schema!=='metaengine.guardian-enrollment-ticket-redemption.v1'||receipt.accepted!==true
        ||receipt.ticket_id!==ticket.ticket_id||receipt.device_id!==device.device_id||receipt.client_id!==device.client_id
        ||receipt.key_fingerprint_sha256!==b.key_fingerprint_sha256||Number(receipt.admin_grant_epoch)!==b.admin_grant_epoch
        ||receipt.consumer_owner_sid_sha256!==b.owner_sid_sha256||receipt.single_use!==true||receipt.device_grant_revalidated!==true
        ||receipt.automatic_retry_allowed!==false||receipt.authority_effect!==false||!Number.isFinite(Date.parse(receipt.consumed_at)))fail('consume_unconfirmed');
      const [readback]=await sql.unsafe(`select consumer_owner_sid_sha256,consumed_at from ${TICKETS} where ticket_id=$1::uuid`,[ticket.ticket_id]);
      if(readback?.consumer_owner_sid_sha256!==b.owner_sid_sha256||new Date(readback.consumed_at).getTime()!==Date.parse(receipt.consumed_at))fail('readback_unconfirmed');
      if((await check()).owner_sid_sha256!==b.owner_sid_sha256||!fresh(h))fail('custody_changed');
      commitAttempted=true;await sql.unsafe('COMMIT');began=false;
      // A post-commit custody/transport failure is UNKNOWN, never safe to retry.
      if((await check()).owner_sid_sha256!==b.owner_sid_sha256||!fresh(h))fail('custody_changed');
      const [current]=await sql.unsafe(`select public_jwk,profile,(active and revoked_at is null and access_tier='ADMIN'
        and admin_revoked_at is null and admin_scopes @> '["CONTROL_PLANE"]'::jsonb
        and admin_grant_epoch=$4::bigint and exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p
          where p.token_hash=${DEVICES}.enrollment_pairing_token_hash and p.active)) as admitted from ${DEVICES}
        where device_id=$1::uuid and client_id=$2::text and key_fingerprint_sha256=$3::text`,
        [device.device_id,device.client_id,b.key_fingerprint_sha256,b.admin_grant_epoch]);
      if(closed||!fresh(h)||current?.admitted!==true||current.profile!==device.profile
        ||json(current.public_jwk)!==json(device.public_jwk))fail('device_changed_after_commit');
      return result('DB_TICKET_CONSUMED',b,{ticket_id:ticket.ticket_id,device_id:device.device_id,client_id:device.client_id,
        key_fingerprint_sha256:b.key_fingerprint_sha256,admin_grant_epoch:b.admin_grant_epoch,
        owner_sid_sha256:b.owner_sid_sha256,consumed_at:receipt.consumed_at});
    }catch{
      if(commitAttempted){closed=true;return result('UNKNOWN',b);}
      if(began)try{await sql.unsafe('ROLLBACK');}catch{closed=true;return result('UNKNOWN',b);}
      if(consumeAttempted){closed=true;return result('UNKNOWN',b);}
      return result('REJECTED',b);
    }
  }
  return Object.freeze({
    consume(request){
      let checked;try{checked=requestShape(request,binding);}catch{return Promise.reject(Error('guardian_owner_consume_request_invalid'));}
      const b=checked.body;
      // A duplicated correlation ID may already have an in-flight/committed
      // effect. Never answer REJECTED as if that earlier dispatch did not run.
      if(requests.has(b.request_id))return Promise.resolve(result('UNKNOWN',b));
      if(closed||active||requests.size>=512)return Promise.resolve(result('REJECTED',b));
      requests.add(b.request_id);active=run(checked).finally(()=>{active=null;});return active;
    },
    close(){closed=true;return active||Promise.resolve();},
  });
}

async function verifyGuardianOwnerDatabase(connection,{identity,systemIdentifier,port,directory,prior}){
  const rows=await connection.unsafe(`select current_user as login,session_user as session_login,current_database() as database,
    current_setting('server_version_num')::int as version,current_setting('data_directory') as directory,
    host(inet_server_addr()) as address,inet_server_port() as port,pg_backend_pid() as backend_pid,
    pg_postmaster_start_time()::text as started_at,system_identifier::text from pg_control_system()`);
  const row=rows[0];
  if(rows.length!==1||row.login!=='state_owner'||row.session_login!=='state_owner'||row.database!=='postgres'
    ||row.address!=='127.0.0.1'||row.port!==Number(port)||row.version<170000||row.version>=180000
    ||row.system_identifier!==systemIdentifier||!Number.isSafeInteger(row.backend_pid)
    ||prior&&row.backend_pid!==prior.backend_pid||Date.parse(row.started_at)!==Date.parse(identity.started_at)
    ||!samePath(await fs.realpath(row.directory),directory))fail('postgres_changed');
  const proof=await runtimeRecoveryPostgresProof({identity:{...identity,...row,data_directory:row.directory},
    pgDataDirectory:directory,expectedClusterSystemIdentifier:systemIdentifier});
  const current={backend_pid:row.backend_pid,started_at:row.started_at,proof_sha256:proof.sha256};
  if(prior&&json(prior)!==json(current))fail('postgres_changed');
  return current;
}

async function protectedPath(target,kind){
  if(typeof target!=='string'||!path.isAbsolute(target)||/^(?:\\\\|\/\/)/.test(target)||/[\x00-\x1f]/.test(target))fail('path_invalid');
  let current=path.parse(target).root;
  for(const segment of path.relative(current,target).split(path.sep).filter(Boolean)){
    current=path.join(current,segment);if((await fs.lstat(current)).isSymbolicLink())fail('path_alias');
  }
  const before=await fs.lstat(target);
  if(kind==='file'?!before.isFile()||before.nlink!==1||before.size>16384:!before.isDirectory())fail('path_invalid');
  const actual=await fs.realpath(target);
  if((await verifyOwnerOnlyWindowsStorage(actual,{operation:kind==='file'?'VERIFY_PRIVATE_FILE':'VERIFY_DIRECTORY'}))?.owner_dacl_verified!==true)fail('storage_unproven');
  const after=await fs.lstat(target);
  if(before.dev!==after.dev||before.ino!==after.ino||kind==='file'&&(before.size!==after.size||before.mtimeMs!==after.mtimeMs))fail('storage_changed');
  return {path:actual,dev:after.dev,ino:after.ino};
}

// Called only by the verified owned runtime Host. No SQL/DSN/storage/SID/
// verifier override is accepted. Private config is taken from its real launch
// environment; normal runtime launch has already verified its source closure.
// Unsupported/attached/legacy profiles receive no capability, not new grants.
export async function createOwnedGuardianTicketConsumer(options){
  if(!exact(options,['runtime','config','signal']))fail('private_dependencies_invalid');
  const {runtime,config,signal}=options;
  if(process.platform!=='win32'||!process.send||!process.connected||!(signal instanceof AbortSignal)||signal.aborted
    ||config?.postgres_mode!=='owned'||!/^\d{16,20}$/.test(config.expected_cluster_system_identifier||'')
    ||!UUID.test(runtime?.instanceId||'')||runtime.stopped!==false)fail('owned_host_required');
  const configFile=process.env.COMPUTE_RUNTIME_HOST_CONFIG,launchNonce=process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE;
  if(!UUID.test(launchNonce||''))fail('generation_required');
  const postgresIdentity=structuredClone(runtime.postgresIdentity);
  const binding=Object.freeze({host_instance_id:runtime.instanceId,host_pid:process.pid,parent_pid:process.ppid,launch_nonce:launchNonce});
  let closed=false,pool,sql,transaction,drainPromise,storagePin,processPin,databasePin;
  const close=()=>{
    closed=true;const pending=transaction?.close();
    if(!drainPromise){
      // Arm pool termination NOW, not after the potentially stuck query.
      // A suspended/unresponsive PG cannot indefinitely block Owner-stop.
      const releasing=Promise.resolve(pending).finally(()=>sql?.release());
      const ending=pool?.end({timeout:5});
      drainPromise=boundedGuardianWait(Promise.all([releasing,ending]));
    }
    return drainPromise;
  };
  const abort=()=>{closed=true;void transaction?.close();};
  const live=()=>{if(closed||signal.aborted||runtime.stopped!==false||runtime.instanceId!==binding.host_instance_id
    ||json(runtime.postgresIdentity)!==json(postgresIdentity)||process.env.COMPUTE_RUNTIME_HOST_CONFIG!==configFile
    ||!process.connected||process.pid!==binding.host_pid
    ||process.ppid!==binding.parent_pid||process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE!==launchNonce)fail('host_changed');};
  const inspect=new URL(config.inspect_database_url),api=new URL(config.database_url);
  if(!['postgres:','postgresql:'].includes(inspect.protocol)||inspect.hostname!=='127.0.0.1'
    ||inspect.hostname!==api.hostname||inspect.port!==api.port||inspect.search||inspect.hash
    ||inspect.username!=='state_owner'||inspect.pathname!=='/postgres'
    ||api.pathname!=='/postgres')fail('database_unadmitted');
  signal?.addEventListener('abort',abort,{once:true});
  async function custody(connection){
    live();
    const paths=await Promise.all([[configFile,'file'],[path.dirname(configFile),'directory'],[config.state_directory,'directory'],[config.pg_data_directory,'directory']]
      .map(([target,kind])=>protectedPath(target,kind)));
    const file=await fs.open(configFile,'r');let bytes;
    try{
      const st=await file.stat();if(st.dev!==paths[0].dev||st.ino!==paths[0].ino||st.size>16384)fail('config_changed');
      bytes=await file.readFile();const after=await file.stat(),named=await fs.lstat(configFile);
      if(bytes.length>16384||st.size!==after.size||st.mtimeMs!==after.mtimeMs||named.isSymbolicLink()
        ||named.dev!==st.dev||named.ino!==st.ino||named.nlink!==1)fail('config_changed');
    }finally{await file.close();}
    const stored=JSON.parse(bytes);
    for(const key of ['schema','version','postgres_mode','expected_cluster_system_identifier','expected_bundle_sha256',
      'database_url','inspect_database_url','state_directory','pg_data_directory'])if(stored[key]!==config[key])fail('config_changed');
    const storage=json({paths,sha256:hash(bytes)});if(storagePin&&storagePin!==storage)fail('storage_changed');storagePin=storage;
    const processes=await Promise.all([binding.host_pid,binding.parent_pid].map(pid=>readNativeCodingWindowsProcess(pid)));
    if(processes[0].user_sid!==processes[1].user_sid)fail('owner_changed');
    const processProof=json(processes);if(processPin&&processPin!==processProof)fail('process_changed');processPin=processProof;
    if(!connection){live();return {owner_sid_sha256:hash(processes[0].user_sid)};}
    databasePin=await verifyGuardianOwnerDatabase(connection,{identity:postgresIdentity,
      systemIdentifier:config.expected_cluster_system_identifier,port:Number(inspect.port),directory:paths[3].path,prior:databasePin});
    live();return {owner_sid_sha256:hash(processes[0].user_sid)};
  }
  try{
    await custody(null);live();
    const {default:postgres}=await import('postgres');live();
    pool=postgres(config.inspect_database_url,{max:1,connect_timeout:5,idle_timeout:0,prepare:false,onnotice:()=>{},debug:false,
      connection:{statement_timeout:15000,lock_timeout:3000}});
    sql=await pool.reserve();live();await custody(sql);live();
    transaction=createGuardianConsumeTransaction({sql,binding,verifyCustody:custody});
    return Object.freeze({
      // Exact private parent channel only; no renderer route or HTTP endpoint.
      async handleMessage(message,handle){
        if(message?.body?.schema!==SCHEMA)return false;
        if(handle){try{handle.destroy?.();}catch{}return true;}
        let receipt,timer;
        try{
          live();validateGuardianOwnerConsumeEnvelope(message,binding);
          const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
            void close().catch(()=>{});reject(Error('guardian_owner_consume_deadline'));
          },30000);});
          receipt=await Promise.race([transaction.consume(message),deadline]);live();
        }catch{return true;}finally{clearTimeout(timer);}
        // No resend or claim of delivery on callback loss. The DB may already
        // have consumed; a future authenticated native bridge must hold.
        try{live();process.send(receipt,()=>{});}catch{}
        return true;
      },
      close(){signal?.removeEventListener('abort',abort);return close();},
    });
  }catch{
    signal?.removeEventListener('abort',abort);
    try{await close();}catch{fail('cleanup_unconfirmed');}
    fail('capability_unavailable');
  }
}
