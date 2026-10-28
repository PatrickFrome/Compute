import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const INTERRUPTED_SETUP_REQUEST_SCHEMA = 'metaengine.client.interrupted-setup-request.v1';
export const INTERRUPTED_SETUP_STATUS_SCHEMA = 'metaengine.client.interrupted-setup-status.v1';
const ARCHIVE_SCHEMA = 'metaengine.client.interrupted-setup-archive.v1';
const RECEIPT_SCHEMA = 'metaengine.client.interrupted-setup-receipt.v1';
const ID_RE = /^recovery_[a-f0-9-]{36}$/i;
const SHA_RE = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : value;
export const interruptedSetupDigest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function interruptedSetupIdentity(snapshot = {}) {
  const state = snapshot.keepalive || {};
  return {
    supervisor_epoch: state.supervisor_epoch,
    cycle_seq: state.cycle_seq,
    process_incarnation_id: state.process_incarnation_id,
    predecessor_process_incarnation_id: state.predecessor_process_incarnation_id,
    predecessor_fenced_at: state.predecessor_fenced_at,
    pending_wake: state.pending_wake || null,
    active_wake: state.active_wake || null,
    conversation_url: state.conversation_url || null,
    rollover_attempt: state.rollover_attempt || null,
    admission_generation_floor: state.admission_generation_floor,
    agents: (snapshot.fleet?.agents || []).filter(row => row.lifecycle_state !== 'RETIRED').map(row => ({
      agent_id: row.agent_id, lifecycle_state: row.lifecycle_state, generation_epoch: row.generation_epoch,
      tab_id: row.tab_id || null, target_id: row.target_id || null, ambiguous_reason: row.ambiguous_reason || null,
      conversation_url_sha256: row.conversation_url_sha256 || null, transport_proof: row.transport_proof || null,
    })).sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id))),
  };
}

export function planInterruptedSetupRecovery(snapshot = {}) {
  const keepalive = snapshot.keepalive;
  const pending = keepalive?.pending_wake;
  const agents = snapshot.fleet?.agents;
  let reason = null;
  if (!keepalive || !Array.isArray(agents) || !Array.isArray(snapshot.tabs)) reason = 'CURRENT_NATIVE_CENSUS_UNAVAILABLE';
  else if (keepalive.conversation_url || keepalive.active_wake || keepalive.rollover_attempt) reason = 'BOUND_OR_ACTIVE_SETUP_REQUIRES_READBACK';
  else if (!pending?.ambiguous_at || !pending.wake_id || pending.automatic_retry_allowed !== false) reason = 'UNRESOLVED_BOOTSTRAP_WAKE_REQUIRED';
  else if (!pending.process_incarnation_id || !keepalive.process_incarnation_id
    || pending.process_incarnation_id === keepalive.process_incarnation_id) reason = 'CROSS_PROCESS_BOUNDARY_REQUIRED';
  else if (!keepalive.predecessor_fenced_at || !pending.process_boundary_fenced_at) reason = 'DURABLE_PREDECESSOR_FENCE_REQUIRED';
  const active = Array.isArray(agents) ? agents.filter(row => row.lifecycle_state !== 'RETIRED') : [];
  if (!reason && active.some(row => row.lifecycle_state !== 'PROVISIONING_AMBIGUOUS'
    || row.ambiguous_reason !== 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING'
    || row.transport_proof || row.conversation_url_sha256)) reason = 'NON_BOOTSTRAP_AGENT_REQUIRES_READBACK';
  const previousTabs = new Set([
    pending?.ambiguity_continuation_tab_id,
    ...active.map(row => row.tab_id),
  ].filter(Boolean).map(String));
  if (!reason && snapshot.tabs.some(tab => previousTabs.has(String(tab.tab_id || '')))) reason = 'PREDECESSOR_TARGET_STILL_PRESENT';
  // An unbound lifecycle normally discovers arbitrary existing conversations.
  // Require their absence so the new incarnation cannot inherit one by URL.
  if (!reason && snapshot.tabs.some(tab => /^https:\/\/(?:www\.)?chatgpt\.com\/c\//i.test(String(tab.url || '')))) reason = 'EXISTING_CONVERSATION_REQUIRES_READBACK';
  if (!reason && (!Number.isSafeInteger(keepalive.supervisor_epoch) || keepalive.supervisor_epoch < 1
    || keepalive.supervisor_epoch >= Number.MAX_SAFE_INTEGER)) reason = 'SUPERVISOR_EPOCH_INVALID';
  const identity = interruptedSetupIdentity(snapshot);
  return Object.freeze({
    schema: INTERRUPTED_SETUP_STATUS_SCHEMA,
    eligible: reason === null,
    reason: reason || 'FENCED_PREDECESSOR_BOOTSTRAP_ONLY',
    expected_recovery_sha256: interruptedSetupDigest(identity),
    supervisor_wake_id: pending?.wake_id || null,
    predecessor_process_incarnation_id: pending?.process_incarnation_id || null,
    current_process_incarnation_id: keepalive?.process_incarnation_id || null,
    expected_admission_generation_floor: keepalive?.admission_generation_floor ?? null,
    next_supervisor_epoch: reason ? null : keepalive.supervisor_epoch + 1,
    affected_agent_count: active.length,
    affected_agent_ids: active.map(row => row.agent_id),
    previous_effect_outcome: 'UNKNOWN',
    previous_effect_replayed: false,
    marks_agent_active: false,
    tasks_modified: false,
    sql_admission_modified: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function validateInterruptedSetupRequest(request, plan) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some(key => !['schema', 'action', 'operator_initiated', 'expected_recovery_sha256'].includes(key))
    || request.schema !== INTERRUPTED_SETUP_REQUEST_SCHEMA
    || request.operator_initiated !== true || request.action !== 'ARCHIVE_INTERRUPTED_SETUP_AND_START_NEW') {
    throw new Error('interrupted_setup_explicit_typed_action_required');
  }
  if (!SHA_RE.test(String(request.expected_recovery_sha256 || ''))
    || request.expected_recovery_sha256 !== plan.expected_recovery_sha256) throw new Error('interrupted_setup_readback_changed');
  if (!plan.eligible) throw new Error(`interrupted_setup_blocked:${plan.reason}`);
}

async function writeExclusiveDurable(file, value, fileSystem, verifyFile) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await fileSystem.open(file, 'wx', 0o600);
  let closed = false;
  try {
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
  } finally {
    if (!closed) await handle.close().catch(() => {});
  }
  const readback = await fileSystem.readFile(file, 'utf8');
  if (readback !== bytes) throw new Error('interrupted_setup_durable_readback_mismatch');
  if (verifyFile) await verifyFile(file);
}

// The caller supplies a protected profile directory and one native mutation
// hold. Each checkpoint is exclusive and immutable. An interrupted apply is
// fenced on the next process start; it never retries a historical browser send.
export class InterruptedSetupRecovery {
  #directory; #fs; #snapshot; #applyFleet; #applySupervisor; #clock; #uuid; #verifyDirectory; #verifyFile; #running = null; #fenced = false; #last = null;
  constructor({ directory, getSnapshot, applyFleet, applySupervisor, fileSystem = fs,
    clock = () => Date.now(), uuid = () => crypto.randomUUID(), verifyDirectory = null, verifyFile = null } = {}) {
    if (!path.isAbsolute(String(directory || '')) || ![getSnapshot, applyFleet, applySupervisor].every(fn => typeof fn === 'function')) {
      throw new Error('interrupted_setup_dependencies_invalid');
    }
    this.#directory = directory; this.#snapshot = getSnapshot; this.#applyFleet = applyFleet; this.#applySupervisor = applySupervisor;
    this.#fs = fileSystem; this.#clock = clock; this.#uuid = uuid;
    if (verifyDirectory != null && typeof verifyDirectory !== 'function' || verifyFile != null && typeof verifyFile !== 'function') throw new Error('interrupted_setup_storage_verifier_invalid');
    this.#verifyDirectory = verifyDirectory; this.#verifyFile = verifyFile;
  }
  async init() {
    try {
      return await this.#readInitialState();
    } catch (error) {
      // An unreadable or invalid recovery record is unknown durable intent,
      // never permission to run another recovery on this same instance.
      this.#fenced = true;
      throw error;
    }
  }
  async #readInitialState() {
    await this.#fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const directoryStat = await this.#fs.lstat(this.#directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) { this.#fenced = true; throw new Error('interrupted_setup_directory_alias_forbidden'); }
    if (this.#verifyDirectory) await this.#verifyDirectory(this.#directory);
    const entries = await this.#fs.readdir(this.#directory);
    const names = new Set(entries);
    for (const name of entries) {
      const checkpoint = /^(recovery_[a-f0-9-]{36})\.(?:fleet-applied|committed)\.json$/i.exec(name);
      if (checkpoint && !names.has(`${checkpoint[1]}.archive.json`)) {
        throw new Error('interrupted_setup_orphan_checkpoint');
      }
    }
    for (const name of entries.filter(name => /^recovery_[a-f0-9-]{36}\.archive\.json$/i.test(name))) {
      const stat = await this.#fs.lstat(path.join(this.#directory, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) { this.#fenced = true; throw new Error('interrupted_setup_archive_alias_forbidden'); }
      const id = name.slice(0, -'.archive.json'.length);
      if (this.#verifyFile) await this.#verifyFile(path.join(this.#directory, name));
      const archive = await this.#fs.readFile(path.join(this.#directory, name), 'utf8').then(JSON.parse).catch(error => { this.#fenced = true; throw error; });
      if (archive.schema !== ARCHIVE_SCHEMA || archive.recovery_id !== id) throw new Error('interrupted_setup_archive_invalid');
      const committed = entries.includes(`${id}.committed.json`);
      if (!committed) { this.#fenced = true; this.#last = { recovery_id: id, state: 'APPLY_READBACK_REQUIRED' }; }
      else {
        const receiptStat = await this.#fs.lstat(path.join(this.#directory, `${id}.committed.json`));
        if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.nlink !== 1) { this.#fenced = true; throw new Error('interrupted_setup_commit_alias_forbidden'); }
        if (this.#verifyFile) await this.#verifyFile(path.join(this.#directory, `${id}.committed.json`));
        const receipt = await this.#fs.readFile(path.join(this.#directory, `${id}.committed.json`), 'utf8').then(JSON.parse);
        if (receipt.schema !== RECEIPT_SCHEMA || receipt.recovery_id !== id || receipt.state !== 'FRESH_SETUP_PREPARED'
          || receipt.archive_sha256 !== interruptedSetupDigest(archive)) throw new Error('interrupted_setup_commit_invalid');
      }
    }
    return this.status();
  }
  status() {
    return Object.freeze({ schema: INTERRUPTED_SETUP_STATUS_SCHEMA, fenced: this.#fenced,
      recovery_id: this.#last?.recovery_id || null, state: this.#last?.state || 'NONE',
      previous_effect_outcome: 'UNKNOWN', previous_effect_replayed: false, automatic_retry_allowed: false, authority_effect: false });
  }
  async inspect() {
    const plan = planInterruptedSetupRecovery(await this.#snapshot());
    return { ...plan, ...this.status(), eligible: plan.eligible && !this.#fenced,
      reason: this.#fenced ? 'INCOMPLETE_RECOVERY_READBACK_REQUIRED' : plan.reason };
  }
  async execute(request) {
    if (this.#running) throw new Error('interrupted_setup_action_in_flight');
    if (this.#fenced) throw new Error('interrupted_setup_incomplete_recovery_fenced');
    this.#running = this.#execute(request);
    try { return await this.#running; } finally { this.#running = null; }
  }
  async #execute(request) {
    const snapshot = await this.#snapshot();
    const plan = planInterruptedSetupRecovery(snapshot);
    validateInterruptedSetupRequest(request, plan);
    const id = `recovery_${this.#uuid()}`;
    if (!ID_RE.test(id)) throw new Error('interrupted_setup_recovery_id_invalid');
    const at = new Date(this.#clock()).toISOString();
    const archive = {
      schema: ARCHIVE_SCHEMA, recovery_id: id, created_at: at,
      event: 'OPERATOR_ARCHIVED_UNKNOWN_PREDECESSOR_BOOTSTRAP',
      previous_effect_outcome: 'UNKNOWN', previous_effect_replayed: false,
      explicit_request: clone(request), expected_recovery_sha256: plan.expected_recovery_sha256,
      keepalive: clone(snapshot.keepalive), fleet: clone(snapshot.fleet),
      automatic_retry_allowed: false, tasks_modified: false, sql_admission_modified: false, authority_effect: false,
    };
    // Fence before the archive write: partial bytes, failed fsync or close are
    // uncertain durable intent. No mutation or automatic second action follows.
    this.#fenced = true; this.#last = { recovery_id: id, state: 'ARCHIVE_READBACK_REQUIRED' };
    await writeExclusiveDurable(path.join(this.#directory, `${id}.archive.json`), archive, this.#fs, this.#verifyFile);
    const current = await this.#snapshot();
    if (interruptedSetupDigest(interruptedSetupIdentity(current)) !== plan.expected_recovery_sha256
      || !planInterruptedSetupRecovery(current).eligible) throw new Error('interrupted_setup_readback_changed_after_archive');
    const binding = { recovery_id: id, archive_sha256: interruptedSetupDigest(archive), plan,
      expected_pending_wake: clone(snapshot.keepalive.pending_wake), expected_agents: clone(snapshot.fleet.agents.filter(row => plan.affected_agent_ids.includes(row.agent_id))) };
    await this.#applyFleet(binding);
    this.#last.state = 'FLEET_ARCHIVED_SUPERVISOR_READBACK_REQUIRED';
    await writeExclusiveDurable(path.join(this.#directory, `${id}.fleet-applied.json`), {
      recovery_id: id, state: this.#last.state, archive_sha256: binding.archive_sha256, previous_effect_outcome: 'UNKNOWN', at,
    }, this.#fs, this.#verifyFile);
    const beforeSupervisor = await this.#snapshot();
    const oldAgents = new Set(plan.affected_agent_ids);
    const fleetReadbackConfirmed = state => Array.isArray(state.fleet?.agents)
      && [...oldAgents].every(id => state.fleet.agents.filter(row => row.agent_id === id && row.lifecycle_state === 'RETIRED').length === 1)
      && state.fleet.agents.every(row => row.lifecycle_state === 'RETIRED');
    // Preserve the original target list when checking census after retirement:
    // retired rows intentionally no longer contain their old tab bindings.
    if (!fleetReadbackConfirmed(beforeSupervisor)
      || !planInterruptedSetupRecovery({ ...beforeSupervisor, fleet: snapshot.fleet }).eligible
      || interruptedSetupDigest(interruptedSetupIdentity({ ...beforeSupervisor, fleet: snapshot.fleet })) !== plan.expected_recovery_sha256) {
      throw new Error('interrupted_setup_readback_changed_before_supervisor');
    }
    await this.#applySupervisor(binding);
    const after = await this.#snapshot();
    const afterAgents = after.fleet?.agents;
    const priorTabs = new Set([snapshot.keepalive.pending_wake?.ambiguity_continuation_tab_id,
      ...snapshot.fleet.agents.map(row => row.tab_id)].filter(Boolean));
    if (after.keepalive?.pending_wake || after.keepalive?.active_wake || after.keepalive?.conversation_url
      || after.keepalive?.rollover_attempt
      || after.keepalive?.process_incarnation_id !== plan.current_process_incarnation_id
      || after.keepalive?.admission_generation_floor !== plan.expected_admission_generation_floor
      || after.keepalive?.supervisor_epoch !== plan.next_supervisor_epoch
      || !(after.keepalive?.ambiguous_history || []).some(row => row.wake_id === plan.supervisor_wake_id && row.operator_recovery_id === id)
      || !Array.isArray(afterAgents)
      || !Array.isArray(after.tabs)
      || after.tabs.some(tab => priorTabs.has(tab.tab_id) || /^https:\/\/(?:www\.)?chatgpt\.com\/c\//i.test(String(tab.url || '')))
      || !fleetReadbackConfirmed(after)
      || [...oldAgents].some(id => afterAgents.filter(row => row.agent_id === id && row.lifecycle_state === 'RETIRED').length !== 1)
      || afterAgents.some(row => oldAgents.has(row.agent_id) && row.lifecycle_state !== 'RETIRED')) {
      throw new Error('interrupted_setup_apply_readback_unconfirmed');
    }
    const receipt = { schema: RECEIPT_SCHEMA, recovery_id: id,
      state: 'FRESH_SETUP_PREPARED', archive_sha256: binding.archive_sha256, previous_effect_outcome: 'UNKNOWN',
      previous_effect_replayed: false, supervisor_epoch: plan.next_supervisor_epoch, retired_agent_count: oldAgents.size,
      automatic_retry_allowed: false, tasks_modified: false, sql_admission_modified: false, authority_effect: false, at };
    await writeExclusiveDurable(path.join(this.#directory, `${id}.committed.json`), receipt, this.#fs, this.#verifyFile);
    this.#last = { recovery_id: id, state: receipt.state }; this.#fenced = false;
    return Object.freeze(receipt);
  }
}
