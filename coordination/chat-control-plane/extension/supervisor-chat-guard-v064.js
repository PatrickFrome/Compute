(() => {
  "use strict";

  const GUARD_KEY = "a2SupervisorChatGuardV1";
  const AUDIT_KEY = "a2SupervisorAuditChainV1";
  const WINDOW_MS = 60_000;
  const BUDGET_LIMIT = 24;
  const FAILURE_LIMIT = 5;
  const MAX_AUDIT = 256;
  const originalProcess = globalThis.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE;
  const parseAction = globalThis.A2_SUPERVISOR_CHAT_PARSE_ACTION;

  if (typeof originalProcess !== "function" || typeof parseAction !== "function") {
    throw new Error("supervisor_chat_guard_dependency_missing");
  }

  function latestAssistantText(row) {
    const messages = Array.isArray(row?.snapshot?.messages) ? row.snapshot.messages : [];
    const assistant = [...messages].reverse().find((message) => String(message?.role || "").toLowerCase() === "assistant");
    return assistant ? String(assistant.text || "") : "";
  }

  function costOf(command) {
    const action = String(command?.action || "").toUpperCase();
    if (["POLL", "CAPTURE", "DISARM"].includes(action)) return 0;
    if (action === "SET_SUPERVISOR_MODE" && String(command?.payload?.mode || "").toUpperCase() === "OFF") return 0;
    if (["SCROLL", "SEMANTIC_FOCUS"].includes(action)) return 1;
    if (["ARM", "SET_SUPERVISOR_MODE", "SET_MODE", "STOP_GENERATION"].includes(action)) return 2;
    if (action === "SEMANTIC_TYPE") return 3;
    if (action === "RESOLVE_PROMPT") return 4;
    return 4;
  }

  function emergency(command) {
    const action = String(command?.action || "").toUpperCase();
    return action === "DISARM"
      || (action === "SET_SUPERVISOR_MODE" && String(command?.payload?.mode || "").toUpperCase() === "OFF");
  }

  async function state() {
    const x = await chrome.storage.session.get(GUARD_KEY);
    const row = x[GUARD_KEY] && typeof x[GUARD_KEY] === "object" ? x[GUARD_KEY] : {};
    const now = Date.now();
    const entries = Array.isArray(row.entries)
      ? row.entries.filter((entry) => Number(entry?.at_ms) >= now - WINDOW_MS).slice(-128)
      : [];
    return { schema: "metaengine.a2-browser-supervisor.chat-guard.v1", entries };
  }

  function summary(entries) {
    let usedCost = 0;
    let recentFailures = 0;
    for (const entry of entries) {
      usedCost += Math.max(0, Number(entry?.cost) || 0);
      if (entry?.ok === false) recentFailures += 1;
    }
    return { usedCost, recentFailures };
  }

  async function storeAttempt(command, ok) {
    const current = await state();
    current.entries.push({
      at_ms: Date.now(),
      cost: costOf(command),
      ok: ok === true,
      action: String(command?.action || "").toUpperCase()
    });
    current.entries = current.entries.slice(-128);
    await chrome.storage.session.set({ [GUARD_KEY]: current });
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function appendAudit({ source, incidentId, command, ok, reason, guard }) {
    const x = await chrome.storage.local.get(AUDIT_KEY);
    const rows = Array.isArray(x[AUDIT_KEY]) ? x[AUDIT_KEY].slice(-MAX_AUDIT + 1) : [];
    const prevHash = rows.length ? String(rows[rows.length - 1]?.hash || "") : "";
    const core = {
      schema: "metaengine.a2-browser-supervisor.audit.v1",
      seq: rows.length ? Number(rows[rows.length - 1]?.seq || 0) + 1 : 1,
      at: new Date().toISOString(),
      source: String(source || "SUPERVISOR_CHAT").slice(0, 40),
      incident_id: incidentId ? String(incidentId).slice(0, 128) : null,
      action: command ? String(command.action || "").toUpperCase() : null,
      platform: command?.platform ? String(command.platform).toUpperCase() : null,
      cost: command ? costOf(command) : 0,
      ok: ok === true,
      reason: reason ? String(reason).slice(0, 120) : null,
      guard: guard ? {
        used_cost: Number(guard.used_cost || 0),
        requested_cost: Number(guard.requested_cost || 0),
        limit: Number(guard.limit || BUDGET_LIMIT),
        recent_failures: Number(guard.recent_failures || 0),
        failure_limit: Number(guard.failure_limit || FAILURE_LIMIT),
        emergency_bypass: guard.emergency_bypass === true
      } : null,
      prev_hash: prevHash || null
    };
    const hash = await sha256(JSON.stringify(core));
    rows.push({ ...core, hash });
    await chrome.storage.local.set({ [AUDIT_KEY]: rows.slice(-MAX_AUDIT) });
    return hash;
  }

  function blockedReceipt(incident, command, reason, guard) {
    return {
      schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1",
      incident_id: incident?.incident_id || null,
      detected: true,
      ok: false,
      action: command?.action || null,
      platform: command?.platform || null,
      authority_effect: false,
      error_code: reason === "ACTION_BUDGET_EXCEEDED"
        ? "supervisor_action_budget_exceeded"
        : "supervisor_failure_circuit_open",
      guard,
      recorded_at: new Date().toISOString()
    };
  }

  async function processResponse(incident, row = null) {
    const snapshotRow = row || (typeof globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT === "function"
      ? await globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT().catch(() => null)
      : null);
    let command = null;
    try { command = parseAction(latestAssistantText(snapshotRow)); }
    catch (_) {
      const receipt = await originalProcess(incident, snapshotRow);
      await appendAudit({ source: "SUPERVISOR_CHAT", incidentId: incident?.incident_id, command: null, ok: receipt?.ok === true, reason: receipt?.error_code || "PARSE_FAILURE", guard: null });
      return receipt;
    }
    if (!command) {
      const receipt = await originalProcess(incident, snapshotRow);
      await appendAudit({ source: "SUPERVISOR_CHAT", incidentId: incident?.incident_id, command: null, ok: receipt?.ok === true, reason: null, guard: null });
      return receipt;
    }

    const current = await state();
    const { usedCost, recentFailures } = summary(current.entries);
    const requestedCost = costOf(command);
    const isEmergency = emergency(command);
    const guard = {
      schema: "metaengine.a2-browser-supervisor.action-budget.v1",
      window_seconds: WINDOW_MS / 1000,
      used_cost: usedCost,
      requested_cost: requestedCost,
      limit: BUDGET_LIMIT,
      recent_failures: recentFailures,
      failure_limit: FAILURE_LIMIT,
      emergency_bypass: isEmergency
    };

    let reason = null;
    if (!isEmergency && recentFailures >= FAILURE_LIMIT) reason = "FAILURE_CIRCUIT_OPEN";
    else if (!isEmergency && requestedCost > 0 && usedCost + requestedCost > BUDGET_LIMIT) reason = "ACTION_BUDGET_EXCEEDED";
    if (reason) {
      const receipt = blockedReceipt(incident, command, reason, guard);
      await appendAudit({ source: "SUPERVISOR_CHAT", incidentId: incident?.incident_id, command, ok: false, reason, guard });
      return receipt;
    }

    const receipt = await originalProcess(incident, snapshotRow);
    await storeAttempt(command, receipt?.ok === true);
    await appendAudit({ source: "SUPERVISOR_CHAT", incidentId: incident?.incident_id, command, ok: receipt?.ok === true, reason: receipt?.error_code || null, guard });
    return receipt;
  }

  async function guardStatus() {
    const current = await state();
    const values = summary(current.entries);
    return {
      schema: current.schema,
      window_seconds: WINDOW_MS / 1000,
      limit: BUDGET_LIMIT,
      failure_limit: FAILURE_LIMIT,
      used_cost: values.usedCost,
      recent_failures: values.recentFailures
    };
  }

  globalThis.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE = processResponse;
  globalThis.A2_SUPERVISOR_CHAT_GUARD_STATUS = guardStatus;
  globalThis.A2_SUPERVISOR_AUDIT_KEY = AUDIT_KEY;
})();
