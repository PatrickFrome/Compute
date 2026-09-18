import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT=process.cwd();
const source=fs.readFileSync(path.join(ROOT,'coordination/chat-control-plane/extension/secret-vault.js'),'utf8');
const local=new Map();
const idbSecrets=new Map([['pairing_secret','A'.repeat(64)]]);

function storage(){return{
  async get(keys){const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{});const out={};for(const k of names)if(local.has(k))out[k]=local.get(k);return out;},
  async set(obj){for(const [k,v] of Object.entries(obj||{}))local.set(k,v);},
  async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))local.delete(k);}
}}
const indexedDB={open(){
  const req={result:null,error:null,onsuccess:null,onerror:null,onupgradeneeded:null};
  const db={objectStoreNames:{contains:()=>true},createObjectStore(){},transaction(){
    const tx={oncomplete:null,onerror:null,onabort:null,error:null};
    tx.objectStore=()=>({
      get(key){const op={result:idbSecrets.get(key)};setTimeout(()=>tx.oncomplete?.(),0);return op;},
      put(value,key){idbSecrets.set(key,value);const op={result:value};setTimeout(()=>tx.oncomplete?.(),0);return op;}
    });return tx;
  },close(){}};
  req.result=db;setTimeout(()=>{req.onupgradeneeded?.();req.onsuccess?.();},0);return req;
}};

async function load(secret,epoch){
  const context=vm.createContext({console,indexedDB,setTimeout,clearTimeout,chrome:{storage:{local:storage()}},A2_BRIDGE_BOOTSTRAP:{bridgeSecret:secret,pairingEpoch:epoch}});
  context.globalThis=context;
  vm.runInContext(source,context,{filename:'secret-vault.js'});
  await context.A2_SECRET_VAULT_READY;
  return context;
}

const B='B'.repeat(64), C='C'.repeat(64), D='D'.repeat(64);
let ctx=await load(B,'epoch-1');
assert.equal(idbSecrets.get('pairing_secret'),B,'new epoch did not rotate stale vault');
assert.equal(local.get('a2PairingBootstrapEpoch'),'epoch-1');

await ctx.A2_SET_PAIRING_SECRET(C);
assert.equal(idbSecrets.get('pairing_secret'),C,'manual vault update failed');
ctx=await load(B,'epoch-1');
assert.equal(idbSecrets.get('pairing_secret'),C,'same bootstrap epoch overwrote manual credential');

ctx=await load(D,'epoch-2');
assert.equal(idbSecrets.get('pairing_secret'),D,'new bootstrap epoch did not perform explicit rotation');
assert.equal(local.get('a2PairingBootstrapEpoch'),'epoch-2');
assert.equal(await ctx.A2_GET_PAIRING_SECRET(),D);

console.log('a2_v060_pairing_epoch_lab: PASS',{epoch:local.get('a2PairingBootstrapEpoch'),secretLength:idbSecrets.get('pairing_secret').length});
