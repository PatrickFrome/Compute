import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyOfflineRuntimeBundle} from './offline-runtime-bundle.mjs';
import {confirmFreshProviderNativeConsent} from './fresh-provider-native-consent.mjs';
import {inspectClientFirstRun} from './first-run-preflight.mjs';
import {initializeFreshClientPg17} from './fresh-pg17-initdb.mjs';
import {startOwnedWindowsPostgres} from './owned-postgres-process.mjs';
import {loadFreshSchemaApplicationPlan,verifyFreshSchemaCatalogue} from './fresh-schema-application-plan.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {provisionLocalApiLogin} from './db-api-grants.mjs';
import {inspectAttachedApiAdmission,secureAttachedPrivateFile} from './attached-postgres-onboarding.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {startConfiguredLocalRuntimeHost,stopOwnedLocalRuntimeHost} from '../../apps/metaengine-browser/src/local-runtime-host-controller.mjs';
import {localStateProviderOwnerFile,validateLocalStateRuntimeIdentity,localStateProviderHealthAttested} from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';
import {provisionPersistentClientProvider} from './persistent-client-provider.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import {canonicalLocalStateSupervisorBase} from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

export const FRESH_CLIENT_INSTALL_ACTION='INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT';
const exec=promisify(execFile), SHA=/^[a-f0-9]{64}$/;
const fail=reason=>{throw Error('fresh_provider_'+reason);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const absolute=p=>typeof p==='string'&&path.isAbsolute(p)&&! /^(?:\\\\|\/\/)/.test(p)&&!/[\x00-\x1f]/.test(p);

// Selection is fixed to the current OS user's two application-data roots. No
// renderer-selected directory, SQL endpoint, login or statement is accepted.
export function freshClientLayout({localAppData,appData,bundleDirectory,expectedBundleDigest,ownerAction}={}) {
  if(ownerAction!==FRESH_CLIENT_INSTALL_ACTION)fail('owner_consent_required');
  if(![localAppData,appData,bundleDirectory].every(absolute)||!SHA.test(expectedBundleDigest||''))fail('arguments_invalid');
  const root=path.join(localAppData,'METAENGINE','client-first-run-v1');
  const state=path.join(root,'runtime');
  return Object.freeze({root,stateDirectory:state,pgDataDirectory:path.join(state,'pg17'),
    runtimeConfigFile:path.join(state,'host-config.json'),passwordFile:path.join(root,'initdb-password'),
    journalFile:path.join(root,'install-journal.json'),ownerFile:localStateProviderOwnerFile({env:{APPDATA:appData},platform:'win32'}),
    bundleDirectory,expectedBundleDigest,appDataDirectory:appData});
}
async function noAliases(target) {
  let current=path.parse(path.resolve(target)).root;
  for(const segment of path.relative(current,path.resolve(target)).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);let st;
    try{st=await fs.lstat(current);}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(st.isSymbolicLink()||!st.isDirectory())fail('private_ancestor_invalid');
  }
}
async function absent(file) {try{await fs.lstat(file);fail('existing_state_requires_review');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function privateFile(file,bytes) {
  const handle=await fs.open(file,'wx',0o600);
  try {await secureAttachedPrivateFile(file);await verifyOwnerOnlyWindowsStorage(file,{operation:'VERIFY_PRIVATE_FILE'});
    await handle.writeFile(bytes);await handle.sync();
  }finally{await handle.close();}
}
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));return port;
}
function cleanEnvironment() {
  return Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','USERPROFILE','TEMP','TMP','APPDATA','LOCALAPPDATA','PATH','Path','HOMEDRIVE','HOMEPATH']
    .filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
}
const databaseUrl=(port,login,password)=>{
  const value=new URL('postgres://127.0.0.1/postgres');
  value.port=String(port);value.username=login;value.password=password;
  return value.href;
};
const IDENTITY_SQL=`select current_user as login,session_user as session_login,current_database() as database,
 current_setting('data_directory') as directory,system_identifier::text as system_identifier,
 pg_backend_pid() as backend_pid,extract(epoch from pg_postmaster_start_time()) as started_at,
 current_setting('server_version_num')::integer as version from pg_control_system()`;
export function verifyFreshConnectionIdentity(actual,expected) {
  if(actual?.login!=='state_owner'||actual.session_login!=='state_owner'||actual.database!=='postgres'
    ||!absolute(actual.directory)||!same(actual.directory,expected.directory)
    ||String(actual.system_identifier)!==expected.systemIdentifier
    ||Number(actual.version)<170000||Number(actual.version)>=180000
    ||Math.floor(Number(actual.started_at))!==Number(expected.postmasterStartIdentity)
    ||!Number.isSafeInteger(actual.backend_pid)||actual.backend_pid<=0
    ||(expected.backendPid!==undefined&&actual.backend_pid!==expected.backendPid))fail('connection_identity_unconfirmed');
}

// No independent nested transaction: existing migrations and API role helper
// both receive the same reserved transaction, so rollback covers ALL DDL/grants.
async function populateFreshClientSchema({connection,plan,verifyIdentity,apiPassword}={}) {
  if(typeof connection?.unsafe!=='function'||typeof verifyIdentity!=='function'||!SHA.test(apiPassword||'')
    ||plan?.schema!=='compute.fresh-schema-application-plan.v1')fail('population_contract_invalid');
  await connection.unsafe('BEGIN');
  let committed=false;
  try {
    await connection.unsafe("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='120s'");
    await connection.unsafe("SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0; SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_transaction_sample_rate=0");
    await verifyIdentity(connection);
    const [transaction]=await connection.unsafe('select txid_current()::text as id');
    await connection.unsafe("SELECT pg_advisory_xact_lock(hashtextextended(current_database()||':compute.fresh-provider.v1',0))");
    const existing=await connection.unsafe(`select 1 from pg_namespace n where n.nspname in ('destruktion_meta','extensions')
      union all select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      union all select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      union all select 1 from pg_roles where rolname in ('anon','authenticated','service_role','local_state_api')`);
    if(existing.length)fail('application_not_empty');
    await connection.unsafe(plan.prerequisite_sql);
    for(const row of plan.statements)await connection.unsafe(row.sql);
    const tx={unsafe:connection.unsafe.bind(connection),begin:fn=>fn(connection)};
    const upgrades=await applyLocalRuntimeMigrations({sql:tx,expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
    if(upgrades.source_manifest_sha256!==plan.upgrade_sources_sha256)fail('upgrade_readback_unconfirmed');
    await connection.unsafe(plan.post_upgrade_acl_sql);
    await verifyFreshSchemaCatalogue({sql:connection,plan});
    await provisionLocalApiLogin({sql:tx,databaseName:'postgres',login:'local_state_api',password:apiPassword,roleMode:'direct'});
    await verifyIdentity(connection);
    const [last]=await connection.unsafe('select txid_current()::text as id');
    if(last.id!==transaction.id)fail('transaction_changed');
    await connection.unsafe('COMMIT');committed=true;
    return Object.freeze({schema:'compute.fresh-schema-population.v1',schema_provisioned:true,
      source_manifest_sha256:plan.source_manifest_sha256,owner_profile_written:false,device_enrolled:false,runtime_ready:false});
  }catch {if(!committed)try{await connection.unsafe('ROLLBACK');}catch{fail('transaction_outcome_unknown');}fail('population_unconfirmed');}
}

const DEVICE_PROFILE='A2_DEVICE_HTTP_SIGNATURE_V1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENROLLMENT_TABLE='public.compute_fabric_a2_browser_device_enrollment_request_h205f22';
const DEVICE_TABLE='public.compute_fabric_a2_browser_device_h205f22';
const canonicalJwk=jwk=>({crv:jwk?.crv,ext:true,key_ops:['verify'],kty:jwk?.kty,x:jwk?.x,y:jwk?.y});
const exactPublicJwk=jwk=>jwk&&Object.keys(jwk).sort().join(',')==='crv,ext,key_ops,kty,x,y'
  &&jwk.ext===true&&JSON.stringify(jwk.key_ops)==='["verify"]';
const publicKeyEqual=(a,b)=>exactPublicJwk(a)&&exactPublicJwk(b)
  &&JSON.stringify(canonicalJwk(a))===JSON.stringify(canonicalJwk(b));
function freshDeviceSnapshot(identity) {
  const state=identity?.snapshot();
  const jwk=canonicalJwk(state?.public_jwk);
  if(!UUID.test(state?.client_id||'')||state.profile!==DEVICE_PROFILE||jwk.kty!=='EC'||jwk.crv!=='P-256'
    ||! /^[A-Za-z0-9_-]{43}$/.test(jwk.x||'')||! /^[A-Za-z0-9_-]{43}$/.test(jwk.y||'')
    ||!exactPublicJwk(state.public_jwk)||createHash('sha256').update(JSON.stringify(jwk)).digest('hex')!==state.key_fingerprint_sha256)fail('device_identity_unconfirmed');
  return state;
}
function unchangedDevice(identity,expected) {
  const state=freshDeviceSnapshot(identity);
  if(state.client_id!==expected.client_id||state.key_fingerprint_sha256!==expected.key_fingerprint_sha256
    ||!publicKeyEqual(state.public_jwk,expected.public_jwk))fail('device_identity_changed');
  return state;
}
async function boundedDeviceResponse(response) {
  const reader=response.body?.getReader();if(!reader)fail('device_response_unconfirmed');
  const chunks=[];let length=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;
    if(length>16384)fail('device_response_too_large');chunks.push(Buffer.from(value));}}
  finally{try{await reader.cancel();}catch{}}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('device_response_unconfirmed');}
}

// PRIVATE composition, not an RPC or injectable production SQL capability.
// Only the owning fresh-install operator below supplies this reserved connection,
// the real protected Browser identity and its own cluster/instance verifier.
// Test-only loader access never ships in the runtime resource graph.
async function enrollFreshLocalDeviceOwner({connection,deviceIdentity,baseUrl,verifyIdentity,verifyRuntime,record,fetchImpl=fetch}) {
  if(canonicalLocalStateSupervisorBase(baseUrl)!==baseUrl)fail('device_endpoint_unconfirmed');
  const initial=freshDeviceSnapshot(deviceIdentity);
  if(initial.device_id||initial.enrollment_request_id)fail('existing_device_binding_requires_review');
  const binding={client_id:initial.client_id,profile:DEVICE_PROFILE,public_jwk:canonicalJwk(initial.public_jwk),
    key_fingerprint_sha256:initial.key_fingerprint_sha256};
  const payload={profile:DEVICE_PROFILE,public_jwk:binding.public_jwk,key_fingerprint_sha256:binding.key_fingerprint_sha256};
  const send=async(route,body)=>{
    unchangedDevice(deviceIdentity,initial);await verifyIdentity(connection);await verifyRuntime();
    const bodyText=JSON.stringify(body),headers=await deviceIdentity.enrollmentHeaders(bodyText);
    const response=await fetchImpl(baseUrl+route,{method:'POST',headers,body:bodyText,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
    return {status:response.status,body:await boundedDeviceResponse(response)};
  };
  const requestRow=async(lock=false)=>{
    const rows=await connection.unsafe(`select *,requested_at::text as requested_at_db,expires_at::text as expires_at_db,
      extract(epoch from requested_at)*1000 as requested_ms,
      extract(epoch from expires_at)*1000 as expires_ms from ${ENROLLMENT_TABLE} where request_id=$1::uuid${lock?' for update':''}`,[binding.request_id]);
    if(rows.length!==1)fail('device_request_unconfirmed');
    const row=rows[0];
    if(row.client_id!==binding.client_id||row.profile!==binding.profile||row.key_fingerprint_sha256!==binding.key_fingerprint_sha256
      ||!publicKeyEqual(row.public_jwk,binding.public_jwk)||row.public_jwk?.d!==undefined||row.authority_effect!==false
      ||Math.trunc(Number(row.expires_ms))!==Date.parse(binding.expires_at)||Math.trunc(Number(row.requested_ms))!==Date.parse(binding.requested_at)
      ||binding.expires_at_db&&row.expires_at_db!==binding.expires_at_db
      ||binding.requested_at_db&&row.requested_at_db!==binding.requested_at_db)fail('device_request_binding_mismatch');
    return row;
  };
  let commitAttempted=false,committed=false;
  try {
    await connection.unsafe('BEGIN');
    await connection.unsafe("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'");
    await verifyIdentity(connection);await verifyRuntime();
    await connection.unsafe("SELECT pg_advisory_xact_lock(hashtextextended(current_database()||':compute.fresh-first-device.v1',0))");
    const existing=await connection.unsafe(`select 1 from ${DEVICE_TABLE} union all select 1 from ${ENROLLMENT_TABLE} limit 1`);
    if(existing.length)fail('existing_device_records_require_review');
    const started=Date.now();await record('DEVICE_REQUEST_OUTCOME_PENDING',binding);
    const pending=await send('/v1/device/enrollment/request',payload);
    if(pending.status!==202||pending.body?.accepted!==true||pending.body.status!=='PENDING'
      ||pending.body.reason!=='APPROVAL_REQUIRED'||pending.body.authority_effect!==false
      ||!UUID.test(pending.body.request_id||'')||pending.body.key_fingerprint_sha256!==binding.key_fingerprint_sha256
      ||!Number.isFinite(Date.parse(pending.body.requested_at))||!Number.isFinite(Date.parse(pending.body.expires_at))
      ||Date.parse(pending.body.requested_at)<started-5000||Date.parse(pending.body.requested_at)>Date.now()+5000
      ||Date.parse(pending.body.expires_at)<=Date.now()||Date.parse(pending.body.expires_at)>started+31*60000)fail('device_pending_request_unconfirmed');
    Object.assign(binding,{request_id:pending.body.request_id,requested_at:pending.body.requested_at,expires_at:pending.body.expires_at});
    const row=await requestRow(true);
    if(row.status!=='PENDING'||row.approved_at||row.approved_pairing_token_hash||row.device_id||row.claimed_at)fail('device_request_not_fresh_pending');
    // JSON/driver dates may truncate microseconds. Preserve the exact database
    // timestamps under the row lock for approval, activation and journal binding.
    Object.assign(binding,{requested_at_db:row.requested_at_db,expires_at_db:row.expires_at_db});
    const [counts]=await connection.unsafe(`select (select count(*)::int from ${DEVICE_TABLE}) as devices,
      (select count(*)::int from ${ENROLLMENT_TABLE}) as requests`);
    if(counts.devices!==0||counts.requests!==1)fail('unexpected_device_records');
    await deviceIdentity.bindEnrollmentRequest(binding.request_id);
    if(unchangedDevice(deviceIdentity,initial).enrollment_request_id!==binding.request_id)fail('device_request_storage_unconfirmed');
    await record('DEVICE_APPROVAL_OUTCOME_PENDING',binding);
    await verifyIdentity(connection);await verifyRuntime();
    const current=unchangedDevice(deviceIdentity,initial);
    if(current.enrollment_request_id!==binding.request_id||current.device_id)fail('device_request_storage_changed');
    const [result]=await connection.unsafe('select public.h205f22_a2_browser_device_enrollment_approve_v1($1::uuid) as approval',[binding.request_id]);
    if(result?.approval?.accepted!==true||result.approval.request_id!==binding.request_id
      ||result.approval.client_id!==binding.client_id||result.approval.status!=='APPROVED'||result.approval.authority_effect!==false)fail('device_approval_unconfirmed');
    const approved=await requestRow();
    if(approved.status!=='APPROVED'||!approved.approved_at||!SHA.test(approved.approved_pairing_token_hash||'')
      ||Number(approved.expires_ms)<=Date.now()||approved.device_id||approved.claimed_at)fail('device_approval_readback_unconfirmed');
    await verifyIdentity(connection);await verifyRuntime();
    commitAttempted=true;await connection.unsafe('COMMIT');committed=true;
  }catch {
    if(!commitAttempted)try{await connection.unsafe('ROLLBACK');}catch{fail('device_approval_outcome_unknown');}
    if(commitAttempted&&!committed)fail('device_approval_outcome_unknown');
    fail('device_enrollment_requires_review');
  }
  await record('DEVICE_ACTIVATION_OUTCOME_PENDING',binding);
  const activation=await send('/v1/device/enrollment/status',{...payload,request_id:binding.request_id});
  if(activation.status!==200||activation.body?.accepted!==true||activation.body.status!=='CLAIMED'
    ||activation.body.request_id!==binding.request_id||!UUID.test(activation.body.device_id||'')
    ||activation.body.key_fingerprint_sha256!==binding.key_fingerprint_sha256||activation.body.authority_effect!==false)fail('device_activation_unconfirmed');
  await verifyIdentity(connection);await verifyRuntime();
  const claimed=await requestRow();
  if(claimed.status!=='CLAIMED'||claimed.device_id!==activation.body.device_id||!claimed.claimed_at)fail('device_activation_readback_unconfirmed');
  const [result]=await connection.unsafe('select public.client_v1_device_admin_readback_v1($1::uuid,$2::text,$3::text) as admin',
    [claimed.device_id,binding.client_id,binding.key_fingerprint_sha256]);
  const admin=result?.admin;
  if(admin?.found!==true||admin.device_id!==claimed.device_id||admin.client_id!==binding.client_id
    ||admin.profile!==binding.profile||admin.key_fingerprint_sha256!==binding.key_fingerprint_sha256||admin.access_tier!=='ADMIN'
    ||admin.admin_ready!==true||!Number.isSafeInteger(admin.admin_grant_epoch)||admin.admin_grant_epoch<1
    ||!Array.isArray(admin.admin_scopes)||!['CONTROL_PLANE','DEVOS'].every(scope=>admin.admin_scopes.includes(scope))||admin.authority_effect!==false)fail('device_admin_readback_unconfirmed');
  await deviceIdentity.bindDevice(claimed.device_id);
  const bound=unchangedDevice(deviceIdentity,initial);
  if(bound.device_id!==claimed.device_id||bound.enrollment_request_id)fail('device_binding_storage_unconfirmed');
  await record('DEVICE_ADMIN_SIGNED_READBACK_PENDING',{...binding,device_id:claimed.device_id});
  const route='/v1/admin/status';
  const headers=await deviceIdentity.deviceHeaders('GET',new URL(baseUrl).pathname+route,'');
  const response=await fetchImpl(baseUrl+route,{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const signed=await boundedDeviceResponse(response);
  if(response.status!==200||signed?.schema!=='metaengine.client-v1.admin-connection.v1'||signed.connected!==true
    ||signed.device_id!==claimed.device_id||signed.client_id!==binding.client_id||signed.profile!==binding.profile
    ||signed.access_tier!=='ADMIN'||signed.admin_ready!==true||signed.admin_grant_epoch!==admin.admin_grant_epoch
    ||!Array.isArray(signed.admin_scopes)||!['CONTROL_PLANE','DEVOS'].every(scope=>signed.admin_scopes.includes(scope))||signed.authority_effect!==false)fail('device_signed_admin_unconfirmed');
  await verifyIdentity(connection);await verifyRuntime();
  const finalState=unchangedDevice(deviceIdentity,initial);
  if(finalState.device_id!==claimed.device_id||finalState.enrollment_request_id)fail('device_binding_storage_changed');
  await record('DEVICE_ADMIN_VERIFIED',{...binding,device_id:claimed.device_id});
  return Object.freeze({device_enrolled:true,admin_ready:true,device_id:claimed.device_id,client_id:binding.client_id,
    key_fingerprint_sha256:binding.key_fingerprint_sha256,request_id:binding.request_id,guardian_ready:false,runtime_ready:false,authority_effect:false});
}

// Every cleanup operation is bound to a handle created by this operator. A
// failed release must not skip the remaining owned cleanup or prove absence.
export async function cleanupFreshClientResources({api,reserved,sql,owned,hostAttempted,stopHost=stopOwnedLocalRuntimeHost}={}) {
  let clean=true;
  for(const action of [()=>api?.end({timeout:5}),()=>reserved?.release(),()=>sql?.end({timeout:5})])try{await action();}catch{clean=false;}
  if(owned)try{if((await owned.stop()).cleanup_confirmed!==true)clean=false;}catch{clean=false;}
  if(hostAttempted)try{if((await stopHost()).cleanup_confirmed!==true)clean=false;}catch{clean=false;}
  if(!clean)fail('cleanup_unconfirmed');
}

/** Real production operator: only invoked after native owner consent. Never repairs
 * or adopts prior state. A journal/partial cluster is a review boundary, not retry. */
export async function provisionFreshClientProvider(options={}) {
  if(process.platform!=='win32')fail('windows_required');
  // Signer/storage/profile are never caller inputs. Only actual Electron main
  // can acquire its native identity; the raw Node CLI remains schema-only.
  if(Object.hasOwn(options,'deviceIdentity'))fail('caller_device_identity_forbidden');
  if(Object.keys(options).some(key=>!['localAppData','appData','bundleDirectory','expectedBundleDigest','ownerAction'].includes(key)))fail('caller_option_forbidden');
  const nativeBrowser=Boolean(process.versions.electron&&process.type==='browser');
  if(process.versions.electron&&!nativeBrowser)fail('installed_native_browser_required');
  const selected=freshClientLayout(options);
  if(!same(options.localAppData,process.env.LOCALAPPDATA||'')||!same(options.appData,process.env.APPDATA||''))fail('os_owner_roots_mismatch');
  let owned=null,sql=null,api=null,reserved=null,hostAttempted=false;
  let journal=null,rootIdentity=null,enrollment=null,enrollmentBinding=null,deviceIdentity=null;
  const requireActiveInstall=()=>{
    if(globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__===true)fail('setup_cancelled');
  };
  const checkRoot=async()=>{const st=await fs.lstat(selected.root);if(st.isSymbolicLink()||st.ino!==rootIdentity.ino||st.dev!==rootIdentity.dev)fail('private_root_changed');};
  const record=async (stage,binding)=>{
    if(binding)enrollmentBinding=structuredClone(binding);
    await checkRoot();const text=JSON.stringify({schema:'compute.fresh-client-install-journal.v1',stage,
      bundle_sha256:options.expectedBundleDigest,automatic_retry_allowed:false,device_enrolled:enrollment?.device_enrolled===true,guardian_ready:false,
      ...(enrollmentBinding?{device_enrollment:enrollmentBinding}:{})})+'\n';
    await journal.truncate(0);await journal.write(text,0,'utf8');await journal.sync();
  };
  try {
    requireActiveInstall();
    const verified=await verifyOfflineRuntimeBundle({bundleDirectory:options.bundleDirectory,expectedBundleDigest:options.expectedBundleDigest});
    if(verified.manifest.bundle_sha256!==options.expectedBundleDigest)fail('bundle_unconfirmed');
    const plan=await loadFreshSchemaApplicationPlan();
    await noAliases(options.localAppData);await noAliases(options.appData);await noAliases(path.dirname(selected.root));
    await absent(selected.root);await absent(selected.ownerFile);
    const pre=await inspectClientFirstRun({...selected});if(pre.state!=='PREPARATION_REVIEW_REQUIRED')fail('existing_state_requires_review');
    // Mandatory here, including direct CLI/module invocation: public argv is not consent.
    await confirmFreshProviderNativeConsent(selected);
    // Consent can take time: recheck absence before the first mutation.
    await absent(selected.root);await absent(selected.ownerFile);
    requireActiveInstall();
    // Conditional Electron dependency is explicitly inventoried at this exact
    // module path. Node CLI never imports it or manufactures a second identity.
    // No injected signer, storage, app, path or no-op consent is accepted.
    if(nativeBrowser) {
      const {createFreshInstalledDeviceIdentity}=await import('./fresh-provider-native-device-identity.mjs');
      deviceIdentity=await createFreshInstalledDeviceIdentity();
      requireActiveInstall();await deviceIdentity.ensure();
      const device=freshDeviceSnapshot(deviceIdentity);
      if(device.device_id||device.enrollment_request_id)fail('existing_device_binding_requires_review');
    }
    requireActiveInstall();
    await fs.mkdir(path.dirname(selected.root),{recursive:true});await noAliases(path.dirname(selected.root));
    await fs.mkdir(selected.root,{mode:0o700});rootIdentity=await fs.lstat(selected.root);
    await protectOwnerOnlyWindowsDirectory(selected.root);await checkRoot();
    // Journal and credential are siblings of runtime, so initdb's empty-state
    // fence and outside-PGDATA credential boundary remain intact.
    journal=await fs.open(selected.journalFile,'wx',0o600);await secureAttachedPrivateFile(selected.journalFile);
    await record('PREPARE');
    const ownerPassword=randomBytes(32).toString('hex'),apiPassword=randomBytes(32).toString('hex');
    await privateFile(selected.passwordFile,ownerPassword+'\n');
    await record('INITDB_OUTCOME_PENDING');
    requireActiveInstall();
    await initializeFreshClientPg17({...selected,expectedBundleSha256:options.expectedBundleDigest,
      ownerAction:FRESH_CLIENT_INSTALL_ACTION,databaseOwner:'state_owner'});
    await verifyOwnerOnlyWindowsStorage(selected.stateDirectory,{operation:'VERIFY_DIRECTORY'});
    await record('PG17_INITIALIZED_UNPROVISIONED');
    const ports=new Set();while(ports.size<3)ports.add(await freePort());const [pgPort,apiPort,edgePort]=[...ports];
    owned=await startOwnedWindowsPostgres({pgBinDir:verified.paths.postgresBinDirectory,pgDataDir:selected.pgDataDirectory,
      databasePort:pgPort,env:cleanEnvironment(),startupTimeoutMs:120000});
    const control=await exec(path.join(verified.paths.postgresBinDirectory,'pg_controldata.exe'),['-D',selected.pgDataDirectory],
      {env:{...cleanEnvironment(),LC_ALL:'C',LANG:'C'},windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    const systemIdentifier=/Database system identifier:\s*([1-9][0-9]{0,19})/.exec(control.stdout)?.[1];
    if(!systemIdentifier)fail('cluster_identifier_unconfirmed');
    const {default:postgres}=await import('postgres');
    const connect=url=>postgres(url,{max:1,prepare:false,connect_timeout:5,idle_timeout:10,debug:false,onnotice:()=>{},onparameter:()=>{}});
    const ownerUrl=databaseUrl(pgPort,'state_owner',ownerPassword),apiUrl=databaseUrl(pgPort,'local_state_api',apiPassword);
    sql=connect(ownerUrl);reserved=await sql.reserve();
    const expected={directory:await fs.realpath(selected.pgDataDirectory),systemIdentifier,postmasterStartIdentity:owned.postmasterStartIdentity};
    const verifyIdentity=async connection=>{requireActiveInstall();await owned.verify();const [row]=await connection.unsafe(IDENTITY_SQL);row.directory=await fs.realpath(row.directory);verifyFreshConnectionIdentity(row,expected);expected.backendPid??=row.backend_pid;};
    await verifyIdentity(reserved);await record('SCHEMA_OUTCOME_PENDING');
    await populateFreshClientSchema({connection:reserved,plan,verifyIdentity,apiPassword});
    api=connect(apiUrl);await inspectAttachedApiAdmission({sql:api,apiLogin:'local_state_api'});await verifyIdentity(reserved);
    await record('SCHEMA_AND_API_VERIFIED');
    const config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:options.bundleDirectory,
      expected_bundle_sha256:options.expectedBundleDigest,state_directory:selected.stateDirectory,pg_data_directory:selected.pgDataDirectory,
      postgres_mode:'owned',api_role_mode:'direct',expected_cluster_system_identifier:systemIdentifier,
      database_url:apiUrl,inspect_database_url:ownerUrl,api_port:apiPort,edge_port:edgePort,startup_timeout_ms:120000};
    await privateFile(selected.runtimeConfigFile,JSON.stringify(config)+'\n');
    await api.end({timeout:5});api=null;await reserved.release();reserved=null;await sql.end({timeout:5});sql=null;
    if((await owned.stop()).cleanup_confirmed!==true)fail('postgres_cleanup_unconfirmed');owned=null;
    await record('NORMAL_RUNTIME_QUALIFICATION_PENDING');
    const publicConfig={schema:'metaengine.browser.local-state-provider-config.v1',version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',
      provider:'LOCAL_POSTGRES',base_url:`http://127.0.0.1:${edgePort}/a2-browser-native-supervisor-v1`,
      runtime_identity_file:path.join(selected.stateDirectory,'runtime-instance.json'),runtime_host:{bundle_directory:options.bundleDirectory,
        expected_bundle_sha256:options.expectedBundleDigest,config_file:selected.runtimeConfigFile},authority_effect:false};
    requireActiveInstall();hostAttempted=true;
    const host=await startConfiguredLocalRuntimeHost({config:publicConfig,env:cleanEnvironment()});
    const runtimeStatus=JSON.parse(await fs.readFile(publicConfig.runtime_identity_file,'utf8'));
    const identity=validateLocalStateRuntimeIdentity(runtimeStatus,publicConfig.base_url);
    if(host.state!=='READY'||host.instance_id!==identity.instance_id||host.runtime_owned!==true||host.endpoint!==publicConfig.base_url)fail('runtime_identity_unconfirmed');
    const health=await fetch(publicConfig.base_url+'/health',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!health.ok||!localStateProviderHealthAttested(await health.json(),identity.instance_id))fail('runtime_health_unconfirmed');
    if(deviceIdentity) {
      const continuity=runtimeStatus.postgres_continuity;
      if(continuity?.system_identifier!==systemIdentifier||continuity.authority_effect!==false
        ||!Number.isFinite(Date.parse(continuity.started_at)))fail('device_runtime_cluster_unconfirmed');
      // Normal runtime restarted PG. Bind a NEW backend to that exact private
      // continuity proof, not to the now-stopped initialization postmaster.
      sql=connect(ownerUrl);reserved=await sql.reserve();
      const enrollmentExpected={directory:expected.directory,systemIdentifier,
        postmasterStartIdentity:Math.floor(Date.parse(continuity.started_at)/1000)};
      const verifyEnrollmentConnection=async connection=>{
        requireActiveInstall();await checkRoot();const [row]=await connection.unsafe(IDENTITY_SQL);
        row.directory=await fs.realpath(row.directory);verifyFreshConnectionIdentity(row,enrollmentExpected);
        enrollmentExpected.backendPid??=row.backend_pid;
        const proof=await runtimeRecoveryPostgresProof({pgDataDirectory:selected.pgDataDirectory,expectedClusterSystemIdentifier:systemIdentifier,
          identity:{pid:continuity.pid,version:Number(row.version),system_identifier:String(row.system_identifier),
            started_at:new Date(Number(row.started_at)*1000).toISOString(),data_directory:row.directory,port:pgPort}});
        if(proof.sha256!==continuity.sha256)fail('device_runtime_incarnation_changed');
      };
      const verifyEnrollmentRuntime=async()=>{
        requireActiveInstall();
        const status=JSON.parse(await fs.readFile(publicConfig.runtime_identity_file,'utf8'));
        const current=validateLocalStateRuntimeIdentity(status,publicConfig.base_url);
        if(current.instance_id!==identity.instance_id||status.postgres_continuity?.sha256!==continuity.sha256)fail('device_runtime_changed');
        const response=await fetch(publicConfig.base_url+'/health',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
        if(!response.ok||!localStateProviderHealthAttested(await response.json(),identity.instance_id))fail('device_runtime_health_unconfirmed');
      };
      await record('DEVICE_IDENTITY_BINDING_PENDING',{cluster_system_identifier:systemIdentifier,runtime_instance_id:identity.instance_id});
      const recordEnrollment=async(stage,binding)=>record(stage,{cluster_system_identifier:systemIdentifier,runtime_instance_id:identity.instance_id,...binding});
      enrollment=await enrollFreshLocalDeviceOwner({connection:reserved,deviceIdentity,baseUrl:publicConfig.base_url,
        verifyIdentity:verifyEnrollmentConnection,verifyRuntime:verifyEnrollmentRuntime,record:recordEnrollment});
      await reserved.release();reserved=null;await sql.end({timeout:5});sql=null;
    }
    if((await stopOwnedLocalRuntimeHost()).cleanup_confirmed!==true)fail('runtime_cleanup_unconfirmed');hostAttempted=false;
    await verifyOfflineRuntimeBundle({bundleDirectory:options.bundleDirectory,expectedBundleDigest:options.expectedBundleDigest});
    requireActiveInstall();await checkRoot();await record('OWNER_PUBLICATION_PENDING');
    await provisionPersistentClientProvider({ownerChoice:'LOCAL_POSTGRES',ownerFile:selected.ownerFile,appDataDirectory:options.appData,
      baseUrl:publicConfig.base_url,runtimeIdentityFile:publicConfig.runtime_identity_file,runtimeHost:publicConfig.runtime_host});
    await record(enrollment?'PROVIDER_CONFIGURED_DEVICE_ADMIN_VERIFIED':'PROVIDER_CONFIGURED_DEVICE_ENROLLMENT_REQUIRED');
    return Object.freeze({schema:'compute.fresh-client-provider.v1',state:'CONFIGURED',provider:'LOCAL_POSTGRES',
      database_initialized:true,schema_provisioned:true,owner_profile_written:true,cleanup_confirmed:true,
      bundle_sha256:options.expectedBundleDigest,device_enrolled:enrollment?.device_enrolled===true,admin_ready:enrollment?.admin_ready===true,
      ...(enrollment?{device_id:enrollment.device_id,client_id:enrollment.client_id,key_fingerprint_sha256:enrollment.key_fingerprint_sha256,request_id:enrollment.request_id}:{}),
      guardian_ready:false,runtime_ready:false,
      automatic_retry_allowed:false,automatic_cloud_fallback:false,authority_effect:false});
  }catch(error) {
    // Preserve only the exact native No while still wholly before mutation.
    // Cleanup below still runs and any uncertainty overrides this category.
    if(error?.message==='fresh_provider_native_consent_declined'&&!journal&&!rootIdentity&&!deviceIdentity
      &&!owned&&!sql&&!api&&!reserved&&!hostAttempted)throw error;
    // No raw SQL/driver/native diagnostic reaches logs or the renderer.
    try{if(journal)await record('OUTCOME_REQUIRES_REVIEW');}catch{}
    fail('setup_requires_review');
  }finally {
    try {await cleanupFreshClientResources({api,reserved,sql,owned,hostAttempted});}
    finally {await journal?.close();}
  }
}
