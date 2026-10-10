import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createWindowsLocalComputerExecutor } from './windows-local-computer-executor.mjs';
import { runRestoredClientProviderCli } from '../../../infra/client-state-runtime/restored-client-provider-cli.mjs';

const execute = promisify(execFile);
const MAX_MESSAGE = 128 * 1024;
const MAX_PENDING_MESSAGES = 64;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const VIEWS = new Set(['OBSERVE_WINDOWS','OBSERVE_DISPLAYS','FOREGROUND_STATUS','VERIFY_TARGET','UIA_SNAPSHOT','CAPTURE_DESKTOP','CAPTURE_WINDOW']);
const CONTROLS = new Set(['UIA_FOCUS','UIA_INVOKE','UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL','TYPE_TEXT','KEY_PRESS','POINTER_CLICK']);
const deny = () => { throw new Error('remote_support_local_approval_required'); };
const RESTORE_ACTION = 'USE_EXISTING_RESTORED_POSTGRES_17';
const RESTORE_FIELDS = ['private_config_file','expected_bundle_sha256','restore_receipt_file',
  'expected_restore_receipt_sha256','appdata_directory','owner_action'];
const restoreDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function restoreArguments(args) {
  if (!args || Array.isArray(args) || typeof args !== 'object'
    || Object.keys(args).length !== RESTORE_FIELDS.length
    || RESTORE_FIELDS.some(key=>!Object.hasOwn(args,key))
    || !restoreDigest(args.expected_bundle_sha256)
    || !restoreDigest(args.expected_restore_receipt_sha256)
    || args.owner_action !== RESTORE_ACTION
    || !['private_config_file','restore_receipt_file','appdata_directory'].every(key =>
      typeof args[key] === 'string' && args[key].length < 2048
      // Require an explicit drive root. isAbsolute alone also accepts UNC,
      // device namespaces and paths rooted on the current drive.
      && /^[a-z]:[\\/]/i.test(args[key])
      && !/[\x00-\x1f:]/.test(args[key].slice(2)))) {
    throw new Error('remote_support_restore_arguments_invalid');
  }
  return ['--config',args.private_config_file,'--bundle-sha256',args.expected_bundle_sha256,
    '--restore-receipt',args.restore_receipt_file,'--restore-receipt-sha256',args.expected_restore_receipt_sha256,
    '--appdata',args.appdata_directory,'--owner-action',RESTORE_ACTION];
}
function ambiguousRestore() {
  return {...content({schema:'metaengine.remote-support-restored-provider-effect.v1',state:'AMBIGUOUS',
    reason:'SESSION_CHANGED_DURING_POSSIBLE_PROVIDER_EFFECT',automatic_retry_allowed:false,
    authority_effect:false}),isError:true};
}
const result = id => ({ jsonrpc:'2.0', id });
const clean = error => /^remote_support_[a-z0-9_]+$/.test(String(error?.message||'')) ? error.message : 'remote_support_operation_failed';
const content = value => ({ content:[{type:'text',text:JSON.stringify(value)}],isError:false });
const errorContent = error => ({content:[{type:'text',text:clean(error)}],isError:true});
const CONTROL_LEASE_SCHEMA = 'metaengine.remote-support-control-lease.v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function frozenJsonSnapshot(value) {
  // Snapshot before an async resolver so a programmatic caller cannot swap
  // action arguments or targets while a lease is being checked.
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded,'utf8') > MAX_MESSAGE)
    throw new Error('remote_support_control_arguments_invalid');
  const freeze = object => {
    if (object !== null && typeof object === 'object') {
      for (const child of Object.values(object)) freeze(child);
      Object.freeze(object);
    }
    return object;
  };
  return freeze(JSON.parse(encoded));
}

export async function confirmRemoteSupportOnWindows({ scope, details = null }) {
  if (process.platform !== 'win32') return false;
  if (!['VIEW','CONTROL','FILES','DB_CONNECT','DB_CONNECT_COMMIT'].includes(scope)) return false;
  // The operator must be physically present in the user's interactive
  // Windows session. The remote caller cannot set this decision.
  const text = scope === 'DB_CONNECT'
    ? 'Allow a 10-minute restored PostgreSQL registration session? The assistant will need an EXISTING private runtime-host config and independent bundle/restore report SHA pins. No database is started and no owner profile is written unless you approve a SECOND local dialog. The operation never creates or overwrites PGDATA or Vault. Stop the support process to revoke.'
    : scope === 'DB_CONNECT_COMMIT'
      ? 'APPROVE ONE restored PostgreSQL 17 provider registration on this Windows PC? Existing private config: ' + String(details?.configFile||'UNSPECIFIED').slice(0,500) + '; Browser profile root: ' + String(details?.appData||'UNSPECIFIED').slice(0,350) + '. This starts and stops your selected DB and may exclusively write a missing owner profile. NEVER replaces PGDATA or Vault. Approve only if these paths are correct.'
    : scope === 'VIEW'
    ? 'Allow ONE METAENGINE support session to VIEW your screen and UI for up to 60 minutes? Private content may be visible. Close the support terminal to stop immediately.'
    : scope === 'FILES'
      ? 'Allow ONE METAENGINE support session to SEARCH FILE AND DIRECTORY NAMES across all accessible local fixed drives for an existing PostgreSQL database, for up to 60 minutes? Only matching database directory locations and metadata can be returned. No file contents, passwords or Vault keys are read. Close the support terminal to stop.'
      : 'Allow ONE METAENGINE support session to VIEW your screen, CONTROL keyboard/mouse and SEARCH local fixed drives for PostgreSQL database locations for up to 60 minutes WITHOUT further per-action popups? File contents, passwords and Vault keys are not read by the discovery tool. Typed effects still require trusted agent leases. Close the support terminal to stop.';
  const escaped = text.replaceAll("'", "''");
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${escaped}','METAENGINE — Remote Support',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning).ToString()`;
  try {
    const {stdout} = await execute('powershell.exe',
      ['-NoProfile','-NonInteractive','-STA','-Command',script],
      {windowsHide:false,shell:false,timeout:60000,maxBuffer:1024});
    return stdout.trim() === 'Yes';
  } catch { return false; }
}


const POSTGRES_DISCOVERY_MAX_DIRECTORIES = 16000;
const POSTGRES_DISCOVERY_MAX_ENTRIES = 220000;
const POSTGRES_DISCOVERY_MAX_RESULTS = 40;
const POSTGRES_DISCOVERY_MAX_MS = 75000;
const ignoredDirectories = new Set(['$recycle.bin','system volume information','.git','node_modules',
  '.next','cache','caches','code cache','gpu cache','temporary internet files']);
const driveRoot = value => typeof value === 'string' && /^[A-Z]:\\$/i.test(value);

export async function listReadyFixedWindowsDrives({ platform = process.platform, run = execute } = {}) {
  if (platform !== 'win32') throw new Error('remote_support_windows_required');
  // Fixed command, never user-provided PowerShell or shell arguments; network,
  // mapped and removable volumes are excluded from automatic enumeration.
  const script = "[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [IO.DriveType]::Fixed -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName }";
  let stdout;
  try {
    ({stdout} = await run('powershell.exe',
      ['-NoProfile','-NonInteractive','-Command',script],
      {windowsHide:true,shell:false,timeout:10000,maxBuffer:4096}));
  } catch { throw new Error('remote_support_drive_enumeration_failed'); }
  const drives = [...new Set(String(stdout || '').split(/\r?\n/).map(x=>x.trim().toUpperCase()).filter(driveRoot))];
  if (!drives.length) throw new Error('remote_support_no_fixed_drives');
  return drives.slice(0,26);
}

function priority(name) {
  const value = name.toLowerCase();
  if (/postgres|pgdata|metaengine|pgsql|database|restore|backup/.test(value)) return 0;
  if (/^users$|^appdata$|^programdata$|^program files/.test(value)) return 1;
  return 2;
}

export async function discoverLocalPostgresFiles({
  roots, fsImpl = fs, now = Date.now, shouldContinue = () => true,
  maxDirectories = POSTGRES_DISCOVERY_MAX_DIRECTORIES,
  maxEntries = POSTGRES_DISCOVERY_MAX_ENTRIES,
  maxResults = POSTGRES_DISCOVERY_MAX_RESULTS,
  maxDurationMs = POSTGRES_DISCOVERY_MAX_MS,
} = {}) {
  if (!Array.isArray(roots) || roots.length === 0 || roots.length > 26 || !roots.every(driveRoot)
    || ![maxDirectories,maxEntries,maxResults,maxDurationMs].every(Number.isSafeInteger)
    || maxDirectories < 1 || maxDirectories > POSTGRES_DISCOVERY_MAX_DIRECTORIES
    || maxEntries < 1 || maxEntries > POSTGRES_DISCOVERY_MAX_ENTRIES
    || maxResults < 1 || maxResults > POSTGRES_DISCOVERY_MAX_RESULTS
    || maxDurationMs < 1 || maxDurationMs > POSTGRES_DISCOVERY_MAX_MS) {
    throw new Error('remote_support_discovery_arguments_invalid');
  }
  const queue = [...new Set(roots.map(x=>x.toUpperCase()))];
  const start = now();
  let directories = 0, entries = 0, inaccessible = 0, truncated = false;
  const candidates = [];
  while (queue.length && directories < maxDirectories && entries < maxEntries
    && now() - start < maxDurationMs && candidates.length < maxResults) {
    if (!shouldContinue()) throw new Error('remote_support_session_not_active');
    const current = queue.shift();
    let stat, children;
    try {
      stat = await fsImpl.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      children = await fsImpl.readdir(current, {withFileTypes:true});
    } catch { inaccessible++;continue; }
    directories++;
    entries += children.length;
    const files = new Set(children.filter(x=>x.isFile() && !x.isSymbolicLink()).map(x=>x.name.toLowerCase()));
    if (files.has('pg_version')) {
      try {
        const control = await fsImpl.lstat(path.win32.join(current,'global','pg_control'));
        if (control.isFile() && !control.isSymbolicLink()) {
          // Never open the database, configs, password files, or the Vault key.
          // postmaster.pid is only a hint and NEVER proof of a running server.
          candidates.push({
            directory:current, pg_version_present:true, pg_control_present:true,
            postgresql_conf_present:files.has('postgresql.conf'),
            postmaster_pid_present:files.has('postmaster.pid'),
            active_server_verified:false, database_contents_read:false,
          });
        }
      } catch {}
    }
    const directoriesHere = children.filter(x=>x.isDirectory() && !x.isSymbolicLink()
      && !ignoredDirectories.has(x.name.toLowerCase())).sort((a,b)=>priority(a.name)-priority(b.name));
    for (const child of directoriesHere) {
      if (queue.length >= maxDirectories * 3) { truncated=true;break; }
      queue.push(path.win32.join(current,child.name));
    }
  }
  if (!shouldContinue()) throw new Error('remote_support_session_not_active');
  truncated ||= queue.length > 0;
  return {
    schema:'metaengine.remote-support-postgres-discovery.v1',
    search_scope:'ALL_READY_FIXED_LOCAL_DRIVES',
    roots_searched:roots, directories_inspected:directories, entries_seen:entries,
    inaccessible_directories:inaccessible, truncated,
    candidates, read_only:true, file_contents_read:false,
    database_opened:false, vault_key_read:false, authority_effect:false,
  };
}

export function createRemoteSupportMcp({
  input = null, output = null,
  executor = createWindowsLocalComputerExecutor(),
  approve = confirmRemoteSupportOnWindows,
  now = () => Date.now(), platform = process.platform,
  imageLoader = readBoundedCapture,
  driveEnumerator = listReadyFixedWindowsDrives,
  postgresDiscoverer = discoverLocalPostgresFiles,
  restoredProviderOperator = runRestoredClientProviderCli,
  // Computer mutations must be authorized by an embedding application that
  // can resolve the DB-backed lease.  The JSON-RPC caller is untrusted and
  // cannot supply this resolver or mint its result through `context`.
  // The resolver performs no UI effects and must check current server-owned
  // lease state, owner/task/action/target/payload binding and freshness. It
  // returns {schema:CONTROL_LEASE_SCHEMA, verified:true, request_binding,
  // context}; request_binding must equal the exact request snapshot supplied.
  resolveControlLease = null,
} = {}) {
  // Programmatic requests do not own the host process's stdio. The CLI below
  // explicitly attaches it; tests and embedding callers can supply a transport.
  if ((input !== null || output !== null)
      && (typeof input?.on !== 'function' || typeof input?.once !== 'function' || typeof input?.off !== 'function'
        || typeof input?.pause !== 'function' || typeof input?.listenerCount !== 'function'
        || typeof output?.write !== 'function'))
    throw new Error('remote_support_transport_invalid');
  let viewExpires = 0;
  let controlExpires = 0;
  let filesExpires = 0;
  let databaseExpires = 0;
  let restoreAttemptClaimed = false;
  let restoreApprovalPending = false;
  let sessionId = null;
  let revoked = false;
  let closed = false;
  // Frame bytes before decoding: a pipe can split any UTF-8 character. The
  // bound applies to each message, not an arbitrary coalesced transport chunk.
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let frame = [];
  let frameBytes = 0;
  let discardFrame = false;
  let processing = Promise.resolve();
  // A bounded frame does not bound the serialized request backlog when a
  // local approval, lease resolver or executor is waiting. Count the running
  // request too, and reserve one separate bounded slot for emergency stop.
  let pendingMessages = 0;
  let pendingBytes = 0;
  let stopPending = false;
  let approvalPending = false;
  let sessionGeneration = 0;
  const send = message => {
    if (closed || !output) return;
    output.write(JSON.stringify(message) + '\n');
  };
  // A locally approved, bounded session replaces modal prompts on EVERY
  // mouse/keyboard action. No remote caller may mint or extend a grant.
  // All effects still pass the existing DB-lease + target-identity fences.
  const SESSION_MAX_MS = 60 * 60 * 1000;
  const grantValid = (grant, scope) =>
    platform === 'win32' && !revoked && !closed && sessionId !== null
    && sessionId === grant.sessionId && sessionGeneration === grant.generation
    && (scope === 'CONTROL' ? controlExpires : scope === 'FILES' ? filesExpires : scope === 'DB_CONNECT' ? databaseExpires : viewExpires) > now();
  const requireAuthorized = scope => {
    if (platform !== 'win32') throw new Error('remote_support_windows_required');
    if (revoked || closed) throw new Error('remote_support_session_revoked');
    if (!sessionId || (scope === 'CONTROL' ? controlExpires : scope === 'FILES' ? filesExpires : scope === 'DB_CONNECT' ? databaseExpires : viewExpires) <= now())
      throw new Error('remote_support_session_not_active');
    return {sessionId, generation:sessionGeneration};
  };
  const recheckGrant = (grant, scope) => {
    if (!grantValid(grant, scope))
      throw new Error(revoked || closed || grant.sessionId !== sessionId
        ? 'remote_support_session_revoked' : 'remote_support_session_not_active');
  };
  const revoke = () => {
    // Generation revocation is synchronous, including when an effect has
    // already been dispatched or a Windows consent dialog is still open.
    sessionGeneration++;
    viewExpires = 0;
    controlExpires = 0;
    filesExpires = 0;
    databaseExpires = 0;
    sessionId = null;
    revoked = true;
  };
  const startSession = async scope => {
    if (platform !== 'win32') throw new Error('remote_support_windows_required');
    if (revoked || closed) throw new Error('remote_support_session_revoked');
    if (!['VIEW','CONTROL','FILES','DB_CONNECT'].includes(scope)) throw new Error('remote_support_scope_invalid');
    // Reserve consent before awaiting Windows; a second remote request must
    // not queue a competing approval or upgrade an existing pending one.
    if (sessionId || approvalPending) throw new Error('remote_support_session_already_started');
    approvalPending = true;
    const initialGeneration = sessionGeneration;
    try {
      const accepted = await approve({scope});
      if (closed || revoked || sessionGeneration !== initialGeneration)
        throw new Error('remote_support_session_revoked');
      if (accepted !== true) deny();
      const until = now() + (scope === 'DB_CONNECT' ? 10 * 60 * 1000 : SESSION_MAX_MS);
      sessionGeneration++;
      sessionId = randomUUID();
      viewExpires = scope === 'VIEW' || scope === 'CONTROL' ? until : 0;
      controlExpires = scope === 'CONTROL' ? until : 0;
      filesExpires = scope === 'FILES' || scope === 'CONTROL' ? until : 0;
      databaseExpires = scope === 'DB_CONNECT' ? until : 0;
      return content({schema:'metaengine.remote-support-session.v1',
        session_id:sessionId,scope,expires_at:new Date(until).toISOString(),
        further_action_prompts:false,unattended_persistent_access:false,
        approved_locally:true,authority_effect:false});
    } finally {
      approvalPending = false;
    }
  };
  async function tool(name, args = {}) {
    if (name === 'support_status') return content({
      schema:'metaengine.remote-support.v1', state:'OPT_IN_ONLY',
      local_approval_required:true, active_view_grant:!revoked && viewExpires > now(),
      active_control_grant:!revoked && controlExpires > now(),
      active_filesystem_grant:!revoked && filesExpires > now(),
      active_database_connect_grant:!revoked && databaseExpires > now(),
      restored_provider_attempt_claimed:restoreAttemptClaimed,
      session_id:revoked ? null : sessionId,
      session_revoked:revoked, further_action_prompts:false,
      arbitrary_shell:false, filesystem_access:'POSTGRES_METADATA_OR_DOUBLE_APPROVED_PROVIDER_REGISTRATION', arbitrary_file_contents:false,
      unattended_access:false,
      restored_database_connection_requires_second_local_approval:true,
      installed_browser_runtime_required:false, authority_effect:false,
      control_lease_resolver_configured:typeof resolveControlLease === 'function',
      control_lease_resolution:typeof resolveControlLease === 'function'
        ? 'TRUSTED_HOST_RESOLVER_REQUIRED_PER_ACTION' : 'UNAVAILABLE_NO_TRUSTED_DB_ADAPTER',
    });
    if (name === 'support_start_session') {
      return startSession(args?.scope);
    }
    if (name === 'support_stop') {
      revoke();
      return content({state:'SESSION_REVOKED',new_session_requires_local_restart:true,authority_effect:false});
    }
    if (name === 'support_discover_postgres') {
      if (args && Object.keys(args).length) throw new Error('remote_support_discovery_arguments_invalid');
      const grant = requireAuthorized('FILES');
      const roots = await driveEnumerator({platform});
      recheckGrant(grant,'FILES');
      const discovery = await postgresDiscoverer({
        roots, now, shouldContinue:()=>grantValid(grant,'FILES'),
      });
      recheckGrant(grant,'FILES');
      return content(discovery);
    }
    if (name === 'support_connect_restored_postgres') {
      const grant = requireAuthorized('DB_CONNECT');
      const cliArgs = restoreArguments(args);
      if (restoreAttemptClaimed || restoreApprovalPending) throw new Error('remote_support_restore_attempt_already_claimed');
      restoreApprovalPending = true;
      let approved = false;
      try {
        approved = await approve({scope:'DB_CONNECT_COMMIT',details:{
          configFile:args.private_config_file,appData:args.appdata_directory,
        }});
      } finally { restoreApprovalPending = false; }
      recheckGrant(grant,'DB_CONNECT');
      if (approved !== true) deny();
      // One attempt per local support process, even if the operator rejects or cleanup becomes ambiguous.
      restoreAttemptClaimed = true;
      let receipt;
      try { receipt = await restoredProviderOperator(cliArgs); }
      catch {
        if (!grantValid(grant,'DB_CONNECT')) return ambiguousRestore();
        throw new Error('remote_support_restore_operator_failed');
      }
      if (!grantValid(grant,'DB_CONNECT')) return ambiguousRestore();
      // Never forward arbitrary operator-provided objects or private paths.
      if (receipt?.schema !== 'compute.restored-client-provider-provisioning.v1'
          || receipt.state !== 'CONFIGURED' || receipt.provider !== 'LOCAL_POSTGRES'
          || receipt.cleanup_confirmed !== true || receipt.private_vault_key_preserved !== true
          || receipt.owner_profile_written !== true || receipt.runtime_ready !== false
          || receipt.authority_effect !== false)
        throw new Error('remote_support_restore_receipt_unverified');
      return content({schema:'metaengine.remote-support-restored-provider-effect.v1',
        state:'CONFIGURED',provider:'LOCAL_POSTGRES',owner_profile_written:true,
        private_vault_key_preserved:true,cleanup_confirmed:true,
        runtime_ready:false,installed_normal_boot_verified:false,
        automatic_retry_allowed:false,authority_effect:false});
    }
    if (name === 'support_observe') {
      if (!VIEWS.has(args?.action)) throw new Error('remote_support_action_not_allowed');
      const grant = requireAuthorized('VIEW');
      const observation = await executor.observe({action:args.action,args:args.args||{},target:args.target});
      // An in-flight view cannot publish private UI data after stop/expiry.
      recheckGrant(grant,'VIEW');
      if (['CAPTURE_DESKTOP','CAPTURE_WINDOW'].includes(args.action)) {
        const capture = observation?.result;
        if (!capture?.png_path || !capture?.png_sha256) throw new Error('remote_support_capture_unverified');
        const image = await imageLoader(capture.png_path,capture.png_sha256);
        recheckGrant(grant,'VIEW');
        return {content:[
          {type:'text',text:JSON.stringify({action:args.action,sha256:capture.png_sha256,window_target_sha256:observation?.result?.target_identity_sha256||null})},
          {type:'image',data:image.toString('base64'),mimeType:'image/png'},
        ],isError:false};
      }
      // UI Automation can reveal private window titles and control values,
      // and is shared only after local screen-view consent.
      return content(observation);
    }
    if (name === 'support_control') {
      if (!CONTROLS.has(args?.action)) throw new Error('remote_support_action_not_allowed');
      // One visible local CONTROL approval covers this bounded session.
      // NO per-action popups; each act is still independently leased,
      // target-bound, readback-checked and never automatically retried.
      const grant = requireAuthorized('CONTROL');
      // Once executor.act has been invoked, physical dispatch may have
      // occurred. Revocation cannot retroactively prove NO_EFFECT.
      const ambiguousAfterRevocation = () => ({
        ...content({schema:'metaengine.remote-support-effect-outcome.v1',
          outcome:'AMBIGUOUS',reason:'SESSION_CHANGED_DURING_POSSIBLE_EFFECT',
          automatic_retry_allowed:false,authority_effect:false}),
        isError:true,
      });
      if (typeof resolveControlLease !== 'function')
        throw new Error('remote_support_trusted_control_lease_resolver_required');
      const controlRequest = frozenJsonSnapshot({
        action:args.action,args:args.args || {},target:args.target,
        agent_id:args.agent_id,task_id:args.task_id,
      });
      // The resolver is injected by the trusted embedding process.  Every
      // field below is caller-controlled input; only the resolver's returned
      // context and binding may reach the computer executor.
      let resolvedLease;
      try {
        resolvedLease = await resolveControlLease({
          request:controlRequest,
          untrusted_context:frozenJsonSnapshot(args.context || {}),
          session_id:grant.sessionId,
          session_generation:grant.generation,
        });
      } catch {
        // No executor was invoked: revocation is a pre-effect denial, not
        // an ambiguous computer operation. Never expose DB error details.
        recheckGrant(grant,'CONTROL');
        throw new Error('remote_support_control_lease_resolution_failed');
      }
      recheckGrant(grant,'CONTROL');
      if (!record(resolvedLease) || resolvedLease.schema !== CONTROL_LEASE_SCHEMA
          || resolvedLease.verified !== true || !record(resolvedLease.context)
          || !record(resolvedLease.request_binding)
          || !isDeepStrictEqual(resolvedLease.request_binding,controlRequest))
        throw new Error('remote_support_control_lease_unverified');
      const trustedContext = frozenJsonSnapshot(resolvedLease.context);
      recheckGrant(grant,'CONTROL');
      let effect;
      try {
        effect = await executor.act(controlRequest,trustedContext);
      } catch (error) {
        if (!grantValid(grant,'CONTROL')) return ambiguousAfterRevocation();
        throw error;
      }
      if (!grantValid(grant,'CONTROL')) return ambiguousAfterRevocation();
      return content(effect);
    }
    throw new Error('remote_support_unknown_tool');
  }
  const tools = [
    {name:'support_status',description:'Read session status without starting control or disclosing private data.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'support_start_session',description:'Request local approval: FILES (metadata), VIEW (screen), CONTROL (leased UI effects), or DB_CONNECT (10-minute restored PostgreSQL session requiring a SECOND approval for registration).',inputSchema:{type:'object',properties:{
      scope:{type:'string',enum:['VIEW','CONTROL','FILES','DB_CONNECT']},
    },required:['scope'],additionalProperties:false}},
    {name:'support_discover_postgres',description:'With locally approved FILES or CONTROL scope, search directory/file NAMES on all accessible fixed local Windows drives for existing PostgreSQL PGDATA. Return matching paths and metadata only; never read file contents, passwords, Vault keys, or write to any disk.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'support_connect_restored_postgres',description:'One-shot, locally double-approved connection of an EXISTING restored PostgreSQL 17 via the reviewed private operator. Requires an existing private runtime-host config, independent bundle/restore receipt SHA pins, and an absent owner profile. Never initdb, overwrite PGDATA/Vault or fall back to hosted DB. No automatic retry; installed boot remains separately unqualified.',inputSchema:{type:'object',properties:{
      private_config_file:{type:'string'},expected_bundle_sha256:{type:'string'},
      restore_receipt_file:{type:'string'},expected_restore_receipt_sha256:{type:'string'},
      appdata_directory:{type:'string'},owner_action:{type:'string',enum:[RESTORE_ACTION]},
    },required:RESTORE_FIELDS,additionalProperties:false}},
    {name:'support_observe',description:'With on-PC view approval, observe windows, UIA, displays or capture a screenshot. May reveal private screen contents.',inputSchema:{type:'object',properties:{
      action:{type:'string',enum:[...VIEWS]},args:{type:'object'},target:{type:'object'},
    },required:['action'],additionalProperties:false}},
    {name:'support_control',description:'During an ACTIVE locally approved CONTROL session and a valid existing computer-authority DB task lease resolved by the trusted host integration, perform one typed Windows action without a popup. Caller context is untrusted; default CLI without an injected DB lease resolver always denies control. No arbitrary shell.',inputSchema:{type:'object',properties:{
      action:{type:'string',enum:[...CONTROLS]},args:{type:'object'},target:{type:'object'},
      agent_id:{type:'string'},task_id:{type:'string'},context:{type:'object'},
    },required:['action','target','agent_id','task_id','context'],additionalProperties:false}},
    {name:'support_stop',description:'Irrevocably stop all remote actions for this process. Reconnect requires a locally launched new process and approval.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  ];
  async function request(message) {
    if (closed) throw new Error('remote_support_session_closed');
    if (!message || message.jsonrpc !== '2.0' || !['string','number','undefined'].includes(typeof message.id) ||
      typeof message.method !== 'string') throw new Error('remote_support_jsonrpc_invalid');
    if (message.id === undefined) return null;
    const id = message.id;
    if (message.method === 'initialize') return {...result(id),result:{
      protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'metaengine-remote-support',version:'0.1.0'},
    }};
    if (message.method === 'ping') return {...result(id),result:{}};
    if (message.method === 'tools/list') return {...result(id),result:{tools}};
    if (message.method === 'tools/call') {
      try { return {...result(id),result:await tool(message.params?.name,message.params?.arguments||{})}; }
      catch(error) { return {...result(id),result:errorContent(error)}; }
    }
    return {...result(id),error:{code:-32601,message:'Method not found'}};
  }
  async function line(text) {
    let m;
    try { m = JSON.parse(text); } catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
    try { const answer=await request(m);if(answer)send(answer); }
    catch { send({jsonrpc:'2.0',id:m?.id??null,error:{code:-32600,message:'Invalid request'}}); }
  }
  function onData(chunk) {
    if (closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length && !closed) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      if (!discardFrame) {
        const size = end - offset;
        if (frameBytes + size > MAX_MESSAGE) {
          frame = []; frameBytes = 0; discardFrame = true;
          send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Message too large'}});
        } else if (size) {
          frame.push(Buffer.from(bytes.subarray(offset, end)));
          frameBytes += size;
        }
      }
      offset = end + 1;
      if (newline < 0) break;
      if (discardFrame) { discardFrame = false; continue; }
      let one;
      const messageBytes = frameBytes;
      try { one = utf8.decode(Buffer.concat(frame, frameBytes)); }
      catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); }
      frame = []; frameBytes = 0;
      if (!one?.trim()) continue;
      // Emergency stop must not wait behind a hung observation, action or
      // pending approval in the normal serialized stdio request queue.
      // JSON-RPC replies may be out of order; revocation happens immediately.
      let interrupt = false;
      try {
        const parsed = JSON.parse(one);
        interrupt = parsed?.method === 'tools/call' && parsed?.params?.name === 'support_stop';
      } catch {}
      if ((interrupt && stopPending) || (!interrupt &&
          (pendingMessages >= MAX_PENDING_MESSAGES || pendingBytes + messageBytes > MAX_PENDING_BYTES))) {
        send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Pending request limit exceeded'}});
        // Revoke before any queued action can run. Keep the existing close
        // ownership rules for shared transports and late/in-flight effects.
        close();
        return;
      }
      if (interrupt) {
        stopPending = true;
        const settled = () => { stopPending = false; };
        void line(one).then(settled,settled);
      } else {
        pendingMessages++;
        pendingBytes += messageBytes;
        const run = async () => {
          try { await line(one); }
          finally { pendingMessages--; pendingBytes -= messageBytes; }
        };
        processing=processing.then(run,run);
      }
    }
  }
  function close() {
    if (closed) return;
    revoke();
    closed = true;
    frame = []; frameBytes = 0;
    if (input) {
      input.off('data',onData);
      input.off('end',close);
      input.off('close',close);
      input.off('error',close);
      // Removing the data listener alone leaves a pipe in flowing mode and
      // can keep the host alive after all requests have finished.
      if (input.listenerCount('data') === 0 && input.listenerCount('readable') === 0)
        input.pause();
    }
  }
  if (input) {
    input.on('data',onData);
    input.once('end',close);
    input.once('close',close);
    input.once('error',close);
  }
  return Object.freeze({
    request,tools,close,
  });
}

export async function readBoundedCapture(filename,sha256) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error('remote_support_capture_unverified');
  const root = await fs.realpath(path.join(os.tmpdir(),'metaengine-computer-captures'));
  const actual = await fs.realpath(filename);
  const relative = path.relative(root,actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^((?:window|capture)-[a-f0-9-]+\.png)$/i.test(relative)) throw new Error('remote_support_capture_boundary_invalid');
  const info = await fs.lstat(filename);
  if (!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<16||info.size>MAX_IMAGE) throw new Error('remote_support_capture_invalid');
  const bytes=await fs.readFile(filename);
  if (bytes.length!==info.size || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || createHash('sha256').update(bytes).digest('hex')!==sha256) throw new Error('remote_support_capture_unverified');
  // Only remove an exact verified executor-owned temp capture, never arbitrary
  // paths passed through a remote call.
  await fs.unlink(filename);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Explicitly launched by the owner-run tunnel-client; no Browser startup
  // registration, no network listener, no persistent unattended service.
  createRemoteSupportMcp({input:process.stdin,output:process.stdout});
}
