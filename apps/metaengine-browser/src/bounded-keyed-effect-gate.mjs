// One native/browser effect lane per exact tab identity. Never evict an
// unfinished lane: dropping it would allow a second same-tab Send to overtake.
export class BoundedKeyedEffectGate {
  #tails = new Map();
  #depth = new Map();
  #maxKeys;
  #maxPerKey;

  constructor({maxKeys=256,maxPerKey=32}={}) {
    if(!Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>4096
      ||!Number.isSafeInteger(maxPerKey)||maxPerKey<1||maxPerKey>256)
      throw new Error('effect_gate_limits_invalid');
    this.#maxKeys=maxKeys;
    this.#maxPerKey=maxPerKey;
  }

  run(tabId,operation) {
    const key=String(tabId||'');
    if(!key||key.length>256||typeof operation!=='function')
      throw new Error('effect_gate_binding_invalid');
    const prior=this.#tails.get(key);
    if(!prior&&this.#tails.size>=this.#maxKeys)
      throw new Error('effect_gate_key_capacity_exceeded');
    const depth=this.#depth.get(key)||0;
    if(depth>=this.#maxPerKey)
      throw new Error('effect_gate_per_key_capacity_exceeded');
    this.#depth.set(key,depth+1);
    const run=(prior||Promise.resolve()).then(operation,operation);
    const settled=run.then(()=>undefined,()=>undefined);
    this.#tails.set(key,settled);
    void settled.then(()=>{
      const remaining=(this.#depth.get(key)||1)-1;
      if(remaining<=0)this.#depth.delete(key);
      else this.#depth.set(key,remaining);
      if(this.#tails.get(key)===settled)this.#tails.delete(key);
    });
    return run;
  }

  snapshot() {
    return Object.freeze({
      schema:'metaengine.bounded-keyed-effect-gate.v1',
      active_keys:this.#tails.size,
      pending_operations:[...this.#depth.values()].reduce((a,b)=>a+b,0),
      max_keys:this.#maxKeys,max_per_key:this.#maxPerKey,
      authority_effect:false,
    });
  }
}
