'use strict';
// Ordinary ChatGPT websites are not API sessions. Never label copied text SENT.
(function(){const mountApi=window.mountEducationLive;
  function mountWeb({api,refresh,includeNotebook}){
    const $=id=>document.getElementById(id);let selected=null,view=null,seq=0,embedded=false;
    const drafts=new Map();const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    const notice=s=>{$('live-notice').textContent=s;};
    $('api-settings').hidden=true;
    $('live-provider').textContent='Обычный ChatGPT · требуется GPT-6 → Pro · API выключен';
    $('live-send').textContent='Скопировать и открыть ↗';
    $('live-edit').checked=false;$('live-edit').disabled=true;
    $('live-input').placeholder='Вопрос к ChatGPT: текст и урок копируются, отправка выполняется в обычном чате';
    const head=$('live-tutor').querySelector('.chat-head');
    const native=el('button','Внутри урока');native.id='web-native-open';native.className='quiet';native.style.whiteSpace='nowrap';head.append(native);
    const outside=$('open-chat-settings');outside.textContent='ChatGPT ↗';outside.title='Открыть обычный ChatGPT в браузере';
    const hide=el('button','×');hide.className='quiet';hide.title='Скрыть встроенный чат';hide.setAttribute('aria-label','Скрыть встроенный чат');head.append(hide);
    const panel=el('div');panel.style.cssText='display:grid;gap:10px;padding:8px;';
    panel.append(el('p','Для этой темы сохраняется отдельная ссылка на обычную беседу ChatGPT. Модель выбирается в самом ChatGPT: GPT-6 → Pro. API-запросов нет.'));
    const row=el('div');row.style.cssText='display:flex;gap:8px;';const url=el('input');url.id='web-conversation-url';url.placeholder='https://chatgpt.com/c/…';url.setAttribute('aria-label','Ссылка на обычный чат этой темы');url.style.cssText='flex:1;min-width:0;';
    const bind=el('button','Привязать');row.append(url,bind);panel.append(row);
    panel.append(el('small','Автоматическое чтение ответов и изменение урока из веб-чата ещё не подключены. Существующие уроки, модули, тетради и откат сохранены.'));
    function geometry(){if(!embedded)return;const r=$('live-messages').getBoundingClientRect();
      api.setViewport({x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}).catch(()=>{});}
    const observer=new ResizeObserver(geometry);observer.observe($('live-messages'));
    async function conceal(){embedded=false;document.body.dataset.webEmbedded='false';await api.showMaterial();$('live-messages').replaceChildren(panel);}
    function paint(){ $('live-topic').textContent=view?.title||'Выбери тему';$('live-version').textContent='GPT-6 Pro: выбор в ChatGPT пока не подтверждён';
      url.value=view?.url||'';$('live-send').disabled=!selected;$('live-undo').disabled=!view?.can_undo;
      if(!embedded)$('live-messages').replaceChildren(panel);
    }
    async function select(id,force=false){if(id===selected&&!force)return;if(selected)drafts.set(selected,$('live-input').value);
      selected=id;view=null;const token=++seq;await conceal();$('live-input').value=drafts.get(id)||'';paint();if(!id)return;
      try{const [s,t]=await Promise.all([api.webTopic(id),api.liveTopic(id)]);if(token!==seq)return;view={...s,can_undo:t.can_undo,revision:t.revision};paint();}
      catch{if(token===seq)notice('Не удалось загрузить привязку беседы. API не используется.');}}
    native.onclick=async()=>{const id=selected;if(!id)return;native.disabled=true;
      try{const result=await api.webOpen({material_id:id,target:'embedded'});if(selected!==id){await api.showMaterial();return;}
        embedded=true;document.body.dataset.webEmbedded='true';geometry();notice('Открыт настоящий сайт ChatGPT. Для входа через Google используй обычный браузер. Выбери GPT-6 → Pro в меню сайта.');}
      catch{notice('Встроенная беседа не открыта. Используй «В браузере»; запрос не повторён автоматически.');}
      finally{native.disabled=false;}};
    hide.onclick=()=>conceal();outside.onclick=async()=>{if(selected){await conceal();await api.webOpen({material_id:selected,target:'browser'});notice('Открыт обычный ChatGPT. Модель пока не подтверждена.');}};
    bind.onclick=async()=>{try{await api.webBind({material_id:selected,url:url.value.trim()});await select(selected,true);notice('Ссылка сохранена только для этой темы.');}catch{notice('Нужна уникальная ссылка https://chatgpt.com/c/… без параметров.');}};
    $('live-input').oninput=()=>{if(selected)drafts.set(selected,$('live-input').value);};
    $('live-send').onclick=async()=>{if(!selected)return;const id=selected;
      try{await api.webCopy({material_id:id,text:$('live-input').value,include_notebook:includeNotebook()});await api.webOpen({material_id:id,target:'browser'});
        notice('Урок и вопрос скопированы. Вставь Ctrl+V в обычный чат и отправь. Сообщение автоматически НЕ отправлено.');}
      catch{notice('Открытие/копирование не завершено. API не использовался.');}};
    $('live-undo').onclick=async()=>{if(!view?.can_undo)return;const id=selected;try{await api.liveUndo({material_id:id,expected_revision:view.revision});await refresh();await select(id,true);}catch{notice('Откат не выполнен: обнови страницу.');}};
    $('live-configure').disabled=true;$('live-disconnect').hidden=true;
    return {select,status:async()=>paint()};
  }
  window.mountEducationLive=function(opts){let instance=null,lastId=null,connecting=null;
    function ensure(){if(instance)return Promise.resolve(instance);if(connecting)return connecting;
      connecting=opts.api.liveStatus().then(s=>{instance=s.api_disabled?mountWeb(opts):mountApi(opts);return instance;}).catch(()=>null).finally(()=>{connecting=null;});return connecting;}
    return {select:async(id,force)=>{lastId=id;const active=await ensure();if(lastId===id)return active?.select(id,force);},status:async()=>{const active=await ensure();return active?.status();}};};
})();
