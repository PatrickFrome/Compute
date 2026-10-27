import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {WebChatBindings,chatConversation,REQUESTED_MODEL} from '../src/education-webchat-core.mjs';
const disk=()=>{let value=null,broken=false;return {load:async()=>structuredClone(value),save:async v=>{if(broken)throw Error('disk');value=structuredClone(v);},break:()=>{broken=true;},read:()=>value};};
const topic=id=>{if(!['material-03-01','material-11-05'].includes(id))throw Error('live_topic_unknown');return {material:{title:id},revision:'r0'};};
test('Only ordinary canonical ChatGPT conversation links are accepted',()=>{
 assert.equal(chatConversation('https://chatgpt.com/c/01234567-abcd/'),'https://chatgpt.com/c/01234567-abcd');
 for(const bad of ['https://chatgpt.com/','http://chatgpt.com/c/01234567','https://chatgpt.com.evil/x','https://chatgpt.com@evil.com/c/01234567','javascript:alert(1)','https://chatgpt.com/c/01234567?model=pro','https://chatgpt.com/c/01234567#token'])assert.throws(()=>chatConversation(bad),/web_chat_url_invalid/);
});
test('Model request is never represented as actual GPT-6 Pro selection',async()=>{
 const s=new WebChatBindings({disk:disk(),topic});await s.init();const v=s.topic('material-03-01');
 assert.equal(v.requested_model,REQUESTED_MODEL);assert.equal(v.model_verified,false);assert.equal(v.api_disabled,true);assert.equal(v.dynamic_sync,'NOT_CONNECTED');
});
test('Chat links persist and do not leak across lessons',async()=>{
 const d=disk(),s=new WebChatBindings({disk:d,topic});await s.init();await s.bind({material_id:'material-03-01',url:'https://chatgpt.com/c/11111111-abcd'});
 const again=new WebChatBindings({disk:d,topic});await again.init();assert.ok(again.topic('material-03-01').url);assert.equal(again.topic('material-11-05').url,null);
});
test('The same conversation cannot accidentally bind two lessons',async()=>{
 const s=new WebChatBindings({disk:disk(),topic});await s.init();const url='https://chatgpt.com/c/11111111-abcd';await s.bind({material_id:'material-03-01',url});
 await assert.rejects(s.bind({material_id:'material-11-05',url}),/web_duplicate_chat/);
});
test('Invalid topic never writes to a state object',async()=>{
 const d=disk(),s=new WebChatBindings({disk:d,topic});await s.init();await assert.rejects(s.bind({material_id:'__proto__',url:'https://chatgpt.com/c/11111111-abcd'}),/live_topic_unknown/);assert.equal(d.read(),null);
});
test('A failed link write is fenced rather than reported saved',async()=>{
 const d=disk(),s=new WebChatBindings({disk:d,topic});await s.init();d.break();
 await assert.rejects(s.bind({material_id:'material-03-01',url:'https://chatgpt.com/c/11111111-abcd'}),/web_persistence_fenced/);
 assert.equal(s.topic('material-03-01').url,null);
});
test('Production Education explicitly disables the API transport and API configure',async()=>{
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 const electron=await fs.readFile(new URL('../src/education-live-electron.mjs',import.meta.url),'utf8');
 assert.ok(main.includes('apiDisabled:true'));assert.ok(electron.includes('credentials:()=>apiDisabled?null:credentials'));
 assert.ok(electron.includes("if(apiDisabled)throw Error('live_api_disabled')"));
});
test('Ordinary web-chat code cannot create a new API request or assert delivery',async()=>{
 const src=await fs.readFile(new URL('../src/education-webchat-electron.mjs',import.meta.url),'utf8');
 assert.ok(!src.includes('api.openai.com')&&!src.includes('fetch(')&&!src.includes('http.createServer'));
 assert.ok(src.includes('sent:false'));assert.ok(!src.includes('model_verified:true'));
});

test('Subscription UI retries an initially unavailable status handler on the next local refresh',async()=>{
 const vm=await import('node:vm');const source=await fs.readFile(new URL('../src/education-webchat-ui.js',import.meta.url),'utf8');
 const selected=[],window={mountEducationLive:()=>({select:id=>selected.push(id),status:()=>{}})};
 vm.runInNewContext(source,{window});let count=0;
 const ui=window.mountEducationLive({api:{liveStatus:async()=>{if(++count===1)throw Error('not_registered_yet');return {api_disabled:false};}}});
 await ui.select('material-03-01');assert.equal(selected.length,0);
 await ui.select('material-03-01');assert.deepEqual(selected,['material-03-01']);assert.equal(count,2);
});
test('Education IPC is registered before loading its actual HTML page',async()=>{
 const s=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 const page=s.indexOf("if(educationMode)await mainWindow.loadFile(path.join(__dirname,'education.html'))");
 assert.ok(page>s.indexOf("ipcMain.handle('education:snapshot'"));
 assert.ok(page>s.indexOf('await installWebChats('));
});
