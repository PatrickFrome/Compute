(() => {
  "use strict";

  const MAX_REWRITE_CHARS = 120000;
  const DEFAULT_FRAME_MAX_AGE_MS = 30000;
  const ACTIONS = new Set(["STOP_GENERATION", "SCROLL", "CLICK_POINT", "DOUBLE_CLICK_POINT"]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function compat(path, fallback) {
    try { return globalThis.A2_COMPAT_GET?.(path, fallback) ?? fallback; }
    catch (_) { return fallback; }
  }
  function assertActionsEnabled(action = null) {
    if (compat("kill_switches.operator_actions_disabled", false) === true) throw new Error("compat_kill_switch_operator_actions_disabled");
    if (["CLICK_POINT", "DOUBLE_CLICK_POINT"].includes(String(action || "")) && compat("features.point_click_enabled", true) !== true) {
      throw new Error("compat_feature_point_click_disabled");
    }
  }
  function frameMaxAgeMs() {
    const value = Number(compat("timeouts.frame_max_age_ms", DEFAULT_FRAME_MAX_AGE_MS));
    return Number.isInteger(value) && value >= 5000 && value <= 120000 ? value : DEFAULT_FRAME_MAX_AGE_MS;
  }

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

  async function sha256Bytes(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

  async function evaluate(session, expression) {
    const result = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error("operator_action_runtime_evaluate_failed");
    return result?.result?.value;
  }

  async function withTab(platform, exactTabId, owner, operation) {
    const tab = await resolvePinned(platform, exactTabId);
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("operator_action_debugger_broker_unavailable");
    return globalThis.A2_DEBUGGER_RUN(tab.id, owner, async (session) => {
      await session.send("Runtime.enable");
      return operation(tab, session);
    });
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
    assertActionsEnabled("REPLACE_DRAFT");
    const value = String(draft ?? "").slice(0, MAX_REWRITE_CHARS);
    if (!normalize(value)) throw new Error("operator_rewrite_empty");
    return withTab(platform, tabId, `rewrite:${platform}`, async (tab, session) => {
      const before = await evaluate(session, composerInspectionExpression(platform));
      if (!before?.ok) throw new Error(`operator_rewrite_${before?.error || "composer_unavailable"}`);
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await session.send("Input.insertText", { text: value });
      const after = await evaluate(session, composerInspectionExpression(platform));
      if (!after?.ok || normalize(after.text) !== normalize(value)) throw new Error("operator_rewrite_exact_readback_failed");
      return { ok: true, action: "REPLACE_DRAFT", platform, tab_id: tab.id, previous_length: String(before.text || "").length, rewritten_length: value.length, exact_readback: true, authority_effect: false };
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
    assertActionsEnabled("STOP_GENERATION");
    return withTab(platform, null, `stop:${platform}`, async (tab, session) => {
      const before = await snapshot(tab.id);
      const point = await evaluate(session, stopInspectionExpression());
      if (!point?.ok) return { ok: false, action: "STOP_GENERATION", status: String(point?.error || "stop_unavailable"), platform, tab_id: tab.id, authority_effect: false };
      await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      try {
        await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      } catch (error) {
        await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
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
        ok: true, action: "STOP_GENERATION", platform, tab_id: tab.id, clicked_stop: true,
        generating_before: before?.generating === true, generating_after: after?.generating === true,
        verification: verified ? "STOP_CONTROL_DISAPPEARED_OR_IDLE" : "STOP_ACTUATED_UNCONFIRMED", authority_effect: false
      };
    });
  }

  async function scroll(platform, deltaY) {
    assertActionsEnabled("SCROLL");
    const bounded = Math.max(-1600, Math.min(1600, Number(deltaY) || 0));
    if (!bounded) throw new Error("operator_scroll_delta_invalid");
    return withTab(platform, null, `scroll:${platform}`, async (tab, session) => {
      await session.send("Page.enable");
      const before = await evaluate(session, "({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})");
      const x = Math.max(1, Number(before?.w || 800) / 2), y = Math.max(1, Number(before?.h || 600) / 2);
      await session.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: bounded });
      await sleep(120);
      const after = await evaluate(session, "({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})");
      return { ok: true, action: "SCROLL", platform, tab_id: tab.id, requested_delta_y: bounded, before_scroll_y: Number(before?.y || 0), after_scroll_y: Number(after?.y || 0), authority_effect: false };
    });
  }

  function frameFor(platform, frameToken) {
    const frame = globalThis.A2_OPERATOR_PERCEPTION_CACHE?.get?.(platform) || null;
    if (!frame) throw new Error("operator_action_perception_frame_missing");
    if (!frameToken || String(frame.frame_token || "") !== String(frameToken)) throw new Error("operator_action_frame_token_mismatch");
    const age = Date.now() - Date.parse(frame.captured_at || "");
    const maxAge = frameMaxAgeMs();
    if (!Number.isFinite(age) || age < 0 || age > maxAge) throw new Error("operator_action_frame_expired");
    return frame;
  }

  async function currentScreenshotHash(session) {
    await session.send("Page.enable");
    const shot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 72, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true });
    const base64 = String(shot?.data || "");
    const binary = base64 ? Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) : new Uint8Array();
    return sha256Bytes(binary);
  }

  function hitInspectionExpression(x, y) {
    return `(() => {
      const x=${Number(x)},y=${Number(y)};
      if(!(x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight))return{ok:false,error:'point_outside_viewport'};
      const el=document.elementFromPoint(x,y);
      if(!(el instanceof Element))return{ok:false,error:'point_no_element'};
      const r=el.getBoundingClientRect(),style=getComputedStyle(el),anchor=el.closest('a[href]'),input=el.closest('input');
      if(style.pointerEvents==='none'||style.visibility==='hidden'||style.display==='none')return{ok:false,error:'point_not_actionable'};
      return{ok:true,tag:el.tagName,id:el.id||null,role:el.getAttribute('role'),aria_label:el.getAttribute('aria-label'),data_testid:el.getAttribute('data-testid'),text:String(el.innerText||el.textContent||'').trim().slice(0,240),bounds:[r.x,r.y,r.width,r.height],anchor_href:anchor?.href||null,anchor_download:anchor?.hasAttribute('download')===true,input_type:input?.type||null,disabled:(el instanceof HTMLElement)&&((el).getAttribute('aria-disabled')==='true'||(el).hasAttribute('disabled'))};
    })()`;
  }

  function assertHitAllowed(platform, hit) {
    if (!hit?.ok) throw new Error(`operator_action_${hit?.error || "point_invalid"}`);
    if (hit.disabled === true) throw new Error("operator_action_point_disabled");
    if (String(hit.input_type || "").toLowerCase() === "file") throw new Error("operator_action_file_input_blocked");
    if (hit.anchor_download === true) throw new Error("operator_action_download_blocked");
    if (hit.anchor_href) {
      const targetPlatform = platformOf(hit.anchor_href);
      if (targetPlatform !== platform) throw new Error("operator_action_external_navigation_blocked");
    }
  }

  async function pointClick(platform, frameToken, xRaw, yRaw, doubleClick = false) {
    assertActionsEnabled(doubleClick ? "DOUBLE_CLICK_POINT" : "CLICK_POINT");
    const frame = frameFor(platform, frameToken);
    const x = Number(xRaw), y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("operator_action_point_coordinates_invalid");
    const viewport = frame.page?.viewport || {};
    if (x < 0 || y < 0 || x > Number(viewport.width || 0) || y > Number(viewport.height || 0)) throw new Error("operator_action_point_outside_frame");

    return withTab(platform, frame.tab_id, `${doubleClick ? "double-click" : "click"}:${platform}`, async (tab, session) => {
      if (normUrl(tab.url || "") !== frame.url) throw new Error("operator_action_frame_url_changed");
      const currentHash = await currentScreenshotHash(session);
      if (currentHash !== frame.hashes?.screenshot_sha256) throw new Error("operator_action_frame_stale_recapture_required");
      const hit = await evaluate(session, hitInspectionExpression(x, y));
      assertHitAllowed(platform, hit);

      const clicks = doubleClick ? 2 : 1;
      for (let count = 1; count <= clicks; count += 1) {
        await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: count });
        try {
          await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: count });
        } catch (error) {
          await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
          throw new Error(`operator_point_release_ambiguous:${String(error?.message || error)}`);
        }
        if (doubleClick && count === 1) await sleep(70);
      }
      await sleep(120);
      const live = await chrome.tabs.get(tab.id);
      return {
        ok: true,
        action: doubleClick ? "DOUBLE_CLICK_POINT" : "CLICK_POINT",
        platform,
        tab_id: tab.id,
        frame_token: frame.frame_token,
        frame_max_age_ms: frameMaxAgeMs(),
        x,
        y,
        hit,
        post_url: normUrl(live?.url || ""),
        verification: "FRAME_SHA256_MATCHED_BEFORE_ACTUATION",
        authority_effect: false
      };
    });
  }

  async function run(message) {
    const platform = String(message?.platform || "");
    if (!["CHATGPT", "GLM_ZAI"].includes(platform)) throw new Error("operator_action_platform_invalid");
    const action = String(message?.action || "");
    if (!ACTIONS.has(action)) throw new Error("operator_action_invalid");
    assertActionsEnabled(action);
    if (action === "STOP_GENERATION") return stopGeneration(platform);
    if (action === "SCROLL") return scroll(platform, message?.delta_y);
    if (action === "CLICK_POINT") return pointClick(platform, message?.frame_token, message?.x, message?.y, false);
    if (action === "DOUBLE_CLICK_POINT") return pointClick(platform, message?.frame_token, message?.x, message?.y, true);
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
  globalThis.A2_OPERATOR_POINT_CLICK = pointClick;
})();
