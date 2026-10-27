import {emptyState,validateState,clone,fail} from './core.mjs';
const DB='devfleet-education-web-v1',KEY='state';
let db;
export async function openStore(){if(!globalThis.indexedDB)fail('Браузерное хранилище недоступно');db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('journal');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Закрой другую вкладку сайта и повтори'));});db.onversionchange=()=>db.close();return loadState();}
export async function loadState(){return new Promise((resolve,reject)=>{const tx=db.transaction('journal','readonly');const r=tx.objectStore('journal').get(KEY);r.onsuccess=()=>{try{resolve(validateState(r.result||emptyState()));}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
export function mutate(fn){return new Promise((resolve,reject)=>{const tx=db.transaction('journal','readwrite');const store=tx.objectStore('journal');let next,error;
 const req=store.get(KEY);req.onsuccess=()=>{try{const current=validateState(req.result||emptyState());next=fn(clone(current))||current;next.seq=current.seq+1;validateState(next);store.put(next,KEY);}catch(e){error=e;tx.abort();}};
 tx.oncomplete=()=>resolve(clone(next));tx.onerror=()=>reject(error||tx.error||Error('Не удалось сохранить изменения'));tx.onabort=()=>reject(error||tx.error||Error('Сохранение отменено'));
 });}
export function replaceState(next){return mutate(()=>clone(next));}
