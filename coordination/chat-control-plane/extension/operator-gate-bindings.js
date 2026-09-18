(() => {
  "use strict";

  const SAFE = "SAFE_RETRY_PRE_ACTUATION";
  const AMBIGUOUS = "AMBIGUOUS_NO_RETRY";

  function typedError(message) {
    const error = new Error(message);
    error.a2ExecutionClass = SAFE;
    return error;
  }

  function autonomousDisabled() {
    return globalThis.A2_COMPAT_GET?.("kill_switches.autonomous_send_disabled", false) === true;
  }

  function assertAutonomousAllowed() {
    if (autonomousDisabled()) throw typedError("compat_kill_switch_autonomous_send_disabled");
  }

  function glmComposerExpression(expectedPrompt) {
    const encoded = JSON.stringify(String(expectedPrompt || ""));
    return `(() => {
      const expected=${encoded};
      const visible=(el)=>{if(!(el instanceof HTMLElement))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
      const normalize=(v)=>String(v??'').replace(/\\r\\n?/g,'\\n').trim();
      const found=[...document.querySelectorAll('#chat-input, textarea.input-scroll, .messageInputContainer textarea, textarea')].filter(visible);
      const composer=found.find((el)=>el.id==='chat-input')||(found.length===1?found[0]:null);
      if(!composer||!('value'in composer))return{ok:false,error:found.length>1?'composer_ambiguous':'composer_not_found'};
      const text=normalize(composer.value??'');
      return{ok:true,matches:text===normalize(expected),empty:text==='',text_length:text.length};
    })()`;
  }

  async function scrubSafeGlmDraft(tabId, command) {
    const prompt = String(command?.prompt || "");
    if (!prompt || typeof globalThis.A2_DEBUGGER_RUN !== "function") return { scrubbed: false, reason: "cleanup_unavailable" };
    try {
      return await globalThis.A2_DEBUGGER_RUN(Number(tabId), `glm-safe-cleanup:${String(command?.command_id || "unknown")}`, async (session) => {
        const inspect = await session.send("Runtime.evaluate", { expression: glmComposerExpression(prompt), returnByValue: true, awaitPromise: true });
        const state = inspect?.result?.value || null;
        if (!state?.ok) return { scrubbed: false, reason: state?.error || "composer_unavailable" };
        if (state.empty === true) return { scrubbed: true, reason: "already_empty" };
        if (state.matches !== true) return { scrubbed: false, reason: "composer_changed_by_user_or_site" };

        await session.send("Runtime.evaluate", {
          expression: `(() => {const f=[...document.querySelectorAll('#chat-input, textarea.input-scroll, .messageInputContainer textarea, textarea')].filter((el)=>el instanceof HTMLElement&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');const c=f.find((el)=>el.id==='chat-input')||(f.length===1?f[0]:null);if(!c)return false;c.focus();return document.activeElement===c||c.contains?.(document.activeElement);})()`,
          returnByValue: true
        });
        await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
        await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
        await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
        await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });

        const after = await session.send("Runtime.evaluate", { expression: glmComposerExpression(""), returnByValue: true, awaitPromise: true });
        const readback = after?.result?.value || null;
        return { scrubbed: readback?.ok === true && readback?.empty === true, reason: readback?.empty === true ? "trusted_keyboard_exact_readback" : "cleanup_readback_failed" };
      });
    } catch (error) {
      return { scrubbed: false, reason: String(error?.message || error) };
    }
  }

  // Prompt-gate bypass is intentionally armed inside each trusted transport at
  // the last reversible boundary. This wrapper enforces the global kill switch
  // and repairs only SAFE pre-actuation failures. AMBIGUOUS failures are never
  // touched because the physical Send may already have happened.
  const originalGlm = globalThis.A2_GLM_TRUSTED_SEND;
  if (typeof originalGlm === "function") {
    globalThis.A2_GLM_TRUSTED_SEND = async (tabId, command) => {
      assertAutonomousAllowed();
      try {
        return await originalGlm(tabId, command);
      } catch (error) {
        if (String(error?.a2ExecutionClass || "") === SAFE) {
          const cleanup = await scrubSafeGlmDraft(tabId, command);
          error.a2SafeCleanup = cleanup;
        } else if (String(error?.a2ExecutionClass || "") !== AMBIGUOUS) {
          error.a2SafeCleanup = { scrubbed: false, reason: "execution_class_not_safe" };
        }
        throw error;
      }
    };
  }

  const originalChatgpt = globalThis.A2_CHATGPT_TRUSTED_SEND;
  if (typeof originalChatgpt === "function") {
    globalThis.A2_CHATGPT_TRUSTED_SEND = async (tabId, command) => {
      assertAutonomousAllowed();
      return originalChatgpt(tabId, command);
    };
  }
})();
