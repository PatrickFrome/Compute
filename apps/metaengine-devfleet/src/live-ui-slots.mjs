import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';

export const LIVE_UI_SCHEMA = 'metaengine.devfleet.live-ui.v1';
export const LIVE_UI_ABI = 1;
const MAX_HTML_BYTES = 1024 * 1024;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const shaRe = /^[a-f0-9]{64}$/;
const basename = s => path.basename(s);

async function atomicWrite(target, data) {
  await fs.mkdir(path.dirname(target), { recursive:true });
  const temp = target + '.tmp-' + crypto.randomUUID();
  await fs.writeFile(temp, data, { mode:0o600, flag:'wx' });
  try { await fs.rename(temp, target); }
  catch (error) { await fs.rm(temp, { force:true }).catch(()=>{}); throw error; }
}
function verifyHtml(buf) {
  if (buf.length < 100 || buf.length > MAX_HTML_BYTES) throw new Error('live_ui_size_invalid');
  const html = buf.toString('utf8');
  if (!/<!doctype html>/i.test(html) || !/<title>\s*METAENGINE DevFleet\s*<\/title>/i.test(html))
    throw new Error('live_ui_identity_invalid');
  if (/<\s*(?:iframe|frame|object|embed|base)\b/i.test(html) || /<script\b[^>]*\bsrc\s*=/i.test(html))
    throw new Error('live_ui_external_execution_disallowed');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (scripts.length !== 1 || !/window\.devfleet/.test(scripts[0][1]))
    throw new Error('live_ui_entrypoint_invalid');
  try { new Script(scripts[0][1], { filename:'live-ui-entrypoint.js' }); }
  catch { throw new Error('live_ui_javascript_syntax_invalid'); }
  return html;
}
function slotRef(sha256) {
  if (!shaRe.test(String(sha256||''))) throw new Error('live_ui_hash_invalid');
  return { sha256, file:'slots/' + sha256 + '.html' };
}
function safeRecord(raw) {
  if (!raw || raw.schema !== LIVE_UI_SCHEMA || raw.abi !== LIVE_UI_ABI
      || !Number.isSafeInteger(raw.generation) || raw.generation < 0
      || typeof raw.workspace !== 'string' || !Array.isArray(raw.history)) throw new Error('live_ui_state_invalid');
  for(const ref of [...raw.history, raw.active, raw.staged, raw.pending?.candidate, raw.pending?.previous].filter(Boolean))
    if (!shaRe.test(ref.sha256) || ref.file !== slotRef(ref.sha256).file) throw new Error('live_ui_slot_reference_invalid');
  return raw;
}

export class LiveUiSlots {
  #root;
  #builtin;
  #data;
  #busy=false;
  #blocked=false;
  constructor({ dataDir, builtinHtml }) {
    if (!path.isAbsolute(dataDir) || !path.isAbsolute(builtinHtml)) throw new Error('live_ui_paths_invalid');
    this.#root = path.join(dataDir, 'live-ui');
    this.#builtin = builtinHtml;
    this.#data = {schema:LIVE_UI_SCHEMA,abi:LIVE_UI_ABI,generation:0,workspace:'',active:null,staged:null,
      pending:null,history:[]};
  }
  get builtin() { return this.#builtin; }
  get configured() { return Boolean(this.#data.workspace); }
  get blocked() { return this.#blocked; }
  #stateFile() { return path.join(this.#root, 'state.json'); }
  #slotFile(ref) { return path.join(this.#root,slotRef(ref.sha256).file); }
  async #save() { await atomicWrite(this.#stateFile(),JSON.stringify(this.#data,null,2)+'\n'); }
  async #checkedSlot(ref) {
    if(!ref) return this.#builtin;
    const file=this.#slotFile(ref);
    const buf=await fs.readFile(file);
    if(hash(buf)!==ref.sha256) throw new Error('live_ui_slot_integrity_invalid');
    verifyHtml(buf);
    return file;
  }
  async init() {
    try {
      const raw=JSON.parse(await fs.readFile(this.#stateFile(),'utf8'));
      this.#data=safeRecord(raw);
    } catch(e) {
      if (e.code!=='ENOENT') throw e;
    }
    if (this.#data.pending) {
      // Process loss mid-activation is never interpreted as success.
      this.#blocked=true;
      try { return await this.#checkedSlot(this.#data.pending.previous); }
      catch { return this.#builtin; }
    }
    try { return await this.#checkedSlot(this.#data.active); }
    catch {
      this.#blocked=true;
      return this.#builtin;
    }
  }
  status() {
    return Object.freeze({
      schema:LIVE_UI_SCHEMA,abi:LIVE_UI_ABI,generation:this.#data.generation,
      workspace_attached:Boolean(this.#data.workspace),
      workspace:this.#data.workspace||null,
      active_sha256:this.#data.active?.sha256||null,
      staged_sha256:this.#data.staged?.sha256||null,
      previous_sha256:this.#data.history.at(-1)?.sha256||null,
      pending_activation:Boolean(this.#data.pending),
      state:this.#blocked?'RECONCILIATION_REQUIRED':this.#data.active?'LIVE':'PACKAGED',
      last_known_good_available:!!this.#data.active,
      effect_authority:false,raw_shell_available:false,hosted_provider:false,
    });
  }
  async attach(workspace) {
    if(this.#busy||this.#blocked||this.#data.pending) throw new Error('live_ui_busy_or_blocked');
    if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw new Error('live_ui_workspace_invalid');
    const root=await fs.realpath(workspace);
    // Windows realpath may normalize short names, drive casing and device
    // aliases. Refuse actual filesystem links, not differing path strings.
    const rootEntry=await fs.lstat(path.resolve(workspace));
    if(!rootEntry.isDirectory() || rootEntry.isSymbolicLink())
      throw new Error('live_ui_workspace_link_denied');
    const pkgFile=path.join(root,'package.json');
    const pkg=JSON.parse(await fs.readFile(pkgFile,'utf8'));
    if(pkg.name!=='metaengine-devfleet') throw new Error('live_ui_package_identity_invalid');
    const candidate=path.join(root,'src','index.html');
    const stat=await fs.lstat(candidate);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_HTML_BYTES)throw new Error('live_ui_source_invalid');
    verifyHtml(await fs.readFile(candidate));
    // Choosing the development workspace requires a local, trusted operator
    // through the packaged Dev Console. No GPT page or agent receives this API.
    if(this.#data.workspace&&this.#data.workspace!==root) throw new Error('live_ui_workspace_already_pinned');
    this.#data.workspace=root;
    await this.#save();
    return this.status();
  }
  async stage() {
    if(!this.configured)throw new Error('live_ui_attach_workspace_first');
    if(this.#blocked||this.#busy||this.#data.pending)throw new Error('live_ui_busy_or_blocked');
    this.#busy=true;
    try {
      const file=path.join(this.#data.workspace,'src','index.html');
      const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_HTML_BYTES)
        throw new Error('live_ui_source_invalid');
      const buf=await fs.readFile(file);
      verifyHtml(buf);
      const ref=slotRef(hash(buf));
      const target=this.#slotFile(ref);
      try {
        const existing=await fs.readFile(target);
        if(hash(existing)!==ref.sha256)throw new Error('live_ui_existing_slot_corrupt');
      } catch(error) {
        if(error.code!=='ENOENT')throw error;
        await atomicWrite(target,buf);
      }
      // A verified immutable snapshot is staged; the editable source file is
      // NEVER loaded directly by the Browser.
      this.#data.staged=ref;
      await this.#save();
      return this.status();
    } finally { this.#busy=false; }
  }
  async #switchTo(candidate,activate) {
    if(this.#blocked||this.#data.pending)throw new Error('live_ui_reconciliation_required');
    if(this.#busy) throw new Error('live_ui_activation_busy');
    if(typeof activate!=='function')throw new Error('live_ui_activator_invalid');
    this.#busy=true;
    const previous=this.#data.active;
    try {
      const file=await this.#checkedSlot(candidate);
      this.#data.pending={candidate,previous,generation:this.#data.generation+1};
      await this.#save();
      try { await activate(file); }
      catch {
        // Uncertain activation -> stay blocked until trusted reconciliation.
        this.#blocked=true;
        await activate(await this.#checkedSlot(previous)).catch(()=>{});
        return { ...this.status(),state:'ACTIVATION_AMBIGUOUS',automatic_retry_allowed:false };
      }
      this.#data.active=candidate;
      this.#data.staged=null;
      this.#data.generation+=1;
      this.#data.history=previous?[...this.#data.history,previous].slice(-5):[];
      this.#data.pending=null;
      try { await this.#save(); }
      catch {this.#blocked=true;return {...this.status(),state:'PERSISTENCE_AMBIGUOUS',automatic_retry_allowed:false};}
      return {...this.status(),state:'ACTIVE_CONFIRMED'};
    } finally {this.#busy=false;}
  }
  async activate(onLoad) {
    if(!this.#data.staged)throw new Error('live_ui_no_staged_candidate');
    if(this.#data.staged.sha256===this.#data.active?.sha256)
      throw new Error('live_ui_candidate_already_active');
    return this.#switchTo(this.#data.staged,onLoad);
  }
  async reconcile(reloadAndReadback) {
    if(!this.#blocked && !this.#data.pending) return this.status();
    if(this.#busy) throw new Error('live_ui_reconciliation_busy');
    if(typeof reloadAndReadback!=='function') throw new Error('live_ui_reconciliation_callback_invalid');
    this.#busy=true;
    try {
      const previous=this.#data.pending?.previous||null;
      const page=await this.#checkedSlot(previous);
      const reportedUrl=await reloadAndReadback(page);
      if(reportedUrl!==pathToFileURL(page).href) throw new Error('live_ui_reconciliation_readback_mismatch');
      this.#data.active=previous;
      this.#data.staged=null;
      this.#data.generation=Math.max(this.#data.generation+1,this.#data.pending?.generation||0);
      this.#data.pending=null;
      await this.#save();
      this.#blocked=false;
      return {...this.status(),state:'LAST_GOOD_RESTORED'};
    } finally {this.#busy=false;}
  }
  async rollback(onLoad) {
    if(this.#data.pending||this.#blocked)throw new Error('live_ui_reconciliation_required');
    const previous=this.#data.history.at(-1)||null;
    if(!this.#data.active&&!previous)throw new Error('live_ui_no_active_slot');
    const result=await this.#switchTo(previous,onLoad);
    if(result.state==='ACTIVE_CONFIRMED') {
      // Do not preserve a loop that repeatedly revisits the same slot.
      this.#data.history=this.#data.history.filter(x=>x.sha256!==previous?.sha256);
      await this.#save();
    }
    return result;
  }
}
