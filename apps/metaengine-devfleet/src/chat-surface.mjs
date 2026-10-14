import crypto from 'node:crypto';
import { WebContentsView, session } from 'electron';
import { classifyPageFailure, summarizeModeNodes, safeAttrs, inferModeFromAttributes, retryWaitMs } from './chat-fleet-preflight.mjs';
import { modelPickerCandidates, modelSubmenuCandidates, boundedModelControls, visibleEffort, gpt6FromControls, sendControls, composerControls, inspectSendSurface } from './model-proof-core.mjs';
import { fingerprintAxSnapshot } from './fleet-observation-core.mjs';
import { AxEventHints } from './ax-event-hints.mjs';
import {receiptMarker,postedMessageObserved,postedUserTurnObserved} from './send-receipt-core.mjs';
import {composerDomText} from './composer-dom-core.mjs';

const CHAT_ROOT = 'https://chatgpt.com/';
const processEpoch = crypto.randomUUID();
const sha = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function chatUrl(text, conversation = false) {
  try {
    const u = new URL(String(text));
    if (u.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(u.hostname)) return false;
    return conversation ? /^\/c\/[a-z0-9-]+\/?$/i.test(u.pathname) :
      u.pathname === '/' || /^\/c\/[a-z0-9-]+\/?$/i.test(u.pathname);
  } catch { return false; }
}
const val = (node, field) => String(node?.[field]?.value ?? '');
function roleOf(node) { return val(node,'role').toLowerCase(); }
const buttonNames = /^(send|send prompt|send message|отправить|отправить сообщение|отправить запрос)$/i;
const stopNames = /^(stop generating|stop|остановить генерацию|остановить)$/i;
const composerNames = /^(message chatgpt|chat with chatgpt|ask chatgpt|сообщение chatgpt|спросить chatgpt|задать вопрос chatgpt)$/i;
function editable(node) {
  const props = Array.isArray(node?.properties) ? node.properties : [];
  const value = props.find(x => x.name === 'editable')?.value?.value;
  return value === true || ['true','plaintext','richtext'].includes(String(value || '').toLowerCase());
}
function composerFrom(nodes) {
  const pool = nodes.filter(n => !n.ignored && n.backendDOMNodeId &&
    (roleOf(n) === 'textbox' || (roleOf(n) === 'generic' && editable(n))));
  const named = pool.filter(n => composerNames.test(val(n,'name').trim()));
  const chosen = named.length === 1 ? named : pool.length === 1 ? pool : [];
  if (!Array.isArray(chosen) && chosen) return chosen;
  return Array.isArray(chosen) && chosen.length === 1 ? chosen[0] : null;
}
function singleButton(nodes,re) {
  const items = nodes.filter(n => !n.ignored && roleOf(n) === 'button' &&
    n.backendDOMNodeId && re.test(val(n,'name').trim()));
  return items.length === 1 ? items[0] : null;
}
function transcript(nodes) {
  const fragments = [];
  let size = 0;
  for (const n of nodes) {
    if (n.ignored || !['statictext','heading','paragraph','listitem','article'].includes(roleOf(n))) continue;
    const name = val(n,'name').trim();
    if (!name) continue;
    const remaining = 180000-size;
    if (remaining <= 0) break;
    fragments.push(name.slice(0,remaining));
    size += name.length + 1;
  }
  return fragments.join('\n').slice(0,180000);
}
async function ax(view) {
  const debug = view.webContents.debugger;
  if (!debug.isAttached()) debug.attach('1.3');
  await debug.sendCommand('Accessibility.enable');
  let timeout;
  let result;
  try {
    result=await Promise.race([
      debug.sendCommand('Accessibility.getFullAXTree'),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('native_ax_readback_timeout')),4000);})
    ]);
  } finally {clearTimeout(timeout);}
  return Array.isArray(result?.nodes) ? result.nodes : [];
}
async function composerValue(view, node, diagnostic = null) {
  if (!node || !Number.isSafeInteger(node.backendDOMNodeId)) return null;
  const dbg = view.webContents.debugger;
  await dbg.sendCommand('DOM.enable');
  const result = await dbg.sendCommand('DOM.describeNode', {
    backendNodeId:node.backendDOMNodeId,depth:-1,pierce:false
  });
  const dom = composerDomText(result?.node,node.backendDOMNodeId);
  if(diagnostic) {
    const n=result?.node,attrs=n?.attributes||[];
    const attr=k=>{const i=attrs.indexOf(k);return i>=0?attrs[i+1]:null;};
    Object.assign(diagnostic,{tag:n?.nodeName||null,id:attr('id'),
      editable:attr('contenteditable'),backend_matches:n?.backendNodeId===node.backendDOMNodeId,
      child_count:n?.childNodeCount??null,children:(n?.children||[]).slice(0,8).map(c=>({
        tag:c.nodeName,type:c.nodeType,child_count:c.childNodeCount??null,
        children:c.children?.length??null,pseudo_count:c.pseudoElements?.length||0})),
      state:dom===null?'UNKNOWN':'PROVEN'});
  }
  if (dom !== null) return dom;
  // Native input value is authoritative for a textarea; contenteditable AX
  // values can flatten/lag paragraphs and MUST use the exact DOM node above.
  return result?.node?.nodeName === 'TEXTAREA' &&
    typeof node.value?.value === 'string' ? node.value.value : null;
}
async function readyComposer(view, diagnostic = null) {
  let nodes=await ax(view),composer=composerFrom(nodes);
  if(!composer)return {nodes,composer:null,value:null};
  const dbg=view.webContents.debugger;
  await dbg.sendCommand('DOM.enable');
  // ChatGPT's pending textarea lazily mounts the actual editor on focus.
  // Focus does not type or submit; always rebind to the new native AX node.
  await dbg.sendCommand('DOM.focus',{backendNodeId:composer.backendDOMNodeId});
  let value=null;
  for(let i=0;i<8;i++) {
    nodes=await ax(view);composer=composerFrom(nodes);
    value=composer ? await composerValue(view,composer,diagnostic) : null;
    if(value!==null)break;
    if(i<7)await sleep(100);
  }
  return {nodes,composer,value};
}
// CDP user-turn scope is critical: a flattened AX transcript can echo an
// unsent marker, an assistant quotation, or other untrusted page text.
async function scopedUserMessageHtml(view) {
  const dbg=view.webContents.debugger;
  if(!dbg.isAttached())dbg.attach('1.3');
  await dbg.sendCommand('DOM.enable');
  const doc=await dbg.sendCommand('DOM.getDocument',{depth:1,pierce:false});
  const rootId=doc?.root?.nodeId;
  if(!Number.isSafeInteger(rootId)||rootId<1)throw Error('user_turn_document_unverified');
  const result=await dbg.sendCommand('DOM.querySelectorAll',{
    nodeId:rootId,selector:'[data-message-author-role="user"]'
  });
  const ids=result?.nodeIds;
  if(!Array.isArray(ids)||ids.length>256||
     ids.some(id=>!Number.isSafeInteger(id)||id<1))
    throw Error('user_turn_scope_unverified');
  const html=[];
  for(const nodeId of ids) {
    const turn=await dbg.sendCommand('DOM.getOuterHTML',{nodeId});
    if(typeof turn?.outerHTML!=='string'||turn.outerHTML.length>65536)
      throw Error('user_turn_html_unverified');
    html.push(turn.outerHTML);
  }
  return html;
}
async function focusAndType(view, backendNodeId, text) {
  const debug = view.webContents.debugger;
  await debug.sendCommand('DOM.enable');
  await debug.sendCommand('DOM.focus', { backendNodeId });
  await debug.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', key:'a', code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await debug.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', key:'a', code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await debug.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
  await debug.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
  await debug.sendCommand('Input.insertText',{text});
}
async function clickNode(view,backendNodeId) {
  const dbg = view.webContents.debugger;
  const box = await dbg.sendCommand('DOM.getBoxModel',{backendNodeId});
  const quad = box?.model?.border;
  if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(Number.isFinite))
    throw new Error('send_button_geometry_unverified');
  const x = (quad[0]+quad[2]+quad[4]+quad[6])/4;
  const y = (quad[1]+quad[3]+quad[5]+quad[7])/4;
  if (x < 0 || y < 0 || x > 10000 || y > 10000) throw new Error('send_button_outside_viewport');
  await dbg.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await dbg.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await dbg.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}

export class ChatSurface {
  #window;
  #views = new Map();
  #navigationGenerations = new Map();
  #eventHints = new AxEventHints();
  #selected = null;
  #partition;
  constructor(window) {
    this.#window = window;
    this.#partition = session.fromPartition('persist:metaengine-devfleet-auth-v1');
    this.#partition.setPermissionRequestHandler((_webContents,_permission,done)=>done(false));
    window.on('resize',()=>this.#layout());
    window.on('maximize',()=>this.#layout());
  }
  #layout() {
    const view = this.#views.get(this.#selected);
    if (!view) return;
    const [width,height] = this.#window.getContentSize();
    view.setBounds({x:340,y:0,width:Math.max(1,width-340),height:Math.max(1,height)});
  }
  select(tabId) {
    const view = this.#views.get(tabId);
    if (!view) throw new Error('tab_not_live');
    for (const [id,v] of this.#views) {
      if (id !== tabId) { try { this.#window.contentView.removeChildView(v); } catch {} }
    }
    try { this.#window.contentView.addChildView(view); } catch {}
    this.#selected = tabId;
    this.#layout();
    return {tab_id:tabId,url:view.webContents.getURL(),selected:true};
  }
  list() {
    return [...this.#views.entries()].map(([tabId,view])=>({
      tab_id:tabId,url:view.webContents.getURL(),selected:tabId===this.#selected,
      target_id:'webcontents:'+view.webContents.id
    }));
  }
  async create(tabId,requestedUrl=CHAT_ROOT) {
    if (this.#views.has(tabId)) throw new Error('tab_already_live');
    if (this.#views.size >= 16) throw new Error('tab_capacity_exceeded');
    if (!chatUrl(requestedUrl)) throw new Error('tab_origin_not_allowed');
    const view = new WebContentsView({webPreferences:{
      partition:'persist:metaengine-devfleet-auth-v1',
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
      spellcheck:true,backgroundThrottling:false
    }});
    this.#views.set(tabId,view);
    this.#navigationGenerations.set(tabId,0);
    this.#eventHints.register(tabId,'webcontents:'+view.webContents.id);
    const advanceNavigation = () => {
      this.#navigationGenerations.set(tabId,
        (this.#navigationGenerations.get(tabId)||0)+1);
      this.#eventHints.invalidate(tabId);
    };
    view.webContents.on('did-start-navigation',advanceNavigation);
    view.webContents.on('did-navigate-in-page',advanceNavigation);
    view.webContents.on('render-process-gone',advanceNavigation);
    // Subscribe to exact native-target CDP signals; never evaluate page JS.
    view.webContents.debugger.on('message',(_event,method)=>{
      if(method==='Accessibility.nodesUpdated' || method==='Accessibility.loadComplete')
        this.#eventHints.invalidate(tabId);
    });
    view.webContents.debugger.on('detach',()=>this.#eventHints.invalidate(tabId));
    view.webContents.setWindowOpenHandler(({url})=>({action:'deny'}));
    view.webContents.on('destroyed',()=>{this.#views.delete(tabId);this.#navigationGenerations.delete(tabId);this.#eventHints.unregister(tabId);});
    // Only ChatGPT receives DevFleet commands; authentication redirects are
    // allowed for user-driven login, but never selected as command surfaces.
    if (!this.#selected) this.select(tabId);
    try {
      await Promise.race([
        view.webContents.loadURL(requestedUrl),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('tab_load_timeout')),30000)),
      ]);
    } catch {
      // A tab may have navigated to ChatGPT before a network load failure.
      // Do not manufacture a verified binding if origin is unknown.
      if (!chatUrl(view.webContents.getURL())) throw new Error('tab_initial_load_unverified');
    }
    return {tab_id:tabId,url:view.webContents.getURL(),target_id:'webcontents:'+view.webContents.id};
  }
  async read(tabId,offset,maxChars) {
    const view = this.#views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    const url = view.webContents.getURL();
    if (!chatUrl(url)) throw new Error('tab_origin_not_chatgpt');
    const nodes = await ax(view);
    const text = transcript(nodes);
    return {tab_id:tabId,url,text:text.slice(offset,offset+maxChars),
      total_chars:text.length,has_more:offset+maxChars<text.length,
      process_epoch:processEpoch,target_id:'webcontents:'+view.webContents.id,
      authority_effect:false};
  }
  async observe(tabId,signal) {
    const view = this.#views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error('observation_tab_not_live');
    const initialUrl = view.webContents.getURL();
    if (!chatUrl(initialUrl)) throw new Error('observation_origin_not_chatgpt');
    const navigation_generation = this.#navigationGenerations.get(tabId);
    const targetId = 'webcontents:' + view.webContents.id;
    const startSignalSeq = this.#eventHints.sequence(tabId);
    if (signal?.aborted) throw Error('observation_timeout');
    const onAbort=()=>this.#eventHints.invalidate(tabId);
    signal?.addEventListener('abort',onAbort,{once:true});
    let nodes;
    try { nodes = await ax(view); }
    finally { signal?.removeEventListener('abort',onAbort); }
    if (signal?.aborted) throw Error('observation_timeout');
    if (!Array.isArray(nodes) || nodes.length===0)
      throw Error('observation_empty_ax_tree');
    // A renderer reload, navigation, disappearing tab, or changed URL while
    // sampling invalidates the entire revision, even for equal page text.
    if (this.#views.get(tabId)!==view || view.webContents.isDestroyed() ||
        view.webContents.getURL()!==initialUrl ||
        this.#navigationGenerations.get(tabId)!==navigation_generation)
      throw new Error('observation_target_changed');
    if (nodes.length>25000)throw new Error('observation_tree_too_large');
    const text = transcript(nodes);
    const snapshot=fingerprintAxSnapshot({
      tab_id:tabId,process_epoch:processEpoch,target_id:targetId,
      navigation_generation,url:initialUrl,text
    });
    if(signal?.aborted) throw Error('observation_timeout');
    if(snapshot.complete) this.#eventHints.acknowledge(tabId,targetId,startSignalSeq);
    else this.#eventHints.invalidate(tabId);
    return snapshot;
  }
  pollHint(tabId) {
    const view=this.#views.get(tabId);
    if(!view || view.webContents.isDestroyed())throw Error('hint_tab_not_live');
    if(!chatUrl(view.webContents.getURL()))throw Error('hint_origin_not_chatgpt');
    return {tab_id:tabId,
      ...this.#eventHints.poll(tabId,'webcontents:'+view.webContents.id)};
  }
  async #mode(view) {
    const nodes = await ax(view);
    const summary = summarizeModeNodes(nodes);
    let mode = summary.state;
    if (mode === 'UNKNOWN' && summary.chat_node != null) {
      const workNodes = nodes.filter(n => /^(work|работа)$/i.test(String(n.name?.value || '').trim())
        && ['button','tab','radio','radiobutton','link'].includes(String(n.role?.value||'').toLowerCase()));
      const workNode = workNodes.length === 1 ? workNodes[0].backendDOMNodeId : null;
      if (workNode != null) {
        try {
          const dbg = view.webContents.debugger;
          await dbg.sendCommand('DOM.enable');
          const a = await dbg.sendCommand('DOM.describeNode', { backendNodeId: summary.chat_node });
          const b = await dbg.sendCommand('DOM.describeNode', { backendNodeId: workNode });
          mode = inferModeFromAttributes(safeAttrs(a?.node?.attributes),safeAttrs(b?.node?.attributes));
        } catch { /* Never turn unsupported DOM inspection into CHAT */ }
      }
    }
    // The ordinary ChatGPT conversation UI can omit the Chat/Work tab pair.
    // Require both native provider controls; a text label alone is not proof.
    if(mode==='UNKNOWN' && summary.nodes.length===0 &&
       modelPickerCandidates(nodes).length===1 && composerControls(nodes).length===1)
      mode='CHAT';
    return {mode,chat_node:summary.chat_node,
      page_failure:classifyPageFailure(transcript(nodes)),
      high_label_visible:nodes.some(n => /^(high)$/i.test(String(n.name?.value||'').trim())),
      gpt6_label_visible:nodes.some(n => /^GPT[ -]?6(?:\b|$)/i.test(String(n.name?.value||'').trim())),
      mode_nodes:summary.nodes};
  }
  async #ensureChat(view) {
    const initial = await this.#mode(view);
    if (initial.page_failure) throw new Error('chatgpt_page_error_' + initial.page_failure.toLowerCase());
    if (initial.mode === 'CHAT') return initial;
    // A unique, identified Chat control may be selected; never click Work.
    if (initial.chat_node == null) throw new Error('chat_mode_unverified');
    await clickNode(view, initial.chat_node);
    await sleep(650);
    const confirmed = await this.#mode(view);
    if (confirmed.mode !== 'CHAT' || confirmed.page_failure) throw new Error('chat_mode_not_confirmed_after_switch');
    return confirmed;
  }
  async inspect(tabId) {
    const view = this.#views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    if (!chatUrl(view.webContents.getURL())) throw new Error('tab_origin_not_chatgpt');
    const result = await this.#mode(view);
    return {tab_id:tabId,mode:result.mode,page_failure:result.page_failure,
      high_label_visible:result.high_label_visible,gpt6_label_visible:result.gpt6_label_visible,
      mode_nodes:result.mode_nodes,authority_effect:false};
  }
  async recover(tabId) {
    const view = this.#views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    let current = await this.inspect(tabId);
    if (!current.page_failure) return {tab_id:tabId,state:'NO_ERROR',...current};
    for (let attempt=1;attempt<=5;attempt++) {
      if (!chatUrl(view.webContents.getURL())) throw new Error('chat_recovery_origin_mismatch');
      view.webContents.reload();
      await sleep(retryWaitMs(attempt));
      current = await this.inspect(tabId);
      if (!current.page_failure) return {tab_id:tabId,state:'RECOVERED',
        reload_count:attempt,...current};
    }
    return {tab_id:tabId,state:'BLOCKED',reload_count:5,...current};
  }
  async modelProbe(tabId) {
    const view=this.#views.get(tabId);
    if(!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    this.select(tabId); // ensure the exact owned WebContents has a live layout
    const url=view.webContents.getURL();
    if(!chatUrl(url)) throw new Error('tab_origin_not_chatgpt');
    const mode=await this.#mode(view);
    if(mode.mode!=='CHAT'||mode.page_failure) throw new Error('model_probe_requires_healthy_chat');
    const before=await ax(view);
    const pickers=modelPickerCandidates(before);
    const base=boundedModelControls(before);
    const effort=visibleEffort(before);
    const result={tab_id:tabId,mode:'CHAT',model_picker_count:pickers.length,
      effort,initial_controls:base,picker_menu_controls:[],
      gpt6_option_count:0,gpt6_selected:false,
      model_selection_proven:false,high_selection_proven:effort.high_selection_proven,
      authority_effect:false};
    if(pickers.length!==1) {
      result.status='MODEL_PICKER_NOT_UNIQUE';
      return result;
    }
    const dbg=view.webContents.debugger;
    try {
      await dbg.sendCommand('DOM.enable');
      await clickNode(view,pickers[0].backendDOMNodeId);
      await sleep(500);
      if(view.webContents.getURL()!==url) throw new Error('model_probe_target_navigated');
      const opened=await ax(view);
      const firstLevel=boundedModelControls(opened);
      const nested=modelSubmenuCandidates(opened);
      result.submenu_count=nested.length;
      result.picker_menu_controls=firstLevel;
      let menu=firstLevel;
      if(nested.length===1) {
        // Open *only* this exact, unambiguous model submenu. No model is
        // selected or changed by an observation operation.
        await clickNode(view,nested[0].backendDOMNodeId);
        await sleep(500);
        if(view.webContents.getURL()!==url)throw new Error('model_submenu_navigated');
        const openedSecond=await ax(view);
        menu=boundedModelControls(openedSecond);
        result.picker_menu_controls=menu;
        result.submenu_opened=true;
      } else {
        result.submenu_opened=false;
      }
      const selected=gpt6FromControls(menu);
      result.gpt6_option_count=selected.gpt6_option_count;
      result.gpt6_selected=selected.gpt6_selected;
      result.model_selection_proven=selected.gpt6_selected;
      result.status=selected.gpt6_selected?'GPT6_SELECTED_IN_MENU':'MODEL_MENU_INSPECTED_UNVERIFIED';
    } catch(error) {
      result.status='MODEL_MENU_PROBE_FAILED';
      result.error_code=String(error?.message||'model_probe_failed').slice(0,85);
    } finally {
      try {
        await dbg.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await dbg.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      } catch {}
    }
    return result;
  }
  async inputProbe(tabId) {
    const view=this.#views.get(tabId);
    if(!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    this.select(tabId); // hidden WebContents may be throttled; inspect the visible exact tab
    if(!chatUrl(view.webContents.getURL()))throw new Error('tab_origin_not_chatgpt');
    const diagnostic={state:'ABSENT'};
    const {nodes,value}=await readyComposer(view,diagnostic);
    const state=await this.#mode(view);
    const controls=inspectSendSurface(nodes);
    return {tab_id:tabId,mode:state.mode,page_failure:state.page_failure,
      unique_composer:controls.unique_composer && value !== null,unique_send:controls.unique_send,
      composer_nonempty:value !== null && value.length > 0,
      generation_active:nodes.some(n=>!n.ignored && roleOf(n)==='button' && stopNames.test(val(n,'name').trim())),
      composer_readback:diagnostic,
      authority_effect:false};
  }
  async send(tabId,text) {
    const view = this.#views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error('tab_not_live');
    this.select(tabId);
    const initialUrl = view.webContents.getURL();
    if (!chatUrl(initialUrl)) throw new Error('chatgpt_login_or_origin_required');
    await this.#ensureChat(view);
    const before = await ax(view);
    if (singleButton(before,stopNames)) throw new Error('chatgpt_current_generation_active');
    const composer = composerControls(before)[0] || null;
    if (!composer) throw new Error('chatgpt_composer_not_unique_or_login_required');
    // Any existing composer text is an owner-authorized replaceable task draft.
    // focusAndType selects and clears it, then exact AX readback below proves
    // replacement before issuing the only physical Send click.
    const beforeText = transcript(before);
    // The request-ID suffix makes the sent message unique within each chat.
    if (beforeText.includes(text)) throw new Error('request_already_in_transcript');
    await focusAndType(view,composer.backendDOMNodeId,text);
    let typed,typedComposer,typedValue;
    for(let attempt=0;attempt<5;attempt++) {
      typed=await ax(view);
      typedComposer=composerControls(typed)[0]||null;
      typedValue=typedComposer ? await composerValue(view,typedComposer) : null;
      if(typedValue===text)break;
      if(attempt<4)await sleep(100);
    }
    if (typedValue !== text) throw new Error('composer_exact_draft_not_proven');
    // A submit control may change its accessible name, disappear, or be
    // overlaid by the ChatGPT UI. The exact, already verified composer is
    // the sole submit target. Only ONE Enter is ever sent; no fallback click.
    if (view.webContents.getURL() !== initialUrl || this.#views.get(tabId)!==view)
      throw new Error('chatgpt_target_changed_before_send');
    const finalMode = await this.#mode(view);
    if (finalMode.mode !== 'CHAT' || finalMode.page_failure)
      throw new Error('chat_only_send_gate_refused');
    if (singleButton(typed,stopNames))
      throw new Error('chatgpt_current_generation_active');
    const dbg=view.webContents.debugger;
    await dbg.sendCommand('DOM.enable');
    await dbg.sendCommand('DOM.focus',{backendNodeId:typedComposer.backendDOMNodeId});
    await dbg.sendCommand('Input.dispatchKeyEvent',{
      type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await dbg.sendCommand('Input.dispatchKeyEvent',{
      type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    // The prompt can span numerous AX paragraphs. Comparing the entire
    // text as a contiguous substring caused false AMBIGUOUS receipts.
    // Require unique durable request marker, conversation URL and cleared
    // composer; a marker still sitting in the draft NEVER proves delivery.
    const marker=receiptMarker(text);
    if (!marker) throw new Error('send_receipt_marker_missing');
    for (let i=0;i<70;i++) {
      await sleep(400);
      const url=view.webContents.getURL();
      if (!chatUrl(url)) throw new Error('chatgpt_origin_changed_after_send');
      if(this.#views.get(tabId)!==view || view.webContents.isDestroyed())
        throw new Error('chatgpt_target_changed_after_send');
      const {nodes,composer:currentComposer,value:currentValue}=await readyComposer(view);
      if(currentValue==='') {
        // The AX marker is only a cheap hint. Never settle a receipt on it.
        const generation=this.#navigationGenerations.get(tabId);
        let scoped=[];
        try{scoped=await scopedUserMessageHtml(view);}catch{ /* fail closed */ }
        if(this.#views.get(tabId)===view&&!view.webContents.isDestroyed()&&
          view.webContents.getURL()===url&&
          this.#navigationGenerations.get(tabId)===generation&&
          postedUserTurnObserved({url,request_id:marker,
            composer_observed:!!currentComposer,
            composer_value:currentValue,
            user_turn_html:scoped})) {
          return {state:'PROVEN_SENT',tab_id:tabId,url,
            target_id:'webcontents:'+view.webContents.id,prompt_sha256:sha(text)};
        }
      }
    }
    throw new Error('send_outcome_requires_manual_readback');
  }
  async probePosted(tabId,requestId) {
    const view=this.#views.get(tabId);
    if(!view || view.webContents.isDestroyed())throw Error('receipt_tab_not_live');
    if(typeof requestId!=='string'||!/^[A-Za-z0-9._:-]{12,100}$/.test(requestId))
      throw Error('receipt_request_id_invalid');
    this.select(tabId);
    const url=view.webContents.getURL();
    if(!chatUrl(url,true))
      return {state:'UNVERIFIED',tab_id:tabId,request_id:requestId,
        authority_effect:false};
    const epoch=this.#navigationGenerations.get(tabId);
    const {nodes,composer,value}=await readyComposer(view);
    if(view.webContents.isDestroyed()||this.#views.get(tabId)!==view||
      this.#navigationGenerations.get(tabId)!==epoch||view.webContents.getURL()!==url)
      return {state:'UNVERIFIED',tab_id:tabId,request_id:requestId,
        authority_effect:false};
    let scoped=[];
    if(composer&&value==='') {
      try{scoped=await scopedUserMessageHtml(view);}catch{ /* fail closed */ }
    }
    const stable=!view.webContents.isDestroyed()&&this.#views.get(tabId)===view&&
      this.#navigationGenerations.get(tabId)===epoch&&view.webContents.getURL()===url;
    const posted=stable&&postedUserTurnObserved({
      url,composer_observed:!!composer,
      composer_value:value,
      user_turn_html:scoped,request_id:requestId
    });
    return {state:posted?'PROVEN_SENT':'UNVERIFIED',tab_id:tabId,
      request_id:requestId,url,
      target_id:'webcontents:'+view.webContents.id,authority_effect:false};
  }
  async closeTab(tabId) {
    const view=this.#views.get(tabId);
    if(!view || view.webContents.isDestroyed())throw new Error('tab_not_live');
    const selected=this.#selected===tabId;
    const destroyed=new Promise((resolve,reject)=>{
      const expiry=setTimeout(()=>reject(new Error('tab_destruction_unverified')),5000);
      view.webContents.once('destroyed',()=>{clearTimeout(expiry);resolve();});
    });
    if(selected)this.#selected=null;
    try{this.#window.contentView.removeChildView(view);}catch{}
    view.webContents.close();
    await destroyed;
    this.#views.delete(tabId);
    this.#navigationGenerations.delete(tabId);
    this.#eventHints.unregister(tabId);
    if(selected && this.#views.size) {
      this.select(this.#views.keys().next().value);
    }
    return {tab_id:tabId,closed:true,authority_effect:false};
  }
  close() {
    for (const view of this.#views.values()) {
      try {view.webContents.close();}catch {}
    }
    for(const tabId of this.#views.keys())this.#eventHints.unregister(tabId);
    this.#views.clear();
    this.#navigationGenerations.clear();
  }
}
