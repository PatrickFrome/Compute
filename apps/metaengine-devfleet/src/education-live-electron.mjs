import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, safeStorage, nativeImage } from 'electron';
import {LessonAssetStore,inspectRaster,MAX_IMPORT_BYTES} from './education-assets.mjs';
import { LiveLessonStore, LiveLessonCoordinator } from './education-live-core.mjs';
import { OpenAILessonTransport, parseSelectedKey, validModel } from './education-live-openai.mjs';

// Renderer cannot choose key paths, read credentials, or dispatch arbitrary URLs.
export async function installLiveEducation({ipcMain,authorize,education,dataDir,writeAtomic,window,fetchImpl=fetch,apiDisabled=false}){
  const stateFile=path.join(dataDir,'education-live-state.json');
  const keyFile=path.join(dataDir,'education-openai-key.bin');
  const configFile=path.join(dataDir,'education-openai-config.json');
  const loadJson=async(file,max)=>{try{const stat=await fs.stat(file);if(stat.size>max)throw Error('live_state_too_large');
    return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const disk={load:()=>loadJson(stateFile,20*1024*1024),save:async state=>{
    const json=JSON.stringify(state);if(Buffer.byteLength(json)>20*1024*1024)throw Error('live_capacity');
    await writeAtomic(stateFile,json);
  }};
  const store=new LiveLessonStore(disk);await store.init();
  let credentials=null,configuring=false;
  const safeAvailable=()=>safeStorage.isEncryptionAvailable()
    &&!(process.platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text');
  try{
    const config=await loadJson(configFile,4096);
    if(!apiDisabled&&config?.accept_billing===true&&validModel(config.model)&&safeAvailable()){
      const encrypted=await fs.readFile(keyFile);if(encrypted.length>32768)throw Error('live_key_file_invalid');
      credentials={model:config.model,key:parseSelectedKey(safeStorage.decryptString(encrypted)),accept_billing:true};
    }
  }catch{/* Credentials unavailable -> visibly NOT CONNECTED; never log key material. */}
  const transport=new OpenAILessonTransport({credentials:()=>apiDisabled?null:credentials,fetchImpl});
  const assets=new LessonAssetStore({dataDir,writeAtomic});await assets.init();
  const coordinator=new LiveLessonCoordinator({store,education,transport,assets:async id=>assets.list(id)});
  const register=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{
    authorize(event);
    try{return await fn(...args);}catch(e){throw Error(/^live_[a-z0-9_]{1,80}$/.test(e?.message)?e.message:'live_operation_failed');}
  });
  register('education:live-assets',id=>assets.list(id));
  register('education:live-asset-read',({material_id,asset_id}={})=>assets.read(material_id,asset_id));
  let importing=false;
  register('education:live-import-image',async id=>{
    assets.list(id);if(importing)throw Error('live_image_import_busy');importing=true;
    try{
      const selected=await dialog.showOpenDialog(window(),{title:'Изображение для текущего урока (PNG / JPEG)',properties:['openFile'],filters:[{name:'Изображения',extensions:['png','jpg','jpeg']}]});
      if(selected.canceled||selected.filePaths.length!==1)return {cancelled:true};
      const handle=await fs.open(selected.filePaths[0],'r');let bytes;
      try{const st=await handle.stat();if(!st.isFile()||st.size>MAX_IMPORT_BYTES)throw Error('live_image_invalid');bytes=await handle.readFile();}finally{await handle.close();}
      inspectRaster(bytes);let image=nativeImage.createFromBuffer(bytes);
      if(image.isEmpty())throw Error('live_image_invalid');const size=image.getSize();
      const scale=Math.min(1,2048/Math.max(size.width,size.height));
      if(scale<1)image=image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'best'});
      const png=image.toPNG();
      const asset=await assets.addNormalized(id,png,path.basename(selected.filePaths[0]).slice(0,160));
      return {material_id:id,asset,pixels_sent_to_model:false};
    }finally{importing=false;}
  });
  register('education:live-status',()=>({...transport.status(),api_disabled:apiDisabled}));
  register('education:live-topic',id=>store.topic(id));
  register('education:live-send',p=>{if(apiDisabled)throw Error('live_api_disabled');return coordinator.send(p);});
  register('education:live-undo',p=>store.undo(p));
  register('education:live-configure',async({model,accept_billing}={})=>{
    if(apiDisabled)throw Error('live_api_disabled');
    if(configuring)throw Error('live_configuration_busy');
    if(!validModel(model)||accept_billing!==true)throw Error('live_configuration_consent_required');
    if(!safeAvailable())throw Error('live_secure_storage_unavailable');
    configuring=true;
    try{
      const choice=await dialog.showMessageBox(window(),{type:'question',buttons:['Отмена','Выбрать файл ключа'],
        defaultId:0,cancelId:0,title:'Прямой GPT в учебных темах',
        message:'Подключить официальный OpenAI API?',
        detail:'API оплачивается отдельно от подписки ChatGPT. По нажатию «Отправить» выбранная тема, её история и разрешённые заметки передаются OpenAI. Выбор темы сам по себе не делает платный запрос. Ключ хранится зашифрованным средствами ОС и не передаётся в страницу.'});
      if(choice.response!==1)return {cancelled:true,...transport.status()};
      const selected=await dialog.showOpenDialog(window(),{title:'Выберите файл ключа из защищённой настройки OpenAI',
        properties:['openFile'],filters:[{name:'Файл API-ключа',extensions:['txt','env','json']}]});
      if(selected.canceled||selected.filePaths.length!==1)return {cancelled:true,...transport.status()};
      const handle=await fs.open(selected.filePaths[0],'r');let text;
      try{const st=await handle.stat();if(!st.isFile()||st.size>16384)throw Error('live_key_file_invalid');text=await handle.readFile('utf8');}
      finally{await handle.close();}
      const key=parseSelectedKey(text);text='';
      credentials=null;
      await writeAtomic(configFile,JSON.stringify({accept_billing:false}));
      await writeAtomic(keyFile,safeStorage.encryptString(key));
      await writeAtomic(configFile,JSON.stringify({model,accept_billing:true}));
      credentials={key,model,accept_billing:true};return transport.status();
    }finally{configuring=false;}
  });
  register('education:live-disconnect',async()=>{
    if(configuring)throw Error('live_configuration_busy');
    credentials=null;
    await writeAtomic(configFile,JSON.stringify({accept_billing:false}));
    await fs.rm(keyFile,{force:true});return transport.status();
  });
  return {store,coordinator,transport,assets};
}
