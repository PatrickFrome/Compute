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
  const {buildEducationHandoff}=await import('../src/education-handoff.mjs');
  const {ALLOWED_RESOURCE_URLS}=await import('../src/education-lesson-depth.mjs');
  const {pathToFileURL}=await import('node:url');
  let state=null;
  const store=new EducationStore({
    load:async()=>state===null?null:structuredClone(state),
    save:async value=>{state=structuredClone(value);}
  });
  await store.init();
  let opened=[],externalLaunches=[],copiedHandoffs=[],openedRefs=[];
  let window,view;
  function trusted(event){
    if(!window||BrowserWindow.fromWebContents(event.sender)!==window
      ||event.senderFrame!==event.sender.mainFrame
      ||event.sender.getURL()!==pathToFileURL(path.join(root,'src','education.html')).href)
      throw Error('smoke_untrusted_sender');
  }
  const wrap=(channel,handler)=>ipcMain.handle(channel,(event,...args)=>{trusted(event);return handler(...args);});
  wrap('education:snapshot',()=>store.snapshot());
  const handoff=(id,opts={})=>buildEducationHandoff(id,store.snapshot().study_contexts,
    store.snapshot().notebook_entries,opts);
  wrap('education:preview-handoff',(id,opts)=>handoff(id,opts));
  wrap('education:copy-handoff',(id,opts)=>{
    const p=handoff(id,opts);copiedHandoffs.push(id);
    return {material_id:id,character_count:p.character_count,copied:true,sent:false};
  });
  wrap('education:launch-external-gpt',(id,opts)=>{
    handoff(id,opts);externalLaunches.push(id);
    return {material_id:id,copied:true,opened:true,sent:false};
  });
  wrap('education:open-reference',url=>{
    if(!ALLOWED_RESOURCE_URLS.includes(url))throw Error('education_reference_not_allowed');
    openedRefs.push(url);return {opened:true};
  });
  wrap('education:chat-health',()=>({state:'NO_NATIVE_TAB',javascript:null}));
  wrap('education:show-material',()=>{
    if(view&&window){try{window.contentView.removeChildView(view);}catch{}}
    return {mode:'study_material',native_chat_visible:false};
  });
  wrap('education:add-folder',p=>store.addFolder(p));
  wrap('education:rename-folder',p=>store.renameFolder(p));
  wrap('education:bind-chat',p=>store.bindChat(p,opened.map(x=>x.tab_id)));
  wrap('education:submit-answer',p=>store.submitAnswer(p));
  wrap('education:add-note',p=>store.addNote(p));
  wrap('education:notebook-add',p=>store.addNotebookEntry(p));
  wrap('education:notebook-edit',p=>store.editNotebookEntry(p));
  wrap('education:notebook-delete',p=>store.deleteNotebookEntry(p));
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
  view=new WebContentsView({webPreferences:{
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.contentView.addChildView(view);
  view.setBounds({x:320,y:0,width:700,height:820});
  await window.loadFile(path.join(root,'src','education.html'));
  const dom=await window.webContents.executeJavaScript(`({
    title:document.title,
    folders:document.querySelectorAll('#tree button.folder').length,
    materials:document.querySelectorAll('#tree button.material-chat').length,
    localMaterial:document.getElementById('material-theory').textContent,
    glossaryCount:document.querySelectorAll('#material-glossary div').length,
    referenceCount:document.querySelectorAll('#material-references button').length,
    notebook:!!document.getElementById('notebook-body'),
    detailLength:document.getElementById('material-extension').textContent.length,
    spotlightLength:document.getElementById('spotlight-text').textContent.length,
    lessons:document.querySelectorAll('#lessons button.lesson-row').length,
    sidebars:!!document.querySelector('.left')&&!!document.querySelector('.right'),
    prompt:document.getElementById('lesson-prompt').value,
    review:document.getElementById('review-count')?.textContent,
    context:document.getElementById('context-details')?.textContent,
    lab:!!document.getElementById('save-lab'),
    error:document.getElementById('status').textContent
  })`);
  if(!dom.title.includes('Education')||dom.folders!==15||dom.materials!==120
    ||dom.localMaterial.length<40||dom.glossaryCount!==4||dom.referenceCount<1
    ||dom.detailLength<100||dom.spotlightLength<300||!dom.notebook||dom.lessons!==2||!dom.sidebars
    ||!dom.prompt.includes('УЧЕБНЫЙ ДИАЛОГ')||!dom.review.includes('К повторению')
    ||!dom.context.includes('Проверенные ответы')||!dom.lab)
    throw Error('education_dom_smoke_failed '+JSON.stringify(dom));
  await window.webContents.executeJavaScript(`(()=>{
    document.getElementById('notebook-title').value='Моя тетрадь напряжения';
    document.getElementById('notebook-body').value='Открытая цепь имеет напряжение';
    document.getElementById('notebook-save').click();
  })()`);
  for(let i=0;i<50&&!store.snapshot().notebook_entries.length;i++)
    await new Promise(resolve=>setTimeout(resolve,20));
  if(store.snapshot().notebook_entries.length!==1
    ||store.snapshot().notebook_entries[0].notebook_key!=='material-03-01')
    throw Error('education_notebook_ui_write_failed');
  for(let i=0;i<100;i++){
    const disabled=await window.webContents.executeJavaScript(`document.getElementById('notebook-save').disabled`);
    if(!disabled)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const changed=await window.webContents.executeJavaScript(`(()=>{
    document.querySelectorAll('#tree button.material-chat')[85].click();
    return {title:document.getElementById('material-title').textContent,
      text:document.getElementById('material-theory').textContent};
  })()`);
  const separateNotebook=await window.webContents.executeJavaScript(`document.getElementById('notebook-count').textContent`);
  if(!separateNotebook.includes('Записей: 0'))throw Error('education_notebook_cross_tab_leak '+JSON.stringify({separateNotebook,changed,entries:store.snapshot().notebook_entries}));
  if(!changed.title.includes('Сварочный аппарат')||changed.text.length<45||opened.length!==0)
    throw Error('education_material_navigation_invalid');
  window.webContents.send('education:external-auth-required',{provider:'Google',source:'embedded_browser_unsupported'});
  await new Promise(resolve=>setTimeout(resolve,60));
  const authNotice=await window.webContents.executeJavaScript(`document.getElementById('embedded-gpt-health').textContent`);
  if(!authNotice.includes('Google OAuth'))throw Error('education_google_auth_notice_missing');
  await window.webContents.executeJavaScript(`document.getElementById('check-embedded-gpt').click()`);
  await new Promise(resolve=>setTimeout(resolve,80));
  const healthMessage=await window.webContents.executeJavaScript(`document.getElementById('embedded-gpt-health').textContent`);
  if(!healthMessage.includes('проверена')&&!healthMessage.includes('Встроенная GPT-вкладка'))
    throw Error('education_native_health_ui_missing');
  await window.webContents.executeJavaScript(`document.getElementById('library-external').click()`);
  for(let i=0;i<30&&!externalLaunches.length;i++)
    await new Promise(resolve=>setTimeout(resolve,20));
  if(externalLaunches.length!==1||externalLaunches[0]!=='material-10-06'
    ||opened.length!==0)throw Error('education_external_handoff_broke_explicitness');
  await window.webContents.executeJavaScript(`document.getElementById('library-copy').click()`);
  for(let i=0;i<30&&!copiedHandoffs.length;i++)
    await new Promise(resolve=>setTimeout(resolve,20));
  if(copiedHandoffs[0]!=='material-10-06')throw Error('education_copy_handoff_failed');
  const note=await window.webContents.executeJavaScript(`window.devfleet.education.addNotebookEntry({
    notebook_key:'material-10-06',title:'Моя сварка',body:'Сначала очищаю волокно'
  })`);
  if(!note?.id||store.snapshot().notebook_entries.length!==2)throw Error('education_notebook_ipc_failed');
  const context=await window.webContents.executeJavaScript(`window.devfleet.education.previewHandoff(
    'material-10-06',{includeNotebook:true})`);
  if(!context.text.includes('Сначала очищаю волокно')||!context.includes_private_notes)
    throw Error('education_notebook_context_sync_failed');
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
    folder_id:'subject-3',tab_id:'${tab.sessions[0].tab_id}',title:'Проверка GPT',
    material_id:'material-03-01'
  })`);
  if(store.snapshot().chats.length!==1
    ||store.snapshot().chats[0].material_id!=='material-03-01')
    throw Error('education_chat_ipc_failed');
  await window.webContents.executeJavaScript(`document.getElementById('library-discuss').click()`);
  for(let i=0;i<30&&!store.snapshot().chats.some(c=>c.material_id==='material-10-06');i++)
    await new Promise(resolve=>setTimeout(resolve,30));
  if(!store.snapshot().chats.some(c=>c.material_id==='material-10-06')||opened.length!==2)
    throw Error('education_material_to_gpt_ui_binding_failed');
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
    folders:dom.folders,seeded_material_chats:dom.materials,
    visible_lessons:dom.lessons,notes:store.snapshot().notes.length,
    bound_chats:store.snapshot().chats.length,
    review_entries:after.reviews.length,practice_questions:after.questions.length,
    domain_glossary_terms:dom.glossaryCount,reference_items:dom.referenceCount,
    external_handoffs:externalLaunches.length,manual_copies:copiedHandoffs.length,
    self_reported_labs:after.labs.length,notebook_entries:after.notebook_entries.length,
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
