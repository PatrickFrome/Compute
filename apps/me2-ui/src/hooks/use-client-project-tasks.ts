"use client";
import {useEffect,useSyncExternalStore} from 'react';
import {getClientProjectTasksView} from '@/lib/client-project-tasks';

export function useClientProjectTasks(){
  const resource=getClientProjectTasksView();
  const view=useSyncExternalStore(resource.subscribe,resource.getSnapshot,resource.getServerSnapshot);
  useEffect(()=>{
    const release=resource.observe(()=>document.visibilityState==='visible');
    const visible=()=>{if(document.visibilityState==='visible')void resource.refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{release();document.removeEventListener('visibilitychange',visible);};
  },[resource]);
  return {resource,view};
}
