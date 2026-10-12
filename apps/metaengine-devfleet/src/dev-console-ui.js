'use strict';
const el=id=>document.getElementById(id);
let busy=false;
const verbs=['choose','stage','activate','rollback','reconcile','refresh'];
function setBusy(v){busy=v;for(const id of verbs)el(id).disabled=v;}
async function show(status=null){
  const state=status||await window.devfleetConsole.status();
  el('status').textContent=JSON.stringify(state,null,2);
}
async function invoke(method) {
  if(busy)return;
  setBusy(true);
  try {const result=await window.devfleetConsole[method]();await show(result);}
  catch(error){el('status').textContent='Ошибка: '+String(error?.message||error).slice(0,250);}
  finally {setBusy(false);}
}
for(const id of verbs) {
  el(id).onclick=()=>id==='refresh'?invoke('status'):invoke(id);
}
void show().catch(error=>{el('status').textContent=String(error?.message||error);});
