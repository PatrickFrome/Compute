// Isolated-world relay on Education only. No content script runs on ChatGPT.
(()=>{const origin='https://devfleet-education-web.vercel.app';if(location.origin!==origin||window.top!==window)return;let clickAt=0;
 for(const type of ['click','keydown'])document.addEventListener(type,e=>{if(e.isTrusted)clickAt=Date.now();},true);
 window.addEventListener('message',async e=>{const d=e.data;if(e.source!==window||e.origin!==origin||d?.channel!=='education-pair-request'||!/^\d{1,12}$/.test(String(d.id)))return;
 const p=d.payload;if(!p||!['status','select','open','disconnect','bind'].includes(p.action))return;
 if(['open','disconnect','bind'].includes(p.action)&&Date.now()-clickAt>2000){window.postMessage({channel:'education-pair-response',id:d.id,ok:false,error:'pair_click_required'},origin);return;}
 try{const r=await chrome.runtime.sendMessage({type:'education-pair',payload:p});window.postMessage({channel:'education-pair-response',id:d.id,...r},origin);}catch{window.postMessage({channel:'education-pair-response',id:d.id,ok:false,error:'pair_extension_unavailable'},origin);}});
 chrome.runtime.onMessage.addListener(m=>{if(m?.type==='education-pair-state')window.postMessage({channel:'education-pair-event',payload:m.payload},origin);if(m?.type==='education-pair-help')window.postMessage({channel:'education-pair-help'},origin);});
})();
