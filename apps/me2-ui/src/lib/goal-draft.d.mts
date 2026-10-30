export type GoalDraftScope = Readonly<{ principalId: string; workspaceId: string; projectId: string | null }>;
export type GoalDraftSnapshot = Readonly<{ text: string; revision: number; storage: 'LOADING' | 'SAVED' | 'UNAVAILABLE' | 'UNBOUND' }>;
export const GOAL_DRAFT_SCHEMA: string;
export const GOAL_DRAFT_MAX_LENGTH: number;
export const GOAL_DRAFT_MAX_RECORD_LENGTH: number;
export function goalDraftStorageKey(scope: GoalDraftScope): string;
export function createGoalDraftStore(scope: GoalDraftScope | null, options?: {
  storage?: () => Pick<Storage, 'getItem' | 'setItem'>;
}): Readonly<{
  getSnapshot(): GoalDraftSnapshot;
  getServerSnapshot(): GoalDraftSnapshot;
  subscribe(listener: () => void): () => void;
  write(text: string): boolean;
  clearIfUnchanged(revision: number): boolean;
}>;
