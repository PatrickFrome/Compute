import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createWindowsLocalComputerExecutor } from './windows-local-computer-executor.mjs';

const execute = promisify(execFile);
const MAX_MESSAGE = 128 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const VIEWS = new Set(['OBSERVE_WINDOWS','OBSERVE_DISPLAYS','FOREGROUND_STATUS','VERIFY_TARGET','UIA_SNAPSHOT','CAPTURE_DESKTOP','CAPTURE_WINDOW']);
const CONTROLS = new Set(['UIA_FOCUS','UIA_INVOKE','UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL','TYPE_TEXT','KEY_PRESS','POINTER_CLICK']);
const deny = () => { throw new Error('remote_support_local_approval_required'); };
const result = id => ({ jsonrpc:'2.0', id });
const clean = error => /^remote_support_[a-z0-9_]+$/.test(String(error?.message||'')) ? error.message : 'remote_support_operation_failed';
const content = value => ({ content:[{type:'text',text:JSON.stringify(value)}],isError:false });
const errorContent = error => ({content:[{type:'text',text:clean(error)}],isError:true});

export async function confirmRemoteSupportOnWindows({ scope }) {
  if (process.platform !== 'win32') return false;
  if (!['VIEW','CONTROL'].includes(scope)) return false;
  // The operator must be physically present in the user's interactive
  // Windows session. The remote caller cannot set this decision.
  const text = scope === 'VIEW'
    ? 'Allow ONE METAENGINE support session to VIEW your screen and UI for up to 60 minutes? Private content may be visible. Close the support terminal to stop immediately.'
    : 'Allow ONE METAENGINE support session to VIEW your screen and CONTROL keyboard/mouse for up to 60 minutes WITHOUT further action-by-action popups? Only trusted authorized agent leases can cause effects. Close the support terminal to stop immediately.';
  const escaped = text.replaceAll("'", "''");
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${escaped}','METAENGINE — Remote Support',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning).ToString()`;
  try {
    const {stdout} = await execute('powershell.exe',
      ['-NoProfile','-NonInteractive','-STA','-Command',script],
      {windowsHide:false,shell:false,timeout:60000,maxBuffer:1024});
    return stdout.trim() === 'Yes';
  } catch { return false; }
}

export function createRemoteSupportMcp({
  input = process.stdin, output = process.stdout,
  executor = createWindowsLocalComputerExecutor(),
  approve = confirmRemoteSupportOnWindows,
  now = () => Date.now(), platform = process.platform,
  imageLoader = readBoundedCapture,
} = {}) {
  let viewExpires = 0;
  let controlExpires = 0;
  let sessionId = null;
  let revoked = false;
  let closed = false;
  let buffer = '';
  let processing = Promise.resolve();
  const send = message => {
    if (closed) return;
    output.write(JSON.stringify(message) + '\n');
  };
  // A locally approved, bounded session replaces modal prompts on EVERY
  // mouse/keyboard action. No remote caller may mint or extend a grant.
  // All effects still pass the existing DB-lease + target-identity fences.
  const SESSION_MAX_MS = 60 * 60 * 1000;
  const requireAuthorized = scope => {
    if (platform !== 'win32') throw new Error('remote_support_windows_required');
    if (revoked || closed) throw new Error('remote_support_session_revoked');
    if (scope === 'CONTROL' ? controlExpires <= now() : viewExpires <= now())
      throw new Error('remote_support_session_not_active');
  };
  const startSession = async scope => {
    if (platform !== 'win32') throw new Error('remote_support_windows_required');
    if (revoked || closed) throw new Error('remote_support_session_revoked');
    if (!['VIEW','CONTROL'].includes(scope)) throw new Error('remote_support_scope_invalid');
    // No silent upgrade or renewal; the owner must terminate and relaunch
    // the foreground local helper to authorize a new session.
    if (sessionId) throw new Error('remote_support_session_already_started');
    const accepted = await approve({scope});
    if (accepted !== true) deny();
    const until = now() + SESSION_MAX_MS;
    sessionId = randomUUID();
    viewExpires = until;
    controlExpires = scope === 'CONTROL' ? until : 0;
    return content({schema:'metaengine.remote-support-session.v1',
      session_id:sessionId,scope,expires_at:new Date(until).toISOString(),
      further_action_prompts:false,unattended_persistent_access:false,
      approved_locally:true,authority_effect:false});
  };
  async function tool(name, args = {}) {
    if (name === 'support_status') return content({
      schema:'metaengine.remote-support.v1', state:'OPT_IN_ONLY',
      local_approval_required:true, active_view_grant:!revoked && viewExpires > now(),
      active_control_grant:!revoked && controlExpires > now(),
      session_id:revoked ? null : sessionId,
      session_revoked:revoked, further_action_prompts:false,
      arbitrary_shell:false, filesystem_access:false, unattended_access:false,
      installed_browser_runtime_required:false, authority_effect:false,
    });
    if (name === 'support_start_session') {
      return startSession(args?.scope);
    }
    if (name === 'support_stop') {
      viewExpires = 0;
      controlExpires = 0;
      sessionId = null;
      revoked = true;
      return content({state:'SESSION_REVOKED',new_session_requires_local_restart:true,authority_effect:false});
    }
    if (name === 'support_observe') {
      if (!VIEWS.has(args?.action)) throw new Error('remote_support_action_not_allowed');
      requireAuthorized('VIEW');
      const observation = await executor.observe({action:args.action,args:args.args||{},target:args.target});
      if (['CAPTURE_DESKTOP','CAPTURE_WINDOW'].includes(args.action)) {
        const capture = observation?.result;
        if (!capture?.png_path || !capture?.png_sha256) throw new Error('remote_support_capture_unverified');
        const image = await imageLoader(capture.png_path,capture.png_sha256);
        return {content:[
          {type:'text',text:JSON.stringify({action:args.action,sha256:capture.png_sha256,window_target_sha256:observation?.result?.target_identity_sha256||null})},
          {type:'image',data:image.toString('base64'),mimeType:'image/png'},
        ],isError:false};
      }
      // UI Automation can reveal private window titles and control values,
      // and is shared only after local screen-view consent.
      return content(observation);
    }
    if (name === 'support_control') {
      if (!CONTROLS.has(args?.action)) throw new Error('remote_support_action_not_allowed');
      // One visible local CONTROL approval covers this bounded session.
      // NO per-action popups; each act is still independently leased,
      // target-bound, readback-checked and never automatically retried.
      requireAuthorized('CONTROL');
      const effect = await executor.act({
        action:args.action, args:args.args||{},target:args.target,
        agent_id:args.agent_id, task_id:args.task_id,
      },args.context||{});
      return content(effect);
    }
    throw new Error('remote_support_unknown_tool');
  }
  const tools = [
    {name:'support_status',description:'Read session status without starting control or disclosing private data.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'support_start_session',description:'Request one local on-screen approval for up to 60 minutes of VIEW or VIEW+CONTROL. This is the ONLY interactive approval per session; control actions have no further popups.',inputSchema:{type:'object',properties:{
      scope:{type:'string',enum:['VIEW','CONTROL']},
    },required:['scope'],additionalProperties:false}},
    {name:'support_observe',description:'With on-PC view approval, observe windows, UIA, displays or capture a screenshot. May reveal private screen contents.',inputSchema:{type:'object',properties:{
      action:{type:'string',enum:[...VIEWS]},args:{type:'object'},target:{type:'object'},
    },required:['action'],additionalProperties:false}},
    {name:'support_control',description:'During an ACTIVE locally approved CONTROL session and a valid existing computer-authority DB task lease, perform one typed Windows action without a popup. No arbitrary shell.',inputSchema:{type:'object',properties:{
      action:{type:'string',enum:[...CONTROLS]},args:{type:'object'},target:{type:'object'},
      agent_id:{type:'string'},task_id:{type:'string'},context:{type:'object'},
    },required:['action','target','agent_id','task_id','context'],additionalProperties:false}},
    {name:'support_stop',description:'Irrevocably stop all remote actions for this process. Reconnect requires a locally launched new process and approval.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  ];
  async function request(message) {
    if (closed) throw new Error('remote_support_session_closed');
    if (!message || message.jsonrpc !== '2.0' || !['string','number','undefined'].includes(typeof message.id) ||
      typeof message.method !== 'string') throw new Error('remote_support_jsonrpc_invalid');
    if (message.id === undefined) return null;
    const id = message.id;
    if (message.method === 'initialize') return {...result(id),result:{
      protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'metaengine-remote-support',version:'0.1.0'},
    }};
    if (message.method === 'ping') return {...result(id),result:{}};
    if (message.method === 'tools/list') return {...result(id),result:{tools}};
    if (message.method === 'tools/call') {
      try { return {...result(id),result:await tool(message.params?.name,message.params?.arguments||{})}; }
      catch(error) { return {...result(id),result:errorContent(error)}; }
    }
    return {...result(id),error:{code:-32601,message:'Method not found'}};
  }
  async function line(text) {
    let m;
    try { m = JSON.parse(text); } catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
    try { const answer=await request(m);if(answer)send(answer); }
    catch { send({jsonrpc:'2.0',id:m?.id??null,error:{code:-32600,message:'Invalid request'}}); }
  }
  function onData(chunk) {
    buffer+=String(chunk);
    if (buffer.length>MAX_MESSAGE) {buffer='';send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Message too large'}});return;}
    let index;
    while ((index=buffer.indexOf('\n'))>=0) {
      const one=buffer.slice(0,index);buffer=buffer.slice(index+1);
      if (one.trim()) processing=processing.then(()=>line(one),()=>line(one));
    }
  }
  input.on('data',onData);
  return Object.freeze({
    request,tools,
    close:()=>{viewExpires=0;controlExpires=0;sessionId=null;revoked=true;closed=true;input.off('data',onData);},
  });
}

export async function readBoundedCapture(filename,sha256) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error('remote_support_capture_unverified');
  const root = await fs.realpath(path.join(os.tmpdir(),'metaengine-computer-captures'));
  const actual = await fs.realpath(filename);
  const relative = path.relative(root,actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^((?:window|capture)-[a-f0-9-]+\.png)$/i.test(relative)) throw new Error('remote_support_capture_boundary_invalid');
  const info = await fs.lstat(filename);
  if (!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<16||info.size>MAX_IMAGE) throw new Error('remote_support_capture_invalid');
  const bytes=await fs.readFile(filename);
  if (bytes.length!==info.size || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || createHash('sha256').update(bytes).digest('hex')!==sha256) throw new Error('remote_support_capture_unverified');
  // Only remove an exact verified executor-owned temp capture, never arbitrary
  // paths passed through a remote call.
  await fs.unlink(filename);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Explicitly launched by the owner-run tunnel-client; no Browser startup
  // registration, no network listener, no persistent unattended service.
  createRemoteSupportMcp();
}
