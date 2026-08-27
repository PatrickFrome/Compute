(() => {
  "use strict";

  const MAX_PROMPT_CHARS = 120000;
  const SEND_READY_TIMEOUT_MS = 2200;
  const SEND_READY_POLL_MS = 40;
  const LEDGER_KEY = "a2ChatgptDispatchedV0523";
  const MAX_LEDGER = 512;
  const SAFE = "SAFE_RETRY_PRE_ACTUATION";
  const AMBIGUOUS = "AMBIGUOUS_NO_RETRY";
  const ACTUATED = "ACTUATED";
  const inFlightTabs = new Set();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const canonicalVisible = (value) => String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/gu, " ")
    .trim();

  function typedError(error, executionClass) {
    const e = error instanceof Error ? error : new Error(String(error || "chatgpt_cdp_failure"));
    e.a2ExecutionClass = executionClass;
    return e;
  }

  async function evaluate(session, expression) {
    const result = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error("chatgpt_cdp_evaluate_failed");
    return result?.result?.value;
  }

  function validateBridgeCommand(command) {
    const commandId = String(command?.command_id || "");
    const idempotencyKey = String(command?.idempotency_key || "");
    const prompt = String(command?.prompt || "");
    if (!commandId || !idempotencyKey || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) throw new Error("chatgpt_cdp_command_invalid");
    if (command?.target_platform !== "CHATGPT") throw new Error("chatgpt_cdp_target_platform_mismatch");
    if (!prompt.startsWith("A2 CHAT BRIDGE — AUTONOMOUS CONTINUE")) throw new Error("chatgpt_cdp_prompt_not_bridge_owned");
    if (!prompt.includes("bridge_job_target=GPT") || !prompt.includes("transport=WEB_CHAT_INTERACTIVE_REMOTE")) throw new Error("chatgpt_cdp_prompt_scope_mismatch");
    return { commandId, idempotencyKey, prompt };
  }

  async function ensureArmed() {
    const { armed } = await chrome.storage.local.get("armed");
    if (armed !== true) throw new Error("chatgpt_cdp_not_armed");
  }

  async function armPromptGateBypass(tabId, commandId, prompt) {
    const { operatorMode } = await chrome.storage.local.get("operatorMode");
    if (operatorMode !== "GATE_SEND") return false;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS",
      command_id: commandId,
      draft: prompt,
      expires_in_ms: 3000
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!response?.ok) throw new Error(`chatgpt_prompt_gate_bypass_unavailable:${response?.error || "unknown"}`);
    return true;
  }

  async function clearPromptGateBypass(tabId, commandId) {
    await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR",
      command_id: commandId
    }).catch(() => null);
  }

  async function ensurePinnedChatgptTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(String(tab?.url || ""));
    if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase())) throw new Error("chatgpt_cdp_target_host_mismatch");
    if (url.pathname.startsWith("/c/")) return { mode: "CONVERSATION", url: url.toString() };
    const stored = await chrome.storage.local.get(["chatgptRolloverPendingTabId", "chatgptRolloverPending"]);
    if (url.pathname === "/" && stored.chatgptRolloverPending === true && Number(stored.chatgptRolloverPendingTabId) === tabId) return { mode: "ROLLOVER_ROOT", url: url.toString() };
    throw new Error("chatgpt_cdp_target_not_conversation");
  }

  async function conversationExhausted(session) {
    return evaluate(session, `(() => {
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const turnSelector = "[data-testid^='conversation-turn-'], article[data-testid^='conversation-turn-']";
      const candidates = [...new Set([
        ...document.querySelectorAll("[role='alert']"), ...document.querySelectorAll("[role='status']"),
        ...document.querySelectorAll("[data-testid*='error']"), ...document.querySelectorAll("[data-testid*='notice']"),
        ...document.querySelectorAll("main [class*='error']"), ...document.querySelectorAll("main [class*='notice']")
      ])].filter(visible).filter((el) => !el.closest(turnSelector));
      const pattern = /you['’]?ve reached the maximum length for this conversation|maximum length for this conversation/i;
      return candidates.some((el) => pattern.test(String(el.innerText || el.textContent || '').slice(0, 1200)));
    })()`);
  }

  async function inspectComposer(session) {
    return evaluate(session, `(() => {
      const visible = (el) => { if (!(el instanceof HTMLElement)) return false; const style=getComputedStyle(el); const r=el.getBoundingClientRect(); return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)!==0 && r.width>0 && r.height>0; };
      const composers=[...document.querySelectorAll('#prompt-textarea')].filter(visible);
      if (composers.length !== 1) return {ok:false,error:'composer_count',count:composers.length};
      const composer=composers[0]; const form=composer.closest('form');
      if (!form) return {ok:false,error:'composer_form_missing'};
      return {ok:true,text:String(composer.innerText || composer.textContent || '')};
    })()`);
  }

  async function focusComposer(session) {
    const result = await evaluate(session, `(() => { const e=[...document.querySelectorAll('#prompt-textarea')]; if(e.length!==1) return false; const el=e[0]; if(!(el instanceof HTMLElement)) return false; el.focus(); return document.activeElement===el || el.contains(document.activeElement); })()`);
    if (result !== true) throw new Error("chatgpt_cdp_focus_failed");
  }

  async function inspectReadySend(session) {
    return evaluate(session, `(() => {
      const visible=(el)=>{ if(!(el instanceof HTMLElement))return false; const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0; };
      const composers=[...document.querySelectorAll('#prompt-textarea')].filter(visible);
      if(composers.length!==1)return{ok:false,error:'composer_count',count:composers.length};
      const composer=composers[0],form=composer.closest('form'); if(!form)return{ok:false,error:'composer_form_missing'};
      if(!String(composer.innerText||composer.textContent||'').trim())return{ok:false,error:'composer_empty'};
      const buttons=[...new Set([...form.querySelectorAll('#composer-submit-button'),...form.querySelectorAll("button[data-testid='send-button']"),...form.querySelectorAll("button[data-testid='composer-submit-button']")])].filter(visible);
      if(buttons.length===0)return{ok:false,error:'send_pending',count:0}; if(buttons.length!==1)return{ok:false,error:'send_ambiguous',count:buttons.length};
      const button=buttons[0]; if(!(button instanceof HTMLButtonElement))return{ok:false,error:'send_not_button'};
      if(button.disabled||button.getAttribute('aria-disabled')==='true')return{ok:false,error:'send_pending',count:1}; return{ok:true};
    })()`);
  }

  async function waitForReadySend(session) {
    const deadline = Date.now() + SEND_READY_TIMEOUT_MS;
    let lastError = "send_not_ready";
    while (Date.now() < deadline) {
      const state = await inspectReadySend(session);
      if (state?.ok) return;
      lastError = String(state?.error || lastError);
      if (["composer_count", "composer_form_missing", "send_ambiguous", "send_not_button"].includes(lastError)) throw new Error(`chatgpt_cdp_${lastError}`);
      await sleep(SEND_READY_POLL_MS);
    }
    throw new Error(`chatgpt_cdp_${lastError}`);
  }

  async function clearComposerBeforeActuation(session) {
    try {
      await focusComposer(session);
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      const after = await inspectComposer(session);
      return after?.ok === true && canonicalVisible(after.text) === "";
    } catch (_) {
      return false;
    }
  }

  async function loadLedger() {
    const stored = await chrome.storage.local.get(LEDGER_KEY);
    return Array.isArray(stored[LEDGER_KEY]) ? stored[LEDGER_KEY] : [];
  }

  async function priorDispatch(commandId, idempotencyKey) {
    const rows = await loadLedger();
    return rows.find((row) => row?.command_id === commandId || row?.idempotency_key === idempotencyKey) || null;
  }

  async function rememberDispatch(commandId, idempotencyKey, phase) {
    const rows = await loadLedger();
    const next = rows.filter((row) => row?.command_id !== commandId && row?.idempotency_key !== idempotencyKey);
    next.push({ command_id: commandId, idempotency_key: idempotencyKey, phase, at: new Date().toISOString() });
    await chrome.storage.local.set({ [LEDGER_KEY]: next.slice(-MAX_LEDGER) });
  }

  async function dispatchTrustedEnter(session, commandId, idempotencyKey) {
    await focusComposer(session);
    await rememberDispatch(commandId, idempotencyKey, "PRE_ENTER_DURABLE");
    try {
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await rememberDispatch(commandId, idempotencyKey, "ACTUATED");
    } catch (error) {
      throw typedError(new Error(`chatgpt_enter_ambiguous_no_retry:${String(error?.message || error)}`), AMBIGUOUS);
    }
  }

  async function withDebugger(tabId, operation) {
    if (inFlightTabs.has(tabId)) throw new Error("chatgpt_cdp_tab_busy");
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("chatgpt_debugger_broker_unavailable");
    inFlightTabs.add(tabId);
    try {
      await ensureArmed();
      const scope = await ensurePinnedChatgptTab(tabId);
      return await globalThis.A2_DEBUGGER_RUN(tabId, "chatgpt-trusted-send", (session) => operation(scope, session));
    } finally {
      inFlightTabs.delete(tabId);
    }
  }

  async function trustedSend(tabId, command) {
    const { commandId, idempotencyKey, prompt } = validateBridgeCommand(command);
    const prior = await priorDispatch(commandId, idempotencyKey);
    if (prior) {
      if (prior.phase === "ACTUATED") return { ok: true, status: "SENT_ALREADY_DURABLE", execution_class: ACTUATED, durable_dispatch_replay: true, phase: prior.phase };
      return { ok: false, status: "FAILED_DURABLE_AMBIGUOUS_NO_RETRY", execution_class: AMBIGUOUS, durable_dispatch_replay: true, phase: prior.phase || null, error: "chatgpt_durable_pre_enter_ambiguous" };
    }

    try {
      return await withDebugger(tabId, async (scope, session) => {
        let promptInserted = false;
        let bypassArmed = false;
        try {
          if (scope?.mode === "CONVERSATION" && await conversationExhausted(session)) throw new Error("chatgpt_cdp_conversation_exhausted");
          const before = await inspectComposer(session);
          if (!before?.ok) throw new Error(`chatgpt_cdp_${before?.error || "composer_inspect_failed"}`);
          if (canonicalVisible(before.text) !== "") throw new Error("chatgpt_cdp_composer_not_empty");
          await focusComposer(session);
          await session.send("Input.insertText", { text: prompt });
          promptInserted = true;
          await waitForReadySend(session);
          bypassArmed = await armPromptGateBypass(tabId, commandId, prompt);
          await dispatchTrustedEnter(session, commandId, idempotencyKey);
          return { ok: true, status: "SENT_DISPATCHED_UNCONFIRMED_NO_RETRY", execution_class: ACTUATED, phase: scope?.mode === "ROLLOVER_ROOT" ? "TRUSTED_ENTER_ROLLOVER_ACTUATED" : "TRUSTED_ENTER_ACTUATED" };
        } catch (error) {
          if (!error?.a2ExecutionClass && promptInserted) {
            await clearComposerBeforeActuation(session);
            if (bypassArmed) await clearPromptGateBypass(tabId, commandId);
          }
          throw error;
        }
      });
    } catch (error) {
      if (error?.a2ExecutionClass) throw error;
      throw typedError(error, SAFE);
    }
  }

  globalThis.A2_CHATGPT_TRUSTED_SEND = trustedSend;
})();
