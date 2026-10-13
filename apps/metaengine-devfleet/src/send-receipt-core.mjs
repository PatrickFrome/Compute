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
