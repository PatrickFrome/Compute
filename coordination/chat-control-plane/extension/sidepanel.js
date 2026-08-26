"use strict";

const $ = (id) => document.getElementById(id);
let lastIntentId = null;
let lastArmed = false;
let captureBusy = false;
let actionBusy = false;
let currentPerception = null;

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

function shortHash(value) {
  const text = String(value || "");
  return text.length > 16 ? `${text.slice(0, 12)}…${text.slice(-4)}` : (text || "—");
}

function renderPerception(perception) {
  currentPerception = perception || null;
  const image = $("perceptionScreenshot");
  if (!perception) {
    $("perceptionTarget").textContent = "none";
    $("perceptionCaptured").textContent = "—";
    $("perceptionFrame").textContent = "—";
    $("perceptionTextMeta").textContent = "—";
    $("perceptionStructure").textContent = "—";
    $("perceptionHashes").textContent = "—";
    $("perceptionBody").value = "";
    $("perceptionStructureDump").textContent = "No capture.";
    image.hidden = true;
    image.removeAttribute("src");
    image.removeAttribute("data-frame-token");
    return;
  }
  $("perceptionTarget").textContent = `${compact(perception.platform)} · ${compact(perception.url)}`;
  $("perceptionCaptured").textContent = compact(perception.captured_at);
  $("perceptionFrame").textContent = perception.frame_token
    ? `${shortHash(perception.frame_token)} · ${Number(perception.frame_max_age_ms || 30000)} ms max`
    : "no pixel-bound frame";
  $("perceptionTextMeta").textContent = `${Number(perception.page?.body_text_length || 0)} chars${perception.page?.body_text_truncated ? " · source clipped" : ""}`;
  $("perceptionStructure").textContent = `${Number(perception.accessibility_total || perception.accessibility?.length || 0)} AX · ${Number(perception.dom_snapshot?.visible_record_count || 0)} visible DOM/layout`;
  $("perceptionHashes").textContent = `text ${shortHash(perception.hashes?.body_text_sha256)} · pixels ${shortHash(perception.hashes?.screenshot_sha256)}`;
  $("perceptionBody").value = String(perception.page?.body_text_excerpt || "");
  $("perceptionStructureDump").textContent = JSON.stringify({
    accessibility: perception.accessibility || [],
    dom: perception.dom_snapshot?.records || [],
    active_element: perception.page?.active_element || null,
    viewport: perception.page?.viewport || null,
    scroll: perception.page?.scroll || null
  }, null, 2);
  const screenshot = perception.screenshot || {};
  if (screenshot.base64) {
    image.src = `data:${screenshot.mime || "image/jpeg"};base64,${screenshot.base64}`;
    image.dataset.frameToken = String(perception.frame_token || "");
    image.hidden = false;
  } else {
    image.hidden = true;
    image.removeAttribute("src");
    image.removeAttribute("data-frame-token");
  }
}

function renderRuntimeHardening(state) {
  const update = state.update || {};
  const blocked = Array.isArray(update.blocked_by) && update.blocked_by.length ? ` · ${update.blocked_by.join(", ")}` : "";
  $("updateState").textContent = `${compact(update.status, "CURRENT")}${update.target_version ? ` → ${update.target_version}` : ""}${blocked}`;

  const compatibility = state.compatibility || {};
  $("compatState").textContent = `${compact(compatibility.status, "UNPROVISIONED")}${compatibility.epoch != null ? ` · epoch ${compatibility.epoch}` : ""}${compatibility.last_error ? ` · ${compatibility.last_error}` : ""}`;
  $("capabilityState").textContent = [
    state.prompt_gate_allowed === false ? "gate OFF" : "gate on",
    state.operator_actions_allowed === false ? "actions OFF" : "actions on",
    state.screenshot_sensor_allowed === false ? "pixels OFF" : "pixels on",
    state.point_click_allowed === false ? "point-click OFF" : "point-click on"
  ].join(" · ");

  const broker = Array.isArray(state.debugger_broker) ? state.debugger_broker : [];
  const active = broker.filter((row) => row?.active_owner || Number(row?.pending || 0) > 0);
  $("debuggerState").textContent = active.length
    ? active.map((row) => `tab ${row.tab_id}: ${row.active_owner || `${row.pending} queued`}`).join(" · ")
    : (state.debugger_last_detach ? `idle · last detach ${state.debugger_last_detach}` : "idle");
}

function render(state) {
  $("runtime").textContent = `${compact(state.operator_runtime)} · ${compact(state.extension_version)}`;
  const armed = state.armed === true;
  lastArmed = armed;
  $("armedBadge").textContent = armed ? "ARMED" : "DISARMED";
  $("armedBadge").className = `badge ${armed ? "on" : "off"}`;
  $("toggleArmed").textContent = armed ? "Disarm bridge" : "Arm bridge";

  const mode = state.operator_mode === "GATE_SEND" ? "GATE_SEND" : "OBSERVE";
  $("modeObserve").classList.toggle("active", mode === "OBSERVE");
  $("modeGate").classList.toggle("active", mode === "GATE_SEND");
  $("modeGate").disabled = state.prompt_gate_allowed === false;
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
  renderRuntimeHardening(state);

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
  } catch (error) { setStatus(String(error?.message || error), true); }
}

async function setMode(mode) {
  try {
    await request("A2_OPERATOR_SET_MODE", { mode });
    setStatus(`Operator mode: ${mode}`);
    await refresh();
  } catch (error) { setStatus(String(error?.message || error), true); }
}

async function setArmed(armed) {
  try {
    await request("A2_OPERATOR_SET_ARM", { armed });
    setStatus(armed ? "Autonomous A2 bridge armed." : "Autonomous A2 bridge disarmed.");
    await refresh();
  } catch (error) { setStatus(String(error?.message || error), true); }
}

async function resolve(action, draft = null) {
  try {
    const state = (await request("A2_OPERATOR_STATUS")).state || {};
    const intent = state.prompt_intent;
    if (!intent?.intent_id) throw new Error("No held prompt intent");
    const response = await request("A2_OPERATOR_RESOLVE_PROMPT", { intent_id: intent.intent_id, action, draft });
    if (action === "REWRITE_ALLOW_ONCE" && response.trusted_rewrite?.exact_readback !== true) throw new Error("Trusted rewrite did not return exact readback");
    setStatus(action === "CANCEL" ? "Send cancelled; draft kept on page." : (action === "REWRITE_ALLOW_ONCE" ? "Draft replaced by trusted CDP and allowed once." : "Allowed once for the next physical Send/Enter."));
    await refresh();
  } catch (error) { setStatus(String(error?.message || error), true); }
}

async function capturePerception(platform) {
  if (captureBusy) return;
  captureBusy = true;
  $("captureGlm").disabled = true;
  $("captureGpt").disabled = true;
  try {
    setStatus(`Capturing ${platform} perception…`);
    const response = await request("A2_OPERATOR_CAPTURE_PERCEPTION", {
      platform,
      options: { include_screenshot: true, body_limit: 16000, ax_limit: 70, dom_limit: 100 }
    });
    renderPerception(response.perception || null);
    $("actionTarget").value = platform;
    setStatus(`${platform} screen captured locally. Full capture remains in service-worker memory only.`);
  } catch (error) { setStatus(String(error?.message || error), true); }
  finally {
    captureBusy = false;
    $("captureGlm").disabled = false;
    $("captureGpt").disabled = false;
  }
}

function setActionControlsDisabled(disabled) {
  for (const id of ["stopGeneration", "scrollUp", "scrollDown"]) $(id).disabled = disabled;
  $("perceptionScreenshot").classList.toggle("busy", disabled);
}

async function runOperatorAction(action, extra = {}) {
  if (actionBusy) return;
  actionBusy = true;
  const { platform: platformOverride, ...payload } = extra;
  const platform = String(platformOverride || $("actionTarget").value);
  setActionControlsDisabled(true);
  try {
    setStatus(`Running ${action} on ${platform}…`);
    const response = await request("A2_OPERATOR_ACTION", { platform, action, ...payload });
    const result = response.result || {};
    $("lastAction").textContent = JSON.stringify(result);
    if (result.ok === false) throw new Error(result.status || `${action} was not available`);
    setStatus(`${action} completed on ${platform}.`);
    if (["SCROLL", "STOP_GENERATION", "CLICK_POINT", "DOUBLE_CLICK_POINT"].includes(action)) {
      try {
        const preview = await request("A2_OPERATOR_CAPTURE_PERCEPTION", {
          platform,
          options: { include_screenshot: true, body_limit: 12000, ax_limit: 50, dom_limit: 70 }
        });
        renderPerception(preview.perception || null);
      } catch (_) {}
    }
    await refresh();
  } catch (error) {
    const message = String(error?.message || error);
    $("lastAction").textContent = message;
    setStatus(message, true);
    if (message.includes("frame_stale") || message.includes("frame_expired") || message.includes("frame_token")) {
      try { await capturePerception(platform); } catch (_) {}
    }
  } finally {
    actionBusy = false;
    setActionControlsDisabled(false);
  }
}

function screenshotCoordinates(event) {
  if (!currentPerception?.frame_token) throw new Error("Capture a fresh pixel frame first.");
  const viewport = currentPerception.page?.viewport || {};
  const width = Number(viewport.width || 0), height = Number(viewport.height || 0);
  if (!(width > 0 && height > 0)) throw new Error("Captured viewport dimensions are unavailable.");
  const rect = $("perceptionScreenshot").getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) throw new Error("Captured screenshot is not visible.");
  const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return { x: nx * width, y: ny * height };
}

$("toggleArmed").addEventListener("click", () => setArmed(!lastArmed));
$("modeObserve").addEventListener("click", () => setMode("OBSERVE"));
$("modeGate").addEventListener("click", () => setMode("GATE_SEND"));
$("cancelIntent").addEventListener("click", () => resolve("CANCEL"));
$("allowOriginal").addEventListener("click", () => resolve("ALLOW_ONCE", $("draftOriginal").value));
$("rewriteAllow").addEventListener("click", () => {
  const rewrite = $("draftRewrite").value;
  if (!rewrite.trim()) return setStatus("Rewrite cannot be empty.", true);
  resolve("REWRITE_ALLOW_ONCE", rewrite);
});
$("captureGlm").addEventListener("click", () => capturePerception("GLM_ZAI"));
$("captureGpt").addEventListener("click", () => capturePerception("CHATGPT"));
$("clearPerception").addEventListener("click", () => { renderPerception(null); setStatus("Local perception preview cleared."); });
$("perceptionScreenshot").addEventListener("click", (event) => {
  try {
    if (actionBusy || captureBusy) return;
    const point = screenshotCoordinates(event);
    const platform = String(currentPerception?.platform || "");
    if (!platform) throw new Error("Captured frame has no target platform.");
    $("actionTarget").value = platform;
    runOperatorAction(event.shiftKey ? "DOUBLE_CLICK_POINT" : "CLICK_POINT", {
      platform,
      frame_token: currentPerception.frame_token,
      x: point.x,
      y: point.y
    });
  } catch (error) { setStatus(String(error?.message || error), true); }
});
$("stopGeneration").addEventListener("click", () => runOperatorAction("STOP_GENERATION"));
$("scrollUp").addEventListener("click", () => runOperatorAction("SCROLL", { delta_y: -700 }));
$("scrollDown").addEventListener("click", () => runOperatorAction("SCROLL", { delta_y: 700 }));
$("pollNow").addEventListener("click", async () => {
  try { await request("BRIDGE_POLL_NOW"); setStatus("Bridge poll requested."); await refresh(); }
  catch (error) { setStatus(String(error?.message || error), true); }
});
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

renderPerception(currentPerception);
refresh();
setInterval(refresh, 1000);
