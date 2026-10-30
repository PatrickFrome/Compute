"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createGoalDraftStore, goalDraftStorageKey, type GoalDraftScope } from "@/lib/goal-draft.mjs";

const drafts = new Map<string, ReturnType<typeof createGoalDraftStore>>();

// The caller must supply current authenticated identity, workspace and project.
// A historical receipt, chat actor or origin is not an authenticated scope.
export function useGoalDraft(scope: GoalDraftScope | null) {
  const key = scope === null ? null : goalDraftStorageKey(scope);
  const resource = useMemo(() => {
    // Unbound text survives navigation while the shell lives, but never enters
    // persistent storage or migrates into a newly confirmed principal/project.
    if (key === null || scope === null) return createGoalDraftStore(null);
    let stored = drafts.get(key);
    if (!stored) { stored = createGoalDraftStore(scope); drafts.set(key, stored); }
    return stored;
  }, [key]);
  const draft = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getServerSnapshot);
  const acknowledgeGoal = useCallback(() => resource.clearIfUnchanged(draft.revision), [resource, draft.revision]);
  return { goal: draft.text, setGoal: resource.write, acknowledgeGoal, draftStorage: draft.storage };
}
