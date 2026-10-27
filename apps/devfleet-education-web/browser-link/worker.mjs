import {PairController,ORIGIN,safeError} from './engine.mjs';
const controller=new PairController({tabs:chrome.tabs,local:chrome.storage.local,session:chrome.storage.session,notify:(id,p)=>chrome.tabs.sendMessage(id,{type:'education-pair-state',payload:p}).catch(()=>{})});
const init=controller.init();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message?.type!=='education-pair')return;init.then(()=>controller.request(sender,message.payload)).then(result=>reply({ok:true,result}),e=>reply({ok:false,error:safeError(e)}));return true;});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url)init.then(()=>controller.observe(id,change.url)).catch(()=>{});});
chrome.tabs.onRemoved.addListener(id=>{init.then(()=>controller.removed(id)).catch(()=>{});});
chrome.action.onClicked.addListener(async tab=>{try{if(new URL(tab.url).origin===ORIGIN){await chrome.tabs.sendMessage(tab.id,{type:'education-pair-help'});return;}}catch{}await chrome.tabs.create({url:ORIGIN+'/#/material-03-01',active:true});});
