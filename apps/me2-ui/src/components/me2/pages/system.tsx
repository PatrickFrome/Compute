"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useMe2,PAGES} from '@/components/me2/store';
import {useClientRuntimeStatus,refreshClientRuntimeStatus} from '@/hooks/use-client-runtime-status';
import {capabilityLabel} from '@/lib/client-readiness-labels';
import {InterruptedSetupRecovery} from '@/components/me2/interrupted-setup-recovery';

type Guardian={schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1';state:string;reason:string;ready:boolean;
  guardian_service_ready?:boolean;owner_binding_proven?:boolean;device_binding_proven?:boolean;package_version?:string;source_head?:string;authority_effect:false};
type Repository={schema:'metaengine.github-repository-connection.v1';state:string;repository:string|null;account_login:string|null;
  authenticated:boolean;repository_access_verified:boolean;can_push:boolean;authority_effect:false};
type Chat={schema:'metaengine.github-chat-relay.v1';state:string;repository?:string;issue_number?:number;reason?:string;authority_effect?:false};
type Bridge={guardianStatus?:()=>Promise<Guardian>;activateGuardian?:()=>Promise<Guardian>;
  githubRepositoryStatus?:()=>Promise<Repository>;connectGithubRepository?:()=>Promise<Repository>;
  githubChatStatus?:()=>Promise<Chat>;connectGithubChat?:()=>Promise<Chat>;disconnectGithubChat?:()=>Promise<Chat>};
const bridge=()=>(window as Window&{metaengineClient?:Bridge}).metaengineClient;
const button='min-h-9 rounded border border-zinc-700 px-3 text-sm disabled:opacity-40';

export function SystemPage(){
  const setPage=useMe2(state=>state.setPage),runtime=useClientRuntimeStatus(),work=runtime.readback?.work;
  const [guardian,setGuardian]=useState<Guardian|null>(null),[repository,setRepository]=useState<Repository|null>(null),[chat,setChat]=useState<Chat|null>(null);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const mounted=useRef(false),flight=useRef(false);
  const read=useCallback(async()=>{
    if(flight.current)return;flight.current=true;if(mounted.current)setBusy('read');
    try{const native=bridge();const [g,r,c]=await Promise.allSettled([native?.guardianStatus?.(),native?.githubRepositoryStatus?.(),native?.githubChatStatus?.()]);
      if(!mounted.current)return;
      setGuardian(g.status==='fulfilled'&&g.value?.schema==='metaengine.browser-guardian.machine-bootstrap-launcher.v1'&&g.value.authority_effect===false?g.value:null);
      setRepository(r.status==='fulfilled'&&r.value?.schema==='metaengine.github-repository-connection.v1'&&r.value.authority_effect===false
        &&(r.value.state!=='CONNECTED'||r.value.authenticated&&r.value.repository_access_verified&&r.value.account_login&&r.value.repository)?r.value:null);
      setChat(c.status==='fulfilled'&&c.value?.schema==='metaengine.github-chat-relay.v1'?c.value:null);
    }finally{flight.current=false;if(mounted.current)setBusy(null);}
  },[]);
  useEffect(()=>{mounted.current=true;void read();return()=>{mounted.current=false;};},[read]);
  const act=async(action:'guardian'|'repository'|'chat-connect'|'chat-disconnect')=>{
    if(flight.current)return;const native=bridge();const call=action==='guardian'?native?.activateGuardian:action==='repository'?native?.connectGithubRepository:
      action==='chat-connect'?native?.connectGithubChat:native?.disconnectGithubChat;
    if(!call){setError('Этот клиент не предоставляет выбранную операцию.');return;}
    flight.current=true;setBusy(action);setError(null);
    try{await call();}catch{if(mounted.current)setError('Результат операции не подтверждён. Прочитайте состояние перед следующим действием; автоматического повтора нет.');}
    finally{flight.current=false;if(mounted.current){setBusy(null);void read();void refreshClientRuntimeStatus();}}
  };
  return <div className="mx-auto max-w-[1100px] space-y-5" data-testid="page-system">
    <header className="flex items-center justify-between gap-3"><h1 className="text-xl font-medium">Настройки и подключения</h1><button type="button" onClick={()=>{void read();void refreshClientRuntimeStatus();}} disabled={busy!==null} className={button}>Обновить состояние</button></header>
    {error?<p role="alert" className="text-sm text-amber-200">{error}</p>:null}
    <nav className="flex flex-wrap gap-2" aria-label="Рабочие экраны">{PAGES.filter(page=>page.key!=='system').map(page=><button key={page.key} type="button" onClick={()=>setPage(page.key)} className={button}>{page.label}</button>)}</nav>
    <section className="rounded-xl border border-zinc-800 p-4" data-testid="native-work-readiness"><h2 className="font-medium">Готовность выполнения</h2>
      <p role="status" className="mt-2 text-sm text-zinc-300">{work?.label||'Текущее состояние недоступно'}</p><p className="mt-1 text-sm text-zinc-400">{work?.detail||'Ожидается ответ Native Supervisor.'}</p>
      <dl className="mt-3 grid grid-cols-[160px_1fr] gap-2 text-sm">{([['chat_dispatch','Отправка в чат'],['coding_execution','Среда разработки'],['host_continuity','Продолжение на хосте'],['continuous_autonomy','Непрерывная автономия']] as const).map(([key,label])=><div className="contents" key={key}><dt className="text-zinc-500">{label}</dt><dd>{capabilityLabel(work,key)}</dd></div>)}</dl>
      {work?.reason==='SUPERVISOR_RECOVERY_REQUIRED'||(work?.ambiguous_agent_count??0)>0?<InterruptedSetupRecovery/>:null}
    </section>
    <section className="rounded-xl border border-zinc-800 p-4" data-testid="github-repository-connection"><h2 className="font-medium">GitHub</h2>
      <p role="status" className="mt-2 text-sm">{repository?.state==='CONNECTED'?`Подключён ${repository.account_login} · ${repository.repository} · ${repository.can_push?'чтение и запись':'чтение'}`:repository?.state||'Состояние недоступно'}</p>
      <p className="mt-1 text-sm text-zinc-400">Используется сохранённая учётная запись этого компьютера.</p><button type="button" onClick={()=>void act('repository')} disabled={busy!==null} className={`mt-3 ${button}`}>Проверить подключение</button>
    </section>
    <section className="rounded-xl border border-zinc-800 p-4" data-testid="github-chat-control"><h2 className="font-medium">Управление из чата GitHub</h2>
      <p role="status" className="mt-2 text-sm">{chat?.state||'Состояние недоступно'}{chat?.repository?` · ${chat.repository} #${chat.issue_number}`:''}</p>
      <div className="mt-3 flex gap-2"><button type="button" onClick={()=>void act('chat-connect')} disabled={busy!==null||!chat||chat.state==='ACTIVE'} className={button}>Подключить чат</button>
        <button type="button" onClick={()=>void act('chat-disconnect')} disabled={busy!==null||!chat||chat.state==='NOT_PAIRED'||chat.state==='REVOKED'} className={button}>Отозвать доступ</button></div>
    </section>
    <section className="rounded-xl border border-zinc-800 p-4" data-testid="guardian-runtime-status"><h2 className="font-medium">Machine Guardian</h2>
      <p role="status" className="mt-2 text-sm">{guardian?.state||'UNAVAILABLE'} · {guardian?.reason||'Нет текущего подтверждения'}</p>
      <p className="mt-1 text-sm text-zinc-400">Служба: {guardian?.guardian_service_ready===true?'доступна':'не подтверждена'} · Owner: {guardian?.owner_binding_proven===true?'подтверждён':'не подтверждён'} · device: {guardian?.device_binding_proven===true?'подтверждён':'не подтверждён'}</p>
      <button type="button" onClick={()=>void act('guardian')} disabled={busy!==null||runtime.readback?.connection.admin_ready!==true||!guardian||!['ACTIVATION_REQUIRED','OWNER_ENROLLMENT_REQUIRED'].includes(guardian.state)} className={`mt-3 ${button}`}>
        {guardian?.state==='OWNER_ENROLLMENT_REQUIRED'?'Привязать подтверждённое устройство':'Активировать Guardian (Windows UAC)'}</button>
      <p className="mt-2 text-xs text-zinc-500">Активация выполняется только по вашему действию. При неоднозначном результате повтор заблокирован до независимого подтверждения.</p>
    </section>
  </div>;
}
