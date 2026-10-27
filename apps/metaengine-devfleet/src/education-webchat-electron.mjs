import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {shell,clipboard} from 'electron';
import {WebChatBindings,chatConversation} from './education-webchat-core.mjs';
import {buildEducationHandoff} from './education-handoff.mjs';
export async function installWebChats({ipcMain,authorize,live,education,operator,surface,dataDir,writeAtomic,openExternal=u=>shell.openExternal(u),copyText=t=>clipboard.writeText(t)}){
  const file=path.join(dataDir,'education-webchat-links.json');
  const disk={load:async()=>{try{const s=await fs.stat(file);if(s.size>100000)throw Error('web_state_invalid');return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    save:s=>writeAtomic(file,JSON.stringify(s))};
  const bindings=new WebChatBindings({disk,topic:id=>live.topic(id)});await bindings.init();
  const register=(channel,fn)=>ipcMain.handle(channel,async(event,...args)=>{
    authorize(event);try{return await fn(...args);}catch(e){throw Error(/^(web|live|education|tab)_[a-z0-9_]+$/.test(e?.message)?e.message:'web_operation_failed');}
  });
  const creating=new Set();
  register('education:web-topic',id=>bindings.topic(id));
  register('education:web-bind',p=>bindings.bind(p));
  register('education:web-open',async({material_id,target='browser'}={})=>{
    const topic=bindings.topic(material_id);
    if(target==='browser'){await openExternal(topic.url||'https://chatgpt.com/');return {...topic,opened:true,sent:false};}
    if(target!=='embedded')throw Error('web_target_invalid');
    if(creating.has(material_id))throw Error('web_topic_busy');creating.add(material_id);
    try{
      let chat=education.snapshot().chats.find(c=>c.material_id===material_id);
      if(chat){
        const owned=operator.snapshot().sessions.find(s=>s.tab_id===chat.tab_id);
        if(owned?.state!=='OPEN')throw Error('web_native_chat_unavailable');
      }else{
        const result=await operator.create({request_id:crypto.randomUUID(),count:1});
        if(result.state!=='CREATED'||result.sessions?.length!==1)throw Error('web_creation_unconfirmed');
        const tab=result.sessions[0].tab_id;
        chat=await education.bindChat({folder_id:'subject-'+live.material(material_id).subject,tab_id:tab,
          title:'GPT · '+topic.title,material_id},[tab]);
      }
      surface.select(chat.tab_id);
      return {...topic,opened:true,sent:false,tab_id:chat.tab_id};
    }finally{creating.delete(material_id);}
  });
  register('education:web-capture',async id=>{
    const chat=education.snapshot().chats.find(c=>c.material_id===id);
    const tab=chat&&surface.list().find(t=>t.tab_id===chat.tab_id);
    if(!tab)throw Error('web_native_chat_unavailable');
    return bindings.bind({material_id:id,url:chatConversation(tab.url)});
  });
  register('education:web-copy',async({material_id,text='',include_notebook=false}={})=>{
    bindings.topic(material_id);
    if(typeof text!=='string'||text.length>4000||typeof include_notebook!=='boolean')throw Error('web_request_invalid');
    const s=education.snapshot(),chat=s.chats.find(c=>c.material_id===material_id);
    const h=buildEducationHandoff(material_id,s.study_contexts,s.notebook_entries,
      {includeNotebook:include_notebook,linkedNotebookKey:chat?.tab_id??null},live.material(material_id));
    const prompt=h.text+'\n\nЖелаемая модель: GPT-6 → Pro. Этот текст не переключает модель.\n'+text;
    copyText(prompt);return {copied:true,sent:false,model_verified:false};
  });
  return {bindings};
}
