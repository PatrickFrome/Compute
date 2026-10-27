'use strict';
window.mountEducationWorkspace=function({api,getMaterial,refresh,notify}){
  const $=id=>document.getElementById(id),drawer=$('study-drawer'),workspace=document.querySelector('.workspace');
  let opener=null,imageTopic=null,imageGeneration=0,images=[];

  function open(name='notebook',from=null){
    // Native legacy webviews sit above HTML; hide the experimental one before opening a drawer.
    api.showMaterial?.().catch(()=>{});
    opener=from||document.activeElement;drawer.hidden=false;drawer.setAttribute('aria-hidden','false');
    for(const section of ['notebook','progress','settings']){
      $('drawer-'+section).hidden=section!==name;$('tab-'+section).setAttribute('aria-selected',String(section===name));
      $('toggle-'+section).setAttribute('aria-expanded',String(section===name));
    }
    $('tab-'+name).focus();
  }
  function close(){drawer.hidden=true;drawer.setAttribute('aria-hidden','true');for(const section of ['notebook','progress','settings'])$('toggle-'+section).setAttribute('aria-expanded','false');if(opener?.isConnected)opener.focus();}
  for(const name of ['notebook','progress','settings']){
    $('toggle-'+name).onclick=e=>{if(!drawer.hidden&&$('tab-'+name).getAttribute('aria-selected')==='true')close();else open(name,e.currentTarget);};
    $('tab-'+name).onclick=()=>open(name,opener);
  }
  $('close-drawer').onclick=close;
  $('open-chat-settings').onclick=e=>open('settings',e.currentTarget);$('open-note-drawer').onclick=e=>open('notebook',e.currentTarget);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!drawer.hidden){e.preventDefault();close();}
    if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('topic-search').focus();}
  });
  document.querySelectorAll('[data-prompt]').forEach(b=>{b.onclick=()=>{$('live-input').value=b.dataset.prompt;$('live-input').dispatchEvent(new Event('input'));$('live-input').focus();};});
  $('live-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();if(!$('live-send').disabled)$('live-send').click();}});
  let selectedExcerpt='';
  $('lesson-reader').addEventListener('mouseup',()=>{const sel=getSelection();if(sel?.anchorNode&&$('lesson-reader').contains(sel.anchorNode))selectedExcerpt=sel.toString().trim().slice(0,1200);});
  $('ask-about-lesson').onclick=()=>{$('live-input').value=selectedExcerpt?'Объясни этот фрагмент урока понятнее и при необходимости дополни страницу:\n«'+selectedExcerpt+'»':'Объясни мне этот урок по шагам. Начни с проверки базовых знаний.';$('live-input').dispatchEvent(new Event('input'));$('live-input').focus();};
  const splitter=$('lesson-splitter');let dragging=false;
  const resize=y=>{const box=workspace.getBoundingClientRect(),height=Math.min(Math.max(box.bottom-y,232),Math.max(232,box.height-56-200));workspace.style.setProperty('--chat-height',height+'px');splitter.setAttribute('aria-valuenow',String(Math.round(height/box.height*100)));};
  splitter.onpointerdown=e=>{dragging=true;splitter.setPointerCapture(e.pointerId);resize(e.clientY);e.preventDefault();};
  splitter.onpointermove=e=>{if(dragging)resize(e.clientY);};splitter.onpointerup=e=>{dragging=false;splitter.releasePointerCapture(e.pointerId);};splitter.onpointercancel=()=>{dragging=false;};
  splitter.onkeydown=e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')workspace.style.removeProperty('--chat-height');else resize(splitter.getBoundingClientRect().top+(e.key==='ArrowUp'?-28:28));}};
  function filterTree(){
    const q=$('topic-search').value.trim().toLocaleLowerCase('ru-RU');
    const selected=String(document.querySelector('#tree .folder.active')?.dataset.folderId||'');
    for(const row of document.querySelectorAll('#tree button')){
      if(row.classList.contains('folder')){row.hidden=false;row.setAttribute('aria-expanded',String(row.dataset.folderId===selected||!!q));continue;}
      row.hidden=q?!row.textContent.toLocaleLowerCase('ru-RU').includes(q):row.dataset.folderId!==selected;
    }
  }
  $('topic-search').oninput=filterTree;
  function renderAssets(){const host=$('lesson-assets');host.replaceChildren();
    for(const a of images){const b=document.createElement('button');b.className='asset-chip';const label=document.createElement('span');label.textContent='▧ '+a.title;
      const detail=document.createElement('small');detail.textContent=a.width+' × '+a.height+' · вставить через GPT';b.append(label,detail);
      b.onclick=()=>{$('live-input').value='Добавь в страницу изображение из текущей темы: asset_id='+a.id+'. Название: '+a.title+'. Подпись должна описывать название, не выдумывай увиденные детали.';$('live-input').dispatchEvent(new Event('input'));$('live-input').focus();};host.append(b);}
  }
  async function loadImages(id){const token=++imageGeneration;images=[];renderAssets();
    if(typeof api.liveAssets!=='function')return;
    try{const result=await api.liveAssets(id);if(token!==imageGeneration||getMaterial()?.id!==id)return;images=result;renderAssets();}
    catch{if(token===imageGeneration)$('image-import-status').textContent='Хранилище изображений недоступно';}
  }
  $('lesson-add-image').onclick=async()=>{
    const id=getMaterial()?.id;if(!id)return;
    if(typeof api.liveImportImage!=='function'){notify('Импорт изображений доступен в новой версии приложения.');return;}
    $('lesson-add-image').disabled=true;
    try{const result=await api.liveImportImage(id);if(result.cancelled)return;
      if(getMaterial()?.id===id){await loadImages(id);$('image-import-status').textContent='Добавлено. Нажми на изображение, чтобы попросить GPT встроить его.';}
      else notify('Изображение сохранено в исходную тему.');
    }catch(e){notify('Изображение не добавлено. Поддерживаются PNG/JPEG до 8 МБ, без чрезмерного разрешения.');}
    finally{$('lesson-add-image').disabled=false;}
  };
  function update(material,subject){
    $('workspace-current').textContent=subject||material?.title||'Учебный кабинет';filterTree();syncViewport();
    if(material){window.renderEducationModules($('lesson-blocks'),material,{readImage:p=>api.liveAssetRead(p)});
      if(imageTopic!==material.id){imageTopic=material.id;$('image-import-status').textContent='';loadImages(material.id);}}
  }
  let resizeTimer;const syncViewport=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(typeof api.setViewport!=='function')return;const r=$('lesson-reader').getBoundingClientRect();api.setViewport({x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}).catch(()=>{});},40);};
  new ResizeObserver(syncViewport).observe($('lesson-reader'));
  window.addEventListener('resize',syncViewport);
  // Right panel is intentionally closed on every launch, including after reload.
  close();return {open,close,update,filterTree};
};
