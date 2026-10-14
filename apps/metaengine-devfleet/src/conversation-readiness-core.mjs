
/** Pure fail-closed renderer observation. URL != mounted conversation. */
export function classifyConversationSurface({url,composer_count=0,turn_count=null,generation_active=false}) {
 let parsed;
 try{parsed=new URL(url);}catch{return {state:'UNKNOWN',reason:'URL_INVALID'};}
 if(parsed.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(parsed.hostname))
   return {state:'UNKNOWN',reason:'ORIGIN_MISMATCH'};
 if(!/^\/c\/[A-Za-z0-9-]+\/?$/.test(parsed.pathname) || parsed.search || parsed.hash)
   return {state:'UNKNOWN',reason:'CONVERSATION_NOT_BOUND'};
 if(composer_count!==0 && composer_count!==1)
   return {state:'UNKNOWN',reason:'COMPOSER_CONFLICT'};
 if(generation_active===true)return {state:'CONTROL_VISIBLE',reason:'GENERATION_CONTROL'};
 if(composer_count===1)return {state:'CONTROL_VISIBLE',reason:'COMPOSER_CONTROL'};
 if(Number.isSafeInteger(turn_count) && turn_count>0)
   return {state:'TURNS_VISIBLE',reason:'SCOPED_TURNS'};
 return {state:'UNKNOWN',reason:'BODY_UNMOUNTED_OR_UNVERIFIED'};
}
/** After one physical Send the owner URL may transition / -> /c/: never
 * issue another Send, never treat same-origin transitional route as delivery. */
export function classifyPostSendNavigation(url) {
 let u;try{u=new URL(url);}catch{return 'UNTRUSTED';}
 if(u.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(u.hostname))
   return 'UNTRUSTED';
 return /^\/c\/[A-Za-z0-9-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash
   ? 'CONVERSATION' : 'SAME_ORIGIN_TRANSITION';
}
