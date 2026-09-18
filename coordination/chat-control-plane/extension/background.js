(() => {
  "use strict";

  const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
  const ORDERING_POLICY = "STRICT_GLM_FIRST_ACTUATED_V1";
  const OPERATOR_RUNTIME = "0.6.0-dev.1";
  const DEFAULTS = Object.freeze({
    daemonUrl: String(bootstrap.daemonUrl || "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote"),
    armed: false,
    autoOpenTabs: true,
    pollMs: 2500,
    chatgptUrl: "",
    zaiUrl: "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db"
  });
  const CHATGPT_ROOT = "https://chatgpt.com/";
  const COMPLETED_KEY = "a2BridgeCompletedCommandsV0523";
  const PENDING_KEY = "a2BridgePendingCommandV0523";
  const PREDECESSOR_KEY = "a2BridgeGlmActuatedPredecessorV0523";
  const MAX_COMPLETED = 512;
  const EXECUTION_CLASSES = new Set(["SAFE_RETRY_PRE_ACTUATION","AMBIGUOUS_NO_RETRY","ACTUATED","VERIFIED","BLOCKED"]);
  const inFlight = new Set();
  let pollPromise = null;
  let lastPollAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (v) => String(v ?? "").replace(/\r\n?/g, "\n").trim();
  function normUrl(value) {
    try { const u = new URL(String(value || "")); u.hash=""; u.search=""; u.pathname=u.pathname.replace(/\/+$/,"")||"/"; return `${u.origin}${u.pathname}`; }
    catch (_) { return ""; }
  }
  function platformOf(value) {
    try { const h=new URL(String(value||"")).hostname.toLowerCase(); if(["chatgpt.com","chat.openai.com"].includes(h))return"CHATGPT"; if(h==="chat.z.ai")return"GLM_ZAI"; }
    catch (_) {} return "UNKNOWN";
  }
  function isChatgptConversation(value) { try { const u=new URL(String(value||"")); return ["chatgpt.com","chat.openai.com"].includes(u.hostname.toLowerCase()) && u.pathname.startsWith("/c/"); } catch(_){return false;} }
  function isExhausted(error) { return String(error?.message || error || "").includes("chatgpt_cdp_conversation_exhausted"); }
  function executionClassFor(status, result=null, error=null) {
    const explicit=String(result?.execution_class||error?.a2ExecutionClass||error?.a2Result?.execution_class||"");
    if(EXECUTION_CLASSES.has(explicit))return explicit;
    const s=String(status||result?.status||error?.a2Result?.status||"");
    if(s.startsWith("BLOCKED"))return"BLOCKED";
    if(s.includes("AMBIGUOUS")&&s.includes("NO_RETRY"))return"AMBIGUOUS_NO_RETRY";
    if(result?.verification?.verified===true||s==="SENT_AND_DOM_VERIFIED"||s==="SENT_WEAK_DOM_VERIFIED")return"VERIFIED";
    if(s.startsWith("SENT_")||s==="DUPLICATE_IGNORED")return"ACTUATED";
    return"SAFE_RETRY_PRE_ACTUATION";
  }

  async function settings() {
    const stored=await chrome.storage.local.get(Object.keys(DEFAULTS));
    const s={...DEFAULTS,...stored}; s.daemonUrl=String(s.daemonUrl||DEFAULTS.daemonUrl).replace(/\/+$/,""); s.pollMs=Math.max(1000,Math.min(30000,Number(s.pollMs)||2500)); return s;
  }
  async function request(path, init={}) {
    if(typeof globalThis.A2_BRIDGE_REQUEST!=="function") throw new Error("bridge_client_unavailable");
    return globalThis.A2_BRIDGE_REQUEST(path, init);
  }
  async function badge() {
    const s=await settings();
    await chrome.action.setBadgeText({text:s.armed?"ON":"OFF"});
    await chrome.action.setBadgeBackgroundColor({color:s.armed?"#16803a":"#5d6470"});
    await chrome.action.setTitle({title:s.armed?"METAENGINE A2 Browser Operator — ARMED · GLM FIRST":"METAENGINE A2 Browser Operator — DISARMED"});
  }

  async function reportSnapshot(tabId,snapshot) {
    const envelope={schema:"metaengine.chat-bridge.snapshot-envelope.v2",tab_id:tabId,platform:snapshot?.platform||"UNKNOWN",observed_at:new Date().toISOString(),snapshot};
    await chrome.storage.local.set({[`snapshot:${envelope.platform}`]:envelope});
    try { const r=await request("/v1/snapshots",{method:"POST",body:JSON.stringify(envelope)}); if(!r.ok)throw new Error(`snapshot_http_${r.status}`); }
    catch(error){ await chrome.storage.local.set({daemonLastError:String(error?.message||error),daemonLastErrorAt:new Date().toISOString()}); }
  }
  async function snapshotEnvelopes() {
    const x=await chrome.storage.local.get(["snapshot:CHATGPT","snapshot:GLM_ZAI"]);
    return [x["snapshot:CHATGPT"],x["snapshot:GLM_ZAI"]].filter((v)=>v?.snapshot);
  }
  async function findPinned(url,platform) {
    const target=normUrl(url), tabs=await chrome.tabs.query({});
    const matches=tabs.filter((t)=>t?.id&&t?.url&&platformOf(t.url)===platform&&normUrl(t.url)===target);
    if(matches.length>1)throw new Error(`duplicate_target_tabs:${platform}:${matches.length}`);
    return matches[0]||null;
  }
  async function waitSnapshot(tabId,timeout=15000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){ try{const r=await chrome.tabs.sendMessage(tabId,{type:"GET_CHAT_SNAPSHOT"});if(r?.ok&&r.snapshot)return r.snapshot;}catch(_){} await sleep(200); }
    throw new Error("content_script_not_ready");
  }
  async function pollSnapshots() {
    const s=await settings();
    for(const [platform,url] of [["CHATGPT",s.chatgptUrl],["GLM_ZAI",s.zaiUrl]]) {
      if(!url)continue;
      try { const tab=await findPinned(url,platform); if(!tab?.id)continue; const r=await chrome.tabs.sendMessage(tab.id,{type:"GET_CHAT_SNAPSHOT"}); if(r?.ok&&r.snapshot){await reportSnapshot(tab.id,r.snapshot);if(platform==="GLM_ZAI"&&typeof globalThis.A2_GLM_RECONCILE==="function")await globalThis.A2_GLM_RECONCILE(tab.id).catch(()=>{});} }
      catch(error){await chrome.storage.local.set({operatorSensorLastError:String(error?.message||error),operatorSensorLastErrorAt:new Date().toISOString()});}
    }
  }
  async function freshSnapshots(s) {
    let rows=await snapshotEnvelopes(), now=Date.now(), maxAge=Math.max(5000,s.pollMs*2);
    if(rows.length<2||rows.some((e)=>!Number.isFinite(Date.parse(e?.observed_at||""))||now-Date.parse(e.observed_at)>maxAge)){await pollSnapshots();rows=await snapshotEnvelopes();}
    return rows;
  }

  function targetUrl(command,s){return command.target_platform==="CHATGPT"?normUrl(s.chatgptUrl):command.target_platform==="GLM_ZAI"?normUrl(s.zaiUrl):"";}
  async function resolveTab(command,s) {
    const url=targetUrl(command,s); if(!url)throw new Error(`target_url_not_configured:${command.target_platform}`);
    let tab=await findPinned(url,command.target_platform);
    if(!tab&&s.autoOpenTabs){tab=await chrome.tabs.create({url,active:false});await waitSnapshot(tab.id);}
    if(!tab?.id)throw new Error(`target_tab_not_found:${command.target_platform}`);
    const live=await chrome.tabs.get(tab.id); if(normUrl(live.url||"")!==url)throw new Error("target_url_mismatch"); return live;
  }
  function validateOrdering(c) {
    const order=Number(c?.launch_order||0),basis=String(c?.ordering_basis||""),pred=c?.predecessor_command_id==null?null:String(c.predecessor_command_id);
    if(c?.target_platform==="GLM_ZAI"){if(order!==1||basis!=="GLM_FIRST"||pred!==null)throw new Error("ordering_contract_glm_invalid");return;}
    if(c?.target_platform==="CHATGPT"){if(order!==2)throw new Error("ordering_contract_gpt_order_invalid");if(basis==="GLM_COMMAND_ACTUATED"&&pred)return;if(basis==="A2_GLM_ALREADY_SUBMITTED"&&pred===null)return;throw new Error("ordering_contract_gpt_gate_invalid");}
    throw new Error("unsupported_target_platform");
  }

  async function loadCompleted(){const x=await chrome.storage.local.get(COMPLETED_KEY);return Array.isArray(x[COMPLETED_KEY])?x[COMPLETED_KEY]:[];}
  async function completedFor(c){const rows=await loadCompleted(),id=String(c.command_id||""),key=String(c.idempotency_key||"");return rows.find((r)=>r.command_id===id||(key&&r.idempotency_key===key))||null;}
  async function rememberCompleted(c,result){const rows=await loadCompleted(),id=String(c.command_id||""),key=String(c.idempotency_key||"");const next=rows.filter((r)=>r.command_id!==id&&r.idempotency_key!==key);next.push({command_id:id,idempotency_key:key,target_platform:c.target_platform,result_status:result.status,target_url:result.target_url||null,execution_class:result.execution_class||null,completed_at:new Date().toISOString()});await chrome.storage.local.set({[COMPLETED_KEY]:next.slice(-MAX_COMPLETED)});}
  async function postResult(id,result){try{const r=await request(`/v1/commands/${encodeURIComponent(id)}/result`,{method:"POST",body:JSON.stringify(result)});if(!r.ok)throw new Error(`result_http_${r.status}`);return true;}catch(error){await chrome.storage.local.set({daemonLastError:`result:${String(error?.message||error)}`,daemonLastErrorAt:new Date().toISOString()});return false;}}
  async function clearPendingIf(id){const x=await chrome.storage.local.get(PENDING_KEY);if(x[PENDING_KEY]?.command_id===id)await chrome.storage.local.remove(PENDING_KEY);}
  async function consumePredecessorIfSafe(command,executionClass,accepted) {
    if(!accepted||command?.target_platform!=="CHATGPT"||!command?.predecessor_command_id||!["ACTUATED","VERIFIED"].includes(executionClass))return;
    const x=await chrome.storage.local.get(PREDECESSOR_KEY);
    if(String(x[PREDECESSOR_KEY]||"")===String(command.predecessor_command_id))await chrome.storage.local.remove(PREDECESSOR_KEY);
  }

  async function waitNewConversation(tabId,timeout=12000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const tab=await chrome.tabs.get(tabId);if(isChatgptConversation(tab?.url||"")){const snap=await waitSnapshot(tabId,1600).catch(()=>null);if(snap)return{tab,snap};}await sleep(150);}throw new Error("chatgpt_rollover_timeout");}
  async function sendChatgpt(tab,command) {
    try { const r=await globalThis.A2_CHATGPT_TRUSTED_SEND(tab.id,command); if(r?.ok!==true)throw Object.assign(new Error(r?.error||r?.status||"chatgpt_send_failed"),{a2Result:r}); return r; }
    catch(error){
      if(!isExhausted(error))throw error;
      await chrome.storage.local.set({chatgptRolloverPending:true,chatgptRolloverPendingTabId:tab.id});
      try {
        await chrome.tabs.update(tab.id,{url:CHATGPT_ROOT,active:false}); await waitSnapshot(tab.id);
        const r=await globalThis.A2_CHATGPT_TRUSTED_SEND(tab.id,command);
        if(r?.ok!==true)throw Object.assign(new Error(r?.error||r?.status||"chatgpt_rollover_send_failed"),{a2Result:r});
        try {
          const done=await waitNewConversation(tab.id);
          await chrome.storage.local.set({chatgptUrl:normUrl(done.tab.url||"")});
          await reportSnapshot(tab.id,done.snap);
        } catch(postActuationError) {
          throw Object.assign(postActuationError instanceof Error?postActuationError:new Error(String(postActuationError)),{a2Result:r});
        }
        return r;
      } finally { await chrome.storage.local.set({chatgptRolloverPending:false,chatgptRolloverPendingTabId:null}); }
    }
  }

  async function execute(command) {
    const id=String(command?.command_id||""); if(!id)throw new Error("missing_command_id"); validateOrdering(command);
    const s=await settings();
    if(!s.armed){
      const envelope={status:"BLOCKED_NOT_ARMED",execution_class:"BLOCKED",authority_effect:false,captured_at:new Date().toISOString()};
      const accepted=await postResult(id,envelope); if(accepted)await clearPendingIf(id); return;
    }
    if(inFlight.has(id))return;
    const prior=await completedFor(command);
    if(prior){
      const envelope={status:"SENT_ALREADY_DURABLE",execution_class:prior.execution_class||"ACTUATED",target_platform:command.target_platform,target_url:prior.target_url||null,clicked_send_button:true,verification:{verified:true,durable_replay:true},ordering_basis:command.ordering_basis||null,predecessor_command_id:command.predecessor_command_id||null,authority_effect:false,captured_at:new Date().toISOString()};
      const accepted=await postResult(id,envelope); if(accepted){await clearPendingIf(id);await consumePredecessorIfSafe(command,envelope.execution_class,true);} return;
    }
    inFlight.add(id);
    try {
      const tab=await resolveTab(command,s); let result;
      if(command.target_platform==="GLM_ZAI"){if(typeof globalThis.A2_GLM_TRUSTED_SEND!=="function")throw new Error("glm_trusted_send_unavailable");result=await globalThis.A2_GLM_TRUSTED_SEND(tab.id,command);}
      else {if(typeof globalThis.A2_CHATGPT_TRUSTED_SEND!=="function")throw new Error("chatgpt_trusted_send_unavailable");result=await sendChatgpt(tab,command);}
      const status=String(result?.status||"FAILED_CLOSED"),executionClass=executionClassFor(status,result);
      const envelope={status,execution_class:executionClass,target_platform:command.target_platform,target_url:targetUrl(command,await settings()),tab_id:tab.id,clicked_send_button:result?.clicked_send_button===true||result?.ok===true,transport_trace_id:result?.transport_trace_id||null,verification:result?.verification||null,recovery:result?.recovery||null,dispatch_group_sha256:command.dispatch_group_sha256||null,launch_order:command.launch_order||null,predecessor_command_id:command.predecessor_command_id||null,ordering_basis:command.ordering_basis||null,authority_effect:false,captured_at:new Date().toISOString()};
      if(["ACTUATED","VERIFIED"].includes(executionClass))await rememberCompleted(command,envelope);
      const accepted=await postResult(id,envelope);
      if(accepted){await clearPendingIf(id);await consumePredecessorIfSafe(command,executionClass,true);}
      setTimeout(()=>pollSnapshots().finally(()=>poll(true)),command.target_platform==="GLM_ZAI"?250:1200);
    } catch(error) {
      const result=error?.a2Result||null,status=String(result?.status||(["AMBIGUOUS_NO_RETRY"].includes(String(error?.a2ExecutionClass||""))?"FAILED_DURABLE_AMBIGUOUS_NO_RETRY":"FAILED_SAFE_PRE_ACTUATION"));
      const executionClass=executionClassFor(status,result,error);
      const accepted=await postResult(id,{status,execution_class:executionClass,error:String(result?.error||error?.message||error),target_platform:command?.target_platform||null,transport_trace_id:result?.transport_trace_id||null,verification:result?.verification||null,recovery:result?.recovery||null,ordering_basis:command?.ordering_basis||null,predecessor_command_id:command?.predecessor_command_id||null,authority_effect:false,captured_at:new Date().toISOString()});
      if(accepted)await clearPendingIf(id);
    } finally { inFlight.delete(id); }
  }

  async function resumePending(){const x=await chrome.storage.local.get(PENDING_KEY),c=x[PENDING_KEY];if(c?.command_id)await execute(c);}
  async function poll(force=false) {
    if(pollPromise)return pollPromise;
    pollPromise=(async()=>{
      const s=await settings(); if(!force&&Date.now()-lastPollAt<s.pollMs)return; lastPollAt=Date.now();
      await resumePending();
      try {
        const snapshots=await freshSnapshots(s), pred=(await chrome.storage.local.get(PREDECESSOR_KEY))[PREDECESSOR_KEY]||null;
        const r=await request("/v1/commands/next",{method:"POST",body:JSON.stringify({snapshots,ordering_policy:ORDERING_POLICY,glm_predecessor_command_id:pred,operator_runtime:OPERATOR_RUNTIME})}); if(!r.ok)throw new Error(`command_http_${r.status}`);
        const body=await r.json();
        if(body?.command){await chrome.storage.local.set({[PENDING_KEY]:body.command});await execute(body.command);}
        await chrome.storage.local.set({daemonOnlineAt:new Date().toISOString(),daemonLastError:null,lastOrderingPolicy:body?.ordering_policy||ORDERING_POLICY,operatorRuntime:OPERATOR_RUNTIME});
      } catch(error){await chrome.storage.local.set({daemonLastError:String(error?.message||error),daemonLastErrorAt:new Date().toISOString()});}
    })().finally(()=>{pollPromise=null;}); return pollPromise;
  }

  globalThis.A2_ON_GLM_ACTUATED=(commandId)=>{const id=String(commandId||"");if(!id)return;chrome.storage.local.set({[PREDECESSOR_KEY]:id}).then(()=>pollSnapshots()).finally(()=>poll(true));};
  globalThis.A2_OPERATOR_RUNTIME=OPERATOR_RUNTIME;

  async function initialize(){await globalThis.A2_SECRET_VAULT_READY?.catch(()=>{});await globalThis.A2_BRIDGE_CLIENT_ID?.();await chrome.alarms.create("a2-chat-bridge-poll",{periodInMinutes:0.5});await badge();await resumePending();await pollSnapshots();await poll(true);}
  chrome.runtime.onInstalled.addListener(async()=>{const old=await chrome.storage.local.get(Object.keys(DEFAULTS)),seed={};for(const[k,v]of Object.entries(DEFAULTS))if(old[k]===undefined)seed[k]=v;await chrome.storage.local.set(seed);await initialize();});
  chrome.runtime.onStartup.addListener(()=>initialize());
  chrome.alarms.onAlarm.addListener((a)=>{if(a.name==="a2-chat-bridge-poll")pollSnapshots().finally(()=>poll(true));});
  chrome.storage.onChanged.addListener(async(changes,area)=>{if(area!=="local")return;if(changes.armed||changes.chatgptUrl||changes.zaiUrl||changes.daemonUrl||changes.pollMs){await badge();await poll(true);}});
  chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{
    if(m?.type==="CHAT_SNAPSHOT"&&sender.tab?.id&&m.snapshot){reportSnapshot(sender.tab.id,m.snapshot).then(()=>poll(false)).then(()=>sendResponse({ok:true})).catch((e)=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
    if(m?.type==="BRIDGE_POLL_NOW"){pollSnapshots().then(()=>poll(true)).then(()=>sendResponse({ok:true})).catch((e)=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
    if(m?.type==="A2_PAIRING_STATUS"){Promise.resolve(globalThis.A2_HAS_PAIRING_SECRET?.()).then((has)=>sendResponse({ok:true,configured:has===true})).catch((e)=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
    if(m?.type==="A2_SET_PAIRING_SECRET"){Promise.resolve(globalThis.A2_SET_PAIRING_SECRET?.(m.secret)).then(()=>sendResponse({ok:true})).catch((e)=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
    return false;
  });
  badge(); resumePending().finally(()=>poll(true));
})();
