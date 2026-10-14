// Source-only TypeScript boundary for operator-observatory-resync.mjs.
// This describes *redacted observational output*, not attested Owner authority.
export declare const OPERATOR_OBSERVATORY_RESYNC_SCHEMA:
  'metaengine.operator.observatory-resync.v1';

export type ObservatoryPlaneWitness = Readonly<{
  state: string;
  fresh: boolean;
  proof: 'NONE' | 'TRUSTED_READBACK';
  observed_at: string | null;
}>;

export type ObservatoryProjection = Readonly<{
  schema: 'metaengine.operator.observatory.v1';
  state: 'UNKNOWN' | 'UNVERIFIED' | 'STALE' | 'AMBIGUOUS' | 'OBSERVED';
  reason: string | null;
  run_id: string | null;
  event_seq: number | null;
  cursor_state: 'UNKNOWN' | 'UNVERIFIED' | 'STALE' | 'AMBIGUOUS' | 'VERIFIED_CURSOR';
  proof_identity: string | null;
  generated_at: string | null;
  planes: Readonly<Record<string, ObservatoryPlaneWitness>>;
  views: Readonly<Record<string, readonly string[]>>;
  authority_effect: false;
  automatic_retry_allowed: false;
}>;

export type ObservatoryIdentity = Readonly<{
  run_id: string;
  owner_id: string;
  owner_epoch: number;
  source_sha: string;
  event_seq: number;
  proof_identity: string;
}>;

export type ObservatoryFrame = Readonly<{
  schema: 'metaengine.operator.observatory-resync.v1';
  mode: 'UNKNOWN' | 'TRACKING' | 'STALE' | 'RESYNC_REQUIRED';
  reason: string | null;
  identity: ObservatoryIdentity | null;
  checkpoint: ObservatoryIdentity | null;
  projection: ObservatoryProjection;
  requires_explicit_resync: boolean;
  authority_effect: false;
  scheduler_authority: false;
  automatic_retry_allowed: false;
}>;

export declare function emptyOperatorObservatoryResync(reason?: string): ObservatoryFrame;
export declare function advanceOperatorObservatoryResync(
  previous: ObservatoryFrame | null | undefined,
  context: unknown,
  options?: {
    nowMs?: number;
    maxAgeMs?: number;
    intent?: 'POLL' | 'EXPLICIT_RESYNC';
  },
): ObservatoryFrame;
export declare function expireOperatorObservatoryResync(
  previous: ObservatoryFrame | null | undefined,
  options?: { nowMs?: number; maxAgeMs?: number },
): ObservatoryFrame;
