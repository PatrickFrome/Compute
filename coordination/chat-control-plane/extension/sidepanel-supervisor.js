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
  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || `${type} failed`);
    return response;
  }
  async function refresh() {
    try { const r = await request("A2_SUPERVISOR_STATUS"); render(r.state || {}); }
    catch (error) {
      $("supervisorLink").textContent = short(error?.message || error,90,"unavailable");
      $("supervisorPulse").textContent = "ERROR"; setDot("supervisorDot", "err");
    }
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
  refresh();
  setInterval(async () => {
    if (document.visibilityState === "visible") {
      await request("A2_SUPERVISOR_POLL_NOW").catch(()=>{});
      await refresh();
    }
  }, 2500);
})();
