import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {evaluateRuntimeRecoveryEligibility} from './runtime-recovery-policy.mjs';
import {createSameExecutableRuntimeRecoveryAdapter, sameRuntimeRecoveryProcess} from './runtime-recovery-process-adapter.mjs';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';

const {durableWriteJson} = createRequire(import.meta.url)('./durable-json-file.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const WINDOW_MS = 600000;
const BACKOFF_MS = [5000,30000];
const PIN_KEYS = ['package_version','owner_sha256','asar_sha256','bundle_sha256','bundle_manifest_sha256','pg_identity_sha256'];
const STATES = new Set(['PREPARED','DISPATCH_INTENT','REQUESTED','AMBIGUOUS','CONFIRMED']);
const fail = code => {throw new Error('runtime_recovery_'+code);};
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value,keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonical = value => JSON.stringify(value, function(_key,v) {
  return plain(v) ? Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])) : v;
});
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const same = (a,b) => canonical(a) === canonical(b);
const hostBinding = value => ({pid:value.host_pid,instance_id:value.instance_id,launch_nonce:value.launch_nonce});

function pins(value) {
  if (!exact(value,['schema',...PIN_KEYS,'normal_bootstrap_ready','host'])
    || value.schema !== 'metaengine.browser.runtime-recovery-binding.v1'
    || typeof value.package_version !== 'string' || !/^\d+\.\d+\.\d+(?:-dev\.\d+\.\d+)?$/.test(value.package_version)
    || PIN_KEYS.slice(1).some(key=>!HASH.test(value[key] || '')) || typeof value.normal_bootstrap_ready !== 'boolean'
    || value.host !== null && (!exact(value.host,['pid','instance_id','launch_nonce']) || !Number.isSafeInteger(value.host.pid) || value.host.pid < 1
      || !UUID.test(value.host.instance_id || '') || !UUID.test(value.host.launch_nonce || ''))) fail('bootstrap_binding_invalid');
  return Object.freeze(Object.fromEntries(PIN_KEYS.map(key=>[key,value[key]])));
}
function validBrowser(value) {
  return exact(value,['schema','pid','created_100ns','executable','executable_sha256','authority_effect'])
    && value.schema === 'metaengine.browser.runtime-recovery-browser.v1' && Number.isSafeInteger(value.pid) && value.pid > 0
    && /^[1-9][0-9]{16,18}$/.test(value.created_100ns || '') && typeof value.executable === 'string'
    && path.isAbsolute(value.executable) && !/^(?:\\\\|\/\/)/.test(value.executable) && !/[\x00-\x1f]/.test(value.executable)
    && HASH.test(value.executable_sha256 || '') && value.authority_effect === false;
}
function validateJournal(value) {
  if (!exact(value,['schema','revision','active','history','authority_effect','sha256'])
    || value.schema !== 'metaengine.browser.runtime-recovery-journal.v1' || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.authority_effect !== false || !HASH.test(value.sha256 || '')
    || digest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='sha256'))) !== value.sha256
    || !Array.isArray(value.history) || value.history.length > 32) fail('journal_invalid');
  const ids = new Set();
  let previous = 0;
  for (const row of value.history) {
    if (!exact(row,['ticket_id','prepared_at_ms']) || !UUID.test(row.ticket_id || '') || ids.has(row.ticket_id)
      || !Number.isSafeInteger(row.prepared_at_ms) || row.prepared_at_ms < previous) fail('journal_history_invalid');
    ids.add(row.ticket_id);previous=row.prepared_at_ms;
  }
  const a = value.active;
  if (!exact(a,['ticket_id','state','prepared_at_ms','not_before_ms','origin_browser','binding','host','terminal','health_witness',
    'drain_receipt_sha256','gate_epoch','new_browser','new_host','confirmed_at_ms'])
    || !UUID.test(a.ticket_id || '') || !ids.has(a.ticket_id) || !STATES.has(a.state)
    || !Number.isSafeInteger(a.prepared_at_ms) || !Number.isSafeInteger(a.not_before_ms) || a.not_before_ms < a.prepared_at_ms
    || !BACKOFF_MS.includes(a.not_before_ms-a.prepared_at_ms) || !validBrowser(a.origin_browser)
    || !exact(a.binding,PIN_KEYS) || !plain(a.host) || !HASH.test(a.drain_receipt_sha256 || '') || !Number.isSafeInteger(a.gate_epoch) || a.gate_epoch < 0
    || value.history.find(row=>row.ticket_id===a.ticket_id)?.prepared_at_ms!==a.prepared_at_ms) fail('journal_active_invalid');
  pins({schema:'metaengine.browser.runtime-recovery-binding.v1',...a.binding,normal_bootstrap_ready:false,host:a.host});
  if (evaluateRuntimeRecoveryEligibility({schema:'metaengine.browser.runtime-host-generation.v1',
    host_pid:a.host.pid,instance_id:a.host.instance_id,launch_nonce:a.host.launch_nonce,ever_ready:true,stopping:false,exited:true,
    cleanup_confirmed:true,terminal_rejected:false,terminal:a.terminal,health_witness:a.health_witness,authority_effect:false}).eligible!==true
    || a.health_witness.bundle_sha256!==a.binding.bundle_sha256) fail('journal_failure_unbound');
  if (a.state === 'CONFIRMED') {
    if (!validBrowser(a.new_browser) || !Number.isSafeInteger(a.confirmed_at_ms) || a.confirmed_at_ms < a.prepared_at_ms) fail('journal_successor_invalid');
    pins({schema:'metaengine.browser.runtime-recovery-binding.v1',...a.binding,normal_bootstrap_ready:true,host:a.new_host});
    if (!a.new_host || a.new_host.instance_id === a.host.instance_id || a.new_host.launch_nonce === a.host.launch_nonce
      || sameRuntimeRecoveryProcess(a.new_browser,a.origin_browser) || a.new_browser.executable_sha256!==a.origin_browser.executable_sha256
      || path.resolve(a.new_browser.executable).toLowerCase()!==path.resolve(a.origin_browser.executable).toLowerCase()) fail('journal_successor_invalid');
  } else if (a.new_browser !== null || a.new_host !== null || a.confirmed_at_ms !== null) fail('journal_successor_invalid');
  return value;
}

// Only native main supplies these closed-over readers/effect adapter. No API
// accepts model paths, receipts, PID, version, shell, command or readiness flag.
// Fresh normal bootstrap and physical Owner/PG pins are mandatory dependencies.
export function createRuntimeRecoveryTransaction({app,readGeneration,readBinding,readGate,drain,beforeRelaunch,
  adapter=createSameExecutableRuntimeRecoveryAdapter({app,beforeRelaunch}),verifyStorage=verifyOwnerOnlyWindowsStorage,
  now=Date.now,writeJson=durableWriteJson}={}) {
  if (!app || typeof app.getPath !== 'function' || [readGeneration,readBinding,readGate,drain,verifyStorage,now,writeJson,
    adapter?.capture,adapter?.readProcess,adapter?.requestRelaunch].some(fn=>typeof fn!=='function')) fail('native_dependencies_required');
  const userData = app.getPath('userData');
  if (typeof userData !== 'string' || !path.isAbsolute(userData) || /^(?:\\\\|\/\/)/.test(userData)) fail('private_profile_invalid');
  const directory = path.join(userData,'runtime-recovery-v1'), journalFile = path.join(directory,'recovery-journal.json'), lockFile = path.join(directory,'transaction.lock');
  let armed = null, cancelled = false, pending = Promise.resolve();
  const queue = operation => {const next=pending.then(operation);pending=next.catch(()=>{});return next;};
  const at = () => {const value=now();if(!Number.isSafeInteger(value)||value<1)fail('clock_invalid');return value;};
  async function requireDirectory() {
    let created = false;
    try {await fs.mkdir(directory);created=true;} catch(error) {if(error.code!=='EEXIST')fail('private_directory_unavailable');}
    let current=path.parse(directory).root;
    for (const part of path.relative(current,directory).split(path.sep).filter(Boolean)) {
      current=path.join(current,part);const stat=await fs.lstat(current);
      if (!stat.isDirectory()||stat.isSymbolicLink()) fail('private_directory_alias');
    }
    const physical=await fs.realpath(directory);
    if (physical.toLowerCase()!==path.resolve(directory).toLowerCase()) fail('private_directory_alias');
    if (created && (await verifyStorage(directory,{operation:'PROTECT_DIRECTORY'}))?.owner_dacl_verified!==true) fail('private_directory_unverified');
    if ((await verifyStorage(directory,{operation:'VERIFY_DIRECTORY'}))?.owner_dacl_verified!==true) fail('private_directory_unverified');
  }
  async function readJournal() {
    let stat;
    try {stat=await fs.lstat(journalFile);} catch(error) {if(error.code==='ENOENT')return null;fail('journal_unavailable');}
    if (!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>256*1024) fail('journal_file_invalid');
    if ((await verifyStorage(journalFile,{operation:'VERIFY_FILE'}))?.owner_dacl_verified!==true) fail('journal_unverified');
    const bytes=await fs.readFile(journalFile),after=await fs.lstat(journalFile);
    if (stat.ino!==after.ino||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||bytes.length!==stat.size) fail('journal_changed');
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('journal_invalid');}
    return validateJournal(value);
  }
  async function save(value) {
    const sealed={...value,sha256:digest(value)};
    await writeJson(journalFile,sealed,{sequence:sealed.revision});
    const readback=await readJournal();
    if (!same(readback,sealed)) fail('journal_readback_mismatch');
    return readback;
  }
  async function exclusive(operation) {
    await requireDirectory();
    let handle;
    try {handle=await fs.open(lockFile,'wx',0o600);} catch(error) {if(error.code==='EEXIST')fail('transaction_locked');fail('transaction_lock_unavailable');}
    try {
      await handle.writeFile(JSON.stringify({schema:'metaengine.browser.runtime-recovery-lock.v1',pid:process.pid,operation_id:randomUUID()}));
      await handle.sync();
      return await operation();
    } finally {await handle.close();await fs.unlink(lockFile).catch(()=>{});}
  }
  function status(value,reason=null) {
    const active=value?.active;
    return Object.freeze({schema:'metaengine.browser.runtime-recovery-readback.v1',state:active?.state||'IDLE',reason,
      ticket_id:active?.ticket_id||null,not_before_ms:active?.not_before_ms||null,
      old_instance_id:active?.host.instance_id||null,new_instance_id:active?.new_host?.instance_id||null,
      fresh_browser_required:true,successor_confirmed:active?.state==='CONFIRMED',
      readback_is_current_liveness:false,
      automatic_retry_allowed:false,authority_effect:false});
  }
  async function gate(expectedEpoch=null) {
    const value=await readGate();
    if (cancelled || !exact(value,['schema','state','epoch']) || value.schema!=='metaengine.browser.runtime-recovery-gate.v1'
      || value.state!=='OPEN' || !Number.isSafeInteger(value.epoch) || value.epoch<0
      || expectedEpoch!==null&&value.epoch!==expectedEpoch) fail('gate_closed');
    return value;
  }
  async function requireDrain() {
    const result=await drain();
    if (!exact(result,['schema','cleanup_confirmed','interrupted_effects_reconciled','automatic_retry_allowed','authority_effect'])
      || result.schema!=='metaengine.managed-runtime-drain.v1'||result.cleanup_confirmed!==true
      || result.interrupted_effects_reconciled!==false||result.automatic_retry_allowed!==false||result.authority_effect!==false) fail('worker_drain_unconfirmed');
    return digest(result);
  }
  async function unchanged(active) {
    await gate(active.gate_epoch);
    const binding=await readBinding();
    if (!same(pins(binding),active.binding)||!sameRuntimeRecoveryProcess(await adapter.capture(),active.origin_browser)) fail('continuity_binding_changed');
    const generation=await readGeneration();
    if (!same(hostBinding(generation||{}),active.host)||evaluateRuntimeRecoveryEligibility(generation).eligible!==true
      || !same(generation.health_witness,active.health_witness)) fail('failure_generation_changed');
    await requireDrain();
    await gate(active.gate_epoch);
  }
  const api = {
    arm:()=>queue(async()=>{
      await gate();
      const generation=await readGeneration(),binding=await readBinding(),browser=await adapter.capture();
      if (!validBrowser(browser)||generation?.ever_ready!==true||generation.exited!==false||generation.stopping!==false
        || generation.transport_failed===true||generation.terminal!==null||generation.terminal_rejected===true
        || generation.cleanup_confirmed!==false||binding.normal_bootstrap_ready!==true
        || !same(binding.host,hostBinding(generation))) fail('normal_bootstrap_unproven');
      armed={browser,binding:pins(binding),host:hostBinding(generation)};
      return Object.freeze({schema:'metaengine.browser.runtime-recovery-arm.v1',state:'ARMED',instance_id:armed.host.instance_id,authority_effect:false});
    }),
    prepare:()=>queue(()=>exclusive(async()=>{
      const existing=await readJournal();
      if (existing&&existing.active.state!=='CONFIRMED') return status(existing,'PRIOR_EFFECT_UNRESOLVED');
      if (!armed) fail('not_armed');
      const generation=await readGeneration();
      if (evaluateRuntimeRecoveryEligibility(generation).eligible!==true||!same(hostBinding(generation||{}),armed.host)) fail('generation_ineligible');
      const g=await gate(),current=await readBinding();
      if (!same(pins(current),armed.binding)||!sameRuntimeRecoveryProcess(await adapter.capture(),armed.browser)
        || generation.health_witness.bundle_sha256!==armed.binding.bundle_sha256) fail('continuity_binding_changed');
      const clock=at(),history=existing?.history||[];
      if (history.some(item=>item.prepared_at_ms>clock)) fail('clock_regressed');
      const recent=history.filter(item=>clock-item.prepared_at_ms<WINDOW_MS);
      if (recent.length>=2) return status(existing,'STORM_BUDGET_EXHAUSTED');
      const drainHash=await requireDrain();await gate(g.epoch);
      const ticket_id=randomUUID();
      return status(await save({schema:'metaengine.browser.runtime-recovery-journal.v1',revision:(existing?.revision||0)+1,
        active:{ticket_id,state:'PREPARED',prepared_at_ms:clock,not_before_ms:clock+BACKOFF_MS[recent.length],
          origin_browser:armed.browser,binding:armed.binding,host:armed.host,terminal:generation.terminal,health_witness:generation.health_witness,
          drain_receipt_sha256:drainHash,gate_epoch:g.epoch,new_browser:null,new_host:null,confirmed_at_ms:null},
        history:[...recent,{ticket_id,prepared_at_ms:clock}],authority_effect:false}));
    })),
    dispatch:ticket=>queue(async()=>{
      if (!UUID.test(ticket||'')) fail('ticket_invalid');
      let intent;
      const readback=await exclusive(async()=>{
        const value=await readJournal(),active=value?.active;
        if (!active||active.ticket_id!==ticket) fail('ticket_unbound');
        if (active.state!=='PREPARED') return status(value,'EFFECT_ALREADY_ATTEMPTED');
        if (at()<active.not_before_ms) return status(value,'BACKOFF_PENDING');
        await unchanged(active);
        intent=await save({...value,sha256:undefined,revision:value.revision+1,active:{...active,state:'DISPATCH_INTENT'}});
        return status(intent);
      });
      // Release the mutex BEFORE requesting process exit. A successor may then
      // read/ack the durable barrier even if the old process exits immediately.
      if (!intent) return readback;
      let outcome='REQUESTED';
      try {await gate(intent.active.gate_epoch);await adapter.requestRelaunch(ticket,intent.active.origin_browser);}
      catch {outcome='AMBIGUOUS';}
      return exclusive(async()=>{
        const latest=await readJournal();
        if (latest?.active.ticket_id!==ticket) fail('journal_dispatch_changed');
        if (latest.active.state!=='DISPATCH_INTENT') return status(latest);
        return status(await save({...latest,sha256:undefined,revision:latest.revision+1,active:{...latest.active,state:outcome}}));
      });
    }),
    acknowledgeSuccessor:ticket=>queue(()=>exclusive(async()=>{
      if (!UUID.test(ticket||'')) fail('ticket_invalid');
      const value=await readJournal(),active=value?.active;
      if (!active||active.ticket_id!==ticket) fail('ticket_unbound');
      if (active.state==='CONFIRMED') return status(value,'ALREADY_RECORDED');
      if (!['DISPATCH_INTENT','REQUESTED','AMBIGUOUS'].includes(active.state)) fail('effect_barrier_not_crossed');
      const acknowledgementGate = await gate();
      const binding=await readBinding(),browser=await adapter.capture();
      if (!same(pins(binding),active.binding)||binding.normal_bootstrap_ready!==true||!binding.host
        || binding.host.instance_id===active.host.instance_id||binding.host.launch_nonce===active.host.launch_nonce
        || !validBrowser(browser)||sameRuntimeRecoveryProcess(browser,active.origin_browser)
        || browser.executable_sha256!==active.origin_browser.executable_sha256
        || path.resolve(browser.executable).toLowerCase()!==path.resolve(active.origin_browser.executable).toLowerCase()) fail('successor_bootstrap_unproven');
      const previous=await adapter.readProcess(active.origin_browser.pid);
      if (previous?.schema!=='metaengine.browser.runtime-recovery-process.v1'||previous.pid!==active.origin_browser.pid||previous.authority_effect!==false
        || !(previous.state==='ABSENT'||previous.state==='PRESENT'&&/^[1-9][0-9]{16,18}$/.test(previous.created_100ns||'')
          && previous.created_100ns!==active.origin_browser.created_100ns)) fail('old_browser_exit_unproven');
      // Native readback awaits may overlap stop/cancel or a new gate epoch.
      // Do not turn that invalidated observation into a durable success receipt.
      await gate(acknowledgementGate.epoch);
      const clock=at();if(clock<active.prepared_at_ms)fail('clock_regressed');
      return status(await save({...value,sha256:undefined,revision:value.revision+1,
        active:{...active,state:'CONFIRMED',new_browser:browser,new_host:binding.host,confirmed_at_ms:clock}}));
    })),
    read:()=>queue(()=>exclusive(async()=>status(await readJournal()))),
    cancel:()=>{cancelled=true;},
  };
  return Object.freeze(api);
}
