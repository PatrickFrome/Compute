(() => {
  "use strict";

  const SUPERVISOR_URL = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v2-canary";
  const MODE_KEY = "a2SupervisorModeV1";
  const EVENTS_KEY = "a2SupervisorEventsV1";
  const LAST_KEY = "a2SupervisorLastReceiptV1";
  const LAST_ERROR_KEY = "a2SupervisorLastErrorV1";
  const ALARM = "a2-browser-supervisor-bootstrap-poll";
  const MODES = new Set(["OFF", "MONITOR", "CONTROL"]);
  const BOOTSTRAP_ACTIONS = new Set(["SET_SUPERVISOR_MODE", "ARM", "DISARM"]);
  let pollPromise = null;

  const clip = (value, max = 500) => String(value ?? "").slice(0, max);

  async function addEvent(type, summary, level = "info", extra = null) {
    const x = await chrome.storage.local.get(EVENTS_KEY);
    const rows = Array.isArray(x[EVENTS_KEY]) ? x[EVENTS_KEY] : [];
    rows.push({ at: new Date().toISOString(), source: "SUPERVISOR", type: clip(type, 60), summary: clip(summary, 500), level, extra });
    await chrome.storage.local.set({ [EVENTS_KEY]: rows.slice(-100) });
  }

  async function request(path, init = {}) {
    if (typeof globalThis.A2_GET_PAIRING_SECRET !== "function") throw new Error("supervisor_pairing_vault_unavailable");
    if (typeof globalThis.A2_BRIDGE_CLIENT_ID !== "function") throw new Error("supervisor_client_identity_unavailable");
    const [secret, client] = await Promise.all([globalThis.A2_GET_PAIRING_SECRET(), globalThis.A2_BRIDGE_CLIENT_ID()]);
    const headers = new Headers(init.headers || {});
    headers.set("content-type", "application/json");
    headers.set("x-a2-chat-bridge-secret", secret);
    headers.set("x-a2-chat-bridge-client", client);
    return fetch(`${SUPERVISOR_URL}${path}`, { ...init, headers, cache: "no-store" });
  }

  async function currentMode() {
    const x = await chrome.storage.session.get(MODE_KEY);
    const value = String(x[MODE_KEY] || "OFF").toUpperCase();
    return MODES.has(value) ? value : "OFF";
  }

  async function setSupervisorMode(value) {
    const next = String(value || "").toUpperCase();
    if (!MODES.has(next)) throw new Error("supervisor_bootstrap_mode_invalid");
    await chrome.storage.session.set({ [MODE_KEY]: next });
    if (next === "OFF") await chrome.storage.local.set({ armed: false });
    await addEvent("REMOTE_MODE", `Remote supervisor mode → ${next}`, "success");
    return { supervisor_mode: next };
  }

  async function execute(command) {
    const action = String(command?.action || "").toUpperCase();
    if (!BOOTSTRAP_ACTIONS.has(action)) throw new Error("supervisor_bootstrap_action_not_allowed");
    if (action === "SET_SUPERVISOR_MODE") return setSupervisorMode(command.payload?.mode);
    if (action === "ARM") {
      await chrome.storage.local.set({ armed: true });
      await addEvent("REMOTE_ARM", "Remote supervisor armed Browser Operator", "success");
      return { armed: true };
    }
    await chrome.storage.local.set({ armed: false });
    await addEvent("REMOTE_DISARM", "Remote supervisor disarmed Browser Operator", "success");
    return { armed: false };
  }

  async function postResult(command, ok, result, error = null) {
    const receipt = {
      schema: "metaengine.a2-browser-supervisor.bootstrap-receipt.v1",
      command_id: command.command_id,
      idempotency_key: command.idempotency_key || null,
      action: command.action,
      platform: command.platform || null,
      result: result || null,
      recorded_at: new Date().toISOString(),
      authority_effect: false
    };
    const r = await request(`/v1/commands/${encodeURIComponent(command.command_id)}/result`, {
      method: "POST",
      body: JSON.stringify({ ok, receipt, error })
    });
    if (!r.ok) throw new Error(`supervisor_bootstrap_result_http_${r.status}`);
  }

  async function poll() {
    if (pollPromise) return pollPromise;
    pollPromise = (async () => {
      const mode = await currentMode();
      if (mode === "CONTROL") return { skipped: true, reason: "already_control" };

      const r = await request("/v1/commands/bootstrap-next", { method: "POST", body: "{}" });
      if (!r.ok) throw new Error(`supervisor_bootstrap_next_http_${r.status}`);
      const body = await r.json();
      const command = body?.command || null;
      if (!command) return { command: null };

      let result = null;
      try {
        result = await execute(command);
        await postResult(command, true, result, null);
        const receipt = {
          command_id: command.command_id,
          idempotency_key: command.idempotency_key || null,
          action: command.action,
          status: "COMPLETED",
          result,
          completed_at: new Date().toISOString()
        };
        await chrome.storage.local.set({ [LAST_KEY]: receipt, [LAST_ERROR_KEY]: null });
        if (command.action === "SET_SUPERVISOR_MODE" && result?.supervisor_mode === "CONTROL" && typeof globalThis.A2_SUPERVISOR_POLL === "function") {
          queueMicrotask(() => globalThis.A2_SUPERVISOR_POLL().catch(() => {}));
        }
        return receipt;
      } catch (error) {
        const message = String(error?.message || error);
        await postResult(command, false, result, message).catch(() => {});
        await chrome.storage.local.set({ [LAST_ERROR_KEY]: message });
        await addEvent("REMOTE_BOOTSTRAP_ERROR", `${command.action}: ${message}`, "error", { command_id: command.command_id });
        return { command_id: command.command_id, action: command.action, status: "FAILED", error: message };
      }
    })().catch(async (error) => {
      const message = String(error?.message || error);
      await chrome.storage.local.set({ [LAST_ERROR_KEY]: message }).catch(() => {});
      await addEvent("REMOTE_BOOTSTRAP_LINK", message, "error").catch(() => {});
      throw error;
    }).finally(() => { pollPromise = null; });
    return pollPromise;
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) poll().catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "session" && changes[MODE_KEY]) || (area === "local" && changes.armed)) poll().catch(() => {});
  });

  globalThis.A2_SUPERVISOR_BOOTSTRAP_POLL = poll;

  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  poll().catch(() => {});
})();
