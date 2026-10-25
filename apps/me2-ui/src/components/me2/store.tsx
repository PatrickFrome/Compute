"use client";
// Presentation state only. Current tasks/history/readiness have separate typed
// native resources; the retired daemon snapshot/command bus is not mounted.
import {create} from 'zustand';

export type PageKey='browser'|'tasks'|'code'|'operator'|'system';
export const PAGES:ReadonlyArray<{key:PageKey;label:string;num:string}>=[
  {key:'browser',label:'Агенты и цель',num:'1'},
  {key:'tasks',label:'Задачи и очередь',num:'2'},
  {key:'code',label:'Проекты и история',num:'3'},
  {key:'operator',label:'Наблюдение',num:'4'},
  {key:'system',label:'Настройки и подключения',num:'5'},
];
const PAGE_LS='me2.page.v1';
export function normalizePageKey(value:unknown):PageKey{
  const key=String(value??'').trim();
  if(['supervisor','memory','observability'].includes(key))return 'operator';
  return PAGES.find(page=>page.key===key)?.key??'browser';
}
type State={page:PageKey;paletteOpen:boolean;recentPages:readonly PageKey[];initialized:boolean;
  init:()=>void;setPage:(page:PageKey)=>void;setPalette:(open:boolean)=>void};
function syncPresentation(page:PageKey){
  try{localStorage.setItem(PAGE_LS,page);history.replaceState(null,'',`#${page}`);}catch{/* private mode */}
  try{const native=(window as Window&{metaengineShell?:{setPrimaryPage?:(page:string)=>Promise<unknown>|unknown}}).metaengineShell;
    void Promise.resolve(native?.setPrimaryPage?.(page)).catch(()=>{});
  }catch{/* A web-only document has no native pane to select. */}
}
export const useMe2=create<State>((set,get)=>({
  page:'browser',paletteOpen:false,recentPages:['browser'],initialized:false,
  init:()=>{
    if(get().initialized)return;set({initialized:true});
    let restored:PageKey='browser';try{restored=normalizePageKey(location.hash.slice(1)||localStorage.getItem(PAGE_LS));}catch{/* private mode */}
    get().setPage(restored);
    document.addEventListener('keydown',event=>{
      if((event.key==='k'||event.key==='K')&&(event.metaKey||event.ctrlKey)){
        event.preventDefault();set({paletteOpen:!get().paletteOpen});
      }
    });
  },
  setPage:requested=>{
    const page=normalizePageKey(requested);set(current=>current.page===page?current:{page,paletteOpen:false,recentPages:[...current.recentPages,page].slice(-20)});
    syncPresentation(page);
  },
  setPalette:paletteOpen=>set({paletteOpen}),
}));
