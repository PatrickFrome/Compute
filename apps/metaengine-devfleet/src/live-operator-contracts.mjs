import crypto from 'node:crypto';

export const LIVE_CONTROL_SCHEMA = 'metaengine.devfleet.live-control.v1';
export const LIVE_CONTRACT_SCHEMA = 'metaengine.devfleet.operator-contract.v1';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const baseContract = Object.freeze({
  schema: LIVE_CONTRACT_SCHEMA,
  dispatch_enabled: true,
  max_batch_items: 8,
  max_prompt_chars: 12000,
  max_observe_parallelism: 4,
  existing_draft: 'REPLACE_ONLY_AFTER_EXACT_READBACK',
  require_verified_model: false,
});
export function validateLiveContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(baseContract,key)) ||
      Object.keys(baseContract).some(key => !Object.hasOwn(value,key)) ||
      value.schema !== LIVE_CONTRACT_SCHEMA ||
      typeof value.dispatch_enabled !== 'boolean' ||
      !Number.isSafeInteger(value.max_batch_items) || value.max_batch_items < 1 || value.max_batch_items > 8 ||
      !Number.isSafeInteger(value.max_prompt_chars) || value.max_prompt_chars < 1 || value.max_prompt_chars > 12000 ||
      !Number.isSafeInteger(value.max_observe_parallelism) || value.max_observe_parallelism < 1 || value.max_observe_parallelism > 4 ||
      !['DENY_EXISTING_DRAFT','REPLACE_ONLY_AFTER_EXACT_READBACK'].includes(value.existing_draft) ||
      typeof value.require_verified_model !== 'boolean')
    throw Error('live_contract_invalid');
  return Object.freeze(clone(value));
}
const entry = contract => {
  const value=validateLiveContract(contract);
  return { sha256:digest(value),value };
};
const fresh = () => ({
  schema: LIVE_CONTROL_SCHEMA,generation:0,active:entry(baseContract),staged:null,
  previous:null,pending:null,events:[]
});
function validated(raw) {
  if(!raw || raw.schema!==LIVE_CONTROL_SCHEMA || !Number.isSafeInteger(raw.generation) ||
     raw.generation<0 || !Array.isArray(raw.events) || raw.events.length>128)
    throw Error('live_control_state_invalid');
  for(const value of [raw.active,raw.staged,raw.previous].filter(Boolean)) {
    if(!value || typeof value.sha256!=='string' || value.sha256!==entry(value.value).sha256)
      throw Error('live_control_hash_invalid');
  }
  if(!raw.active || (raw.pending && (
    !Number.isSafeInteger(raw.pending.generation) ||
    raw.pending.generation<=raw.generation ||
    !['ACTIVATE','ROLLBACK'].includes(raw.pending.action))))
    throw Error('live_control_pending_invalid');
  return clone(raw);
}
export class LiveOperatorContracts {
  #store;
  #state=fresh();
  #busy=false;
  #fenced=false;
  constructor({store}) {
    if(typeof store?.load!=='function'||typeof store?.save!=='function')
      throw Error('live_control_store_invalid');
    this.#store=store;
  }
  async init() {
    const disk=await this.#store.load();
    if(disk!==null&&disk!==undefined) this.#state=validated(disk);
    this.#fenced=Boolean(this.#state.pending);
    return this.status();
  }
  get contract() {return clone(this.#state.active.value);}
  status() {
    return {schema:LIVE_CONTROL_SCHEMA,generation:this.#state.generation,
      active_sha256:this.#state.active.sha256,staged_sha256:this.#state.staged?.sha256||null,
      previous_sha256:this.#state.previous?.sha256||null,
      state:this.#fenced?'RECONCILIATION_REQUIRED':this.#state.staged?'STAGED':'ACTIVE',
      dispatch_enabled:!this.#fenced && this.#state.active.value.dispatch_enabled,
      effective_contract:this.#fenced?null:this.contract,
      event_count:this.#state.events.length,raw_code_execution:false,
      native_send_authority:false,automatic_retry_allowed:false};
  }
  async #persist() {
    try { await this.#store.save(clone(this.#state)); }
    catch {this.#fenced=true;throw Error('live_control_persistence_ambiguous');}
  }
  async #exclusive(fn) {
    if(this.#busy)throw Error('live_control_busy');
    if(this.#fenced)throw Error('live_control_reconciliation_required');
    this.#busy=true;
    try{return await fn();}finally{this.#busy=false;}
  }
  #expect(generation) {
    if(!Number.isSafeInteger(generation)||generation!==this.#state.generation)
      throw Error('live_control_generation_mismatch');
  }
  #note(action) {
    this.#state.events.push({generation:this.#state.generation,action,sha256:this.#state.active.sha256});
    this.#state.events=this.#state.events.slice(-128);
  }
  async stage({expected_generation,contract}) {
    return this.#exclusive(async()=>{
      this.#expect(expected_generation);
      const staged=entry(contract);
      if(staged.sha256===this.#state.active.sha256)throw Error('live_control_no_change');
      this.#state.staged=staged;
      await this.#persist();
      return this.status();
    });
  }
  async #switch(action,target,expected_generation) {
    return this.#exclusive(async()=>{
      this.#expect(expected_generation);
      if(!target)throw Error('live_control_target_missing');
      // Durable prepare / publish / final receipt: do not erase the pending
      // record after a lost write. A process interruption fences dispatch.
      const previous=this.#state.active;
      this.#state.pending={action,generation:expected_generation+1,
        from:previous.sha256,to:target.sha256};
      await this.#persist();
      this.#state.active=target;
      this.#state.previous=previous;
      this.#state.generation++;
      this.#state.staged=null;
      this.#note(action);
      this.#state.pending=null;
      await this.#persist();
      return this.status();
    });
  }
  activate({expected_generation,expected_sha256}) {
    if(this.#state.staged?.sha256!==expected_sha256)
      throw Error('live_control_staged_sha_mismatch');
    return this.#switch('ACTIVATE',this.#state.staged,expected_generation);
  }
  rollback({expected_generation}) {
    return this.#switch('ROLLBACK',this.#state.previous,expected_generation);
  }
  async reconcile({expected_generation}) {
    if(!this.#fenced)throw Error('live_control_no_reconciliation_required');
    if(this.#busy)throw Error('live_control_busy');
    this.#busy=true;
    try {
      this.#expect(expected_generation);
      // A conservative reset disables dispatch until a new explicit activation.
      // Prior in-flight physical requests are NOT reclassified or replayed.
      this.#state.pending=null;
      this.#state.previous=this.#state.active;
      this.#state.staged=null;
      this.#state.active=entry({...baseContract,dispatch_enabled:false});
      this.#state.generation++;
      this.#note('FENCED_RECONCILIATION');
      await this.#persist();
      this.#fenced=false;
      return this.status();
    } finally {this.#busy=false;}
  }
}
