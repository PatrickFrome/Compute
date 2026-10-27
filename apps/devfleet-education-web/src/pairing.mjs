const pending=new Map();let serial=0;
export const pairErrors={
 pair_chrome_155_required:'Для двух страниц рядом нужен Chrome 155 или новее.',
 pair_click_required:'Нажми кнопку ещё раз: открытие разрешается только твоим действием.',
 pair_use_normal_unpinned_tab:'Открой урок в обычной незакреплённой вкладке Chrome.',
 pair_existing_split_not_owned:'Эта вкладка уже находится в другой паре. Сначала разъедини её средствами Chrome.',
 pair_chat_changed_manually:'В этой вкладке вручную выбрана другая беседа. Закрой только эту вкладку ChatGPT и снова открой чат урока.',
 pair_chat_moved:'Вкладка беседы перенесена в другое окно. Верни её или закрой и снова открой чат урока.',
 pair_creation_unconfirmed:'Создание вкладки не подтверждено. Автоматического повтора нет; проверь вкладки браузера.',
 pair_open_tab_limit:'Открыто 24 чата. Закрой ненужные вкладки ChatGPT — беседы останутся в аккаунте.',
 pair_binding_conflict:'Привязки сайта и расширения различаются. Сохрани нужную ссылку через меню «Привязать беседу».',
 pair_chat_already_bound:'Эта беседа уже привязана к другой теме.',
 pair_close_topic_before_rebinding:'Закрой связанную вкладку ChatGPT перед изменением привязки.',
 pair_invalid_chat:'Нужна ссылка https://chatgpt.com/c/… без параметров.',
 pair_extension_unavailable:'Расширение ещё не подключено. Обнови страницу после установки.',
 pair_storage_failed:'Не удалось сохранить привязку. Операция остановлена.',
 pair_chat_in_another_split:'Беседа уже в другой паре вкладок. Сначала разъедини её.'
};
export function pairMessage(error){return pairErrors[error]||'Не удалось открыть беседу рядом. Существующие чаты сохранены.';}
export function createPairing({onState,onHelp}){
 let current=null,info=null;
 window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin)return;const d=e.data;
  if(d?.channel==='education-pair-response'){const p=pending.get(d.id);if(!p)return;clearTimeout(p.timer);pending.delete(d.id);d.ok?p.resolve(d.result):p.reject(Error(d.error));}
  if(d?.channel==='education-pair-event'&&d.payload?.topic===current){info=d.payload;onState(info);}
  if(d?.channel==='education-pair-help')onHelp();
 });
 function request(payload,timeout=7000){return new Promise((resolve,reject)=>{const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(Error('pair_extension_unavailable'));},timeout);pending.set(id,{resolve,reject,timer});window.postMessage({channel:'education-pair-request',id,payload},location.origin);});}
 return {
  get info(){return info;},
  async probe(topic){const r=await request({action:'status',topic},1000);if(topic===current){info=r;onState(r);}return r;},
  async select(topic,url){current=topic;info=null;const captured=topic;try{const s=await request({action:'status',topic},650);if(current!==captured)return;info=s;onState(s);if(s.enabled){const r=await request({action:'select',topic,url});if(current===captured&&!r.superseded){info=r;onState(r);}}}catch(e){if(current===captured){info=null;onState({topic,available:false,error:e.message});}}},
  async open(topic,url){const r=await request({action:'open',topic,url});if(topic===current){info=r;onState(r);}return r;},
  async bind(topic,url){if(!info)return;const r=await request({action:'bind',topic,url});if(topic===current){info=r;onState(r);}return r;},
  async disconnect(topic){const r=await request({action:'disconnect',topic});if(topic===current){info=r;onState(r);}return r;}
 };
}
