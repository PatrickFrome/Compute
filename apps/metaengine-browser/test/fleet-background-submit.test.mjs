import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';
import { submitFencedChatGptPrompt } from '../src/chatgpt-fenced-submit.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';

function ax(role, name, id, value = null) {
  return { nodeId:`ax-${id}`, ignored:false, role:{ value:role }, name:{ value:name }, backendDOMNodeId:id, frameId:'frame-root', ...(value == null ? {} : { value:{ value } }) };
}
let nextId = 7000;
function fakeChat({ sendPresent = true, initialDraft = '', clearWorks = true, submitWorks = true, mutateDraftOnResolve = false } = {}) {
  const id = nextId++;
  let attached = false;
  let draft = initialDraft;
  let generating = false;
  let url = 'https://chatgpt.com/';
  let sends = 0;
  const calls = [];
  const listeners = new Map();
  const debuggerApi = {
    isAttached:() => attached, attach:() => { attached = true; }, detach:() => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name,rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emit(method, params = {}) { for (const fn of listeners.get('message') || []) fn({},method,params,null); },
    async sendCommand(method, params = {}) {
      calls.push([method,structuredClone(params)]);
      if (method === 'Page.getFrameTree') return { frameTree:{ frame:{ id:'frame-root',url } } };
      if (method === 'Runtime.enable') { this.emit('Runtime.executionContextCreated',{ context:{ id:1,uniqueId:`context-${id}`,auxData:{ frameId:'frame-root',isDefault:true } } }); return {}; }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport:{ clientWidth:0,clientHeight:0 } };
      if (method === 'Accessibility.getFullAXTree') return { nodes:[
        ax('textbox','Message ChatGPT',3,draft),
        ...(draft && sendPresent && !generating ? [ax('button','Send prompt',7)] : []),
        ...(generating ? [ax('button','Stop generating',9)] : []),
      ] };
      if (method === 'DOM.focus') return {};
      if (method === 'Input.insertText') { draft += params.text; return {}; }
      if (method === 'Input.dispatchKeyEvent') {
        if (params.commands?.includes('DeleteBackward') && clearWorks) draft = '';
        return {};
      }
      if (method === 'DOM.resolveNode') {
        if (mutateDraftOnResolve) draft = 'another agent prompt';
        return { object:{ objectId:`node-${params.backendNodeId}` } };
      }
      if (method === 'Runtime.callFunctionOn') {
        assert.equal(params.objectId,'node-7');
        sends += 1;
        if (submitWorks) { generating = true; draft = ''; url = 'https://chatgpt.com/c/independent-session'; this.emit('Accessibility.nodesUpdated'); }
        return { result:{ value:true } };
      }
      if (method === 'Runtime.releaseObject') return {};
      throw new Error(`unexpected debugger command:${method}`);
    },
  };
  const webContents = { id,debugger:debuggerApi,isDestroyed:() => false,getURL:() => url,getTitle:() => 'ChatGPT',getOSProcessId:() => 17000 + id,getOrCreateDevToolsTargetId:() => `target-${id}` };
  const executeCommand = async (command) => command.action === 'CAPTURE'
    ? { ...await captureSemanticFrame(webContents),tab_id:'tab_fleet' }
    : executeSemanticCommand(webContents,command);
  return { calls,webContents,executeCommand,sends:() => sends,setDraft:(value) => { draft = value; } };
}

test('hidden ChatGPT fleet proves draft replacement, fresh Send, and one geometry-free submit without Enter', async () => {
  const h = fakeChat({ initialDraft:'old account draft' });
  try {
    const frame = await h.executeCommand({ action:'CAPTURE' });
    const result = await submitFencedChatGptPrompt({ ...h,tab_id:'tab_fleet',frame,text:'METAENGINE bounded independent task' });
    assert.equal(result.effect_state,'PROVEN_GENERATING');
    assert.equal(result.event_driven_readback,true);
    assert.equal(h.sends(),1);
    assert.equal(h.calls.some(([method,params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter'),false);
    assert.equal(h.calls.some(([method]) => ['DOM.getBoxModel','Input.dispatchMouseEvent'].includes(method)),false);
  } finally { releasePersistentBrowserDebugger(h.webContents); }
});

test('ChatGPT rejects single-phase submit before draft mutation', async () => {
  const h = fakeChat();
  try {
    const frame = await h.executeCommand({ action:'CAPTURE' });
    const composer = frame.semantic_targets[0];
    await assert.rejects(() => executeSemanticCommand(h.webContents,{ action:'SEMANTIC_TYPE',platform:'CHATGPT',payload:{ role:'textbox',accessible_name:composer.name,semantic_ref:composer.semantic_ref,text:'task',submit_after_type:true } }),/native_chatgpt_two_phase_submit_required/);
    assert.equal(h.calls.some(([method]) => method === 'Input.insertText'),false);
    assert.equal(h.sends(),0);
  } finally { releasePersistentBrowserDebugger(h.webContents); }
});

test('ChatGPT unavailable Send and failed draft clear are pre-submit failures', async () => {
  for (const options of [{ sendPresent:false },{ initialDraft:'old poisoned draft',clearWorks:false }]) {
    const h = fakeChat(options);
    try {
      const frame = await h.executeCommand({ action:'CAPTURE' });
      await assert.rejects(() => submitFencedChatGptPrompt({ ...h,tab_id:'tab_fleet',frame,text:'task' }),/chatgpt_submit_(send_not_unique|typed_draft_not_exact)/);
      assert.equal(h.sends(),0);
    } finally { releasePersistentBrowserDebugger(h.webContents); }
  }
});

test('native ChatGPT Send checks the exact draft again after fresh capture', async () => {
  const h = fakeChat();
  try {
    const frame = await h.executeCommand({ action:'CAPTURE' });
    await assert.rejects(() => submitFencedChatGptPrompt({ ...h,tab_id:'tab_fleet',frame,text:'task',beforeSend:async () => h.setDraft('other task') }),/native_chatgpt_typed_draft_not_exact/);
    assert.equal(h.sends(),0);
  } finally { releasePersistentBrowserDebugger(h.webContents); }
});

test('unproven native ChatGPT Send is ambiguous and never retried', async () => {
  const h = fakeChat({ submitWorks:false });
  try {
    const frame = await h.executeCommand({ action:'CAPTURE' });
    const out = await submitFencedChatGptPrompt({ ...h,tab_id:'tab_fleet',frame,text:'task' });
    assert.equal(out.effect_state,'AMBIGUOUS_AFTER_SEND');
    assert.equal(h.sends(),1);
    assert.equal(out.automatic_retry_allowed,false);
  } finally { releasePersistentBrowserDebugger(h.webContents); }
});

test('native ChatGPT draft movement during asynchronous DOM resolution blocks the physical click', async () => {
  const h = fakeChat({ mutateDraftOnResolve:true });
  try {
    const frame = await h.executeCommand({ action:'CAPTURE' });
    await assert.rejects(() => submitFencedChatGptPrompt({ ...h,tab_id:'tab_fleet',frame,text:'task' }),/native_chatgpt_typed_draft_not_exact/);
    assert.equal(h.sends(),0);
  } finally { releasePersistentBrowserDebugger(h.webContents); }
});
