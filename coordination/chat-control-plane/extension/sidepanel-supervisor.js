"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let busy = false;

  function short(value, max = 48, fallback = "—") {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  function relativeTime(value) {
    const ts = Date.parse(String(value || ""));
    if (!Number.isFinite(ts)) return "never";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 3) return "now";
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    return `${m}m ago`;
  }
  function setDot(id, state) {
    const el = $(id); if (!el) return;
    el.className = `dot ${state || ""}`.trim();
  }
  function modeClass(buttonId, active, danger = false) {
    const el = $(buttonId); if (!el) return;
    el.classList.toggle("active", active);
    if (danger) el.classList.toggle("danger-outline", true);
  }
  function addMetric(root, id, label, wide = false) {
    if (document.getElementById(id)) return;
    const box = document.createElement("div"); box.className = `metric${wide ? " wide" : ""}`;
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.id = id; strong.textContent = "—";
    box.append(small, strong); root.append(box);
  }
  function ensureChatUi() {
    const card = document.querySelector(".supervisor-card");
    const grid = card?.querySelector(".supervisor-grid");
    const actions = card?.querySelector(".actions.compact");
    if (grid) {
      addMetric(grid, "supervisorChatHealth", "Chat session");
      addMetric(grid, "supervisorChatEpoch", "Chat epoch");
      addMetric(grid, "supervisorIncident", "Incident");
      addMetric(grid, "supervisorChatAction", "Chat action");
    }
    if (actions && !document.getElementById("openSupervisorChat")) {
      const open = document.createElement("button"); open.id = "openSupervisorChat"; open.textContent = "Open chat";
      const recover = document.createElement("button"); recover.id = "recoverSupervisorChat"; recover.textContent = "Recover chat";
      actions.prepend(recover); actions.prepend(open);
    }
    const hint = card?.querySelector(".hint");
    if (hint) hint.textContent = "Supervisor authority can bootstrap CONTROL and ARM remotely. Every privileged effect still passes deterministic extension-side allowlists, role binding and execution fences.";
    const lead = card?.querySelector(".lead");
    if (lead) lead.textContent = "The extension owns a dedicated self-healing ChatGPT supervisor session. Problems are escalated automatically; typed actions are schema-validated before execution and arbitrary remote code is never accepted.";
  }
  function renderTimeline(rows) {
    const root = $("supervisorTimeline");
    if (!root) return;
    root.replaceChildren();
    const events = Array.isArray(rows) ? [...rows].slice(-40).reverse() : [];
    if (!events.length) {
      const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Waiting for events…"; root.append(empty); return;
    }
    for (const event of events) {
      const item = document.createElement("div");
      item.className = `timeline-item ${event.level || ""}`;
      const time = document.createElement("div"); time.className = "timeline-time"; time.textContent = relativeTime(event.at);
      const main = document.createElement("div"); main.className = "timeline-main";
      const title = document.createElement("b"); title.textContent = `${short(event.source,18,"SYS")} · ${short(event.type,28,"EVENT")}`;
      const summary = document.createElement("span"); summary.textContent = short(event.summary,220,"");
      main.append(title, summary); item.append(time, main); root.append(item);
    }
  }
  function render(state) {
    const mode = String(state.supervisor_mode || "OFF");
    const badge = $("supervisorBadge");
    if (badge) { badge.textContent = mode; badge.className = `badge ${mode === "CONTROL" ? "on" : mode === "MONITOR" ? "warn" : "neutral"}`; }
    modeClass("supervisorOff", mode === "OFF");
    modeClass("supervisorMonitor", mode === "MONITOR");
    modeClass("supervisorControl", mode === "CONTROL", true);

    const sync = state.supervisor_last_sync;
    const error = state.supervisor_last_error;
    const syncAge = Date.now() - Date.parse(sync || "");
    const online = Number.isFinite(syncAge) && syncAge < 20000 && !error;
    $("supervisorLink").textContent = error ? short(error,90) : (sync ? `online · ${relativeTime(sync)}` : "not connected");
    $("supervisorPulse").textContent = mode === "OFF" ? "OFF" : online ? mode : "LINK?";
    setDot("supervisorDot", error ? "err" : online ? "ok" : mode === "OFF" ? "" : "warn");

    const bridgeOnline = Boolean(state.bridge?.online_at) && !state.bridge?.error;
    $("bridgePulse").textContent = state.bridge?.error ? "ERROR" : bridgeOnline ? relativeTime(state.bridge.online_at) : "WAIT";
    setDot("bridgeDot", state.bridge?.error ? "err" : bridgeOnline ? "ok" : "warn");
    $("gatePulse").textContent = String(state.operator_mode || "OBSERVE").replace("_", " ");

    const command = state.current_supervisor_command;
    $("supervisorCommand").textContent = command ? `${short(command.action,24)}${command.platform ? ` · ${command.platform}` : ""}` : "none";
    const receipt = state.last_supervisor_receipt;
    $("supervisorReceipt").textContent = receipt ? `${receipt.status || "?"} · ${receipt.action || "?"} · ${relativeTime(receipt.completed_at)}` : "none";
    renderTimeline(state.events);
  }
  function renderChat(board) {
    ensureChatUi();
    const chat = board?.chat || null;
    const health = chat?.health || null;
    const healthEl = document.getElementById("supervisorChatHealth");
    const epochEl = document.getElementById("supervisorChatEpoch");
    const incidentEl = document.getElementById("supervisorIncident");
    const actionEl = document.getElementById("supervisorChatAction");
    if (healthEl) healthEl.textContent = chat?.enabled === false ? "DISABLED" : short(health?.state || (chat?.tab_present ? "READY" : "MISSING"),40);
    if (epochEl) epochEl.textContent = chat?.epoch != null ? `#${chat.epoch}${chat.snapshot_fresh ? " · live" : " · stale"}` : "—";
    const pending = board?.pending_incident;
    if (incidentEl) incidentEl.textContent = pending ? `${short(pending.source,16)} · ${short(pending.status,24)} · try ${pending.attempt || 1}` : (board?.last_incident ? `done · ${relativeTime(board.last_incident.completed_at)}` : "none");
    const action = board?.last_action;
    if (actionEl) actionEl.textContent = action ? `${action.ok === false ? "BLOCKED" : action.detected === false ? "none" : "OK"} · ${short(action.action,24,"no action")}` : "none";
  }
  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || `${type} failed`);
    return response;
  }
  async function refresh() {
    ensureChatUi();
    const [supervisor, chat] = await Promise.allSettled([
      request("A2_SUPERVISOR_STATUS"),
      request("A2_SUPERVISOR_CHAT_STATUS")
    ]);
    if (supervisor.status === "fulfilled") render(supervisor.value.state || {});
    else {
      $("supervisorLink").textContent = short(supervisor.reason?.message || supervisor.reason,90,"unavailable");
      $("supervisorPulse").textContent = "ERROR"; setDot("supervisorDot", "err");
    }
    if (chat.status === "fulfilled") renderChat(chat.value.state || {});
    else renderChat({ chat: { enabled: true, tab_present: false, health: { state: "UNAVAILABLE" } } });
  }
  async function setMode(mode) {
    if (busy) return; busy = true;
    try { await request("A2_SUPERVISOR_SET_MODE", { mode }); await refresh(); }
    catch (error) { $("supervisorLink").textContent = short(error?.message || error,90); }
    finally { busy = false; }
  }
  $("supervisorOff")?.addEventListener("click", () => setMode("OFF"));
  $("supervisorMonitor")?.addEventListener("click", () => setMode("MONITOR"));
  $("supervisorControl")?.addEventListener("click", () => setMode("CONTROL"));
  $("supervisorPoll")?.addEventListener("click", async () => { if (busy) return; busy = true; try { await request("A2_SUPERVISOR_POLL_NOW"); await refresh(); } finally { busy = false; } });
  $("clearTimeline")?.addEventListener("click", async () => { await request("A2_SUPERVISOR_CLEAR_EVENTS").catch(()=>{}); await refresh(); });
  ensureChatUi();
  document.getElementById("openSupervisorChat")?.addEventListener("click", async () => { if (busy) return; busy = true; try { const r = await request("A2_SUPERVISOR_CHAT_OPEN"); renderChat(r.state || {}); } finally { busy = false; } });
  document.getElementById("recoverSupervisorChat")?.addEventListener("click", async () => { if (busy) return; busy = true; try { const r = await request("A2_SUPERVISOR_CHAT_RECOVER"); renderChat(r.state || {}); } finally { busy = false; } });
  refresh();
  setInterval(async () => {
    if (document.visibilityState === "visible") {
      await refresh();
    }
  }, 2500);
})();