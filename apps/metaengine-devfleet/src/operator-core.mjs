import crypto from 'node:crypto';
import { runObservationBatch } from './fleet-observation-core.mjs';

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
  #contracts;
  #state = { schema: SCHEMA, sessions: [], requests: [] };
  #busy = false;
  #initialized = false;
  #restoring = false;
  #restorePromise = Promise.resolve();
  #persistenceFenced = false;
  #saveTail = Promise.resolve();
  constructor({ adapter, store, contracts=null }) {
    if (!adapter || !['create','read','send'].every(k => typeof adapter[k] === 'function')
      || !store || typeof store.load !== 'function' || typeof store.save !== 'function')
      throw new Error('operator_dependencies_invalid');
    this.#adapter = adapter;
    this.#store = store;
    this.#contracts = contracts;
  }
  async init({deferRestore=false}={}) {
    if (this.#initialized) {
      if(!deferRestore)await this.#restorePromise;
      return this.snapshot();
    }
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
    this.#restoring = true;
    // RESTORING never reaches the persistence store; it is a live-only truth.
    // Write-ahead request receipts remain untouched, including AMBIGUOUS.
    const sessions = this.#state.sessions;
    for (const tab of sessions) tab.state = 'RESTORING';
    let next = 0;
    const worker = async () => {
      while(next<sessions.length) {
        const tab=sessions[next++];
        try {
          const opened=await this.#adapter.create(tab.tab_id,tab.url);
          // An owned target must reconnect the exact saved conversation.
          // A redirect to ChatGPT's root or another /c/ URL loses that binding.
          if(opened?.tab_id!==tab.tab_id || !ownChatUrl(opened?.url) ||
             ownChatUrl(opened.url).replace(/\/$/,'')!==ownChatUrl(tab.url).replace(/\/$/,''))
            throw Error('restore_readback_invalid');
          tab.state='OPEN';
        } catch {tab.state='RESTORE_BLOCKED';}
      }
    };
    this.#restorePromise=Promise.all(Array.from(
      {length:Math.min(4,sessions.length)},worker))
      .finally(()=>{this.#restoring=false;});
    if(!deferRestore)await this.#restorePromise;
    return this.snapshot();
  }
  async whenRestored() {
    if(!this.#initialized)throw Error('operator_not_initialized');
    await this.#restorePromise;
    return this.snapshot();
  }
  #requireInit() {
    if (!this.#initialized) throw new Error('operator_not_initialized');
    if (this.#restoring) throw new Error('operator_restoring');
  }
  isBusy() { return this.#busy || this.#restoring || this.#persistenceFenced; }
  #policy() {
    if (!this.#contracts) return {
      dispatch_enabled:true,max_batch_items:8,max_prompt_chars:12000,
      max_observe_parallelism:4,existing_draft:'REPLACE_ONLY_AFTER_EXACT_READBACK',
      require_verified_model:false
    };
    if(this.#contracts.status().state==='RECONCILIATION_REQUIRED')
      throw Error('operator_policy_reconciliation_required');
    return this.#contracts.contract;
  }
  receiptSummary() {
    this.#requireInit();
    const counts={SENT:0,AMBIGUOUS:0};
    const blocked_tabs=[];
    for(const r of this.#state.requests) {
      if(r.operation!=='assign')continue;
      if(r.state==='SENT')counts.SENT++;
      if(r.state==='AMBIGUOUS'){
        counts.AMBIGUOUS++;
        if(r.tab_id&&!blocked_tabs.includes(r.tab_id))blocked_tabs.push(r.tab_id);
      }
    }
    return {schema:SCHEMA,counts,blocked_tabs,
      read_only:true,completion_proven:false,automatic_retry_allowed:false,
      authority_effect:false};
  }
  #find(tabId) {
    const validated = validateTab(tabId);
    const s = this.#state.sessions.find(x => x.tab_id === validated);
    if (!s) throw new Error('operator_tab_not_owned');
    return s;
  }
  #requireOpen(tab) {
    if (tab.state !== 'OPEN') throw new Error('operator_tab_not_open');
    return tab;
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
    const snapshot = plain(this.#state);
    const pending = this.#saveTail.then(async () => {
      if (this.#persistenceFenced) throw new Error('operator_persistence_reconciliation_required');
      try { await this.#store.save(snapshot); }
      catch (error) { this.#persistenceFenced = true; throw error; }
    });
    this.#saveTail = pending.catch(() => {});
    await pending;
  }
  async #exclusive(fn) {
    if (this.#persistenceFenced) throw new Error('operator_persistence_reconciliation_required');
    if (this.#busy) throw new Error('operator_effect_in_progress');
    this.#busy = true;
    try { return await fn(); } finally { this.#busy = false; }
  }
  snapshot() {
    if(!this.#initialized)throw Error('operator_not_initialized');
    return { schema: SCHEMA, client: 'METAENGINE_DEVFLEET_STANDALONE',
      bootstrap_state:this.#restoring?'RESTORING':'READY',
      restored_count:this.#state.sessions.filter(x=>x.state==='OPEN').length,
      session_count: this.#state.sessions.length, sessions: this.#state.sessions.map(s => ({
        tab_id: s.tab_id, url: s.url, state: s.state })),
      receipt_summary: {sent:this.#state.requests.filter(x=>x.operation==='assign'&&x.state==='SENT').length,
        ambiguous:this.#state.requests.filter(x=>x.operation==='assign'&&x.state==='AMBIGUOUS').length},
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
      try { await this.#save(); }
      catch {
        log.state = 'AMBIGUOUS';
        log.receipt = { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
          tab_id: tabId, automatic_retry_allowed: false };
      }
      return plain(log.receipt);
    });
  }
  async read(params) {
    this.#requireInit();
    fields(params, ['tab_id','offset','max_chars']);
    const tab = this.#requireOpen(this.#find(params.tab_id));
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
    const tab = this.#requireOpen(this.#find(params.tab_id));
    if(typeof this.#adapter.inspect !== 'function') throw new Error('chat_inspection_unavailable');
    const inspection = await this.#adapter.inspect(tab.tab_id);
    if(inspection?.tab_id !== tab.tab_id || inspection?.authority_effect !== false)
      throw new Error('chat_inspection_unverified');
    return {schema:SCHEMA,state:'INSPECTED',...inspection,authority_effect:false};
  }
  async recover(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#requireOpen(this.#find(params.tab_id));
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
  async batchPoll(params={}) {
    this.#requireInit();
    fields(params,['tab_ids']);
    if(typeof this.#adapter.pollHint!=='function')
      throw Error('operator_event_hints_unavailable');
    const owned=this.#state.sessions.filter(s=>s.state==='OPEN').map(s=>s.tab_id);
    const ids=params.tab_ids===undefined?owned:params.tab_ids;
    if(!Array.isArray(ids) || ids.length<1 || ids.length>16 ||
        new Set(ids).size!==ids.length)
      throw Error('operator_hint_ids_invalid');
    for(const id of ids) {
      validateTab(id);
      if(!owned.includes(id))throw Error('operator_hint_tab_not_owned');
    }
    const hints=new Set(['UNINITIALIZED','DIRTY_HINT','RESCAN_DUE','QUIET_HINT']);
    const records=ids.map(tab_id=>{
      try{
        const value=this.#adapter.pollHint(tab_id);
        if(value?.tab_id!==tab_id || !hints.has(value?.hint) ||
           value.authority_effect!==false ||
           (value.age_ms!==null && (!Number.isSafeInteger(value.age_ms) ||
            value.age_ms<0 || value.age_ms>10000)))
          throw Error('hint_readback_invalid');
        return {tab_id,hint:value.hint,age_ms:value.age_ms,
          authority_effect:false};
      }catch{
        return {tab_id,hint:'UNKNOWN',age_ms:null,authority_effect:false};
      }
    });
    return {schema:'metaengine.devfleet.ax-hints.v1',scope:'READ_ONLY',
      hints_only:true,completion_proven:false,automatic_retry_allowed:false,
      authority_effect:false,records};
  }
  async batchObserve(params={}) {
    this.#requireInit();
    if (typeof this.#adapter.observe!=='function')
      throw new Error('operator_observation_unavailable');
    const policy=this.#policy();
    if(params.parallelism!==undefined && params.parallelism>policy.max_observe_parallelism)
      throw Error('operator_observe_policy_budget');
    return runObservationBatch({
      params,
      ownedTabs:this.#state.sessions.filter(s=>s.state==='OPEN').map(s=>s.tab_id),
      observe:(tabId,signal)=>this.#adapter.observe(tabId,signal)
    });
  }
  async modelProbe(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#requireOpen(this.#find(params.tab_id));
    if(typeof this.#adapter.modelProbe !== 'function')throw new Error('model_probe_not_supported');
    const result=await this.#adapter.modelProbe(tab.tab_id);
    if(result?.tab_id!==tab.tab_id||result?.authority_effect!==false)
      throw new Error('model_probe_unverified');
    return {schema:SCHEMA,state:'MODEL_PROBED',...plain(result),authority_effect:false};
  }
  async inputProbe(params) {
    this.#requireInit();
    fields(params,['tab_id']);
    const tab=this.#requireOpen(this.#find(params.tab_id));
    if(typeof this.#adapter.inputProbe !== 'function')throw new Error('input_probe_not_supported');
    const result=await this.#adapter.inputProbe(tab.tab_id);
    if(result?.tab_id!==tab.tab_id||result?.authority_effect!==false)
      throw new Error('input_probe_unverified');
    return {schema:SCHEMA,state:'INPUT_PROBED',...plain(result),authority_effect:false};
  }
  async #assignLocked(params) {
    this.#requireInit();
    fields(params, ['request_id','tab_id','text']);
    const id = validateId(params.request_id);
    const tab = this.#find(params.tab_id);
    const prompt = params.text;
    const policy=this.#policy();
    if(!policy.dispatch_enabled)throw Error('operator_policy_disarmed');
    if (typeof prompt !== 'string' || !prompt.trim() ||
        prompt.length > policy.max_prompt_chars)
      throw new Error('operator_prompt_invalid');
    const fingerprint = sha(tab.tab_id + '\0' + prompt);
    const prior = this.#prior(id,'assign',fingerprint);
    if (prior) return prior;
    this.#requireOpen(tab);
    if (this.#state.requests.some(r => r.operation === 'assign' &&
      r.state === 'AMBIGUOUS' && r.tab_id === tab.tab_id))
      throw new Error('operator_tab_ambiguous_reconciliation_required');
    if (this.#state.requests.length >= 500) throw new Error('operator_request_history_full');
    {
      // Read-only origin/mode/composer preflight before any write-ahead
      // effect intent. Existing composer drafts may be replaced with the
      // exact new task; historical AMBIGUOUS sends remain fenced.
      // The account owner has selected GPT-6 High, so absence of an
      // accessibility-tree label is not a native Send precondition.
      // Replacing existing composer text is explicitly owner-authorized.
      // Empty composers may not display Send until the prompt is typed.
      if(typeof this.#adapter.inputProbe !== 'function')
        throw new Error('operator_input_preflight_unavailable');
      const pre=await this.#adapter.inputProbe(tab.tab_id);
      if(pre?.tab_id!==tab.tab_id||pre?.authority_effect!==false
        ||pre?.mode!=='CHAT'||pre?.page_failure
        ||pre?.unique_composer!==true)
        throw new Error('operator_chat_input_not_ready');
      if(policy.existing_draft==='DENY_EXISTING_DRAFT' && pre.composer_nonempty===true)
        throw Error('operator_existing_draft_fenced');
      if(policy.require_verified_model) {
        if(typeof this.#adapter.modelProbe!=='function')
          throw Error('operator_model_proof_unavailable');
        const model=await this.#adapter.modelProbe(tab.tab_id);
        if(model?.tab_id!==tab.tab_id||model?.mode!=='CHAT'||
           model?.authority_effect!==false||
           model?.model_selection_proven!==true||
           model?.high_selection_proven!==true)
          throw Error('operator_model_not_proven');
      }
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
      } catch (error) {
        // Allowlisted diagnostic only. Preserve AMBIGUOUS and never leak
        // prompt, page text, bearer token, stack or arbitrary exceptions.
        const raw=String(error?.message||'');
        const allowed=new Set([
          'send_button_not_unique','composer_exact_draft_not_proven',
          'chatgpt_target_changed_before_send','chat_only_send_gate_refused',
          'send_outcome_requires_manual_readback','send_outcome_ambiguous',
          'chatgpt_current_generation_active','send_button_geometry_unverified',
          'send_button_outside_viewport','request_already_in_transcript',
          'chatgpt_origin_changed_after_send','chatgpt_composer_not_unique_or_login_required',
          'chatgpt_target_changed_after_send','send_receipt_marker_missing'
        ]);
        log.receipt = { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
          tab_id: tab.tab_id, error_code: allowed.has(raw)?raw:'send_error_unknown',
          automatic_retry_allowed: false };
      }
      try { await this.#save(); }
      catch {
        log.state = 'AMBIGUOUS';
        log.receipt = { schema: SCHEMA, state: 'AMBIGUOUS', request_id: id,
          tab_id: tab.tab_id, automatic_retry_allowed: false };
      }
      return plain(log.receipt);
    }
  }
  async assign(params) {
    this.#requireInit();
    return this.#exclusive(() => this.#assignLocked(params));
  }

  async reconcileReceipt(params) {
    this.#requireInit();
    fields(params,['request_id','tab_id']);
    const id=validateId(params.request_id);
    const tab=this.#requireOpen(this.#find(params.tab_id));
    if(typeof this.#adapter.probePosted!=='function')
      throw Error('operator_receipt_readback_unavailable');
    return this.#exclusive(async()=>{
      const log=this.#state.requests.find(r=>r.operation==='assign'&&r.request_id===id);
      if(!log||log.tab_id!==tab.tab_id)throw Error('operator_receipt_request_unmatched');
      if(log.state==='SENT')return plain(log.receipt);
      if(log.state!=='AMBIGUOUS')throw Error('operator_receipt_state_invalid');
      let proof;
      try {proof=await this.#adapter.probePosted(tab.tab_id,id);}
      catch {return {schema:SCHEMA,state:'AMBIGUOUS',request_id:id,tab_id:tab.tab_id,
        reconciliation:'READBACK_UNAVAILABLE',automatic_retry_allowed:false};}
      if(proof?.state!=='PROVEN_SENT'||proof?.request_id!==id||
         proof?.tab_id!==tab.tab_id||proof?.authority_effect!==false||
         !ownChatUrl(proof.url)) {
        return {schema:SCHEMA,state:'AMBIGUOUS',request_id:id,tab_id:tab.tab_id,
          reconciliation:'NOT_PROVEN',automatic_retry_allowed:false};
      }
      const priorReceipt=log.receipt;
      const oldState=log.state;
      log.state='SENT';
      log.receipt={schema:SCHEMA,state:'SENT',request_id:id,tab_id:tab.tab_id,
        conversation_url:ownChatUrl(proof.url),
        verified_target:proof.target_id||null,
        proof_sha256:sha([id,tab.tab_id,proof.url,proof.target_id].join(':')),
        reconciliation:'POSTED_MESSAGE_NATIVE_READBACK',
        automatic_retry_allowed:false};
      try {await this.#save();}
      catch {
        log.state=oldState;log.receipt=priorReceipt;
        return {schema:SCHEMA,state:'AMBIGUOUS',request_id:id,tab_id:tab.tab_id,
          reconciliation:'PERSISTENCE_UNPROVEN',automatic_retry_allowed:false};
      }
      return plain(log.receipt);
    });
  }

  async batchAssign(params) {
    this.#requireInit();
    fields(params,['assignments']);
    const items = params.assignments;
    const policy=this.#policy();
    if(!policy.dispatch_enabled)throw Error('operator_policy_disarmed');
    if (!Array.isArray(items) || items.length < 1 || items.length > policy.max_batch_items)
      throw new Error('operator_batch_size_invalid');
    const ids = new Set(), tabs = new Set();
    let totalChars = 0;
    for (const row of items) {
      fields(row,['request_id','tab_id','text']);
      const id = validateId(row.request_id);
      const tab = this.#find(row.tab_id);
      if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > policy.max_prompt_chars)
        throw new Error('operator_prompt_invalid');
      if (ids.has(id) || tabs.has(tab.tab_id))
        throw new Error('operator_batch_duplicate_id_or_tab');
      ids.add(id); tabs.add(tab.tab_id); totalChars += row.text.length;
    }
    if (totalChars > 32000) throw new Error('operator_batch_budget_exceeded');
    return this.#exclusive(async () => {
      const receipts = [];
      let halted = false;
      for (const row of items) {
        if (halted) {
          receipts.push({state:'NOT_ATTEMPTED',request_id:row.request_id,
            tab_id:row.tab_id,automatic_retry_allowed:false});
          continue;
        }
        try {
          const receipt = await this.#assignLocked(row);
          receipts.push(receipt);
          // A send with unknown outcome fences ONLY its own tab. Other
          // distinct owned tabs and request IDs are independent effects.
          // Never retry the AMBIGUOUS tab; keep the batch moving.
        } catch (error) {
          const reason = String(error?.message || 'operator_batch_refused');
          receipts.push({state:'REFUSED',request_id:row.request_id,tab_id:row.tab_id,
            error:/^[a-zA-Z0-9_:-]{1,100}$/.test(reason)?reason:'operator_batch_refused',
            automatic_retry_allowed:false});
          if (this.#persistenceFenced || /persistence_reconciliation|required|request_collision/.test(reason))
            halted = true;
        }
      }
      return {schema:SCHEMA,state:halted?'HALTED':
        receipts.some(x=>x.state==='AMBIGUOUS')?'PARTIAL_AMBIGUOUS':'COMPLETED',receipts,
        sent:receipts.filter(x=>x.state==='SENT').length,
        ambiguous:receipts.filter(x=>x.state==='AMBIGUOUS').length,
        mutation_attempted:receipts.some(x=>['SENT','AMBIGUOUS'].includes(x.state)),
        automatic_retry_allowed:false};
    });
  }

}
