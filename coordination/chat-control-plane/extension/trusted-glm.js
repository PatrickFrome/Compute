(() => {
"use strict";

const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
const DEBUGGER_VERSION = "1.3";
const TRACE_RE = /^[0-9a-f]{32}$/;
const TRACK_TYPES = new Set(["Fetch", "XHR", "EventSource"]);
const trackers = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

function traceId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clientId() {
  const stored = await chrome.storage.local.get("clientId");
  const value = String(stored.clientId || "");
  if (!value) throw new Error("glm_trusted_client_id_missing");
  return value;
}

function bridgeBase() {
  return String(bootstrap.daemonUrl || "").replace(/\/+$/, "");
}

async function postProgress(commandId, transportTraceId, progressStatus) {
  if (!TRACE_RE.test(String(transportTraceId || ""))) throw new Error("invalid_transport_trace_id");
  const response = await fetch(`${bridgeBase()}/v1/commands/${encodeURIComponent(commandId)}/progress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-a2-chat-bridge-client": await clientId()
    },
    body: JSON.stringify({
      progress_status: progressStatus,
      transport_trace_id: transportTraceId,
      authority_effect: false
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`glm_progress_http_${response.status}:${progressStatus}`);
  const body = await response.json().catch(() => ({}));
  if (body?.accepted !== true) throw new Error(`glm_progress_not_accepted:${progressStatus}`);
  return body;
}

async function debuggerCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function attach(tabId) {
  await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
  try {
    await debuggerCommand(tabId, "Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    await debuggerCommand(tabId, "Runtime.enable");
  } catch (error) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw error;
  }
}

async function detach(tabId) {
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

function preparationExpression(prompt) {
  const encoded = JSON.stringify(String(prompt || ""));
  return `(() => new Promise(async (resolve) => {
    const prompt = ${encoded};
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const normalize = (value) => String(value ?? '').replace(/\\r\\n?/g, '\\n').trim();
    const composer = [...document.querySelectorAll('#chat-input, textarea.input-scroll, .messageInputContainer textarea, textarea')].find(visible);
    if (!composer) return resolve({ ok:false, error:'composer_not_found' });
    const beforeText = normalize(composer.value ?? composer.innerText ?? composer.textContent ?? '');
    if (beforeText && beforeText !== normalize(prompt)) return resolve({ ok:false, error:'glm_composer_not_empty_before_trusted_send' });
    if ('value' in composer) {
      const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (!descriptor?.set) return resolve({ ok:false, error:'native_value_setter_unavailable' });
      descriptor.set.call(composer, prompt);
      composer.dispatchEvent(new Event('input', { bubbles:true }));
      composer.dispatchEvent(new Event('change', { bubbles:true }));
    } else {
      return resolve({ ok:false, error:'glm_composer_not_text_control' });
    }
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const candidates = [...document.querySelectorAll('button.sendMessageButton, #send-message-button, button')].filter(visible);
      const send = candidates.find((button) => button.matches('button.sendMessageButton, #send-message-button')) || candidates.find((button) => {
        const fields = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].map((v) => normalize(v).toLowerCase());
        return fields.some((v) => /^(send|send message|send prompt|submit|отправить|отправить сообщение|发送|发送消息)$/iu.test(v));
      });
      if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && getComputedStyle(send).pointerEvents !== 'none') {
        const readback = normalize(composer.value ?? '');
        if (readback !== normalize(prompt)) return resolve({ ok:false, error:'composer_readback_mismatch' });
        const rect = send.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const actionable = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && !!hit && (hit === send || send.contains(hit));
        if (actionable) return resolve({ ok:true, x, y, width:rect.width, height:rect.height, viewport_width:innerWidth, viewport_height:innerHeight });
      }
      await new Promise((r) => setTimeout(r, 75));
    }
    resolve({ ok:false, error:'send_button_not_actionable' });
  }))()`;
}

async function prepare(tabId, prompt) {
  const response = await debuggerCommand(tabId, "Runtime.evaluate", {
    expression: preparationExpression(prompt),
    awaitPromise: true,
    returnByValue: true,
    userGesture: false
  });
  if (response?.exceptionDetails) throw new Error("glm_prepare_runtime_exception");
  const value = response?.result?.value;
  if (value?.ok !== true) throw new Error(String(value?.error || "glm_prepare_failed"));
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("glm_actionability_point_invalid");
  return { x, y, width: Number(value.width || 0), height: Number(value.height || 0) };
}

async function getSnapshot(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" });
    return response?.ok ? response.snapshot : null;
  } catch (_) {
    return null;
  }
}

function snapshotEvidence(before, after, prompt) {
  const messages = Array.isArray(after?.messages) ? after.messages : [];
  const expected = normalize(prompt);
  const exactUserTurn = messages.some((message) => message?.role === "user" && normalize(message?.text) === expected);
  const countAdvanced = Number(after?.message_count || 0) > Number(before?.message_count || 0);
  const composerCleared = normalize(after?.composer_text || "") === "";
  const generatingAccepted = before?.generating !== true && after?.generating === true;
  const verified = exactUserTurn || (composerCleared && countAdvanced) || generatingAccepted;
  return {
    verified,
    exact_user_turn_seen: exactUserTurn,
    verification_strength: exactUserTurn ? "EXACT_USER_TURN" : (composerCleared && countAdvanced ? "CLEARED_AND_COUNT_ADVANCED" : (generatingAccepted ? "GLM_THINKING_ACCEPTED" : "NONE")),
    composer_cleared: composerCleared,
    message_count_before: Number(before?.message_count || 0),
    message_count_after: Number(after?.message_count || 0),
    generating_after_send: after?.generating === true,
    after_snapshot: after || null
  };
}

async function observeAcceptance(tabId, before, prompt, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getSnapshot(tabId);
    if (latest) {
      const evidence = snapshotEvidence(before, latest, prompt);
      if (evidence.verified) return evidence;
    }
    await sleep(250);
  }
  return snapshotEvidence(before, latest, prompt);
}

async function loadDispatched() {
  const stored = await chrome.storage.local.get("a2GlmDispatchedV0522");
  return Array.isArray(stored.a2GlmDispatchedV0522) ? stored.a2GlmDispatchedV0522 : [];
}

async function findDispatched(command) {
  const rows = await loadDispatched();
  const commandId = String(command?.command_id || "");
  const idem = String(command?.idempotency_key || "");
  return rows.find((row) => row?.command_id === commandId || (idem && row?.idempotency_key === idem)) || null;
}

async function rememberDispatched(command, transportTraceId) {
  const rows = await loadDispatched();
  const commandId = String(command.command_id || "");
  const idem = String(command.idempotency_key || "");
  const next = rows.filter((row) => row?.command_id !== commandId && (!idem || row?.idempotency_key !== idem));
  next.push({ command_id: commandId, idempotency_key: idem, transport_trace_id: transportTraceId, dispatched_at: new Date().toISOString() });
  await chrome.storage.local.set({ a2GlmDispatchedV0522: next.slice(-256) });
}

async function maybeRelease(tabId, tracker, attempt = 0) {
  if (trackers.get(tabId) !== tracker) return;
  const snapshot = await getSnapshot(tabId);
  const evidence = snapshotEvidence(tracker.before, snapshot, tracker.prompt);
  const idle = snapshot && snapshot.generating !== true && normalize(snapshot.composer_text || "") === "";
  if (evidence.verified && idle) {
    await postProgress(tracker.commandId, tracker.traceId, "RELEASED").catch(() => {});
    trackers.delete(tabId);
    await detach(tabId);
    return;
  }
  if (attempt < 5) setTimeout(() => maybeRelease(tabId, tracker, attempt + 1), 5000);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source?.tabId;
  const tracker = Number.isInteger(tabId) ? trackers.get(tabId) : null;
  if (!tracker || !tracker.releasedAt) return;

  if (method === "Network.requestWillBeSent" && !tracker.requestId) {
    const requestMethod = String(params?.request?.method || "").toUpperCase();
    if (!TRACK_TYPES.has(String(params?.type || "")) || requestMethod !== "POST") return;
    tracker.requestId = String(params.requestId || "");
    if (!tracker.requestId) return;
    postProgress(tracker.commandId, tracker.traceId, "REQUEST_OBSERVED").catch(() => {});
    return;
  }
  if (!tracker.requestId || String(params?.requestId || "") !== tracker.requestId) return;
  if (method === "Network.responseReceived" && !tracker.responseStarted) {
    tracker.responseStarted = true;
    postProgress(tracker.commandId, tracker.traceId, "RESPONSE_STARTED").catch(() => {});
    return;
  }
  if (method === "Network.loadingFinished" && !tracker.networkTerminal) {
    tracker.networkTerminal = "COMPLETED";
    postProgress(tracker.commandId, tracker.traceId, "NETWORK_COMPLETED")
      .finally(() => setTimeout(() => maybeRelease(tabId, tracker, 0), 3000));
    return;
  }
  if (method === "Network.loadingFailed" && !tracker.networkTerminal) {
    tracker.networkTerminal = "ERROR_HOLD";
    postProgress(tracker.commandId, tracker.traceId, "NETWORK_ERROR_HOLD")
      .finally(() => setTimeout(() => maybeRelease(tabId, tracker, 0), 60000));
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source?.tabId)) trackers.delete(source.tabId);
});

async function trustedSend(tabId, command) {
  const commandId = String(command?.command_id || "");
  const prompt = String(command?.prompt || "");
  if (!commandId || !prompt.trim()) throw new Error("glm_trusted_invalid_command");

  const prior = await findDispatched(command);
  if (prior) {
    return {
      status: "DUPLICATE_IGNORED",
      command_id: commandId,
      clicked_send_button: true,
      transport_trace_id: prior.transport_trace_id || null,
      verification: { verified: true, durable_dispatch_replay: true, verification_strength: "DURABLE_DISPATCH_REPLAY" },
      recovery: "GLM_AT_MOST_ONCE_DURABLE_REPLAY"
    };
  }

  const before = await getSnapshot(tabId);
  if (!before) throw new Error("glm_snapshot_unavailable_before_trusted_send");
  if (before.generating === true) throw new Error("chat_is_generating");
  if (normalize(before.composer_text || "") !== "") throw new Error("glm_composer_not_empty_before_trusted_send");

  const transportTraceId = traceId();
  let attached = false;
  let pressed = false;
  let point = null;
  try {
    await attach(tabId);
    attached = true;
    point = await prepare(tabId, prompt);
    const tracker = { tabId, commandId, prompt, traceId: transportTraceId, before, requestId: null, responseStarted: false, networkTerminal: null, releasedAt: 0 };
    trackers.set(tabId, tracker);

    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    pressed = true;

    // Critical ordering: durable server fence exists before the trusted click is completed.
    await postProgress(commandId, transportTraceId, "DISPATCHED");
    await rememberDispatched(command, transportTraceId);

    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    pressed = false;
    tracker.releasedAt = Date.now();

    const verification = await observeAcceptance(tabId, before, prompt);
    const status = verification.exact_user_turn_seen === true
      ? "SENT_AND_DOM_VERIFIED"
      : (verification.verified === true ? "SENT_WEAK_DOM_VERIFIED" : "SENT_DISPATCHED_UNCONFIRMED_NO_RETRY");
    return {
      status,
      command_id: commandId,
      clicked_send_button: true,
      transport_trace_id: transportTraceId,
      verification,
      recovery: verification.verified ? "GLM_TRUSTED_CDP_DUAL_FENCE" : "GLM_AT_MOST_ONCE_NO_RELOAD"
    };
  } catch (error) {
    if (pressed && point) {
      // Cancel a not-yet-fenced press away from the actionable target. Never retry.
      await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
      pressed = false;
    }
    const tracker = trackers.get(tabId);
    if (tracker && !tracker.releasedAt) trackers.delete(tabId);
    if (attached && !trackers.has(tabId)) await detach(tabId);
    throw error;
  }
}

globalThis.A2_GLM_TRUSTED_SEND = trustedSend;
})();
