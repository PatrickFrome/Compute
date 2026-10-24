'use strict';
// Isolated native-Electron UI smoke: no GPT navigation, no Send, no production profile.
const {app,BrowserWindow,WebContentsView,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const smokeProfile=path.join(os.tmpdir(),'devfleet-education-native-smoke-'+process.pid);
fsSync.mkdirSync(smokeProfile,{recursive:true});
app.setPath('userData',smokeProfile);
async function run(){
  await app.whenReady();
  const {EducationStore}=await import('../src/education-core.mjs');
  const {pathToFileURL}=await import('node:url');
  let state=null;
  const store=new EducationStore({
    load:async()=>state===null?null:structuredClone(state),
    save:async value=>{state=structuredClone(value);}
  });
  await store.init();
  let opened=[];
  let window;
  function trusted(event){
    if(!window||BrowserWindow.fromWebContents(event.sender)!==window
      ||event.senderFrame!==event.sender.mainFrame
      ||event.sender.getURL()!==pathToFileURL(path.join(root,'src','education.html')).href)
      throw Error('smoke_untrusted_sender');
  }
  const wrap=(channel,handler)=>ipcMain.handle(channel,(event,p)=>{trusted(event);return handler(p);});
  wrap('education:snapshot',()=>store.snapshot());
  wrap('education:add-folder',p=>store.addFolder(p));
  wrap('education:rename-folder',p=>store.renameFolder(p));
  wrap('education:bind-chat',p=>store.bindChat(p,opened.map(x=>x.tab_id)));
  wrap('education:submit-answer',p=>store.submitAnswer(p));
  wrap('education:add-note',p=>store.addNote(p));
  wrap('education:add-lab',p=>store.addLabReport(p));
  wrap('devfleet:list',()=>({sessions:opened,session_count:opened.length}));
  wrap('devfleet:create',p=>{
    if(p?.count!==1||typeof p.request_id!=='string')throw Error('smoke_bad_create');
    const tab_id='tab_'+crypto.randomUUID();
    const next={tab_id,state:'OPEN',url:'https://chatgpt.com/'};
    opened.push(next);
    return {state:'CREATED',sessions:[next]};
  });
  wrap('devfleet:select',id=>{
    if(!opened.some(t=>t.tab_id===id))throw Error('smoke_unowned_tab');
    return {tab_id:id,selected:true};
  });
  window=new BrowserWindow({show:false,width:1320,height:820,
    webPreferences:{preload:path.join(root,'src','education-preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const view=new WebContentsView({webPreferences:{
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.contentView.addChildView(view);
  view.setBounds({x:320,y:0,width:700,height:820});
  await window.loadFile(path.join(root,'src','education.html'));
  const dom=await window.webContents.executeJavaScript(`({
    title:document.title,
    folders:document.querySelectorAll('#tree button.folder').length,
    lessons:document.querySelectorAll('#lessons button.lesson-row').length,
    sidebars:!!document.querySelector('.left')&&!!document.querySelector('.right'),
    prompt:document.getElementById('lesson-prompt').value,
    review:document.getElementById('review-count')?.textContent,
    context:document.getElementById('context-details')?.textContent,
    lab:!!document.getElementById('save-lab'),
    error:document.getElementById('status').textContent
  })`);
  if(!dom.title.includes('Education')||dom.folders!==15||dom.lessons!==2||!dom.sidebars
    ||!dom.prompt.includes('преподаватель')||!dom.review.includes('К повторению')
    ||!dom.context.includes('Проверенные ответы')||!dom.lab)
    throw Error('education_dom_smoke_failed '+JSON.stringify(dom));
  // Exercise typed renderer bridge on a real isolated Electron process.
  await window.webContents.executeJavaScript(`window.devfleet.education.addNote({
    lesson_id:'s3-1',text:'Electron smoke: written by the learner'
  })`);
  if(store.snapshot().notes.length!==1)throw Error('education_note_ipc_failed');
  const tab=await window.webContents.executeJavaScript(`window.devfleet.create({
    request_id:crypto.randomUUID(),count:1
  })`);
  if(tab.state!=='CREATED'||tab.sessions.length!==1)throw Error('education_tab_create_failed');
  await window.webContents.executeJavaScript(`window.devfleet.education.bindChat({
    folder_id:'subject-3',tab_id:'${tab.sessions[0].tab_id}',title:'Проверка GPT'
  })`);
  if(store.snapshot().chats.length!==1)throw Error('education_chat_ipc_failed');
  await window.webContents.executeJavaScript(`window.devfleet.education.addLabReport({
    lesson_id:'s3-1',title:'E4 virtual lab',kind:'simulation',observation:'Simulated 12V circuit'
  })`);
  await window.webContents.executeJavaScript(`window.devfleet.education.submitAnswer({
    question_id:'ohm',choice:1
  })`);
  const after=store.snapshot();
  if(after.labs.length!==1||after.labs[0].provenance!=='self_reported_unverified'
    ||after.reviews.length!==1||after.reviews[0].step!==1
    ||after.study_contexts[3].distinct_correct_answers!==1)
    throw Error('education_e4_ipc_or_evidence_failed');
  const result={state:'PASS',schema:'devfleet.education.electron-smoke.v2',
    folders:dom.folders,visible_lessons:dom.lessons,notes:store.snapshot().notes.length,
    bound_chats:store.snapshot().chats.length,
    review_entries:after.reviews.length,practice_questions:after.questions.length,
    self_reported_labs:after.labs.length,
    view_bounds:view.getBounds(),profile_isolated:true,chatgpt_network_used:false};
  console.log(JSON.stringify(result));
  await fs.writeFile(path.join(os.tmpdir(),'devfleet-education-smoke-receipt.json'),JSON.stringify(result,null,2),'utf8');
  window.destroy();
  app.quit();
}
run().catch(async error=>{
  const message=String(error?.stack||error);
  console.error('EDUCATION_SMOKE_FAIL '+message);
  await fs.writeFile(path.join(os.tmpdir(),'devfleet-education-smoke-receipt.json'),
    JSON.stringify({state:'FAIL',error:message.slice(0,3000)},null,2),'utf8').catch(()=>{});
  app.exit(1);
});
