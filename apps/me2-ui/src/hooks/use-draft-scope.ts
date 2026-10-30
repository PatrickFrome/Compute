"use client";

import {useCallback, useSyncExternalStore} from "react";
import {createDraftScopeResource, type DraftScopeBridge} from "@/lib/draft-scope.mjs";

// One resource owns the native read across Page remounts. No storage, journal,
// status flag or renderer-generated identity is a fallback source of scope.
const resource=createDraftScopeResource({
  bridge:()=>typeof window==="undefined"?null:(window as Window & {metaengineClient?: DraftScopeBridge}).metaengineClient,
  onVisibilityChange:listener=>{
    document.addEventListener("visibilitychange",listener);
    return ()=>document.removeEventListener("visibilitychange",listener);
  },
});

export function useDraftScope(){
  const snapshot=useSyncExternalStore(resource.subscribe,resource.getSnapshot,resource.getServerSnapshot);
  const isCurrent=useCallback(()=>resource.isCurrent(snapshot.generation),[snapshot.generation]);
  return {...snapshot,isCurrent};
}
