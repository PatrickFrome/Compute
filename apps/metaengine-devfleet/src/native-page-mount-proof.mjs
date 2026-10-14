// Pure read-only CDP structural evidence reducer.
// No page string, DOM text, URL, or browser output can confer Send authority.
const keys=['main','role_main','user_turn','assistant_turn','composer','article','loading'];
export function summarizeNativePageMount(evidence) {
 const unknown=(reason)=>({schema:'metaengine.devfleet.native-page-mount.v1',
    state:'UNKNOWN',reason,body_mounted:false,send_authorized:false,
    completion_proven:false,effect_authority:false});
 if(!evidence||evidence.stable!==true)return unknown('TARGET_UNSTABLE');
 let u;try{u=new URL(evidence.url);}catch{return unknown('URL_INVALID');}
 if(u.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(u.hostname)
   ||u.search||u.hash||!/^\/c\/[a-z0-9-]+\/?$/i.test(u.pathname))
   return unknown('CONVERSATION_URL_INVALID');
 const counts=evidence.counts;
 if(!counts||keys.some(k=>!Number.isSafeInteger(counts[k])||counts[k]<0||counts[k]>2048))
   return unknown('DOM_COUNTS_UNVERIFIED');
 if(typeof evidence.is_loading!=='boolean')return unknown('LOADING_STATE_UNKNOWN');
 const result={schema:'metaengine.devfleet.native-page-mount.v1',
    state:'UNKNOWN',reason:'BODY_UNMOUNTED_OR_UNVERIFIED',
    counts:Object.fromEntries(keys.map(k=>[k,counts[k]])),is_loading:evidence.is_loading,
    body_mounted:false,send_authorized:false,completion_proven:false,effect_authority:false};
 if(evidence.is_loading){result.reason='RENDERER_LOADING';return result;}
 if(counts.user_turn>0||counts.assistant_turn>0){
   result.state='TURNS_VISIBLE';result.reason='SCOPED_TURNS';
   result.body_mounted=true;return result;
 }
 if(counts.composer===1){
   result.state='COMPOSER_VISIBLE';result.reason='SINGLE_COMPOSER';
   result.body_mounted=true;return result;
 }
 if(counts.composer>1){result.reason='COMPOSER_CONFLICT';return result;}
 if(counts.loading>0){result.reason='PAGE_LOADING_INDICATORS';return result;}
 if(counts.main>0||counts.role_main>0||counts.article>0){
   result.reason='MAIN_CONTAINER_WITHOUT_CHAT_CONTROLS';return result;
 }
 result.reason='SIDEBAR_OR_EMPTY_DOCUMENT';return result;
}
