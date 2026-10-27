'use strict';
// DOM-only presenter; never receives API credentials or remote HTML.
window.mountEducationLive=function({api,getTopicId,refresh,includeNotebook}){
  const $=id=>document.getElementById(id),drafts=new Map(),pending=new Set();
  let selected=null,view=null,provider={ready:false},generation=0;
  const errors={live_not_connected:'Прямой GPT ещё не подключён. Настрой API; подписка ChatGPT не является API-подключением.',
    live_stale_revision:'Страница уже изменилась. Загружена новая версия; запрос не повторён.',
    live_request_seen:'Этот запрос уже зарегистрирован. Автоматический повтор запрещён.',
    live_topic_busy:'Для этой темы уже выполняется запрос.',live_persistence_fenced:'Не удалось надёжно сохранить журнал. Отправка заблокирована до проверки диска и перезапуска; автоматического повтора нет.',live_capacity:'Достигнут лимит локальной истории. Новые запросы не отправлены.',
    live_api_auth_failed:'API не принял ключ. Проверь подключение в настройках.',
    live_api_rate_or_quota:'API сообщил об ограничении частоты или квоты. Повтор не выполнен.',
    live_api_incomplete:'API вернул незавершённый ответ. Страница не изменена.',
    live_answer_invalid:'Ответ не прошёл проверку структуры. Страница не изменена.',
    live_configuration_consent_required:'Нужны ID модели и согласие с отдельной оплатой API.',
    live_key_file_invalid:'Файл не содержит поддерживаемый формат ключа.',
    live_remote_outcome_unknown:'Не удалось подтвердить результат сетевого запроса. Автоматического повтора нет; возможна тарификация.',
    live_api_rejected:'API отклонил параметры. Проверь доступность выбранной модели и поддержку Structured Outputs.',
    live_secure_storage_unavailable:'Защищённое хранилище ОС недоступно. Ключ не сохранён.'};
  const message=text=>{$('live-notice').textContent=text;};
  const err=e=>{const code=String(e?.message||e).match(/live_[a-z0-9_]+/)?.[0];return errors[code]||'Операция не завершена. Страница не подтверждена как изменённая.';};
  const element=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  function paint(){
    $('live-topic').textContent=view?view.material.title:'Выбери учебную тему';
    $('live-provider').textContent=provider.ready?
      'OpenAI API · '+provider.model+(provider.connection_verified?' · ответ получен':' · настроен, ещё не проверен'):
      'API не подключён · платных запросов нет';
    $('live-version').textContent=view?'Редакция '+view.version+' · изменения GPT не проходят независимую проверку':'';
    const list=$('live-messages');list.replaceChildren();
    for(const turn of view?.turns||[]){const row=element('div','');row.className='live-turn '+turn.role;
      row.append(element('strong',turn.role==='user'?'Ты':'GPT'),element('p',turn.text));list.append(row);}
    if(!view?.turns?.length)list.append(element('small','У каждой темы своя беседа. Материал подставляется автоматически; запрос выполняется только после «Отправить».'));
    $('live-send').disabled=!view||pending.has(selected)||view.pending||view.persistence_fenced||!provider.ready;
    $('live-input').disabled=pending.has(selected)||!!view?.pending||!!view?.persistence_fenced;
    $('live-undo').disabled=!view||!view.can_undo||pending.has(selected)||view.pending||view.persistence_fenced;
    const r=view?.requests?.at(-1);
    if(r?.state==='UNKNOWN')message('Последний запрос не подтверждён; он не будет автоматически повторён.');
    $('live-revisions').replaceChildren();
    for(const r of view?.revisions||[]){$('live-revisions').append(element('div','v'+r.version+' · '+r.summary));}
  }
  async function status(){if(typeof api.liveStatus!=='function')return;
    provider=await api.liveStatus();if(provider.model&&!$('live-model').value)$('live-model').value=provider.model;paint();}
  async function select(id,force=false){
    if(!force&&id===selected)return;
    if(selected)drafts.set(selected,$('live-input').value);
    selected=id;view=null;const token=++generation;
    $('live-input').value=drafts.get(id)||'';message('');paint();
    if(!id||typeof api.liveTopic!=='function')return;
    try{const [topic,p]=await Promise.all([api.liveTopic(id),api.liveStatus()]);
      if(token!==generation)return;view=topic;provider=p;
      if(p.model&&!$('live-model').value)$('live-model').value=p.model;paint();
    }catch(e){if(token===generation)message(err(e));}
  }
  $('live-input').addEventListener('input',()=>{if(selected)drafts.set(selected,$('live-input').value);});
  $('live-send').onclick=async()=>{
    const id=selected,text=$('live-input').value.trim(),revision=view?.revision;
    if(!id||!text||pending.has(id))return;
    const request_id=crypto.randomUUID();pending.add(id);paint();
    message('GPT работает с выбранной темой. Можно открыть другую тему; ответ останется здесь.');
    try{
      const result=await api.liveSend({material_id:id,request_id,text,expected_revision:revision,
        allow_edits:$('live-edit').checked,include_notebook:includeNotebook()});
      drafts.delete(id);if(selected===id)$('live-input').value='';
      await refresh();
      if(selected===id){await select(id,true);message(result.applied?
        'Страница обновлена: '+result.changed_fields.join(', ')+'. Доступна отмена.':
        result.conflict?'Ответ сохранён; страницу не менял, поскольку версия устарела.':'Ответ сохранён. Страница не менялась.');}
    }catch(e){if(selected===id){await select(id,true);message(err(e));}}
    finally{pending.delete(id);paint();}
  };
  $('live-undo').onclick=async()=>{
    const id=selected,revision=view?.revision;if(!view||pending.has(id))return;
    pending.add(id);paint();
    try{await api.liveUndo({material_id:id,expected_revision:revision});await refresh();
      if(selected===id){await select(id,true);message('Предыдущая редакция восстановлена. История беседы сохранена.');}}
    catch(e){if(selected===id)message(err(e));}
    finally{pending.delete(id);paint();}
  };
  $('live-configure').onclick=async()=>{
    try{provider=await api.liveConfigure({model:$('live-model').value.trim(),accept_billing:$('live-billing').checked});
      paint();message(provider.cancelled?'Настройка отменена.':provider.ready?'API настроен. Проверка с моделью произойдёт при отправке твоего сообщения.':'API не подключён.');}
    catch(e){message(err(e));}
  };
  $('live-disconnect').onclick=async()=>{
    try{provider=await api.liveDisconnect();paint();message('Ключ удалён из подключения. Уже отправленный запрос может завершиться.');}
    catch(e){message(err(e));}
  };
  return {select,status,repaint:paint};
};
