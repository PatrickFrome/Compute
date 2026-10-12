// Pure, bounded ChatGPT model/composer observation predicates.
// Names from page/accessibility trees are untrusted and confer NO authority.
const toName=n=>String(n?.name?.value||'').trim().slice(0,160);
const toRole=n=>String(n?.role?.value||'').toLowerCase();
const prop=(n,name)=>n?.properties?.find?.(x=>x.name===name)?.value?.value;
const high=/^(?:High|\u0412\u044b\u0441\u043e\u043a\u0438\u0439)$/iu;
const gpt6=/^GPT[\s-]?6(?:\.0)?(?:\s+(?:Thinking|Instant))?$/i;
const modelTop=/^(?:ChatGPT(?:\s+(?:GPT[\s-]?\d(?:\.\d+)?))?|\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043c\u043e\u0434\u0435\u043b\u044c ChatGPT|Choose ChatGPT model|Select model)$/iu;
const likely=/GPT(?:[\s-]?\d)?|ChatGPT|High|Thinking|Instant|Medium|Extra High|\u0412\u044b\u0441\u043e\u043a|\u041c\u043e\u0434\u0435\u043b|\u0434\u0443\u043c\u0430\u0442|\u0420\u0430\u0437\u043c\u044b\u0448\u043b/i;
const uiRoles=new Set(['button','menuitem','radio','radiobutton','tab','combobox','option','checkbox','statictext']);
const controlRoles=new Set(['button','menuitem','radio','radiobutton','tab','combobox','option','checkbox']);
export function selectedFlag(n) {
 const checked=prop(n,'checked'),selected=prop(n,'selected'),pressed=prop(n,'pressed');
 return checked===true || selected===true || pressed===true
   || checked==='true'||selected==='true'||pressed==='true';
}
export function modelPickerCandidates(nodes) {
 return (nodes||[]).filter(n=>!n.ignored && Number.isSafeInteger(n.backendDOMNodeId)
   && controlRoles.has(toRole(n)) && modelTop.test(toName(n)))
   .map(n=>({backendDOMNodeId:n.backendDOMNodeId,name:toName(n),role:toRole(n)}));
}
export function boundedModelControls(nodes) {
 return (nodes||[]).filter(n=>!n.ignored && uiRoles.has(toRole(n))
   && (controlRoles.has(toRole(n)) ? likely.test(toName(n))
      : (high.test(toName(n)) || gpt6.test(toName(n))))).slice(0,48)
   .map(n=>({name:toName(n),role:toRole(n),
     selected:selectedFlag(n),backend_node_present:Number.isSafeInteger(n.backendDOMNodeId)}));
}
export function visibleEffort(nodes) {
 const candidates=(nodes||[]).filter(n=>!n.ignored && controlRoles.has(toRole(n))
   && high.test(toName(n)) && Number.isSafeInteger(n.backendDOMNodeId));
 const staticLabels=(nodes||[]).filter(n=>!n.ignored&&toRole(n)==='statictext'&&high.test(toName(n)));
 return {high_control_count:candidates.length,
   high_label_visible:candidates.length===1||(candidates.length===0&&staticLabels.length===1),
   // A page label by itself cannot prove that the High effort is selected.
   high_selection_proven:candidates.length===1 && selectedFlag(candidates[0])};
}
export function gpt6FromControls(controls) {
 const candidates=(controls||[]).filter(n=>controlRoles.has(n.role)&&gpt6.test(n.name));
 return {gpt6_option_count:candidates.length,
    gpt6_selected:candidates.length===1 && candidates[0].selected===true};
}
export function sendControls(nodes) {
 const buttons=(nodes||[]).filter(n=>!n.ignored&&toRole(n)==='button'&&Number.isSafeInteger(n.backendDOMNodeId));
 const send=/^(?:Send|Send message|Send prompt|Send to ChatGPT|\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c(?:\s+\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435|\s+\u0437\u0430\u043f\u0440\u043e\u0441)?)$/iu;
 return buttons.filter(n=>send.test(toName(n)));
}
export function composerControls(nodes) {
 const editable=n=>{
  const v=prop(n,'editable');
  return v===true||['true','plaintext','richtext'].includes(String(v||'').toLowerCase());
 };
 const pool=(nodes||[]).filter(n=>!n.ignored&&Number.isSafeInteger(n.backendDOMNodeId)
   && (toRole(n)==='textbox'||(toRole(n)==='generic'&&editable(n))));
 const recognized=/^(?:Message ChatGPT|Chat with ChatGPT|Ask ChatGPT|\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c ChatGPT|\u0417\u0430\u0434\u0430\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441 ChatGPT|\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 ChatGPT)$/iu;
 const named=pool.filter(n=>recognized.test(toName(n)));
 return named.length===1?named:pool.length===1?pool:[];
}
export function inspectSendSurface(nodes) {
 const composers=composerControls(nodes),send=sendControls(nodes);
 return {composer_count:composers.length,send_button_count:send.length,
   existing_composer_value:composers.length===1?String(composers[0].value?.value||'').slice(0,30):null,
   unique_send:send.length===1,unique_composer:composers.length===1};
}
