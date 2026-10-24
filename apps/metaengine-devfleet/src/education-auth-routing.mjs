export function isGoogleEmbeddedAuthorization(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&parsed.hostname==='accounts.google.com';
  }catch{return false;}
}
// Do not pass the embedded OAuth URL, state, tokens, or query parameters to the
// browser. Open only the official ChatGPT root and let its regular-browser
// sign-in complete there.
export const SAFE_EXTERNAL_CHATGPT_URL='https://chatgpt.com/';
