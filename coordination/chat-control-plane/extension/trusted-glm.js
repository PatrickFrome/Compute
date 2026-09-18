(() => {
  "use strict";

  const TRACE_RE = /^[0-9a-f]{32}$/;
  const HASH_RE = /^[0-9a-f]{64}$/;
  const TRACK_TYPES = new Set(["Fetch", "XHR", "EventSource"]);
  const LEDGER_KEY = "a2GlmTransportV0523";
  const MAX_LEDGER = 512;
  const SAFE = "SAFE_RETRY_PRE_ACTUATION";
  const AMBIGUOUS = "AMBIGUOUS_NO_RETRY";
  const ACTUATED = "ACTUATED";
  const VERIFIED = "VERIFIED";
  const MONITOR_INTERVAL_MS = 5000;
  const MONITOR_MAX_ATTEMPTS = 120;
  const trackers = new Map();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function typedError(error, executionClass) {
    const e = error instanceof Error ? error : new Error(String(error || "glm_trusted_failure"));
    e.a2ExecutionClass = executionClass;
    return e;
  }

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function traceId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function postProgress(commandId, transportTraceId, progressStatus) {
    if (!TRACE_RE.test(String(transportTraceId || ""))) throw new Error("invalid_transport_trace_id");
    if (typeof globalThis.A2_BRIDGE_REQUEST !== "function") throw new Error("bridge_client_unavailable");
    const response = await globalThis.A2_BRIDGE_REQUEST(`/v1/commands/${encodeURIComponent(commandId)}/progress`, {
      method: "POST",
      body: JSON.stringify({ progress_status: progressStatus, transport_trace_id: transportTraceId, authority_effect: false })
    });
    if (!response.ok) throw new Error(`glm_progress_http_${response.status}:${progressStatus}`);
    const body = await response.json().catch(() => ({}));
    if (body?.accepted !== true) throw new Error(`glm_progress_not_accepted:${progressStatus}`);
    return body;
  }

  async function operatorGateEnabled() {
    const { operatorMode } = await chrome.storage.local.get("operatorMode");
    return operatorMode === "GATE_SEND";
  }

  async function armPromptGateBypass(tabId, commandId, prompt) {
    if (!(await operatorGateEnabled())) return false;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS",
      command_id: commandId,
      draft: prompt,
      expires_in_ms: 3000
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!response?.ok) throw new Error(`glm_prompt_gate_bypass_unavailable:${response?.error || "unknown"}`);
    return true;
  }

  async function clearPromptGateBypass(tabId, commandId) {
    await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR",
      command_id: commandId
    }).catch(() => null);
  }

  function composerInspectExpression() {
    return `(() => {
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const normalize = (value) => String(value ?? '').replace(/\\r\\n?/g, '\\n').trim();
      const composers = [...document.querySelectorAll('#chat-input, textarea.input-scroll, .messageInputContainer textarea, textarea')].filter(visible);
      const composer = composers.find((el) => el.id === 'chat-input') || (composers.length === 1 ? composers[0] : null);
      if (!composer) return { ok:false, error:composers.length > 1 ? 'composer_ambiguous' : 'composer_not_found', count:composers.length };
      if (!('value' in composer)) return { ok:false, error:'glm_composer_not_text_control' };
      const text = normalize(composer.value ?? '');
      composer.focus();
      if (document.activeElement !== composer && !composer.contains?.(document.activeElement)) return { ok:false, error:'composer_focus_failed' };
      return { ok:true, text };
    })()`;
  }

  function sendPointExpression(prompt) {
    const encoded = JSON.stringify(String(prompt || ""));
    return `(() => {
      const prompt = ${encoded};
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const normalize = (value) => String(value ?? '').replace(/\\r\\n?/g, '\\n').trim();
      const composers = [...document.querySelectorAll('#chat-input, textarea.input-scroll, .messageInputContainer textarea, textarea')].filter(visible);
      const composer = composers.find((el) => el.id === 'chat-input') || (composers.length === 1 ? composers[0] : null);
      if (!composer) return { ok:false, error:composers.length > 1 ? 'composer_ambiguous' : 'composer_not_found' };
      const readback = normalize(composer.value ?? '');
      if (readback !== normalize(prompt)) return { ok:false, error:'composer_readback_mismatch' };
      const exact = [...document.querySelectorAll('button.sendMessageButton, #send-message-button')].filter(visible);
      const semantic = [...document.querySelectorAll('button')].filter(visible).filter((button) => {
        const fields = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].map((v) => normalize(v).toLowerCase());
        return fields.some((v) => /^(send|send message|send prompt|submit|отправить|отправить сообщение|发送|发送消息)$/iu.test(v));
      });
      const candidates = exact.length ? exact : semantic;
      if (candidates.length === 0) return { ok:false, error:'send_button_pending' };
      if (candidates.length !== 1) return { ok:false, error:'send_button_ambiguous', count:candidates.length };
      const send = candidates[0];
      if (send.disabled || send.getAttribute('aria-disabled') === 'true' || getComputedStyle(send).pointerEvents === 'none') return { ok:false, error:'send_button_pending' };
      const rect = send.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const actionable = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && !!hit && (hit === send || send.contains(hit));
      return actionable ? { ok:true, x, y, width:rect.width, height:rect.height } : { ok:false, error:'send_button_not_actionable' };
    })()`;
  }

  async function evaluate(session, expression) {
    const response = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (response?.exceptionDetails) throw new Error("glm_runtime_exception");
    return response?.result?.value;
  }

  async function prepare(session, prompt) {
    const before = await evaluate(session, composerInspectExpression());
    if (before?.ok !== true) throw new Error(String(before?.error || "glm_prepare_failed"));
    if (normalize(before.text || "") !== "") throw new Error("glm_composer_not_empty_before_trusted_send");
    await session.send("Input.insertText", { text: prompt });
    const deadline = Date.now() + 3500;
    let lastError = "send_button_not_actionable";
    while (Date.now() < deadline) {
      const point = await evaluate(session, sendPointExpression(prompt));
      if (point?.ok === true) {
        const x = Number(point.x), y = Number(point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("glm_actionability_point_invalid");
        return { x, y };
      }
      lastError = String(point?.error || lastError);
      if (["composer_ambiguous", "composer_not_found", "composer_readback_mismatch", "send_button_ambiguous"].includes(lastError)) throw new Error(lastError);
      await sleep(75);
    }
    throw new Error(lastError);
  }

  async function clearComposerBeforeActuation(session) {
    try {
      const inspect = await evaluate(session, composerInspectExpression());
      if (inspect?.ok !== true) return false;
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      const after = await evaluate(session, composerInspectExpression());
      return after?.ok === true && normalize(after.text || "") === "";
    } catch (_) {
      return false;
    }
  }

  async function getSnapshot(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" });
      return response?.ok ? response.snapshot : null;
    } catch (_) { return null; }
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

  async function observeAcceptance(tabId, before, prompt, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;
    while (Date.now() < deadline) {
      latest = await getSnapshot(tabId);
      if (latest) {
        const evidence = snapshotEvidence(before, latest, prompt);
        if (evidence.verified) return evidence;
      }
      await sleep(125);
    }
    return snapshotEvidence(before, latest, prompt);
  }

  async function loadLedger() {
    const stored = await chrome.storage.local.get(LEDGER_KEY);
    return Array.isArray(stored[LEDGER_KEY]) ? stored[LEDGER_KEY] : [];
  }

  async function saveLedger(rows) { await chrome.storage.local.set({ [LEDGER_KEY]: rows.slice(-MAX_LEDGER) }); }

  async function findTransport(command) {
    const rows = await loadLedger();
    const commandId = String(command?.command_id || ""), idem = String(command?.idempotency_key || "");
    return rows.find((row) => row?.command_id === commandId || (idem && row?.idempotency_key === idem)) || null;
  }

  async function updateTransport(command, trace, patch) {
    const rows = await loadLedger();
    const commandId = String(command?.command_id || ""), idem = String(command?.idempotency_key || "");
    const old = rows.find((row) => row?.command_id === commandId || (idem && row?.idempotency_key === idem)) || {};
    const next = rows.filter((row) => row?.command_id !== commandId && (!idem || row?.idempotency_key !== idem));
    next.push({ ...old, command_id: commandId, idempotency_key: idem, tab_id: Number(command?.tab_id || old.tab_id || 0) || null, transport_trace_id: trace || old.transport_trace_id || null, ...patch, updated_at: new Date().toISOString() });
    await saveLedger(next);
  }

  function validateCommand(command) {
    const commandId = String(command?.command_id || ""), idem = String(command?.idempotency_key || ""), prompt = String(command?.prompt || "");
    if (!commandId || !idem || !prompt.trim()) throw new Error("glm_trusted_invalid_command");
    if (command?.target_platform !== "GLM_ZAI") throw new Error("glm_trusted_target_platform_mismatch");
    if (!prompt.startsWith("A2 CHAT BRIDGE — AUTONOMOUS CONTINUE") || !prompt.includes("bridge_job_target=GLM")) throw new Error("glm_trusted_prompt_scope_mismatch");
    return { commandId, idem, prompt };
  }

  function bufferNetworkProgress(tracker, status) {
    if (tracker.actuatedAt) tracker.progressChain = tracker.progressChain.then(() => postProgress(tracker.commandId, tracker.traceId, status)).catch(() => {});
    else tracker.pendingProgress.push(status);
  }

  async function markActuated(tabId, tracker, command) {
    if (tracker.actuatedAt) return;
    tracker.actuatedAt = Date.now();
    await updateTransport({ ...command, tab_id: tabId }, tracker.traceId, { state: "ACTUATED", actuated_at: new Date(tracker.actuatedAt).toISOString() });
    await postProgress(tracker.commandId, tracker.traceId, "ACTUATED");
    for (const status of tracker.pendingProgress.splice(0)) bufferNetworkProgress(tracker, status);
    try { globalThis.A2_ON_GLM_ACTUATED?.(tracker.commandId); } catch (_) {}
  }

  async function releaseMonitor(tabId, tracker) {
    trackers.delete(tabId);
    await tracker.debuggerLease?.release?.().catch?.(() => {});
  }

  async function maybeRelease(tabId, tracker, attempt = 0) {
    if (trackers.get(tabId) !== tracker) return;
    const snapshot = await getSnapshot(tabId);
    const evidence = snapshotEvidence(tracker.before, snapshot, tracker.prompt);
    const idle = snapshot && snapshot.generating !== true && normalize(snapshot.composer_text || "") === "";
    if (evidence.verified && idle) {
      await tracker.progressChain.catch(() => {});
      await postProgress(tracker.commandId, tracker.traceId, "RELEASED").catch(() => {});
      await updateTransport(tracker.command, tracker.traceId, { state: "RELEASED", released_at: new Date().toISOString() }).catch(() => {});
      await releaseMonitor(tabId, tracker);
      return;
    }
    if (attempt < MONITOR_MAX_ATTEMPTS) {
      setTimeout(() => maybeRelease(tabId, tracker, attempt + 1), MONITOR_INTERVAL_MS);
      return;
    }
    await postProgress(tracker.commandId, tracker.traceId, "NETWORK_ERROR_HOLD").catch(() => {});
    await updateTransport(tracker.command, tracker.traceId, { monitor_timeout_at: new Date().toISOString() }).catch(() => {});
    await releaseMonitor(tabId, tracker);
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    const tracker = Number.isInteger(tabId) ? trackers.get(tabId) : null;
    if (!tracker || !tracker.releaseInitiatedAt) return;
    if (method === "Network.requestWillBeSent" && !tracker.requestId) {
      const requestMethod = String(params?.request?.method || "").toUpperCase();
      if (!TRACK_TYPES.has(String(params?.type || "")) || requestMethod !== "POST") return;
      tracker.requestId = String(params.requestId || "");
      if (!tracker.requestId) return;
      bufferNetworkProgress(tracker, "REQUEST_OBSERVED");
      return;
    }
    if (!tracker.requestId || String(params?.requestId || "") !== tracker.requestId) return;
    if (method === "Network.responseReceived" && !tracker.responseStarted) {
      tracker.responseStarted = true;
      bufferNetworkProgress(tracker, "RESPONSE_STARTED");
      return;
    }
    if (method === "Network.loadingFinished" && !tracker.networkTerminal) {
      tracker.networkTerminal = "COMPLETED";
      bufferNetworkProgress(tracker, "NETWORK_COMPLETED");
      return;
    }
    if (method === "Network.loadingFailed" && !tracker.networkTerminal) {
      tracker.networkTerminal = "ERROR_HOLD";
      bufferNetworkProgress(tracker, "NETWORK_ERROR_HOLD");
    }
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = Number(source?.tabId);
    if (!Number.isInteger(tabId)) return;
    const tracker = trackers.get(tabId);
    if (!tracker) return;
    trackers.delete(tabId);
    if (tracker.actuatedAt) {
      postProgress(tracker.commandId, tracker.traceId, "NETWORK_ERROR_HOLD").catch(() => {});
      updateTransport(tracker.command, tracker.traceId, { debugger_detached_at: new Date().toISOString() }).catch(() => {});
    }
  });

  async function trustedSend(tabId, command) {
    const { commandId, prompt } = validateCommand(command);
    const prior = await findTransport(command);
    if (prior && prior.state !== "ABORTED_BEFORE_ACTUATION") {
      const actuated = ["ACTUATED", "RELEASED"].includes(prior.state);
      return {
        status: actuated ? "SENT_ALREADY_DURABLE" : "FAILED_DURABLE_AMBIGUOUS_NO_RETRY",
        execution_class: actuated ? ACTUATED : AMBIGUOUS,
        command_id: commandId,
        clicked_send_button: actuated,
        transport_trace_id: prior.transport_trace_id || null,
        verification: { verified: actuated, durable_transport_replay: true, transport_state: prior.state },
        recovery: actuated ? "GLM_AT_MOST_ONCE_DURABLE_REPLAY" : "GLM_DURABLE_PRE_RELEASE_AMBIGUOUS"
      };
    }

    if (typeof globalThis.A2_DEBUGGER_HOLD !== "function" || typeof globalThis.A2_DEBUGGER_RUN !== "function") {
      throw typedError(new Error("glm_debugger_broker_unavailable"), SAFE);
    }

    const before = await getSnapshot(tabId);
    if (!before) throw typedError(new Error("glm_snapshot_unavailable_before_trusted_send"), SAFE);
    if (before.generating === true) throw typedError(new Error("chat_is_generating"), SAFE);
    if (normalize(before.composer_text || "") !== "") throw typedError(new Error("glm_composer_not_empty_before_trusted_send"), SAFE);

    const promptSha256 = await sha256Text(normalize(prompt));
    const transportTraceId = traceId();
    let monitorLease = null;
    let tracker = null;
    let promptInserted = false;
    let pressed = false;
    let released = false;
    let bypassArmed = false;
    let point = null;

    try {
      monitorLease = await globalThis.A2_DEBUGGER_HOLD(tabId, `glm-monitor:${commandId}`);
      await monitorLease.send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
      await monitorLease.send("Runtime.enable");

      tracker = {
        tabId, commandId, command, prompt, traceId: transportTraceId, before, debuggerLease: monitorLease,
        requestId: null, responseStarted: false, networkTerminal: null,
        releaseInitiatedAt: 0, actuatedAt: 0, pendingProgress: [], progressChain: Promise.resolve()
      };

      const result = await globalThis.A2_DEBUGGER_RUN(tabId, `glm-actuate:${commandId}`, async (session) => {
        point = await prepare(session, prompt);
        promptInserted = true;
        trackers.set(tabId, tracker);

        await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
        pressed = true;

        await postProgress(commandId, transportTraceId, "DISPATCHED");
        try {
          await updateTransport({ ...command, tab_id: tabId }, transportTraceId, {
            state: "DISPATCHED",
            dispatched_at: new Date().toISOString(),
            before_message_count: Number(before?.message_count || 0),
            prompt_sha256_local: promptSha256
          });
        } catch (error) {
          const cancelled = await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).then(() => true).catch(() => false);
          pressed = false;
          await postProgress(commandId, transportTraceId, "ABORTED_BEFORE_ACTUATION").catch(() => {});
          throw typedError(error, cancelled ? SAFE : AMBIGUOUS);
        }

        try {
          bypassArmed = await armPromptGateBypass(tabId, commandId, prompt);
        } catch (error) {
          const cancelled = await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).then(() => true).catch(() => false);
          pressed = false;
          await postProgress(commandId, transportTraceId, "ABORTED_BEFORE_ACTUATION").catch(() => {});
          throw typedError(error, cancelled ? SAFE : AMBIGUOUS);
        }

        tracker.releaseInitiatedAt = Date.now();
        try {
          await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
          pressed = false;
          released = true;
          await markActuated(tabId, tracker, command);
        } catch (releaseError) {
          const evidence = await observeAcceptance(tabId, before, prompt, 700);
          if (tracker.requestId || evidence.verified || tracker.actuatedAt) {
            pressed = false;
            released = true;
            await markActuated(tabId, tracker, command).catch(() => {});
          } else {
            if (pressed) {
              await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
              pressed = false;
            }
            throw typedError(new Error(`glm_release_ambiguous_no_retry:${String(releaseError?.message || releaseError)}`), AMBIGUOUS);
          }
        } finally {
          if (bypassArmed) await clearPromptGateBypass(tabId, commandId);
        }

        const verification = await observeAcceptance(tabId, before, prompt, 2500);
        const status = verification.exact_user_turn_seen === true
          ? "SENT_AND_DOM_VERIFIED"
          : (verification.verified === true ? "SENT_WEAK_DOM_VERIFIED" : (tracker.requestId ? "SENT_NETWORK_DISPATCH_CONFIRMED" : "SENT_DISPATCHED_UNCONFIRMED_NO_RETRY"));
        return {
          status,
          execution_class: verification.verified === true ? VERIFIED : ACTUATED,
          command_id: commandId,
          clicked_send_button: released,
          transport_trace_id: transportTraceId,
          verification,
          recovery: "GLM_TRUSTED_CDP_BROWSER_OPERATOR_V060_BROKERED"
        };
      });

      setTimeout(() => maybeRelease(tabId, tracker, 0), 2500);
      return result;
    } catch (error) {
      if (bypassArmed) await clearPromptGateBypass(tabId, commandId);
      if (!released && tracker) trackers.delete(tabId);
      if (!released && promptInserted && !error?.a2ExecutionClass && monitorLease) {
        await globalThis.A2_DEBUGGER_RUN(tabId, `glm-cleanup:${commandId}`, (session) => clearComposerBeforeActuation(session)).catch(() => false);
      }
      if (!released && monitorLease) await monitorLease.release().catch(() => {});
      if (!error?.a2ExecutionClass) error = typedError(error, released || tracker?.actuatedAt ? AMBIGUOUS : SAFE);
      throw error;
    }
  }

  async function reconcile(tabId) {
    const rows = await loadLedger();
    const candidates = rows.filter((row) => Number(row?.tab_id) === tabId && !["RELEASED", "ABORTED_BEFORE_ACTUATION"].includes(row?.state));
    if (!candidates.length) return { reconciled: false, reason: "NO_PENDING_TRANSPORT" };
    const row = candidates[candidates.length - 1];
    const snapshot = await getSnapshot(tabId);
    if (!snapshot) return { reconciled: false, reason: "SNAPSHOT_UNAVAILABLE" };
    const trace = String(row.transport_trace_id || "");
    if (!TRACE_RE.test(trace)) return { reconciled: false, reason: "TRACE_INVALID" };
    const beforeCount = Number(row.before_message_count || 0);
    const afterCount = Number(snapshot.message_count || 0);
    const strongPromptHash = String(row.prompt_sha256_local || "");
    const exactUserTurn = HASH_RE.test(strongPromptHash) && Array.isArray(snapshot.messages)
      && snapshot.messages.some((m) => m?.role === "user" && String(m?.text_sha256 || "") === strongPromptHash);
    const countAdvanced = afterCount > beforeCount;
    const composerCleared = normalize(snapshot.composer_text || "") === "";
    const actuationEvidence = exactUserTurn || (countAdvanced && composerCleared);
    const evidence = { verified: actuationEvidence, exact_user_turn_seen: exactUserTurn, strong_sha256_identity: HASH_RE.test(strongPromptHash), count_advanced: countAdvanced, composer_cleared: composerCleared, message_count_before: beforeCount, message_count_after: afterCount };

    let state = row.state;
    if (state === "DISPATCHED" && actuationEvidence) {
      state = "ACTUATED";
      await updateTransport(row, trace, { state, actuated_at: row.actuated_at || new Date().toISOString() });
      await postProgress(row.command_id, trace, "ACTUATED").catch(() => {});
      try { globalThis.A2_ON_GLM_ACTUATED?.(row.command_id); } catch (_) {}
    }
    if (state === "ACTUATED" && actuationEvidence && snapshot.generating !== true && composerCleared) {
      await postProgress(row.command_id, trace, "RELEASED").catch(() => {});
      await updateTransport(row, trace, { state: "RELEASED", released_at: new Date().toISOString() });
      return { reconciled: true, state: "RELEASED", evidence };
    }
    return { reconciled: true, state, evidence };
  }

  globalThis.A2_GLM_TRUSTED_SEND = trustedSend;
  globalThis.A2_GLM_RECONCILE = reconcile;
})();
