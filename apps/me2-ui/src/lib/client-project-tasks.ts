// Native own-PG project read model. No legacy daemon, scheduler or task mutation.
export type RepairObligation='PENDING'|'RESOLVED'|null;
export type ProjectTask = Readonly<{task_seq:number;task_id:string;root_task_id:string;parent_task_id:string|null;
  depth:number;state:string;role:string;repair_obligation:RepairObligation;objective:string|null;agent_id:string|null;lease_generation:number|null;lease_expires_at:string|null}>;
export type NativeReviewRejection=Readonly<{schema:'metaengine.native-coding.review-rejection.v1';project_id:string;
  verdict:'REJECT';writer_task_id:string;writer_lease_generation:number;critic_task_id:string;critic_lease_generation:number;
  result_sha256:string;automatic_retry_allowed:false;authority_effect:false}>;
export type TaskPage = Readonly<{project_id:string;root_task_id:string;request_id:string;goal:string;state:string;total_tasks:number;
  last_seq:number;native_review_rejection:NativeReviewRejection|null;tasks:readonly ProjectTask[];cursor:Readonly<{after_seq:number;next_seq:number;has_more:boolean}>}>;
export type ProjectTasksBridge = {projectOverview:()=>Promise<unknown>;
  projectSnapshot:(request:{project_id:string;task_after_seq:number;limit:number})=>Promise<unknown>};
export type ProjectTasksState = Readonly<{state:"UNBOUND"|"LOADING"|"OBSERVED"|"DEGRADED"|"UNAVAILABLE";
  busy:boolean;page:TaskPage|null;selectedTaskId:string|null;observedAt:string|null;canGoBack:boolean}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// One presentation mapping keeps accepted states and their filters in sync.
// Suspension means retained work awaiting continuation, not a new queued run.
export const PROJECT_TASK_GROUPS=['Все','Очередь','В работе','Приостановлены','Требуют внимания','Завершены','История исправлений'] as const;
export type ProjectTaskGroup=typeof PROJECT_TASK_GROUPS[number];
const STATE_GROUP:Readonly<Record<string,ProjectTaskGroup>>=Object.freeze({
  READY:'Очередь',LEASED:'В работе',RUNNING:'В работе',RESULT_READY:'В работе',SUSPENDED:'Приостановлены',
  BLOCKED:'Требуют внимания',FAILED:'Требуют внимания',AMBIGUOUS:'Требуют внимания',FENCED:'Требуют внимания',COMPLETED:'Завершены',
});
const STATES=new Set(Object.keys(STATE_GROUP));
export function projectTaskMatchesGroup(state:string,group:ProjectTaskGroup,repair:RepairObligation=null):boolean {
  const repairHistory=state==='RESULT_READY'&&(repair==='PENDING'||repair==='RESOLVED');
  return STATES.has(state)&&(group==='Все'||(repairHistory?group==='История исправлений':STATE_GROUP[state]===group));
}
export function projectTaskRepairDescription(repair:RepairObligation):string|null {
  if(repair==='PENDING')return 'Ожидается завершение замены. Прежний отклонённый результат сохранён.';
  if(repair==='RESOLVED')return 'Обязательство закрыто проверенной и сохранённой заменой. Прежний результат остаётся отклонённым.';
  return null;
}
const integer=(value:unknown,min=0):value is number=>Number.isSafeInteger(value)&&Number(value)>=min;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const denied=()=>{throw Error('native_project_tasks_invalid');};
function readReviewRejection(value:unknown,projectId:string):NativeReviewRejection|null {
  if(value==null)return null;
  const keys=['schema','project_id','verdict','writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation',
    'result_sha256','automatic_retry_allowed','authority_effect'];
  if(!plain(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|')
    ||value.schema!=='metaengine.native-coding.review-rejection.v1'||value.project_id!==projectId||value.verdict!=='REJECT'
    ||typeof value.writer_task_id!=='string'||!UUID.test(value.writer_task_id)
    ||typeof value.critic_task_id!=='string'||!UUID.test(value.critic_task_id)||value.writer_task_id===value.critic_task_id
    ||!integer(value.writer_lease_generation,1)||!integer(value.critic_lease_generation,1)
    ||typeof value.result_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.result_sha256)
    ||value.automatic_retry_allowed!==false||value.authority_effect!==false)return denied();
  return Object.freeze({...value}) as NativeReviewRejection;
}
export const EMPTY_PROJECT_TASKS:ProjectTasksState=Object.freeze({state:'UNBOUND',busy:false,page:null,selectedTaskId:null,observedAt:null,canGoBack:false});

export function readNativeProjectTaskPage(value:unknown,{projectId=null,afterSeq=0,limit=128}:{projectId?:string|null;afterSeq?:number;limit?:number}={}):TaskPage|null{
  if(value===null)return null;if(!plain(value))return denied();const v=value;
  if(v.schema!=='metaengine.devos.project-snapshot.v1'||typeof v.found!=='boolean'||v.authority_effect!==false||v.automatic_retry_allowed!==false)return denied();
  if(!v.found)return null;
  if(v.scheduler_authority!==false||v.filesystem_paths_exposed!==false||!UUID.test(String(v.project_id??''))||projectId!==null&&v.project_id!==projectId
    ||!UUID.test(String(v.root_task_id??''))||!UUID.test(String(v.request_id??''))||!text(v.goal,12000)||!text(v.state,64)
    ||!integer(v.total_tasks,1)||!integer(v.last_seq)||!Array.isArray(v.tasks)||v.tasks.length>limit||!plain(v.task_cursor))return denied();
  const cursor=v.task_cursor;
  if(cursor.after_seq!==afterSeq||!integer(cursor.next_seq,afterSeq)||typeof cursor.has_more!=='boolean'||cursor.next_seq>v.total_tasks)return denied();
  const ids=new Set<string>();let sequence=afterSeq;
  const tasks=v.tasks.map((raw:unknown):ProjectTask=>{
    if(!plain(raw)||!integer(raw.task_seq,sequence+1)||raw.task_seq>Number(v.total_tasks)||!UUID.test(String(raw.task_id??''))
      ||ids.has(String(raw.task_id))||raw.root_task_id!==v.root_task_id||!integer(raw.depth)
      ||!(raw.parent_task_id===null||UUID.test(String(raw.parent_task_id??'')))||!STATES.has(String(raw.state))||!text(raw.role,64)
      ||!(raw.objective===null||text(raw.objective,4000))||!(raw.agent_id===null||text(raw.agent_id,128))
      ||!(raw.lease_generation===null||integer(raw.lease_generation))
      ||!(raw.lease_expires_at===null||text(raw.lease_expires_at,64)&&Number.isFinite(Date.parse(raw.lease_expires_at))))return denied();
    const repair=raw.repair_obligation??null;
    if(repair!==null&&(!['PENDING','RESOLVED'].includes(String(repair))||typeof repair!=='string'
      ||raw.state!=='RESULT_READY'||!['IMPLEMENTER','CRITIC'].includes(String(raw.role))))return denied();
    sequence=raw.task_seq;ids.add(raw.task_id as string);
    return Object.freeze({task_seq:raw.task_seq,task_id:raw.task_id as string,root_task_id:raw.root_task_id as string,
      parent_task_id:raw.parent_task_id as string|null,depth:raw.depth,state:raw.state as string,role:raw.role,repair_obligation:repair as RepairObligation,
      objective:raw.objective as string|null,agent_id:raw.agent_id as string|null,lease_generation:raw.lease_generation as number|null,
      lease_expires_at:raw.lease_expires_at as string|null});
  });
  if(cursor.next_seq!==sequence||cursor.has_more!==(cursor.next_seq<v.total_tasks)||cursor.has_more&&!tasks.length)return denied();
  return Object.freeze({project_id:v.project_id as string,root_task_id:v.root_task_id as string,request_id:v.request_id as string,
    goal:v.goal,state:v.state,native_review_rejection:readReviewRejection(v.native_review_rejection,v.project_id as string),total_tasks:v.total_tasks,last_seq:v.last_seq,tasks:Object.freeze(tasks),
    cursor:Object.freeze({after_seq:afterSeq,next_seq:cursor.next_seq,has_more:cursor.has_more})});
}

export function createClientProjectTasksView({bridge,deadlineMs=8000,intervalMs=10000}:{bridge:()=>ProjectTasksBridge|null;deadlineMs?:number;intervalMs?:number}){
  if(typeof bridge!=='function'||!integer(deadlineMs,1)||deadlineMs>10000||!integer(intervalMs,1000))throw Error('native_project_tasks_configuration');
  let current:ProjectTasksState=EMPTY_PROJECT_TASKS,generation=0,closed=false,observers=0,after=0;
  let pending:{generation:number;promise:Promise<void>}|null=null,ticker:ReturnType<typeof setInterval>|null=null;
  const previous:number[]=[],listeners=new Set<()=>void>();
  const publish=(patch:Partial<ProjectTasksState>)=>{if(closed)return;current=Object.freeze({...current,...patch});for(const listener of listeners)listener();};
  const bounded=async(read:()=>Promise<unknown>)=>{let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('native_project_tasks_timeout')),deadlineMs);})]);}
    finally{if(timer!==undefined)clearTimeout(timer);}};
  const refresh=()=>{
    if(closed)return Promise.resolve();if(pending?.generation===generation)return pending.promise;
    const started=generation;publish({busy:true,state:current.page?current.state:'LOADING'});
    const promise=(async()=>{await Promise.resolve();
      try{
        const native=bridge();if(!native?.projectOverview||!native.projectSnapshot){publish({state:current.page?'DEGRADED':'UNAVAILABLE'});return;}
        const overview=readNativeProjectTaskPage(await bounded(()=>native.projectOverview()));
        if(closed||started!==generation)return;
        if(!overview){after=0;previous.length=0;publish({...EMPTY_PROJECT_TASKS});return;}
        if(current.page?.project_id!==overview.project_id){after=0;previous.length=0;}
        let page=overview;
        if(after>0){page=readNativeProjectTaskPage(await bounded(()=>native.projectSnapshot({project_id:overview.project_id,task_after_seq:after,limit:128})),
          {projectId:overview.project_id,afterSeq:after})!;
          if(!page||page.root_task_id!==overview.root_task_id||page.request_id!==overview.request_id||page.goal!==overview.goal)throw Error('native_project_tasks_binding');}
        if(closed||started!==generation)return;
        publish({page,state:'OBSERVED',observedAt:new Date().toISOString(),canGoBack:previous.length>0,
          selectedTaskId:current.page?.project_id===page.project_id&&page.tasks.some(row=>row.task_id===current.selectedTaskId)?current.selectedTaskId:null});
      }catch{if(!closed&&started===generation)publish({state:'DEGRADED'});}
      finally{if(!closed&&started===generation)publish({busy:false});if(pending?.generation===started)pending=null;}
    })();pending={generation:started,promise};return promise;
  };
  const move=(next:number,remember:boolean)=>{
    if(closed||current.busy)return Promise.resolve();if(remember){previous.push(after);if(previous.length>64)previous.shift();}
    after=next;generation++;return refresh();
  };
  return Object.freeze({getSnapshot:()=>current,getServerSnapshot:()=>EMPTY_PROJECT_TASKS,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},refresh,
    nextPage:()=>current.page?.cursor.has_more?move(current.page.cursor.next_seq,true):Promise.resolve(),
    previousPage:()=>!current.busy&&previous.length?move(previous.pop()!,false):Promise.resolve(),
    firstPage:()=>{if(current.busy)return Promise.resolve();previous.length=0;return move(0,false);},
    selectTask:(taskId:string|null)=>{if(taskId!==null&&!current.page?.tasks.some(task=>task.task_id===taskId))return false;publish({selectedTaskId:taskId});return true;},
    observe:(visible:()=>boolean)=>{if(closed)return()=>{};observers++;if(observers===1){const poll=()=>{if(visible())void refresh();};poll();ticker=setInterval(poll,intervalMs);}
      let released=false;return()=>{if(released)return;released=true;if(--observers===0&&ticker!==null){clearInterval(ticker);ticker=null;}};},
    close:()=>{closed=true;generation++;if(ticker!==null)clearInterval(ticker);listeners.clear();},
  });
}

let clientView:ReturnType<typeof createClientProjectTasksView>|null=null;
export function getClientProjectTasksView(){
  clientView??=createClientProjectTasksView({bridge:()=>typeof window==='undefined'?null:
    (window as Window&{metaengineClient?:ProjectTasksBridge}).metaengineClient??null});return clientView;
}
