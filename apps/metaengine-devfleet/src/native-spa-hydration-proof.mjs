// Native read-only SPA hydration classification. Inputs come only from one
// in-process owned WebContents, never a page, worker, prompt or API caller.
// A DOM node, HTTP success or PID alone cannot prove app hydration or Send.
export const HYDRATION_SCHEMA='metaengine.devfleet.native-spa-hydration.v1';
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
export function unknownHydration(reason,identity=null) {
  return {schema:HYDRATION_SCHEMA,state:'UNKNOWN',reason,
    identity:identity||null,loading:null,dom:null,network:null,
    hydration_proven:false,send_authorized:false,completion_proven:false,
    read_only:true,authority_effect:false,effect_authority:false};
}
export function classifyNativeSpaHydration(e) {
  const unknown=reason=>unknownHydration(reason);
  if(!e||e.target_stable!==true)return unknown('TARGET_CHANGED_OR_UNBOUND');
  const i=e.identity;
  if(!i||typeof i.process_epoch!=='string'||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(i.process_epoch)||
    typeof i.tab_id!=='string'||!/^tab_[0-9a-f-]{36}$/i.test(i.tab_id)||
    !integer(i.webcontents_id,0x7fffffff)||i.webcontents_id===0||
    i.target_id!=='webcontents:'+i.webcontents_id||
    !integer(i.renderer_pid,0x7fffffff)||i.renderer_pid===0||
    !integer(i.renderer_generation,1e9)||
    !integer(i.navigation_generation,1e9))
    return unknown('NATIVE_PROCESS_IDENTITY_UNKNOWN');
  let u;
  try{u=new URL(e.url);}catch{return unknown('CONVERSATION_ORIGIN_UNKNOWN');}
  if(u.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(u.hostname)||
    u.username||u.password||u.port||u.search||u.hash||
    !/^\/c\/[a-z0-9-]+\/?$/i.test(u.pathname))
    return unknown('CONVERSATION_ORIGIN_UNKNOWN');
  if(e.renderer_crashed===true)return unknown('RENDERER_CRASHED');
  const b=e.before,a=e.after;
  const isFlags=x=>x&&['is_loading','main_frame_loading','waiting_for_response']
    .every(k=>typeof x[k]==='boolean');
  if(!isFlags(b)||!isFlags(a)||typeof e.renderer_crashed!=='boolean')
    return unknown('NATIVE_LOADING_SIGNALS_UNKNOWN');
  const c=e.counts;
  if(!c||!['busy','composer','turns'].every(k=>integer(c[k],2048)))
    return unknown('DOM_COUNTS_UNKNOWN');
  const n=e.network;
  if(!n||typeof n.sampled!=='boolean'||typeof n.overflow!=='boolean'||
     !['requests','failed','blocked','http_4xx','http_5xx']
       .every(k=>integer(n[k],128)))
    return unknown('NETWORK_SAMPLE_MALFORMED');
  const identity={process_epoch:i.process_epoch,tab_id:i.tab_id,
    target_id:i.target_id,webcontents_id:i.webcontents_id,
    renderer_pid:i.renderer_pid,renderer_generation:i.renderer_generation,
    navigation_generation:i.navigation_generation};
  const loading={before:{...b},after:{...a}};
  const dom={busy:c.busy,composer:c.composer,turns:c.turns};
  const network=n.sampled
    ? {coverage:'WINDOW_ONLY',requests:n.requests,failed:n.failed,
       blocked:n.blocked,http_4xx:n.http_4xx,http_5xx:n.http_5xx,
       overflow:n.overflow}
    : {coverage:'UNKNOWN'};
  let reason='UI_NODES_PRESENT_NOT_HYDRATION_PROOF';
  if(n.overflow)reason='NETWORK_EVENT_BUDGET_EXCEEDED';
  else if(b.is_loading||a.is_loading||b.main_frame_loading||a.main_frame_loading)
    reason='NATIVE_DOCUMENT_LOADING';
  else if(b.waiting_for_response||a.waiting_for_response)
    reason='NATIVE_RESPONSE_WAIT';
  else if(c.busy>0)reason='SPA_BUSY_AFTER_DOCUMENT_LOAD';
  else if(n.sampled&&(n.failed>0||n.blocked>0||n.http_5xx>0))
    reason='NETWORK_FAILURE_BUCKET_OBSERVED';
  else if(c.composer>1)reason='COMPOSER_CONFLICT';
  else if(c.composer===0&&c.turns===0)reason='CHAT_BODY_UNMOUNTED';
  return {schema:HYDRATION_SCHEMA,state:'UNKNOWN',reason,identity,loading,dom,network,
    observed_at:typeof e.observed_at==='string'&&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(e.observed_at)
        ?e.observed_at:null,
    hydration_proven:false,send_authorized:false,completion_proven:false,
    read_only:true,authority_effect:false,effect_authority:false};
}
