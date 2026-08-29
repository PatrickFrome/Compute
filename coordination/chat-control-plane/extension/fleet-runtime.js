(() => {
  "use strict";

  const STATE_KEY = "a2FleetRuntimeStateV1";
  const EVIDENCE_KEY = "a2FleetEvidenceBlackboardV1";
  const MAX_EVIDENCE = 512;
  const MAX_PROMPT_CHARS = 120000;
  const CHATGPT_ROOT = "https://chatgpt.com/";
  const SAFE = "SAFE_RETRY_PRE_ACTUATION";
  const AMBIGUOUS = "AMBIGUOUS_NO_RETRY";
  const ACTUATED = new Set(["ACTUATED", "VERIFIED"]);
  const dispatching = new Set();

  const nowIso = () => new Date().toISOString();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function trustedSidePanel(sender) {
    if (sender?.id !== chrome.runtime.id || typeof sender?.url !== "string") return false;
    try {
      const expected = new URL(chrome.runtime.getURL("sidepanel.html"));
      const actual = new URL(sender.url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch (_) { return false; }
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const raw = stored[STATE_KEY];
    return raw?.schema === "metaengine.a2-browser-operator.fleet-runtime.v1"
      ? raw
      : { schema: "metaengine.a2-browser-operator.fleet-runtime.v1", current_point_id: null, last_wave_id: null, assignments: {}, updated_at: nowIso(), authority_effect: false };
  }

  async function saveState(state) {
    const clean = { schema: "metaengine.a2-browser-operator.fleet-runtime.v1", current_point_id: state?.current_point_id || null, last_wave_id: state?.last_wave_id || null, assignments: { ...(state?.assignments || {}) }, updated_at: nowIso(), authority_effect: false };
    await chrome.storage.local.set({ [STATE_KEY]: clean });
    return clean;
  }

  async function evidenceRows() {
    const stored = await chrome.storage.local.get(EVIDENCE_KEY);
    return Array.isArray(stored[EVIDENCE_KEY]) ? stored[EVIDENCE_KEY] : [];
  }

  async function appendEvidence(row) {
    const rows = await evidenceRows();
    rows.push({ schema: "metaengine.a2-browser-operator.fleet-evidence.v1", ...row, raw_response_stored: false, authority_effect: false, recorded_at: row?.recorded_at || nowIso() });
    await chrome.storage.local.set({ [EVIDENCE_KEY]: rows.slice(-MAX_EVIDENCE) });
  }

  async function discover() {
    if (!globalThis.A2_TARGET_REGISTRY?.discoverOpenChats) throw new Error("fleet_target_registry_unavailable");
    return globalThis.A2_TARGET_REGISTRY.discoverOpenChats();
  }

  async function agents() {
    await discover();
    const targets = await globalThis.A2_TARGET_REGISTRY.listTargets();
    const state = await loadState();
    const selected = await globalThis.A2_TARGET_REGISTRY.selectedTargetId();
    return targets.map((target) => ({ ...target, lifecycle_state: target.status, selected: target.target_id === selected, active_assignment: state.assignments[target.agent_id] || null }));
  }

  async function status() {
    const rows = await agents();
    const state = await loadState();
    const evidence = await evidenceRows();
    const counts = { total: rows.length };
    for (const row of rows) counts[row.lifecycle_state] = Number(counts[row.lifecycle_state] || 0) + 1;
    return { schema: "metaengine.a2-browser-operator.fleet-status.v1", manager_pattern: true, provider_policy: "OPENAI_WEB_CHAT_ONLY", direct_peer_messaging: false, automatic_retry_allowed: false, one_active_assignment_per_agent: true, single_extension_actuator: true, current_point_id: state.current_point_id, last_wave_id: state.last_wave_id, selected_agent_id: await globalThis.A2_TARGET_REGISTRY.selectedTargetId(), counts, agents: rows, evidence: evidence.slice(-30), updated_at: nowIso(), authority_effect: false };
  }

  async function selectAgent(agentId) {
    const target = await globalThis.A2_TARGET_REGISTRY.selectTarget(agentId);
    return { agent: target, selected: true, authority_effect: false };
  }

  async function setRole(agentId, role) {
    const target = await globalThis.A2_TARGET_REGISTRY.setRole(agentId, role);
    return { agent: target, authority_effect: false };
  }

  function fleetPrompt({ waveId, pointId, agent, prompt }) {
    const body = String(prompt || "").slice(0, MAX_PROMPT_CHARS);
    if (!normalize(body)) throw new Error("fleet_prompt_empty");
    return ["A2 FLEET — SAME POINT", `fleet_wave_id=${waveId}`, `semantic_point=${pointId}`, `agent_id=${agent.agent_id}`, `agent_role=${agent.role}`, `conversation_epoch=${agent.conversation_epoch}`, "transport=WEB_CHAT_FLEET_REMOTE", "direct_peer_messaging=false", "Return your independent result for this semantic point. Do not assume that other fleet agents can see this response.", "", body].join("\n");
  }

  async function waitSnapshot(tabId, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const response = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" }); if (response?.ok && response.snapshot) return response.snapshot; } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    throw new Error("fleet_snapshot_timeout");
  }

  async function waitNewConversation(tabId, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.url && globalThis.A2_TARGET_REGISTRY.isConversationUrl(tab.url)) {
        await discover();
        const targetId = await globalThis.A2_TARGET_REGISTRY.targetForTab(tabId);
        if (!targetId) throw new Error("fleet_rollover_target_rebind_missing");
        return globalThis.A2_TARGET_REGISTRY.resolveLiveTab(targetId);
      }
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
    throw new Error("fleet_rollover_timeout");
  }

  async function sendWithRollover(agent, tab, command) {
    try { return await globalThis.A2_CHATGPT_TRUSTED_SEND(tab.id, command); }
    catch (error) {
      if (!String(error?.message || error).includes("chatgpt_cdp_conversation_exhausted")) throw error;
      await chrome.storage.local.set({ chatgptRolloverPending: true, chatgptRolloverPendingTabId: tab.id });
      try {
        await chrome.tabs.update(tab.id, { url: CHATGPT_ROOT, active: false });
        await waitSnapshot(tab.id, 10000);
        const result = await globalThis.A2_CHATGPT_TRUSTED_SEND(tab.id, command);
        await waitNewConversation(tab.id);
        return { ...result, rollover: true };
      } finally { await chrome.storage.local.set({ chatgptRolloverPending: false, chatgptRolloverPendingTabId: null }); }
    }
  }

  async function recordAssignment(agent, assignment) {
    const state = await loadState();
    if (state.assignments[agent.agent_id]) throw new Error(`fleet_agent_assignment_active:${agent.agent_id}`);
    state.assignments[agent.agent_id] = assignment;
    state.current_point_id = assignment.point_id;
    state.last_wave_id = assignment.wave_id;
    await saveState(state);
    await globalThis.A2_TARGET_REGISTRY.setStatus(agent.target_id, "BUSY");
  }

  async function updateAssignment(agentId, patch, { clear = false } = {}) {
    const state = await loadState();
    const current = state.assignments[agentId] || null;
    if (!current && !clear) return null;
    if (clear) delete state.assignments[agentId]; else state.assignments[agentId] = { ...current, ...patch };
    await saveState(state);
    return clear ? null : clone(state.assignments[agentId]);
  }

  async function dispatchOne(agent, pointId, prompt, waveId) {
    if (dispatching.has(agent.agent_id)) throw new Error(`fleet_agent_dispatch_inflight:${agent.agent_id}`);
    dispatching.add(agent.agent_id);
    try {
      if (agent.status !== "READY") throw new Error(`fleet_agent_not_ready:${agent.agent_id}:${agent.status}`);
      const live = await globalThis.A2_TARGET_REGISTRY.resolveLiveTab(agent.target_id);
      const before = await waitSnapshot(live.tab.id, 4000).catch(() => null);
      const assignmentId = crypto.randomUUID();
      const commandId = `fleet-${crypto.randomUUID()}`;
      const idempotencyKey = `fleet:${waveId}:${agent.agent_id}:e${agent.conversation_epoch}`;
      const assignment = { schema: "metaengine.a2-browser-operator.fleet-assignment.v1", assignment_id: assignmentId, wave_id: waveId, point_id: pointId, agent_id: agent.agent_id, target_id: agent.target_id, role: agent.role, conversation_epoch: agent.conversation_epoch, generation_epoch: 1, base_message_count: Number(before?.message_count || 0), command_id: commandId, idempotency_key: idempotencyKey, phase: "PRE_ACTUATION_DURABLE", assigned_at: nowIso(), automatic_retry_allowed: false, authority_effect: false };
      await recordAssignment(agent, assignment);
      const command = { command_id: commandId, idempotency_key: idempotencyKey, target_platform: "CHATGPT", prompt: fleetPrompt({ waveId, pointId, agent, prompt }) };
      let result;
      try { result = await sendWithRollover(agent, live.tab, command); }
      catch (error) {
        const executionClass = String(error?.a2ExecutionClass || SAFE);
        const terminal = executionClass === AMBIGUOUS;
        await updateAssignment(agent.agent_id, { phase: terminal ? "AMBIGUOUS_NO_RETRY" : "SAFE_PRE_ACTUATION_FAILURE", execution_class: executionClass, error: String(error?.message || error).slice(0, 500), failed_at: nowIso() }, { clear: !terminal });
        if (!terminal) await globalThis.A2_TARGET_REGISTRY.setStatus(agent.target_id, "READY").catch(() => {}); else await globalThis.A2_TARGET_REGISTRY.setStatus(agent.target_id, "DRAINING").catch(() => {});
        throw error;
      }
      const executionClass = String(result?.execution_class || "ACTUATED");
      await updateAssignment(agent.agent_id, { phase: ACTUATED.has(executionClass) ? "AWAITING_RESPONSE" : "DISPATCHED", execution_class: executionClass, dispatched_at: nowIso(), rollover: result?.rollover === true });
      return { agent_id: agent.agent_id, assignment_id: assignmentId, command_id: commandId, status: result?.status || "SENT", execution_class: executionClass, rollover: result?.rollover === true, authority_effect: true };
    } finally { dispatching.delete(agent.agent_id); }
  }

  async function dispatch({ point_id, prompt, agent_ids } = {}) {
    const local = await chrome.storage.local.get("armed");
    if (local.armed !== true) throw new Error("fleet_dispatch_arm_required");
    const pointId = normalize(point_id).slice(0, 128);
    if (!pointId) throw new Error("fleet_point_id_required");
    const body = String(prompt || "");
    if (!normalize(body) || body.length > MAX_PROMPT_CHARS) throw new Error("fleet_prompt_invalid");
    const currentAgents = await agents();
    const requested = Array.isArray(agent_ids) && agent_ids.length ? new Set(agent_ids.map((v) => String(v || "").toLowerCase())) : new Set(currentAgents.filter((a) => a.status === "READY").map((a) => a.agent_id));
    const selected = currentAgents.filter((agent) => requested.has(agent.agent_id));
    if (!selected.length) throw new Error("fleet_dispatch_no_agents");
    const waveId = crypto.randomUUID();
    const results = [];
    for (const agent of selected) {
      try { results.push(await dispatchOne(agent, pointId, body, waveId)); }
      catch (error) { results.push({ agent_id: agent.agent_id, status: "FAILED", error: String(error?.message || error), execution_class: String(error?.a2ExecutionClass || SAFE), authority_effect: false }); }
    }
    return { schema: "metaengine.a2-browser-operator.fleet-wave-receipt.v1", wave_id: waveId, point_id: pointId, agent_count: selected.length, results, automatic_retry_allowed: false, direct_peer_messaging: false, authority_effect: results.some((row) => row.authority_effect === true) };
  }

  async function ingestSnapshot(tab, snapshot) {
    if (!tab?.id || snapshot?.platform !== "CHATGPT") return { accepted: false, reason: "snapshot_not_chatgpt" };
    const supervisorTab = (await chrome.storage.local.get("a2SupervisorChatTabIdV1")).a2SupervisorChatTabIdV1;
    if (Number(supervisorTab) === Number(tab.id)) return { accepted: false, reason: "supervisor_chat_excluded" };
    await globalThis.A2_TARGET_REGISTRY.bindObservedTab(tab);
    const targetId = await globalThis.A2_TARGET_REGISTRY.targetForTab(tab.id);
    if (!targetId) return { accepted: false, reason: "fleet_target_unmanaged" };
    const target = await globalThis.A2_TARGET_REGISTRY.getTarget(targetId);
    if (!target) return { accepted: false, reason: "fleet_target_missing" };
    const envelope = { schema: "metaengine.a2-browser-operator.fleet-snapshot.v1", agent_id: target.agent_id, target_id: target.target_id, conversation_epoch: target.conversation_epoch, observed_at: nowIso(), snapshot };
    await chrome.storage.local.set({ [`snapshot:agent:${target.agent_id}`]: envelope, ...(target.target_id === await globalThis.A2_TARGET_REGISTRY.selectedTargetId() ? { "snapshot:CHATGPT": { snapshot, observed_at: envelope.observed_at } } : {}) });
    const state = await loadState();
    const assignment = state.assignments[target.agent_id] || null;
    if (assignment) {
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const last = messages[messages.length - 1] || null;
      const completed = snapshot.generating !== true && Number(snapshot.message_count || 0) >= Number(assignment.base_message_count || 0) + 2 && String(last?.role || "").toLowerCase() === "assistant" && Boolean(last?.text_sha256);
      if (completed) {
        await appendEvidence({ event_type: "WORK_COMPLETED", agent_id: target.agent_id, role: target.role, assignment_id: assignment.assignment_id, wave_id: assignment.wave_id, point_id: assignment.point_id, conversation_epoch: target.conversation_epoch, content_digest: last.text_sha256, message_count: Number(snapshot.message_count || 0) });
        await updateAssignment(target.agent_id, null, { clear: true });
        await globalThis.A2_TARGET_REGISTRY.setStatus(target.target_id, "READY").catch(() => {});
      }
    }
    return { accepted: true, role: "FLEET_AGENT", agent_id: target.agent_id, target_id: target.target_id };
  }

  async function markTabLost(tabId) {
    const targetId = await globalThis.A2_TARGET_REGISTRY.targetForTab(tabId);
    if (!targetId) return;
    const target = await globalThis.A2_TARGET_REGISTRY.getTarget(targetId);
    const state = await loadState();
    const assignment = target ? state.assignments[target.agent_id] : null;
    if (target && assignment) {
      await updateAssignment(target.agent_id, { phase: "AMBIGUOUS_NO_RETRY", execution_class: AMBIGUOUS, error: "fleet_tab_lost_after_assignment", failed_at: nowIso() });
      await appendEvidence({ event_type: "WORK_LOST_AMBIGUOUS", agent_id: target.agent_id, assignment_id: assignment.assignment_id, wave_id: assignment.wave_id, point_id: assignment.point_id, conversation_epoch: target.conversation_epoch, content_digest: null });
      await globalThis.A2_TARGET_REGISTRY.setStatus(target.target_id, "LOST").catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (type === "CHAT_SNAPSHOT" && sender?.tab?.id && message.snapshot) {
      ingestSnapshot(sender.tab, message.snapshot).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (!["A2_FLEET_STATUS", "A2_FLEET_DISCOVER", "A2_FLEET_SELECT", "A2_FLEET_SET_ROLE", "A2_FLEET_DISPATCH"].includes(type)) return false;
    if (!trustedSidePanel(sender)) { sendResponse({ ok: false, error: "fleet_sender_not_trusted" }); return false; }
    const job = type === "A2_FLEET_STATUS" ? status() : type === "A2_FLEET_DISCOVER" ? discover().then(status) : type === "A2_FLEET_SELECT" ? selectAgent(message?.agent_id) : type === "A2_FLEET_SET_ROLE" ? setRole(message?.agent_id, message?.role) : dispatch(message || {});
    Promise.resolve(job).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => { markTabLost(tabId).catch(() => {}); });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (typeof changeInfo?.url === "string") discover().catch(() => {}); });

  globalThis.A2_FLEET_STATUS = status;
  globalThis.A2_FLEET_DISCOVER = discover;
  globalThis.A2_FLEET_SELECT = selectAgent;
  globalThis.A2_FLEET_SET_ROLE = setRole;
  globalThis.A2_FLEET_DISPATCH = dispatch;
  globalThis.A2_BRIDGE_POLL_NOW = async () => ({ ok: true, fleet: await status(), at: nowIso(), authority_effect: false });

  (async () => { await globalThis.A2_TARGET_REGISTRY.ready; await discover(); await chrome.alarms.create("a2-fleet-discovery", { periodInMinutes: 0.5 }); })().catch((error) => console.error("a2_fleet_init_failed", error));
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "a2-fleet-discovery") discover().catch(() => {}); });
})();