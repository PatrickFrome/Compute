(() => {
  "use strict";

  const WORKSPACE_ID = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
  const SUPERVISOR_URL = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v1";
  const MODE_KEY = "a2SupervisorModeV1";
  const EVENTS_KEY = "a2SupervisorEventsV1";
  const CURRENT_KEY = "a2SupervisorCurrentCommandV1";
  const LAST_KEY = "a2SupervisorLastReceiptV1";
  const LAST_SYNC_KEY = "a2SupervisorLastSyncV1";
  const LAST_ERROR_KEY = "a2SupervisorLastErrorV1";
  const ALARM = "a2-browser-supervisor-poll";
  const MODES = new Set(["OFF", "MONITOR", "CONTROL"]);
  const CONTROL_ACTIONS = new Set([
    "ARM", "DISARM", "SET_MODE", "POLL", "CAPTURE", "STOP_GENERATION", "SCROLL",
    "SEMANTIC_FOCUS", "SEMANTIC_TYPE", "RESOLVE_PROMPT"
  ]);
  const SAFE_REMOTE_SEMANTIC_ROLES = new Set(["textbox", "searchbox", "combobox", "button", "checkbox", "radio", "switch", "tab", "menuitem"]);
  let pollPromise = null;

  const normalize = (v) => String(v ?? "").replace(/\r\n?/g, "\n").trim();
  const clip = (v, max = 500) => String(v ?? "").slice(0, max);

  function platformOf(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
      if (host === "chat.z.ai") return "GLM_ZAI";
    } catch (_) {}
    return "UNKNOWN";
  }
  function normUrl(value) {
    try { const u = new URL(String(value || "")); u.hash=""; u.search=""; u.pathname=u.pathname.replace(/\/+$/,"")||"/"; return `${u.origin}${u.pathname}`; }
    catch (_) { return ""; }
  }
  function trustedSidePanel(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }
  async function mode() {
    const x = await chrome.storage.local.get(MODE_KEY);
    const value = String(x[MODE_KEY] || "OFF");
    return MODES.has(value) ? value : "OFF";
  }
  async function setMode(value) {
    const next = String(value || "").toUpperCase();
    if (!MODES.has(next)) throw new Error("supervisor_mode_invalid");
    await chrome.storage.local.set({ [MODE_KEY]: next });
    await addEvent("SUPERVISOR", "MODE", `Supervisor mode → ${next}`, "info");
    return next;
  }
  async function addEvent(source, type, summary, level = "info", extra = null) {
    const x = await chrome.storage.local.get(EVENTS_KEY);
    const rows = Array.isArray(x[EVENTS_KEY]) ? x[EVENTS_KEY] : [];
    rows.push({ at: new Date().toISOString(), source: clip(source,40), type: clip(type,60), summary: clip(summary,500), level, extra });
    await chrome.storage.local.set({ [EVENTS_KEY]: rows.slice(-100) });
  }
  async function events() {
    const x = await chrome.storage.local.get(EVENTS_KEY);
    return Array.isArray(x[EVENTS_KEY]) ? x[EVENTS_KEY].slice(-60) : [];
  }
  async function supervisorRequest(path, init = {}) {
    if (typeof globalThis.A2_GET_PAIRING_SECRET !== "function") throw new Error("supervisor_pairing_vault_unavailable");
    if (typeof globalThis.A2_BRIDGE_CLIENT_ID !== "function") throw new Error("supervisor_client_identity_unavailable");
    const [secret, client] = await Promise.all([globalThis.A2_GET_PAIRING_SECRET(), globalThis.A2_BRIDGE_CLIENT_ID()]);
    const headers = new Headers(init.headers || {});
    headers.set("content-type", "application/json");
    headers.set("x-a2-chat-bridge-secret", secret);
    headers.set("x-a2-chat-bridge-client", client);
    return fetch(`${SUPERVISOR_URL}${path}`, { ...init, headers, cache: "no-store" });
  }
  function peerSummary(snapshot) {
    if (!snapshot) return null;
    return {
      platform: snapshot.platform || null,
      url: normUrl(snapshot.url || ""),
      generating: snapshot.generating === true,
      message_count: Number(snapshot.message_count || 0),
      composer_present: snapshot.composer_present === true,
      composer_empty: normalize(snapshot.composer_text || "") === "",
      dom_pair_error: snapshot.dom_pair_error || null
    };
  }
  function semanticTargets(frame) {
    const rows = Array.isArray(frame?.accessibility) ? frame.accessibility : [];
    const out = [];
    const seen = new Map();
    for (const node of rows) {
      const role = normalize(node?.role).toLowerCase();
      const name = normalize(node?.name);
      if (!SAFE_REMOTE_SEMANTIC_ROLES.has(role) || !name || !Number.isInteger(Number(node?.backend_dom_node_id))) continue;
      const key = `${role}\u0000${name}`;
      seen.set(key, Number(seen.get(key) || 0) + 1);
      out.push({ role, name: name.slice(0, 220), backend_node_id: Number(node.backend_dom_node_id) });
    }
    return out.filter((row) => seen.get(`${row.role}\u0000${row.name}`) === 1).slice(0, 60);
  }
  function perceptionSummary() {
    const result = {};
    for (const platform of ["GLM_ZAI", "CHATGPT"]) {
      const frame = globalThis.A2_OPERATOR_PERCEPTION_CACHE?.get?.(platform) || null;
      if (!frame) continue;
      result[platform] = {
        captured_at: frame.captured_at || null,
        url: normUrl(frame.url || ""),
        frame_token: frame.frame_token || null,
        body_text_sha256: frame.hashes?.body_text_sha256 || null,
        screenshot_sha256: frame.hashes?.screenshot_sha256 || null,
        body_excerpt: clip(frame.page?.body_text || "", 7000),
        semantic_targets: semanticTargets(frame)
      };
    }
    return result;
  }
  async function localState() {
    const local = await chrome.storage.local.get([
      "armed","operatorMode","daemonOnlineAt","daemonLastError","lastOrderingPolicy",
      "snapshot:CHATGPT","snapshot:GLM_ZAI","a2BridgePendingCommandV0523","a2BridgeGlmActuatedPredecessorV0523",
      CURRENT_KEY,LAST_KEY,LAST_SYNC_KEY,LAST_ERROR_KEY
    ]);
    const session = await chrome.storage.session.get("a2OperatorHeldPromptIntentV060");
    const supMode = await mode();
    const perception = perceptionSummary();
    const flatTargets = Object.entries(perception).flatMap(([platform, value]) => (value.semantic_targets || []).map((t) => ({ platform, ...t, perception_captured_at: value.captured_at })));
    return {
      operator_runtime: globalThis.A2_OPERATOR_RUNTIME || "0.6.0",
      extension_version: chrome.runtime.getManifest().version,
      supervisor_mode: supMode,
      armed: local.armed === true,
      operator_mode: local.operatorMode || "OBSERVE",
      ordering_policy: local.lastOrderingPolicy || "STRICT_GLM_FIRST_ACTUATED_V1",
      bridge: { online_at: local.daemonOnlineAt || null, error: local.daemonLastError || null },
      peers: {
        GLM_ZAI: peerSummary(local["snapshot:GLM_ZAI"]?.snapshot),
        CHATGPT: peerSummary(local["snapshot:CHATGPT"]?.snapshot)
      },
      ordering: {
        predecessor_command_id: local.a2BridgeGlmActuatedPredecessorV0523 || null,
        pending_command: local.a2BridgePendingCommandV0523 || null
      },
      perception,
      semantic_targets: flatTargets.slice(0, 60),
      prompt_intent: session.a2OperatorHeldPromptIntentV060 ? {
        intent_id: session.a2OperatorHeldPromptIntentV060.intent_id,
        platform: session.a2OperatorHeldPromptIntentV060.platform,
        event_type: session.a2OperatorHeldPromptIntentV060.event_type,
        created_at: session.a2OperatorHeldPromptIntentV060.created_at,
        draft_sha256: session.a2OperatorHeldPromptIntentV060.draft_sha256,
        original_draft: clip(session.a2OperatorHeldPromptIntentV060.original_draft || "", 12000)
      } : null,
      current_supervisor_command: local[CURRENT_KEY] || null,
      last_supervisor_receipt: local[LAST_KEY] || null,
      supervisor_last_sync: local[LAST_SYNC_KEY] || null,
      supervisor_last_error: local[LAST_ERROR_KEY] || null,
      events: await events(),
      workspace_id: WORKSPACE_ID,
      authority_effect: false
    };
  }
  async function heartbeat(lastCommand = null, lastStatus = null) {
    const state = await localState();
    const r = await supervisorRequest("/v1/state", { method: "POST", body: JSON.stringify({ state, last_command_id: lastCommand, last_command_status: lastStatus }) });
    if (!r.ok) throw new Error(`supervisor_state_http_${r.status}`);
    await chrome.storage.local.set({ [LAST_SYNC_KEY]: new Date().toISOString(), [LAST_ERROR_KEY]: null });
    return state;
  }
  async function broadcastPromptMode(next) {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab?.id) && ["CHATGPT","GLM_ZAI"].includes(platformOf(tab.url || "")))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "A2_PROMPT_GATE_CONFIG", mode: next })));
  }
  async function setOperatorMode(nextRaw) {
    const next = String(nextRaw || "").toUpperCase();
    if (!["OBSERVE","GATE_SEND"].includes(next)) throw new Error("supervisor_operator_mode_invalid");
    if (next === "OBSERVE") {
      const x = await chrome.storage.session.get("a2OperatorHeldPromptIntentV060");
      const intent = x.a2OperatorHeldPromptIntentV060 || null;
      if (intent?.tab_id) await chrome.tabs.sendMessage(intent.tab_id,{type:"A2_PROMPT_GATE_RESOLUTION",intent_id:intent.intent_id,action:"CANCEL"}).catch(()=>null);
      await chrome.storage.session.remove("a2OperatorHeldPromptIntentV060");
    }
    await chrome.storage.local.set({ operatorMode: next });
    await broadcastPromptMode(next);
    return { mode: next };
  }
  async function capture(platform) {
    if (!["CHATGPT","GLM_ZAI"].includes(platform)) throw new Error("supervisor_capture_platform_invalid");
    if (typeof globalThis.A2_OPERATOR_CAPTURE_PERCEPTION !== "function") throw new Error("supervisor_perception_unavailable");
    const frame = await globalThis.A2_OPERATOR_CAPTURE_PERCEPTION(platform);
    return {
      platform,
      captured_at: frame.captured_at,
      frame_token: frame.frame_token,
      body_text_sha256: frame.hashes?.body_text_sha256 || null,
      screenshot_sha256: frame.hashes?.screenshot_sha256 || null,
      body_excerpt: clip(frame.page?.body_text || "", 7000),
      semantic_targets: semanticTargets(frame)
    };
  }
  async function semantic(action, command) {
    const platform = String(command.platform || "");
    if (!["CHATGPT","GLM_ZAI"].includes(platform)) throw new Error("supervisor_semantic_platform_invalid");
    if (typeof globalThis.A2_OPERATOR_CAPTURE_PERCEPTION !== "function" || typeof globalThis.A2_OPERATOR_SEMANTIC_ACTION !== "function") throw new Error("supervisor_semantic_runtime_unavailable");
    const frame = await globalThis.A2_OPERATOR_CAPTURE_PERCEPTION(platform);
    const role = normalize(command.payload?.role).toLowerCase();
    const name = normalize(command.payload?.accessible_name);
    const matches = semanticTargets(frame).filter((t) => t.role === role && t.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? `supervisor_semantic_target_ambiguous:${matches.length}` : "supervisor_semantic_target_not_found");
    const message = { action, platform, perception_captured_at: frame.captured_at, role, accessible_name: name };
    if (action === "TYPE_SEMANTIC") {
      const text = String(command.payload?.text ?? "");
      if (!text || text.length > 120000) throw new Error("supervisor_semantic_text_invalid");
      message.text = text;
      message.replace_existing = command.payload?.replace_existing !== false;
    }
    return globalThis.A2_OPERATOR_SEMANTIC_ACTION(message);
  }
  async function resolvePrompt(command) {
    const x = await chrome.storage.session.get("a2OperatorHeldPromptIntentV060");
    const intent = x.a2OperatorHeldPromptIntentV060 || null;
    if (!intent?.intent_id) throw new Error("supervisor_no_held_prompt");
    const action = String(command.payload?.action || "CANCEL");
    if (!["CANCEL","ALLOW_ONCE","REWRITE_ALLOW_ONCE"].includes(action)) throw new Error("supervisor_prompt_resolution_invalid");
    let pageAction = action;
    let draft = intent.original_draft;
    let rewrite = null;
    if (action === "REWRITE_ALLOW_ONCE") {
      draft = String(command.payload?.draft || "");
      if (!normalize(draft)) throw new Error("supervisor_prompt_rewrite_empty");
      if (typeof globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT !== "function") throw new Error("supervisor_prompt_rewrite_unavailable");
      rewrite = await globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT(intent.tab_id,intent.platform,draft);
      if (rewrite?.exact_readback !== true) throw new Error("supervisor_prompt_rewrite_readback_failed");
      pageAction = "ALLOW_ONCE";
    }
    const response = await chrome.tabs.sendMessage(intent.tab_id,{type:"A2_PROMPT_GATE_RESOLUTION",intent_id:intent.intent_id,action:pageAction,draft});
    if (!response?.ok) throw new Error(response?.error || "supervisor_prompt_resolution_failed");
    await chrome.storage.session.remove("a2OperatorHeldPromptIntentV060");
    return { action, page_action: pageAction, trusted_rewrite: rewrite };
  }
  async function execute(command) {
    const action = String(command?.action || "");
    if (!CONTROL_ACTIONS.has(action)) throw new Error("supervisor_command_action_not_allowed");
    const currentMode = await mode();
    if (currentMode !== "CONTROL") throw new Error(`supervisor_local_control_required:${currentMode}`);
    if (action === "ARM") { await chrome.storage.local.set({ armed:true }); return { armed:true }; }
    if (action === "DISARM") { await chrome.storage.local.set({ armed:false }); return { armed:false }; }
    if (action === "SET_MODE") return setOperatorMode(command.payload?.mode);
    if (action === "POLL") { const r=await chrome.runtime.sendMessage({type:"BRIDGE_POLL_NOW"}); if(r?.ok!==true)throw new Error(r?.error||"bridge_poll_failed"); return {poll:true}; }
    if (action === "CAPTURE") return capture(String(command.platform||""));
    if (action === "STOP_GENERATION") { if(typeof globalThis.A2_OPERATOR_STOP_GENERATION!=="function")throw new Error("supervisor_stop_unavailable"); return globalThis.A2_OPERATOR_STOP_GENERATION(String(command.platform||"")); }
    if (action === "SCROLL") { if(typeof globalThis.A2_OPERATOR_SCROLL!=="function")throw new Error("supervisor_scroll_unavailable"); return globalThis.A2_OPERATOR_SCROLL(String(command.platform||""),Number(command.payload?.delta_y||0)); }
    if (action === "SEMANTIC_FOCUS") return semantic("FOCUS_SEMANTIC",command);
    if (action === "SEMANTIC_TYPE") return semantic("TYPE_SEMANTIC",command);
    if (action === "RESOLVE_PROMPT") return resolvePrompt(command);
    throw new Error("supervisor_command_unreachable");
  }
  async function postResult(command, ok, receipt, error = null) {
    const r = await supervisorRequest(`/v1/commands/${encodeURIComponent(command.command_id)}/result`, { method:"POST", body:JSON.stringify({ ok, receipt:{ schema:"metaengine.a2-browser-supervisor.receipt.v1", command_id:command.command_id, action:command.action, platform:command.platform||null, result:receipt||null, recorded_at:new Date().toISOString(), authority_effect:false }, error }) });
    if (!r.ok) throw new Error(`supervisor_result_http_${r.status}`);
  }
  async function poll(forceHeartbeat = false) {
    if (pollPromise) return pollPromise;
    pollPromise = (async () => {
      let current = null;
      try {
        const state = await heartbeat();
        if (state.supervisor_mode !== "CONTROL") return state;
        const r = await supervisorRequest("/v1/commands/next", { method:"POST", body:"{}" });
        if (!r.ok) throw new Error(`supervisor_next_http_${r.status}`);
        const body = await r.json();
        current = body?.command || null;
        if (!current) return state;
        await chrome.storage.local.set({ [CURRENT_KEY]: current });
        await addEvent("CHAT", "COMMAND", `${current.action}${current.platform ? ` · ${current.platform}` : ""}`, "command", { command_id: current.command_id });
        let result = null;
        try {
          result = await execute(current);
          await postResult(current,true,result,null);
          const receipt = { command_id:current.command_id,action:current.action,platform:current.platform||null,status:"COMPLETED",result,completed_at:new Date().toISOString() };
          await chrome.storage.local.set({ [LAST_KEY]:receipt,[CURRENT_KEY]:null });
          await addEvent("EXTENSION","RECEIPT",`${current.action} completed`,"success",{command_id:current.command_id});
          await heartbeat(current.command_id,"COMPLETED");
          return receipt;
        } catch (error) {
          const message = String(error?.message || error);
          await postResult(current,false,result,message).catch(()=>{});
          const receipt = { command_id:current.command_id,action:current.action,platform:current.platform||null,status:"FAILED",error:message,completed_at:new Date().toISOString() };
          await chrome.storage.local.set({ [LAST_KEY]:receipt,[CURRENT_KEY]:null,[LAST_ERROR_KEY]:message });
          await addEvent("EXTENSION","ERROR",`${current.action}: ${message}`,"error",{command_id:current.command_id});
          await heartbeat(current.command_id,"FAILED").catch(()=>{});
          return receipt;
        }
      } catch (error) {
        const message = String(error?.message || error);
        await chrome.storage.local.set({ [LAST_ERROR_KEY]:message });
        await addEvent("SUPERVISOR","LINK",message,"error").catch(()=>{});
        throw error;
      }
    })().finally(()=>{ pollPromise=null; });
    return pollPromise;
  }

  async function status() { return localState(); }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    const type=String(message?.type||"");
    if (!["A2_SUPERVISOR_STATUS","A2_SUPERVISOR_SET_MODE","A2_SUPERVISOR_POLL_NOW","A2_SUPERVISOR_CLEAR_EVENTS"].includes(type)) return false;
    if (!trustedSidePanel(sender)) { sendResponse({ok:false,error:"supervisor_sender_not_trusted"}); return false; }
    if (type==="A2_SUPERVISOR_STATUS") { status().then(state=>sendResponse({ok:true,state})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)})); return true; }
    if (type==="A2_SUPERVISOR_SET_MODE") { setMode(message?.mode).then(mode=>poll(true).catch(()=>{}).then(()=>sendResponse({ok:true,mode}))).catch(e=>sendResponse({ok:false,error:String(e?.message||e)})); return true; }
    if (type==="A2_SUPERVISOR_POLL_NOW") { poll(true).then(result=>sendResponse({ok:true,result})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)})); return true; }
    if (type==="A2_SUPERVISOR_CLEAR_EVENTS") { chrome.storage.local.set({[EVENTS_KEY]:[]}).then(()=>sendResponse({ok:true})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)})); return true; }
    return false;
  });
  chrome.runtime.onInstalled.addListener(()=>{ chrome.alarms.create(ALARM,{periodInMinutes:0.5}); heartbeat().catch(()=>{}); });
  chrome.runtime.onStartup.addListener(()=>{ chrome.alarms.create(ALARM,{periodInMinutes:0.5}); heartbeat().catch(()=>{}); });
  chrome.alarms.onAlarm.addListener((alarm)=>{ if(alarm.name===ALARM) poll().catch(()=>{}); });
  chrome.storage.onChanged.addListener((changes,area)=>{ if(area==="local" && (changes.armed||changes.operatorMode||changes[MODE_KEY])) heartbeat().catch(()=>{}); });
  globalThis.A2_SUPERVISOR_POLL = poll;
  globalThis.A2_SUPERVISOR_STATUS = status;
  (async()=>{ const x=await chrome.storage.local.get(MODE_KEY); if(!MODES.has(String(x[MODE_KEY]||"")))await chrome.storage.local.set({[MODE_KEY]:"OFF"}); chrome.alarms.create(ALARM,{periodInMinutes:0.5}); await heartbeat().catch(()=>{}); })().catch(()=>{});
})();
