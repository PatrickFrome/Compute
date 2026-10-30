"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createGoalDraftStore, goalDraftStorageKey, type GoalDraftScope } from "@/lib/goal-draft.mjs";

const drafts = new Map<string, ReturnType<typeof createGoalDraftStore>>();
const alwaysCurrent = () => true;

// The caller supplies a confirmed native principal and coordination workspace.
// A historical receipt, chat actor or origin cannot confirm this namespace.
export function useGoalDraft(scope: GoalDraftScope | null, isCurrent: () => boolean = alwaysCurrent) {
  const key = scope === null ? null : goalDraftStorageKey(scope);
  const resource = useMemo(() => {
    // Unbound text survives navigation while the shell lives, but never enters
    // persistent storage or migrates into a newly confirmed principal/project.
    if (key === null || scope === null) return createGoalDraftStore(null);
    let stored = drafts.get(key);
    if (!stored) { stored = createGoalDraftStore(scope); drafts.set(key, stored); }
    return stored;
  }, [key]);
  const subscribe = useCallback((listener: () => void) => isCurrent() ? resource.subscribe(listener) : () => {}, [resource, isCurrent]);
  const getSnapshot = useCallback(() => isCurrent() ? resource.getSnapshot() : resource.getServerSnapshot(), [resource, isCurrent]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, resource.getServerSnapshot);
  const setGoal = useCallback((text: string) => isCurrent() && resource.write(text), [resource, isCurrent]);
  const acknowledgeGoal = useCallback(() => isCurrent() && resource.clearIfUnchanged(draft.revision), [resource, draft.revision, isCurrent]);
  return { goal: draft.text, setGoal, acknowledgeGoal, draftStorage: draft.storage, isCurrent };
}
