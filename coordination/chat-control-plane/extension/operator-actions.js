(() => {
  "use strict";

  const CDP_VERSION = "1.3";
  const MAX_REWRITE_CHARS = 120000;
  const ACTIONS = new Set(["STOP_GENERATION", "SCROLL"]);
  const inFlight = new Set();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function trustedOperatorSender(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }

  function platformOf(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
      if (host === "chat.z.ai") return "GLM_ZAI";
    } catch (_) {}
    return "UNKNOWN";
  }

  function normUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ""; }
  }

  async function resolvePinned(platform, exactTabId = null) {
    const stored = await chrome.storage.local.get(["chatgptUrl", "zaiUrl"]);
    const configured = platform === "CHATGPT" ? normUrl(stored.chatgptUrl || "") : platform === "GLM_ZAI" ? normUrl(stored.zaiUrl || "") : "";
    if (!configured) throw new Error(`operator_action_target_not_configured:${platform}`);
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(tab?.id) && platformOf(tab.url || "") === platform && normUrl(tab.url || "") === configured);
    if (matches.length !== 1) throw new Error(matches.length ? `operator_action_duplicate_target_tabs:${platform}:${matches.length}` : `operator_action_target_not_found:${platform}`);
    if (exactTabId != null && Number(matches[0].id) !== Number(exactTabId)) throw new Error("operator_action_tab_binding_mismatch");
    return matches[0];
  }

  async function send(tabId, method, params = {}) { return chrome.debugger.sendCommand({ tabId }, method, params); }
  async function evaluate(tabId, expression) {
    const result = await send(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error("operator_action_runtime_evaluate_failed");
    return result?.result?.value;
  }

  async function attachExclusive(tabId) {
    if (inFlight.has(tabId)) throw new Error("operator_action_tab_busy");
    const targets = await chrome.debugger.getTargets();
    const target = targets.find((item) => Number(item?.tabId) === Number(tabId));
    if (target?.attached) throw new Error("operator_action_debugger_target_busy");
    inFlight.add(tabId);
    try { await chrome.debugger.attach({ tabId }, CDP_VERSION); }
    catch (error) { inFlight.delete(tabId); throw error; }
  }

  async function detach(tabId) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    inFlight.delete(tabId);
  }

  async function withTab(platform, exactTabId, operation) {
    const tab = await resolvePinned(platform, exactTabId);
    await attachExclusive(tab.id);
    try {
      await send(tab.id, "Runtime.enable");
      return await operation(tab);
    } finally { await detach(tab.id); }
  }

  function composerInspectionExpression(platform) {
    const selectors = platform === "CHATGPT"
      ? ["#prompt-textarea", "[data-testid='composer-text-input'] textarea", "[contenteditable='true'][data-lexical-editor='true']", "[role='textbox'][contenteditable='true']"]
      : ["#chat-input", "textarea.input-scroll", ".messageInputContainer textarea", "textarea", "[role='textbox'][contenteditable='true']"];
    return `(() => {
      const visible=(el)=>{if(!(el instanceof HTMLElement))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
      const selectors=${JSON.stringify(selectors)};
      const found=[];
      for(const selector of selectors){for(const el of document.querySelectorAll(selector)){if(visible(el)&&!found.includes(el))found.push(el);}if(${JSON.stringify(platform)}==='GLM_ZAI'&&selector==='#chat-input'&&found.length)break;}
      if(found.length!==1)return{ok:false,error:found.length?'composer_ambiguous':'composer_not_found',count:found.length};
      const el=found[0],r=el.getBoundingClientRect();el.focus();
      const text=String(('value'in el?el.value:(el.innerText||el.textContent||''))||'').replace(/\\r\\n?/g,'\\n').trim();
      return{ok:true,text,tag:el.tagName,contenteditable:el.isContentEditable,x:r.left+r.width/2,y:r.top+r.height/2};
    })()`;
  }

  async function trustedReplaceDraft(tabId, platform, draft) {
    const value = String(draft ?? "").slice(0, MAX_REWRITE_CHARS);
    if (!normalize(value)) throw new Error("operator_rewrite_empty");
    return withTab(platform, tabId, async (tab) => {
      const before = await evaluate(tab.id, composerInspectionExpression(platform));
      if (!before?.ok) throw new Error(`operator_rewrite_${before?.error || "composer_unavailable"}`);
      await send(tab.id, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await send(tab.id, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await send(tab.id, "Input.insertText", { text: value });
      const after = await evaluate(tab.id, composerInspectionExpression(platform));
      if (!after?.ok || normalize(after.text) !== normalize(value)) throw new Error("operator_rewrite_exact_readback_failed");
      return {
        ok: true,
        action: "REPLACE_DRAFT",
        platform,
        tab_id: tab.id,
        previous_length: String(before.text || "").length,
        rewritten_length: value.length,
        exact_readback: true,
        authority_effect: false
      };
    });
  }

  function stopInspectionExpression() {
    return `(() => {
      const visible=(el)=>{if(!(el instanceof HTMLElement))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
      const strong=[...document.querySelectorAll("button[data-testid='stop-button'],button[data-testid='composer-stop-button'],#stop-button,#composer-stop-button")].filter(visible);
      const semantic=[...document.querySelectorAll('button')].filter(visible).filter((b)=>{const f=[b.getAttribute('aria-label'),b.getAttribute('title'),b.textContent].map(v=>String(v||'').trim().toLowerCase());return f.some(v=>/^(stop|stop generating|stop generation|остановить|остановить генерацию|停止|停止生成)$/iu.test(v));});
      const candidates=strong.length?strong:semantic;
      if(candidates.length===0)return{ok:false,error:'stop_not_found'};
      if(candidates.length!==1)return{ok:false,error:'stop_ambiguous',count:candidates.length};
      const b=candidates[0],r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      if(!hit||!(hit===b||b.contains(hit)))return{ok:false,error:'stop_not_actionable'};
      return{ok:true,x,y};
    })()`;
  }

  async function snapshot(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" });
      return response?.ok ? response.snapshot : null;
    } catch (_) { return null; }
  }

  async function stopGeneration(platform) {
    return withTab(platform, null, async (tab) => {
      const before = await snapshot(tab.id);
      const point = await evaluate(tab.id, stopInspectionExpression());
      if (!point?.ok) return { ok: false, action: "STOP_GENERATION", status: String(point?.error || "stop_unavailable"), platform, tab_id: tab.id, authority_effect: false };
      await send(tab.id, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      try {
        await send(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      } catch (error) {
        await send(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
        throw new Error(`operator_stop_release_ambiguous:${String(error?.message || error)}`);
      }
      const deadline = Date.now() + 5000;
      let after = null;
      while (Date.now() < deadline) {
        after = await snapshot(tab.id);
        if (after && after.generating !== true) break;
        await sleep(125);
      }
      const verified = Boolean(after && after.generating !== true);
      return {
        ok: true,
        action: "STOP_GENERATION",
        platform,
        tab_id: tab.id,
        clicked_stop: true,
        generating_before: before?.generating === true,
        generating_after: after?.generating === true,
        verification: verified ? "STOP_CONTROL_DISAPPEARED_OR_IDLE" : "STOP_ACTUATED_UNCONFIRMED",
        authority_effect: false
      };
    });
  }

  async function scroll(platform, deltaY) {
    const bounded = Math.max(-1600, Math.min(1600, Number(deltaY) || 0));
    if (!bounded) throw new Error("operator_scroll_delta_invalid");
    return withTab(platform, null, async (tab) => {
      await send(tab.id, "Page.enable");
      const before = await evaluate(tab.id, "({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})");
      const x = Math.max(1, Number(before?.w || 800) / 2), y = Math.max(1, Number(before?.h || 600) / 2);
      await send(tab.id, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: bounded });
      await sleep(120);
      const after = await evaluate(tab.id, "({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})");
      return {
        ok: true,
        action: "SCROLL",
        platform,
        tab_id: tab.id,
        requested_delta_y: bounded,
        before_scroll_y: Number(before?.y || 0),
        after_scroll_y: Number(after?.y || 0),
        authority_effect: false
      };
    });
  }

  async function run(message) {
    const platform = String(message?.platform || "");
    if (!["CHATGPT", "GLM_ZAI"].includes(platform)) throw new Error("operator_action_platform_invalid");
    const action = String(message?.action || "");
    if (!ACTIONS.has(action)) throw new Error("operator_action_invalid");
    if (action === "STOP_GENERATION") return stopGeneration(platform);
    if (action === "SCROLL") return scroll(platform, message?.delta_y);
    throw new Error("operator_action_unreachable");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "A2_OPERATOR_ACTION") return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    run(message).then((result) => sendResponse({ ok: result?.ok !== false, result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT = trustedReplaceDraft;
  globalThis.A2_OPERATOR_STOP_GENERATION = stopGeneration;
  globalThis.A2_OPERATOR_SCROLL = scroll;
})();
