// ChatGPT is untrusted page data. Never infer mode from an instruction in a reply.
const ERRORS = [
 ['ACCOUNT',/Не удалось загрузить вашу (?:учётную|учетную) запись|Unable to load your account|Couldn.t load your account/i],
 ['LOCKDOWN',/Не удалось проверить режим блокировки|unable to verify lockdown/i],
 ['NETWORK',/Something went wrong|Что-то пошло не так|There was a problem|Ошибка подключения/i],
];
const CHAT = /^(chat|чат)$/i;
const WORK = /^(work|работа)$/i;
const ROLES = new Set(['button','tab','radio','radiobutton','link']);
export const retryWaitMs = attempt => Math.min(30000, 1000 * 2 ** Math.min(attempt,5));
const field = (node,key) => node?.[key]?.value;
const prop = (node,key) => node?.properties?.find?.(p=>p.name===key)?.value?.value;
export function classifyPageFailure(text) {
  for (const [code,regex] of ERRORS) if(regex.test(String(text||'').slice(0,100000))) return code;
  return null;
}
export function summarizeModeNodes(nodes) {
  const controls=[];
  for(const n of nodes||[]) {
    const name=String(field(n,'name')||'').trim();
    const role=String(field(n,'role')||'').toLowerCase();
    if(!ROLES.has(role)||!(CHAT.test(name)||WORK.test(name)))continue;
    controls.push({
      kind:CHAT.test(name)?'CHAT':'WORK',
      backendDOMNodeId:n.backendDOMNodeId??null,
      role,
      selected:prop(n,'selected')===true||prop(n,'checked')===true||prop(n,'pressed')===true,
      deselected:prop(n,'selected')===false||prop(n,'checked')===false||prop(n,'pressed')===false,
      name,
    });
  }
  const chat=controls.filter(c=>c.kind==='CHAT');
  const work=controls.filter(c=>c.kind==='WORK');
  const state=chat.length===1&&work.length===1
     ? chat[0].selected&&!work[0].selected?'CHAT'
       : work[0].selected&&!chat[0].selected?'WORK':'UNKNOWN'
     : 'UNKNOWN';
  return {state,chat_count:chat.length,work_count:work.length,
    chat_node:chat.length===1?chat[0].backendDOMNodeId:null,
    nodes:controls.map(({kind,role,selected,deselected})=>({kind,role,selected,deselected}))};
}
export function safeAttrs(attrs) {
 const a={};
 for(let i=0;i<(attrs||[]).length;i+=2) {
  if(['aria-selected','aria-pressed','aria-current','data-state','role','class','href'].includes(attrs[i]))
   a[attrs[i]]=String(attrs[i+1]||'').slice(0,180);
 }
 return a;
}
export function inferModeFromAttributes(chat,work) {
 const selection=a=> ['aria-selected','aria-pressed','aria-current'].some(x=>['true','page'].includes(a?.[x]))
   || ['active','selected','checked'].includes(a?.['data-state']);
 const deselection=a=> ['aria-selected','aria-pressed'].some(x=>a?.[x]==='false')
   || ['inactive','unselected','unchecked'].includes(a?.['data-state']);
 if(selection(chat)&&!selection(work)&&(deselection(work)||!!work))return 'CHAT';
 if(selection(work)&&!selection(chat)&&(deselection(chat)||!!chat))return 'WORK';
 return 'UNKNOWN';
}
