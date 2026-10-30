import type {GoalDraftScope} from './goal-draft.mjs';
export type DraftScopeBridge = {draftScope(): Promise<unknown>};
export type DraftScopeSnapshot = Readonly<{
 state: 'UNKNOWN' | 'READY' | 'CHANGED'; scope: GoalDraftScope | null;
 generation: number; observedAt: number | null; expiresAt: number | null;
}>;
export const DRAFT_SCOPE_TTL_MS: number;
export function normalizeDraftScopeObservation(value: unknown, options: {now: number; requestedAt: number}):
 Omit<DraftScopeSnapshot, 'generation'> | null;
export function createDraftScopeResource(options: {
 bridge(): DraftScopeBridge | null | undefined;
 now?: () => number;
 monotonicNow?: () => number;
 schedule?: typeof setTimeout;
 cancel?: typeof clearTimeout;
 onVisibilityChange?: (listener: () => void) => () => void;
}): Readonly<{
 getSnapshot(): DraftScopeSnapshot;
 getServerSnapshot(): DraftScopeSnapshot;
 isCurrent(generation: number): boolean;
 refresh(): Promise<void>;
 subscribe(listener: () => void): () => void;
}>;
