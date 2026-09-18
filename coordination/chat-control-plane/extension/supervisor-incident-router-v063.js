(() => {
  "use strict";

  const PENDING_KEY = "a2SupervisorPendingIncidentV1";
  const LAST_KEY = "a2SupervisorLastIncidentReceiptV1";
  const LAST_FINGERPRINT_KEY = "a2SupervisorLastIncidentFingerprintV1";
  const ALARM = "a2-supervisor-incident-watch";
  const NO_PROGRESS_MS = 120_000;
  const RETRY_DELAY_MS = 30_000;
  const DEDUPE_MS = 300_000;
  const MAX_ATTEMPTS = 3;
  const WATCHED = Object.freeze({
    daemonLastError: { source: "BRIDGE", at: "daemonLastErrorAt" },
    operatorSensorLastError: { source: "SENSOR", at: "operatorSensorLastErrorAt" },
    a2SupervisorLastErrorV1: { source: "SUPERVISOR_LINK", at: null },
    operatorDebuggerLastDetach: { source: "DEBUGGER", at: "operatorDebuggerLastDetachAt" }
  });

  let tickPromise = null;
  let escalationPromise = null;

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const nowIso = () => new Date().toISOString();

  function safeToken(value, max = 160) {
    const raw = normalize(value).slice(0, 800);
    const token = raw
      .replace(/https?:\/\/\S+/giu, "URL")
      .replace(/[^A-Za-z0-9_.:-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max);
    return token || "unknown_error";
  }

  function safeContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const key of ["operator_runtime", "extension_version", "supervisor_mode", "armed", "operator_mode", "platform", "error_code", "command_id", "execution_class", "bridge_status", "source_event"]) {
      const raw = value[key];
      if (raw == null) continue;
      if (typeof raw === "boolean" || typeof raw === "number") out[key] = raw;
      else out[key] = safeToken(raw, 240);
    }
    return out;
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function assistantSignal(row) {
    const snap = row?.snapshot || null;
    const messages = Array.isArray(snap?.messages) ? snap.messages : [];
    const assistants = messages.filter((message) => String(message?.role || "").toLowerCase() === "assistant");
    const tail = assistants[assistants.length - 1] || null;
    return {
      assistant_count: assistants.length,
      assistant_tail_sha256: tail?.text_sha256 || null,
      message_count: Number(snap?.message_count || messages.length || 0),
      generating: snap?.generating === true,
      observed_at: row?.observed_at || snap?.captured_at || null
    };
  }

  function responseAdvanced(baseline, current) {
    if (!baseline || !current) return false;
    if (Number(current.assistant_count || 0) > Number(baseline.assistant_count || 0)) return true;
    return Boolean(current.assistant_tail_sha256 && current.assistant_tail_sha256 !== baseline.assistant_tail_sha256);
  }

  function progressAdvanced(previous, current) {
    if (!previous || !current) return false;
    return Number(current.assistant_count || 0) !== Number(previous.assistant_count || 0)
      || String(current.assistant_tail_sha256 || "") !== String(previous.assistant_tail_sha256 || "")
      || current.generating !== previous.generating;
  }

  async function snapshotSignal() {
    if (typeof globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT !== "function") return assistantSignal(null);
    const row = await globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT().catch(() => null);
    return assistantSignal(row);
  }

  async function sessionStatus() {
    if (typeof globalThis.A2_SUPERVISOR_CHAT_STATUS !== "function") return null;
    return globalThis.A2_SUPERVISOR_CHAT_STATUS().catch(() => null);
  }

  async function readPending() {
    const x = await chrome.storage.local.get(PENDING_KEY);
    return x[PENDING_KEY] || null;
  }

  async function writePending(value) {
    await chrome.storage.local.set({ [PENDING_KEY]: value });
    return value;
  }

  async function clearPending(receipt) {
    await chrome.storage.local.set({ [LAST_KEY]: receipt, [PENDING_KEY]: null });
  }

  async function buildIncident(source, error, context = {}) {
    const errorCode = safeToken(error, 180);
    const sourceToken = safeToken(source, 80);
    const fingerprint = await sha256(`${sourceToken}\n${errorCode}`);
    return {
      source: sourceToken,
      safe_message: `${sourceToken} reported ${errorCode}`.slice(0, 500),
      context: { ...safeContext(context), error_code: errorCode, source_event: sourceToken },
      fingerprint_sha256: fingerprint
    };
  }

  async function isDuplicate(fingerprint) {
    const pending = await readPending();
    if (pending?.fingerprint_sha256 === fingerprint && !["COMPLETED", "HOLD"].includes(String(pending.status || ""))) return true;
    const x = await chrome.storage.local.get(LAST_FINGERPRINT_KEY);
    const prior = x[LAST_FINGERPRINT_KEY] || null;
    const at = Date.parse(String(prior?.at || ""));
    return prior?.fingerprint_sha256 === fingerprint && Number.isFinite(at) && Date.now() - at < DEDUPE_MS;
  }

  async function dispatch(pending, reason = "dispatch") {
    if (typeof globalThis.A2_SUPERVISOR_CHAT_SEND_INCIDENT !== "function") throw new Error("supervisor_incident_transport_unavailable");
    const baseline = await snapshotSignal();
    const next = {
      ...pending,
      status: "DISPATCHING",
      baseline,
      last_signal: baseline,
      last_progress_at: nowIso(),
      dispatch_reason: safeToken(reason, 120),
      updated_at: nowIso()
    };
    await writePending(next);

    try {
      const result = await globalThis.A2_SUPERVISOR_CHAT_SEND_INCIDENT({
        incident_id: next.incident_id,
        source: next.source,
        message: next.safe_message,
        attempt: next.attempt,
        context: next.context
      });
      const sent = {
        ...next,
        status: "WAITING_RESPONSE",
        epoch: Number(result?.epoch || 0),
        tab_id: Number(result?.tab_id || 0) || null,
        execution_class: String(result?.execution_class || "ACTUATED"),
        sent_at: nowIso(),
        last_progress_at: nowIso(),
        updated_at: nowIso()
      };
      await writePending(sent);
      return sent;
    } catch (error) {
      const executionClass = String(error?.a2ExecutionClass || "SAFE_RETRY_PRE_ACTUATION");
      if (executionClass === "AMBIGUOUS_NO_RETRY") {
        const ambiguous = {
          ...next,
          status: "WAITING_AMBIGUOUS",
          execution_class: executionClass,
          sent_at: nowIso(),
          last_progress_at: nowIso(),
          last_error_code: safeToken(error?.message || error, 180),
          updated_at: nowIso()
        };
        await writePending(ambiguous);
        return ambiguous;
      }
      const retryable = {
        ...next,
        status: "RETRYABLE",
        execution_class: executionClass,
        retry_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        last_error_code: safeToken(error?.message || error, 180),
        updated_at: nowIso()
      };
      await writePending(retryable);
      return retryable;
    }
  }

  async function escalate(source, error, context = {}) {
    if (escalationPromise) return escalationPromise;
    escalationPromise = (async () => {
      const built = await buildIncident(source, error, context);
      if (await isDuplicate(built.fingerprint_sha256)) return { ok: true, deduplicated: true, fingerprint_sha256: built.fingerprint_sha256 };
      const incident = {
        schema: "metaengine.a2-browser-supervisor.pending-incident.v1",
        incident_id: crypto.randomUUID(),
        source: built.source,
        safe_message: built.safe_message,
        context: built.context,
        fingerprint_sha256: built.fingerprint_sha256,
        status: "PENDING",
        attempt: 1,
        created_at: nowIso(),
        updated_at: nowIso()
      };
      await writePending(incident);
      await chrome.storage.local.set({ [LAST_FINGERPRINT_KEY]: { fingerprint_sha256: built.fingerprint_sha256, at: nowIso() } });
      return dispatch(incident, "initial");
    })().finally(() => { escalationPromise = null; });
    return escalationPromise;
  }

  async function complete(pending, signal, reason) {
    const receipt = {
      schema: "metaengine.a2-browser-supervisor.incident-receipt.v1",
      incident_id: pending.incident_id,
      fingerprint_sha256: pending.fingerprint_sha256,
      source: pending.source,
      status: "COMPLETED",
      attempt: pending.attempt,
      epoch: pending.epoch || null,
      response: {
        assistant_count: signal.assistant_count,
        assistant_tail_sha256: signal.assistant_tail_sha256,
        message_count: signal.message_count
      },
      completion_reason: reason,
      completed_at: nowIso()
    };
    await clearPending(receipt);
    return receipt;
  }

  async function prepareNextAttempt(pending, reason) {
    if (Number(pending.attempt || 1) >= MAX_ATTEMPTS) {
      const hold = { ...pending, status: "HOLD", hold_reason: safeToken(reason, 160), updated_at: nowIso() };
      await writePending(hold);
      return { hold };
    }
    const next = {
      ...pending,
      status: "PENDING",
      attempt: Number(pending.attempt || 1) + 1,
      epoch: null,
      tab_id: null,
      baseline: null,
      last_signal: null,
      last_progress_at: nowIso(),
      updated_at: nowIso()
    };
    await writePending(next);
    return { next };
  }

  async function resendOnAdvancedEpoch(pending, reason) {
    const prepared = await prepareNextAttempt(pending, reason);
    if (prepared.hold) return prepared.hold;
    return dispatch(prepared.next, `new_epoch:${reason}`);
  }

  async function recoverAndResend(pending, reason) {
    const prepared = await prepareNextAttempt(pending, reason);
    if (prepared.hold) return prepared.hold;
    if (typeof globalThis.A2_SUPERVISOR_CHAT_RECOVER !== "function") {
      const retryable = { ...pending, status: "RETRYABLE", retry_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString(), last_error_code: "supervisor_chat_recover_unavailable", updated_at: nowIso() };
      await writePending(retryable);
      return retryable;
    }
    await writePending({ ...pending, status: "RECOVERING_CHAT", recovery_reason: safeToken(reason, 160), updated_at: nowIso() });
    try {
      await globalThis.A2_SUPERVISOR_CHAT_RECOVER(`incident:${safeToken(reason, 120)}`);
      await writePending(prepared.next);
      return dispatch(prepared.next, `recovery:${reason}`);
    } catch (error) {
      const retryable = {
        ...prepared.next,
        status: "RETRYABLE",
        retry_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        last_error_code: safeToken(error?.message || error, 180),
        updated_at: nowIso()
      };
      await writePending(retryable);
      return retryable;
    }
  }

  async function tick() {
    if (tickPromise) return tickPromise;
    tickPromise = (async () => {
      const pending = await readPending();
      if (!pending?.incident_id || ["COMPLETED", "HOLD"].includes(String(pending.status || ""))) return pending;

      if (["PENDING", "DISPATCHING"].includes(String(pending.status || ""))) return dispatch(pending, "resume");
      if (pending.status === "RETRYABLE") {
        const retryAt = Date.parse(String(pending.retry_after || ""));
        if (!Number.isFinite(retryAt) || Date.now() >= retryAt) return dispatch(pending, "retry");
        return pending;
      }

      const signal = await snapshotSignal();
      const baseline = pending.baseline || signal;
      if (responseAdvanced(baseline, signal) && signal.generating !== true) return complete(pending, signal, "assistant_response_observed");

      let current = pending;
      if (progressAdvanced(pending.last_signal || baseline, signal)) {
        current = { ...current, last_signal: signal, last_progress_at: nowIso(), updated_at: nowIso() };
        await writePending(current);
      }

      const status = await sessionStatus();
      if (Number(current.epoch || 0) > 0 && Number(status?.epoch || 0) > Number(current.epoch || 0)) {
        return resendOnAdvancedEpoch(current, "session_epoch_advanced");
      }

      const progressAt = Date.parse(String(current.last_progress_at || current.sent_at || current.updated_at || ""));
      if (Number.isFinite(progressAt) && Date.now() - progressAt >= NO_PROGRESS_MS) {
        return recoverAndResend(current, "no_response_timeout");
      }
      return current;
    })().finally(() => { tickPromise = null; });
    return tickPromise;
  }

  function contextFromRuntime() {
    return {
      operator_runtime: globalThis.A2_OPERATOR_RUNTIME || "0.6.3-supervisor-authority-dev.2",
      extension_version: chrome.runtime.getManifest?.().version || "0.6.3"
    };
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, spec] of Object.entries(WATCHED)) {
      if (!changes[key] || changes[key].newValue == null || changes[key].newValue === "") continue;
      const value = changes[key].newValue;
      const context = { ...contextFromRuntime(), source_event: key };
      if (key === "operatorDebuggerLastDetach" && ["target_closed", "canceled_by_user"].includes(String(value || ""))) continue;
      escalate(spec.source, value, context).catch(() => {});
    }
  });

  globalThis.addEventListener?.("unhandledrejection", (event) => {
    const reason = event?.reason?.message || event?.reason || "unhandled_rejection";
    escalate("WORKER_UNHANDLED_REJECTION", reason, contextFromRuntime()).catch(() => {});
  });

  globalThis.addEventListener?.("error", (event) => {
    const message = event?.error?.message || event?.message || "worker_error";
    escalate("WORKER_ERROR", message, contextFromRuntime()).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) tick().catch(() => {});
  });

  globalThis.A2_SUPERVISOR_ESCALATE_ERROR = escalate;
  globalThis.A2_SUPERVISOR_INCIDENT_TICK = tick;

  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  tick().catch(() => {});
})();