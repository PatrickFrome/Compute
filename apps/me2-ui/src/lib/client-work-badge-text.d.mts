// Declaration for the ESM .mjs presentation boundary. Keep this bound to
// the canonical native readback models, not renderer-shaped proof flags.
import type { ClientConnectionStatus, ClientWorkReadiness } from "./client-runtime-resource";

export type ClientWorkBadgeState = "READY" | "PAUSED" | "BLOCKED" | "UNAVAILABLE";
export type ClientWorkBadgeConnection = Pick<ClientConnectionStatus, "admin_ready" | "local_runtime_ready">;
export type ClientWorkBadgeReadiness = Pick<
  ClientWorkReadiness,
  | "schema"
  | "state"
  | "reason"
  | "execution_ready"
  | "capabilities"
  | "continuous_autonomy_ready"
  | "automatic_retry_allowed"
  | "authority_effect"
>;

export interface ClientWorkBadge {
  readonly state: ClientWorkBadgeState;
  readonly label: string;
  readonly reason: string | null;
  readonly admin_ready: boolean;
  readonly autonomous_ready_color: boolean;
  readonly authority_effect: false;
}

// Optional evidence is intentional: unavailable native observation must render
// UNKNOWN, never inherit the most recent ADMIN transport connection.
export function projectClientWorkBadge(input?: {
  readonly connection?: ClientWorkBadgeConnection | null;
  readonly work?: ClientWorkBadgeReadiness | null;
}): Readonly<ClientWorkBadge>;
