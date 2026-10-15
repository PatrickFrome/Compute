// Compile-only regression for the JS/TS .mjs boundary (included by the
// frozen ME2 tsc). No DOM, native reader, or execution authority is invoked.
import type { ClientConnectionStatus, ClientWorkReadiness } from "./client-runtime-resource";
import { projectClientWorkBadge } from "./client-work-badge-text.mjs";

declare const connection: ClientConnectionStatus;
declare const work: ClientWorkReadiness;

// The actual typed native readback must be accepted without unsafe casts.
const badge = projectClientWorkBadge({ connection, work });
const state: "READY" | "PAUSED" | "BLOCKED" | "UNAVAILABLE" = badge.state;
const effectAuthority: false = badge.authority_effect;
const readyColour: boolean = badge.autonomous_ready_color;
void state; void effectAuthority; void readyColour;

// Empty/incomplete evidence is legitimate, always a presentation fallback.
projectClientWorkBadge();
projectClientWorkBadge({ connection: undefined, work: undefined });
projectClientWorkBadge({ connection: null, work: null });

// Regressions must not let an ADMIN-only partial value masquerade as
// the canonical readback type (or widen the boundary to 'any').
// @ts-expect-error missing local runtime witness
projectClientWorkBadge({ connection: { admin_ready: true }, work });
// @ts-expect-error readiness requires its actual capability set
projectClientWorkBadge({ connection, work: { schema: "metaengine.client.work-readiness.v1", state: "READY" } });
// @ts-expect-error badge authority cannot be made true by a caller
const authorityGranted: true = badge.authority_effect;
void authorityGranted;
