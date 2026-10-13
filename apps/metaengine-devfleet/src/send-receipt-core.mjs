// Pure, origin-bound receipt predicates for ChatGPT message delivery.
// Page text and AX nodes are UNTRUSTED; this does not grant effect authority.
// A draft containing the marker must never be mistaken for a posted message.
export function receiptMarker(sentText) {
  if(typeof sentText!=='string')return null;
  const m=/\[DevFleet request: ([A-Za-z0-9._:-]{12,100})\]$/.exec(sentText);
  return m?.[1]||null;
}
export function postedMessageObserved({url,composer_value,transcript,request_id,composer_observed}) {
  if(typeof url!=='string'||typeof transcript!=='string'||typeof request_id!=='string')
    return false;
  let u;
  try {u=new URL(url);}catch{return false;}
  if(u.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(u.hostname)
    ||!/^\/c\/[A-Za-z0-9-]+\/?$/.test(u.pathname))return false;
  if(composer_observed!==true||composer_value!==''||!/[A-Za-z0-9._:-]{12,100}/.test(request_id))
    return false;
  return transcript.includes(request_id);
}

/**
 * Stronger reconciler: a marker in the flattened AX transcript is NOT a
 * delivery receipt. Count only scoped, DOM-backed USER turns in the exact
 * owned conversation, and only after the unique composer is empty.
 *
 * The calling native adapter obtains outerHTML by exact CDP DOM selectors
 * [data-message-author-role="user"]. Other page text is never promoted to
 * this input. No missing/contradictory evidence is proof of NOT_SENT.
 */
export function postedUserTurnObserved({
  url,request_id,composer_observed,composer_value,user_turn_html
}) {
  if(typeof request_id!=='string'||!/^[A-Za-z0-9._:-]{12,100}$/.test(request_id) ||
     composer_observed!==true||composer_value!=='' ||
     !Array.isArray(user_turn_html)||user_turn_html.length>256)return false;
  let u;
  try{u=new URL(url);}catch{return false;}
  if(u.protocol!=='https:'||!['chatgpt.com','www.chatgpt.com'].includes(u.hostname) ||
     u.search||u.hash||!/^\/c\/[A-Za-z0-9-]+\/?$/.test(u.pathname))return false;
  const marker='[DevFleet request: '+request_id+']';
  let hits=0;
  for(const html of user_turn_html) {
    if(typeof html!=='string'||html.length>65536)return false;
    const root=html.match(/^\s*<[^>]{1,2048}>/);
    if(!root||!/\bdata-message-author-role\s*=\s*(["'])user\1/i.test(root[0]))
      return false;
    // Drop tags (including attributes) before comparing text. An id in an
    // href/title, assistant response, heading or unsent composer is invalid.
    const text=html.replace(/<!--[^]*?-->/g,'').replace(/<[^>]*>/g,'')
      .replace(/&amp;/g,'&').replace(/&#91;|&lbrack;/gi,'[')
      .replace(/&#93;|&rbrack;/gi,']');
    if(text.includes(marker))hits++;
    if(hits>1)return false;
  }
  return hits===1;
}
