"use strict";

const $ = (id) => document.getElementById(id);
let lastIntentId = null;

function setStatus(text, error = false) {
  const el = $("status");
  el.textContent = text || "";
  el.className = error ? "error" : "ok";
}

function compact(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function renderPeer(snapshot) {
  if (!snapshot) return "not observed";
  const parts = [snapshot.generating ? "generating" : "idle"];
  parts.push(`${Number(snapshot.message_count || 0)} turns`);
  if (snapshot.dom_pair_error) parts.push(snapshot.dom_pair_error);
  return parts.join(" · ");
}

function render(state) {
  $("runtime").textContent = `${compact(state.operator_runtime)} · ${compact(state.extension_version)}`;
  const armed = state.armed === true;
  $("armedBadge").textContent = armed ? "ARMED" : "DISARMED";
  $("armedBadge").className = `badge ${armed ? "on" : "off"}`;

  const mode = state.operator_mode === "GATE_SEND" ? "GATE_SEND" : "OBSERVE";
  $("modeObserve").classList.toggle("active", mode === "OBSERVE");
  $("modeGate").classList.toggle("active", mode === "GATE_SEND");
  $("ordering").textContent = compact(state.ordering_policy);
  $("predecessor").textContent = compact(state.glm_predecessor_command_id);
  $("pendingCommand").textContent = state.pending_command
    ? `${compact(state.pending_command.target_platform)} · ${compact(state.pending_command.command_id)}`
    : "none";
  $("glmState").textContent = renderPeer(state.snapshots?.GLM_ZAI);
  $("gptState").textContent = renderPeer(state.snapshots?.CHATGPT);
  $("daemon").textContent = state.daemon_online_at ? `seen ${state.daemon_online_at}` : "not confirmed";
  $("sensorError").textContent = compact(state.sensor_error);
  $("lastError").textContent = compact(state.daemon_error);

  const intent = state.prompt_intent || null;
  $("intentCard").hidden = !intent;
  if (intent) {
    const changed = lastIntentId !== intent.intent_id;
    lastIntentId = intent.intent_id;
    $("intentMeta").textContent = `${compact(intent.platform)} · ${compact(intent.event_type)} · ${compact(intent.draft_sha256)}`;
    $("draftOriginal").value = String(intent.original_draft || "");
    if (changed) $("draftRewrite").value = String(intent.original_draft || "");
  } else {
    lastIntentId = null;
  }
}

async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || `${type} failed`);
  return response;
}

async function refresh() {
  try {
    const response = await request("A2_OPERATOR_STATUS");
    render(response.state || {});
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

async function setMode(mode) {
  try {
    await request("A2_OPERATOR_SET_MODE", { mode });
    setStatus(`Operator mode: ${mode}`);
    await refresh();
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

async function resolve(action, draft = null) {
  try {
    const state = (await request("A2_OPERATOR_STATUS")).state || {};
    const intent = state.prompt_intent;
    if (!intent?.intent_id) throw new Error("No held prompt intent");
    await request("A2_OPERATOR_RESOLVE_PROMPT", {
      intent_id: intent.intent_id,
      action,
      draft
    });
    setStatus(action === "CANCEL" ? "Send cancelled; draft kept on page." : "Allowed once for the next physical Send/Enter.");
    await refresh();
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

$("modeObserve").addEventListener("click", () => setMode("OBSERVE"));
$("modeGate").addEventListener("click", () => setMode("GATE_SEND"));
$("cancelIntent").addEventListener("click", () => resolve("CANCEL"));
$("allowOriginal").addEventListener("click", () => resolve("ALLOW_ONCE", $("draftOriginal").value));
$("rewriteAllow").addEventListener("click", () => {
  const rewrite = $("draftRewrite").value;
  if (!rewrite.trim()) return setStatus("Rewrite cannot be empty.", true);
  resolve("REWRITE_ALLOW_ONCE", rewrite);
});
$("pollNow").addEventListener("click", async () => {
  try { await request("BRIDGE_POLL_NOW"); setStatus("Bridge poll requested."); await refresh(); }
  catch (error) { setStatus(String(error?.message || error), true); }
});
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
setInterval(refresh, 1000);
