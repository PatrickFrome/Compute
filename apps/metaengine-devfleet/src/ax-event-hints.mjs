import { performance } from 'node:perf_hooks';

// CDP Accessibility.nodesUpdated/loadComplete are *hints*, not a durable event
// stream. Silence is not proof that ChatGPT or an agent is unchanged.
export class AxEventHints {
  #slots=new Map();
  #clock;
  #quietMs;
  constructor({quietMs=2000,clock=()=>performance.now()}={}) {
    if (!Number.isSafeInteger(quietMs) || quietMs<100 || quietMs>10000 ||
        typeof clock!=='function') throw Error('hint_policy_invalid');
    this.#quietMs=quietMs;this.#clock=clock;
  }
  register(tabId,targetId) {
    if(this.#slots.has(tabId) || !/^webcontents:[1-9][0-9]*$/.test(targetId))
      throw Error('hint_registration_invalid');
    this.#slots.set(tabId,{targetId,sequence:0,dirty:true,baselineAt:null});
  }
  unregister(tabId) {this.#slots.delete(tabId);}
  invalidate(tabId) {
    const row=this.#slots.get(tabId);
    if(!row)return;
    row.sequence=Math.min(Number.MAX_SAFE_INTEGER,row.sequence+1);
    row.dirty=true;
    row.baselineAt=null;
  }
  sequence(tabId) {return this.#slots.get(tabId)?.sequence??null;}
  acknowledge(tabId,targetId,startedSequence) {
    const row=this.#slots.get(tabId);
    if (!row || row.targetId!==targetId ||
        !Number.isSafeInteger(startedSequence) ||
        startedSequence!==row.sequence) return false;
    row.dirty=false;
    row.baselineAt=this.#clock();
    return true;
  }
  poll(tabId,targetId) {
    const row=this.#slots.get(tabId);
    if(!row || row.targetId!==targetId)
      return {hint:'UNINITIALIZED',age_ms:null,authority_effect:false};
    if(row.dirty || row.baselineAt===null)
      return {hint:'DIRTY_HINT',age_ms:null,authority_effect:false};
    const age=this.#clock()-row.baselineAt;
    if(!Number.isFinite(age) || age<0 || age>this.#quietMs)
      return {hint:'RESCAN_DUE',age_ms:null,authority_effect:false};
    return {hint:'QUIET_HINT',age_ms:Math.floor(age),authority_effect:false};
  }
}
