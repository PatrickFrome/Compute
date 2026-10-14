export declare const PRIMARY_OPERATOR_VIEWS: readonly ['Now', 'Missions', 'Fleet'];
export type PrimaryViewName = 'Now' | 'Missions' | 'Fleet';
export type PrimaryDelivery = 'IDLE' | 'LOADING' | 'READING' | 'UNBOUND' | 'TIMED_OUT' | 'FAILED';
export type PrimaryPhase = 'RECONCILE' | 'STALE' | 'UNBOUND' | 'TIMED_OUT' | 'FAILED' | 'LOADING' | 'READING' | 'TRACKING' | 'UNKNOWN';
export type PrimaryFacet = Readonly<{
  name: string; state: string; proof: 'NONE' | 'TRUSTED_READBACK';
  fresh: boolean; observed_at: string | null;
}>;
export type PrimaryViewProjection = Readonly<{
  schema: 'metaengine.operator.primary-view.v1';
  view: PrimaryViewName; title: string; phase: PrimaryPhase;
  hint: string; missing_detail: string; source_bound: boolean;
  run_id: string | null; event_seq: number | null;
  facets: readonly PrimaryFacet[]; first_truth_ms: number | null;
  authority_effect: false; automatic_retry_allowed: false;
}>;
export declare function projectPrimaryOperatorView(
  frame: unknown,
  view: PrimaryViewName,
  options?: { delivery?: PrimaryDelivery; firstTruthMs?: number | null },
): PrimaryViewProjection;
