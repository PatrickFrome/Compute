// Agent Toolbelt — Tier 2 item 4 (agent→tools break).
//
// The execution side of the agent tool protocol: harvests TOOL_REQUEST_V1
// blocks (parsed by agent-tool-protocol.mjs from the agent conversation),
// issues each as a command-plane command through the device-authenticated
// edge route /v1/commands/issue-tool, and harvests the terminal receipts.
//
// Every issued command carries per-agent attribution:
//   issued_by = agent:<agent_id>   (edge + DB row provenance)
//   payload.rsi_task = { task_id, agent_id }   → the Outcome River binds it
//     pre-execution, so one served tool request becomes one durable
//     experience case (the toolbelt is the river's primary producer).
//
// The commands execute through the SAME lane machinery as operator commands
// (lease batch → lane scheduler → exact-target fencing → v2 receipt), so
// agents gain tools without any new execution authority path. Conversation
// mutation stays dispatch-only: the tool allowlist is read + navigation.

import { AGENT_TOOL_PROTOCOL_SCHEMA, AGENT_TOOL_ACTIONS } from './agent-tool-protocol.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_RE = /^tab_[0-9a-f-]{36}$/i;
const MAX_COMMANDS_PER_LEASE = 8;
const MAX_SERVED_RESULTS = 128;
const RESULT_SUMMARY_CLIP = 4000;

function clip(value, max) { return String(value ?? '').slice(0, max); }

function leaseKey(lease) {
  const taskId = String(lease?.task_id || '').toLowerCase();
  const generation = Number(lease?.lease_generation);
  if (!UUID_RE.test(taskId) || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('agent_toolbelt_lease_invalid');
  }
  return `${taskId}:${generation}`;
}

export class AgentToolbelt {
  #signedRequest;
  #maxCommandsPerLease;
  // key `${task_id}:${lease_generation}` → served/issued request rows.
  #byLease = new Map();
  // One overflow result per lease; budget denials cannot grow its request map.
  #budgetWitnesses = new Map();
  // request_id → terminal result row (bounded LRU across ALL leases).
  #results = new Map();
  #counters = { requests_parsed: 0, requests_issued: 0, requests_unavailable: 0, results_terminal: 0, issue_errors: 0, route_unavailable_streak: 0 };
  #lastError = null;
  #projectRuntime = null;

  constructor({ signedRequest, maxCommandsPerLease = MAX_COMMANDS_PER_LEASE } = {}) {
    if (typeof signedRequest !== 'function') throw new Error('agent_toolbelt_signed_request_required');
    if (!Number.isSafeInteger(maxCommandsPerLease) || maxCommandsPerLease < 1 || maxCommandsPerLease > 32) throw new Error('agent_toolbelt_budget_invalid');
    this.#signedRequest = signedRequest;
    this.#maxCommandsPerLease = maxCommandsPerLease;
  }

  bindProjectRuntime(runtime) {
    if (runtime != null && typeof runtime.serveToolRequests !== 'function') throw new Error('agent_toolbelt_project_runtime_invalid');
    this.#projectRuntime = runtime;
  }

  #leaseRows(key) {
    let rows = this.#byLease.get(key);
    if (!rows) { rows = new Map(); this.#byLease.set(key, rows); }
    return rows;
  }

  #rememberResult(row) {
    this.#results.set(row.request_id, row);
    while (this.#results.size > MAX_SERVED_RESULTS) {
      this.#results.delete(this.#results.keys().next().value);
    }
  }

  // Serve parsed requests for a lease. Never throws — unavailable/failed
  // requests degrade to UNAVAILABLE results the agent can see.
  async serveToolRequests({ lease, requests } = {}) {
    const key = leaseKey(lease);
    const agentId = String(lease?.agent_id || '').toLowerCase();
    const tabId = String(lease?.tab_id || '');
    if (!AGENT_RE.test(agentId)) return { issued: [], unavailable: [], error: 'agent_toolbelt_agent_invalid' };
    const rows = this.#leaseRows(key);
    const issued = [];
    const unavailable = [];
    const deny = (requestId, reason, { effectUnknown = false } = {}) => {
      unavailable.push({ request_id: requestId, status: 'UNAVAILABLE', reason });
      if (reason === 'BUDGET_EXHAUSTED' && this.#budgetWitnesses.has(key)) return;
      const row = {
        request_id: requestId,
        action: null,
        status: 'UNAVAILABLE',
        summary: `reason=${reason}${effectUnknown ? '; effect=UNKNOWN; readback_required=true; automatic_retry_allowed=false' : ''}`,
        ...(effectUnknown ? {effect_unknown:true} : {}),
        at: new Date().toISOString(),
        for_agent: agentId,
        command_id: null,
      };
      if (reason === 'BUDGET_EXHAUSTED') this.#budgetWitnesses.set(key, row);
      else rows.set(requestId, row);
      this.#rememberResult(row);
      this.#counters.requests_unavailable += 1;
    };
    const list = Array.isArray(requests) ? requests : [];
    this.#counters.requests_parsed += list.length;
    for (const request of list) {
      const requestId = String(request?.request_id || '');
      const action = String(request?.action || '').toUpperCase();
      if (!requestId || rows.has(requestId) || this.#budgetWitnesses.get(key)?.request_id === requestId) continue;
      if (rows.size >= this.#maxCommandsPerLease) { deny(requestId, 'BUDGET_EXHAUSTED'); continue; }
      if (!AGENT_TOOL_ACTIONS.includes(action)) { deny(requestId, 'ACTION_NOT_ALLOWED'); continue; }
      if (['PROJECT_SPAWN', 'PROJECT_HISTORY', 'PROJECT_MESSAGE', 'PROJECT_ACK_MESSAGE'].includes(action)) {
        if (!this.#projectRuntime) { deny(requestId, 'PROJECT_RUNTIME_UNAVAILABLE'); continue; }
        try {
          const results = await this.#projectRuntime.serveToolRequests({ lease, requests: [request] });
          for (const result of results) {
            const row = { ...result, action, for_agent: agentId, at: new Date().toISOString(), command_id: null };
            rows.set(requestId, row); this.#rememberResult(row);
            issued.push({ request_id: requestId, action, project_result: true });
          }
        } catch { deny(requestId, 'PROJECT_REQUEST_FENCED_OR_AMBIGUOUS', { effectUnknown: true }); }
        continue;
      }
      // Project suspension requires durable custody BEFORE crossing the issue
      // barrier. Restart reuses an accepted command ID or holds UNKNOWN; it
      // never sends an already-journaled request again.
      let custody = null;
      if(typeof this.#projectRuntime?.beginToolEffect === 'function') {
        try { custody=await this.#projectRuntime.beginToolEffect(lease,request); }
        catch { deny(requestId,'TOOL_EFFECT_CUSTODY_UNAVAILABLE',{effectUnknown:true}); continue; }
        if(custody?.state==='UNKNOWN') { deny(requestId,'TOOL_EFFECT_READBACK_REQUIRED',{effectUnknown:true});continue; }
        if(custody?.state==='RESOLVED') {
          const row={...custody.result,request_id:requestId,action,for_agent:agentId,at:new Date().toISOString()};
          rows.set(requestId,row);this.#rememberResult(row);continue;
        }
        if(custody?.state==='PENDING') {
          rows.set(requestId,{request_id:requestId,action,command_id:custody.command_id,status:'PENDING',summary:null,at:new Date().toISOString()});continue;
        }
      }
      const payload = { ...(request?.payload || {}) };
      if (!payload.tab_id && TAB_RE.test(tabId)) payload.tab_id = tabId;
      try {
        const response = await this.#signedRequest('/v1/commands/issue-tool', {
          payload: {
            action,
            payload,
            agent_id: agentId,
            request_id: requestId,
            task_id: String(lease.task_id).toLowerCase(),
            tab_id: TAB_RE.test(tabId) ? tabId : null,
          },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.accepted !== true || !body?.command_id) {
          const reason = response.status === 404 ? 'EDGE_ROUTE_UNAVAILABLE' : clip(body?.error || body?.reason || `HTTP_${response.status}`, 120);
          if (response.status === 404) this.#counters.route_unavailable_streak += 1;
          // A server error or malformed success may follow a committed issue.
          // Report uncertainty rather than claiming that no command exists.
          const effectUnknown=response.ok === true || response.status >= 500;
          deny(requestId, reason, { effectUnknown });
          if(!effectUnknown && custody?.state==='NEW') await this.#projectRuntime.resolveToolEffect(lease,requestId,rows.get(requestId));
          continue;
        }
        if(custody?.state==='NEW') await this.#projectRuntime.ackToolEffect(lease,requestId,String(body.command_id));
        this.#counters.route_unavailable_streak = 0;
        const row = {
          request_id: requestId,
          action,
          command_id: String(body.command_id),
          status: 'PENDING',
          summary: null,
          at: new Date().toISOString(),
        };
        rows.set(requestId, row);
        issued.push({ request_id: requestId, action, command_id: row.command_id });
        this.#counters.requests_issued += 1;
      } catch (error) {
        this.#counters.issue_errors += 1;
        this.#lastError = clip(error?.message || error, 240);
        deny(requestId, 'ISSUE_TRANSPORT_ERROR', { effectUnknown: true });
      }
    }
    return { issued, unavailable };
  }

  // Harvest terminal receipts for a lease's issued commands. Read-only; never
  // throws. Returns the rows that reached a terminal state this pass.
  async harvestResults({ lease } = {}) {
    const key = leaseKey(lease);
    const rows = this.#byLease.get(key);
    const agentId = String(lease?.agent_id || '').toLowerCase();
    if (!rows || rows.size === 0) return [];
    const terminal = [];
    for (const row of rows.values()) {
      if (row.status !== 'PENDING') continue;
      try {
        const response = await this.#signedRequest(`/v1/commands/${encodeURIComponent(row.command_id)}/receipt`, { method: 'GET' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.found !== true) continue;
        if (body?.terminal !== true) continue;
        const status = String(body.status || '').toUpperCase();
        // A malformed terminal envelope must not turn UNKNOWN/AMBIGUOUS into
        // resolved custody merely because it is displayable.
        if (!['COMPLETED','FAILED'].includes(status)) continue;
        const summaryRaw = body?.receipt?.result ?? body?.receipt?.error ?? null;
        const summary = summaryRaw == null ? '' : (typeof summaryRaw === 'string' ? summaryRaw : JSON.stringify(summaryRaw));
        const resultSummary=clip(String(summary).replace(/\s+/g, ' ').trim(), RESULT_SUMMARY_CLIP);
        if(typeof this.#projectRuntime?.resolveToolEffect==='function') await this.#projectRuntime.resolveToolEffect(lease,row.request_id,
          {request_id:row.request_id,action:row.action,status,summary:resultSummary,command_id:row.command_id});
        row.status = status;
        row.summary = resultSummary;
        row.at = new Date().toISOString();
        this.#rememberResult({
          request_id: row.request_id,
          action: row.action,
          status: row.status,
          summary: row.summary,
          at: row.at,
          command_id: row.command_id,
          for_agent: agentId,
        });
        this.#counters.results_terminal += 1;
        terminal.push({ ...row });
      } catch (error) {
        this.#lastError = clip(error?.message || error, 240);
      }
    }
    return terminal;
  }

  pendingCount(lease) {
    const rows = this.#byLease.get(leaseKey(lease));
    if (!rows) return 0;
    let pending = 0;
    for (const row of rows.values()) if (row.status === 'PENDING') pending += 1;
    return pending;
  }

  // Terminal results for an agent's NEXT task message (immutable rows only).
  resultsForAgent(agentId, { limit = 4 } = {}) {
    const id = String(agentId || '').toLowerCase();
    const out = [];
    for (const row of this.#results.values()) {
      if (out.length >= limit) break;
      if (row.for_agent === id) out.push({ request_id: row.request_id, status: row.status, summary: row.summary });
    }
    return out;
  }

  resultsForLease(lease, { limit = 8 } = {}) {
    const key = leaseKey(lease);
    const rows = this.#byLease.get(key);
    if (!rows) return [];
    const budget = this.#budgetWitnesses.get(key);
    return [...rows.values(), ...(budget ? [budget] : [])].filter(row => ['COMPLETED', 'FAILED', 'UNAVAILABLE'].includes(row.status))
      .slice(0, limit).map(row => ({ request_id: row.request_id, status: row.status, summary: row.summary, ...(row.effect_unknown ? {effect_unknown:true} : {}) }));
  }

  snapshot() {
    let pending = 0;
    let issued = 0;
    for (const rows of this.#byLease.values()) {
      for (const row of rows.values()) {
        if (row.status !== 'UNAVAILABLE') issued += 1;
        if (row.status === 'PENDING') pending += 1;
      }
    }
    return Object.freeze({
      schema: AGENT_TOOL_PROTOCOL_SCHEMA,
      version: 1,
      state: 'READY',
      lease_count: this.#byLease.size,
      issued_command_count: issued,
      pending_command_count: pending,
      served_result_count: this.#results.size,
      counters: Object.freeze({ ...this.#counters }),
      last_error: this.#lastError,
      actions: [...AGENT_TOOL_ACTIONS],
      conversation_mutation_allowed: false,
      authority_effect: false,
    });
  }
}

export function agentToolbeltTrustRootSnapshot() {
  return Object.freeze({
    schema: 'metaengine.agent-toolbelt-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/agent-toolbelt-core.mjs',
    issued_commands_ride_command_plane: true,
    per_agent_attribution_required: true,
    outcome_river_binding_via_rsi_task: true,
    read_heavy_allowlist_only: false,
    browser_and_computer_shared_observation: true,
    computer_typed_actuation_allowed: true,
    computer_effects_require_existing_db_lease: true,
    conversation_mutation_allowed: false,
    results_delivered_on_next_task_message: true,
    execution_authority: false,
    authority_effect: false,
  });
}
