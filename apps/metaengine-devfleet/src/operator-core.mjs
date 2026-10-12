import crypto from 'node:crypto';

export const SCHEMA = 'metaengine.devfleet.operator.v1';
const requestRe = /^[A-Za-z0-9._:-]{12,100}$/;
const tabRe = /^tab_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownChatUrl = url => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['chatgpt.com', 'www.chatgpt.com'].includes(u.hostname)
      && (u.pathname === '/' || /^\/c\/[A-Za-z0-9-]+\/?$/.test(u.pathname))
      ? 'https://chatgpt.com' + u.pathname : null;
  } catch { return null; }
};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function validateId(value) {
  if (typeof value !== 'string' || !requestRe.test(value)) throw new Error('request_id_invalid');
  return value;
}
function validateTab(value) {
  if (typeof value !== 'string' || !tabRe.test(value)) throw new Error('tab_id_invalid');
  return value;
}
function fields(value, allow) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !allow.includes(k))) throw new Error('params_invalid');
}
function recordFor(requestId, operation, fingerprint) {
  return { request_id: requestId, operation, fingerprint, state: 'AMBIGUOUS',
    receipt: null, at: new Date().toISOString() };
}

export class DevFleetOperator {
  #adapter;
  #store;
  #state = { schema: SCHEMA, sessions: [], requests: [] };
  #busy = false;
  #initialized = false;
  #persistenceFenced = false;
  constructor({ adapter, store }) {
    if (!adapter || !['create','read','send'].every(k => typeof adapter[k] === 'function')
      || !store || typeof store.load !== 'function' || typeof store.save !== 'function')
      throw new Error('operator_dependencies_invalid');
    this.#adapter = adapter;
    this.#store = store;
  }
  async init() {
    if (this.#initialized) return this.snapshot();
    const disk = await this.#store.load();
    if (disk != null) {
      if (disk.schema !== SCHEMA || !Array.isArray(disk.sessions) || !Array.isArray(disk.requests)
        || disk.sessions.length > 16 || disk.requests.length > 500)
        throw new Error('operator_state_invalid');
      const seen = new Set();
      for (const s of disk.sessions) {
        validateTab(s.tab_id);
        if (seen.has(s.tab_id) || !ownChatUrl(s.url)) throw new Error('operator_state_session_invalid');
        seen.add(s.tab_id);
      }
      this.#state = plain(disk);
    }
    this.#initialized = true;
    for (const s of this.#state.sessions) {
      try { await this.#adapter.create(s.tab_id, s.url); }
      catch { s.state = 'RESTORE_BLOCKED'; }
    }
    return this.snapshot();
  }
  #requireInit() { if (!this.#initialized) throw new Error('operator_not_initialized'); }
  isBusy() { return this.#busy || this.#persistenceFenced; }
  #find(tabId) {
    const validated = validateTab(tabId);
    const s = this.#state.sessions.find(x => x.tab_id === validated);
    if (!s) throw new Error('operator_tab_not_owned');
    return s;
  }
  #prior(id, op, hash) {
    const r = this.#state.requests.find(x => x.request_id === id);
    if (!r) return null;
    if (r.operation !== op || r.fingerprint !== hash) throw new Error('operator_request_collision');
    return plain(r.receipt || { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
      automatic_retry_allowed: false });
  }
  async #save() {
    if (this.#persistenceFenced) throw new Error('operator_persistence_reconciliation_required');
    try { await this.#store.save(plain(this.#state)); }
    catch (error) { this.#persistenceFenced = true; throw error; }
  }
  async #exclusive(fn) {
    if (this.#persistenceFenced) throw new Error('operator_persistence_reconciliation_required');
    if (this.#busy) throw new Error('operator_effect_in_progress');
    this.#busy = true;
    try { return await fn(); } finally { this.#busy = false; }
  }
  snapshot() {
    this.#requireInit();
    return { schema: SCHEMA, client: 'METAENGINE_DEVFLEET_STANDALONE',
      session_count: this.#state.sessions.length, sessions: this.#state.sessions.map(s => ({
        tab_id: s.tab_id, url: s.url, state: s.state })),
      only_actions: ['create','read','assign','close'],
      primary_browser_shared_profile: false,
      hosted_database: false,
      automatic_retry_allowed: false, authority_effect: false };
  }
  async create(params) {
    this.#requireInit();
    fields(params, ['request_id','count']);
    const id = validateId(params.request_id);
    const count = Number(params.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 8) throw new Error('operator_count_invalid');
    const fingerprint = sha('create:' + count);
    const prior = this.#prior(id,'create',fingerprint);
    if (prior) return prior;
    if (this.#state.sessions.length + count > 16) throw new Error('operator_capacity_exceeded');
    return this.#exclusive(async () => {
      if (this.#state.requests.length >= 500) throw new Error('operator_request_history_full');
      const log = recordFor(id, 'create', fingerprint);
      this.#state.requests.push(log);
      await this.#save(); // write-ahead ambiguity fence BEFORE any tab is created
      const result = [];
      for (let i = 0; i < count; i++) {
        const tabId = 'tab_' + crypto.randomUUID();
        try {
          const opened = await this.#adapter.create(tabId, 'https://chatgpt.com/');
          const url = ownChatUrl(opened?.url);
          if (!url || opened?.tab_id !== tabId) throw new Error('create_readback_invalid');
          const entry = { tab_id: tabId, url, state: 'OPEN' };
          this.#state.sessions.push(entry);
          result.push({ ...entry });
          await this.#save();
        } catch {
          log.receipt = { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
            verified_sessions: result, automatic_retry_allowed: false };
          await this.#save().catch(() => {});
          return plain(log.receipt);
        }
      }
      log.state = 'CREATED';
      log.receipt = { schema: SCHEMA, state: 'CREATED', request_id: id,
        sessions: result, automatic_retry_allowed: false };
      await this.#save();
      return plain(log.receipt);
    });
  }
  async closeTab(params) {
    this.#requireInit();
    fields(params, ['request_id','tab_id']);
    const id=validateId(params.request_id);
    const tabId=validateTab(params.tab_id);
    const fingerprint=sha('close:' + tabId);
    const prior=this.#prior(id,'close',fingerprint);
    if(prior) return prior;
    const tab=this.#find(tabId);
    if(this.#state.requests.some(r=>r.operation==='assign' && r.state==='AMBIGUOUS' && r.tab_id===tabId))
      throw new Error('tab_close_blocked_by_ambiguous_send');
    if(this.#state.requests.some(r=>r.operation==='close' && r.state==='AMBIGUOUS' && r.tab_id===tabId))
      throw new Error('tab_close_reconciliation_required');
    if(typeof this.#adapter.closeTab!=='function')throw new Error('tab_close_unavailable');
    return this.#exclusive(async()=>{
      if(this.#state.requests.length>=500)throw new Error('operator_request_history_full');
      const log={...recordFor(id,'close',fingerprint),tab_id:tabId};
      this.#state.requests.push(log);
      await this.#save();
      try {
        const outcome=await this.#adapter.closeTab(tab.tab_id);
        if(outcome?.tab_id!==tabId || outcome?.closed!==true || outcome?.authority_effect!==false)
          throw new Error('tab_close_readback_invalid');
        this.#state.sessions=this.#state.sessions.filter(s=>s.tab_id!==tabId);
        log.state='CLOSED';
        log.receipt={schema:SCHEMA,state:'CLOSED',request_id:id,tab_id:tabId,
          session_count:this.#state.sessions.length,automatic_retry_allowed:false};
      } catch {
        log.receipt={schema:SCHEMA,state:'AMBIGUOUS',request_id:id,tab_id:tabId,
          automatic_retry_allowed:false};
      }
      await this.#save().catch(()=>{});
      return plain(log.receipt);
    });
  }
  async read(params) {
    this.#requireInit();
    fields(params, ['tab_id','offset','max_chars']);
    const tab = this.#find(params.tab_id);
    const offset = params.offset === undefined ? 0 : Number(params.offset);
    const size = params.max_chars === undefined ? 16000 : Number(params.max_chars);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 200000
      || !Number.isSafeInteger(size) || size < 1 || size > 20000)
      throw new Error('operator_read_bounds_invalid');
    const data = await this.#adapter.read(tab.tab_id, offset, size);
    if (data?.tab_id !== tab.tab_id || typeof data.text !== 'string' || data.text.length > size
      || typeof data.total_chars !== 'number' || data.authority_effect !== false)
      throw new Error('operator_readback_invalid');
    const newUrl = ownChatUrl(data.url);
    if (newUrl && newUrl !== tab.url) {
      tab.url = newUrl;
      await this.#save();
    }
    return { schema: SCHEMA, state: 'READ', tab_id: tab.tab_id, url: tab.url,
      text: data.text, offset, total_chars: data.total_chars,
      has_more: Boolean(data.has_more), page_content_untrusted: true,
      automatic_retry_allowed: false, authority_effect: false };
  }
  async inspect(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab = this.#find(params.tab_id);
    if(typeof this.#adapter.inspect !== 'function') throw new Error('chat_inspection_unavailable');
    const inspection = await this.#adapter.inspect(tab.tab_id);
    if(inspection?.tab_id !== tab.tab_id || inspection?.authority_effect !== false)
      throw new Error('chat_inspection_unverified');
    return {schema:SCHEMA,state:'INSPECTED',...inspection,authority_effect:false};
  }
  async recover(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#find(params.tab_id);
    if(this.#state.requests.some(r=>r.operation==='assign'
       && r.state==='AMBIGUOUS' && r.tab_id===tab.tab_id))
      throw new Error('chat_recovery_blocked_by_ambiguous_send');
    if(typeof this.#adapter.recover !== 'function') throw new Error('chat_recovery_unavailable');
    return this.#exclusive(async()=>{
      const result=await this.#adapter.recover(tab.tab_id);
      if(result?.tab_id!==tab.tab_id || !['RECOVERED','BLOCKED','NO_ERROR'].includes(result.state)
          || result.authority_effect!==false)
        throw new Error('chat_recovery_readback_invalid');
      return {schema:SCHEMA,...result,automatic_retry_allowed:false};
    });
  }
  async modelProbe(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#find(params.tab_id);
    if(typeof this.#adapter.modelProbe !== 'function')throw new Error('model_probe_not_supported');
    const result=await this.#adapter.modelProbe(tab.tab_id);
    if(result?.tab_id!==tab.tab_id||result?.authority_effect!==false)
      throw new Error('model_probe_unverified');
    return {schema:SCHEMA,state:'MODEL_PROBED',...plain(result),authority_effect:false};
  }
  async inputProbe(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#find(params.tab_id);
    if(typeof this.#adapter.inputProbe !== 'function')throw new Error('input_probe_not_supported');
    const result=await this.#adapter.inputProbe(tab.tab_id);
    if(result?.tab_id!==tab.tab_id||result?.authority_effect!==false)
      throw new Error('input_probe_unverified');
    return {schema:SCHEMA,state:'INPUT_PROBED',...plain(result),authority_effect:false};
  }
  async assign(params) {
    this.#requireInit();
    fields(params, ['request_id','tab_id','text']);
    const id = validateId(params.request_id);
    const tab = this.#find(params.tab_id);
    const prompt = params.text;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000)
      throw new Error('operator_prompt_invalid');
    const fingerprint = sha(tab.tab_id + '\0' + prompt);
    const prior = this.#prior(id,'assign',fingerprint);
    if (prior) return prior;
    if (this.#state.requests.some(r => r.operation === 'assign' &&
      r.state === 'AMBIGUOUS' && r.tab_id === tab.tab_id))
      throw new Error('operator_tab_ambiguous_reconciliation_required');
    return this.#exclusive(async () => {
      // Read-only preflight before writing an effect intent. Refuse nonempty
      // existing drafts instead of overwriting user/agent work or creating
      // an AMBIGUOUS receipt for a known precondition failure.
      if(typeof this.#adapter.inputProbe !== 'function')
        throw new Error('operator_input_preflight_unavailable');
      const pre=await this.#adapter.inputProbe(tab.tab_id);
      if(pre?.tab_id!==tab.tab_id||pre?.authority_effect!==false
        ||pre?.mode!=='CHAT'||pre?.page_failure
        ||pre?.unique_composer!==true||pre?.unique_send!==true
        ||pre?.composer_nonempty!==false)
        throw new Error('operator_chat_input_not_ready_or_draft_present');
      const log = { ...recordFor(id,'assign',fingerprint), tab_id: tab.tab_id };
      this.#state.requests.push(log);
      await this.#save(); // never repeat a send after an uncertain OS/network outcome
      try {
        const sentText = prompt + '\n\n[DevFleet request: ' + id + ']';
        const outcome = await this.#adapter.send(tab.tab_id, sentText);
        if (outcome?.tab_id !== tab.tab_id || outcome?.state !== 'PROVEN_SENT'
          || !ownChatUrl(outcome.url)) throw new Error('send_outcome_ambiguous');
        tab.url = ownChatUrl(outcome.url);
        log.state = 'SENT';
        log.receipt = { schema: SCHEMA, state: 'SENT', request_id: id,
          tab_id: tab.tab_id, conversation_url: tab.url, prompt_sha256: sha(prompt),
          automatic_retry_allowed: false };
      } catch {
        log.receipt = { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
          tab_id: tab.tab_id, automatic_retry_allowed: false };
      }
      await this.#save().catch(() => {});
      return plain(log.receipt);
    });
  }
}
