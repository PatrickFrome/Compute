// ME2 OS daemon identity — R81-PHASE0 recovery build.
// Honest lineage note: donor daemon (sandbox/me2-os, v0.57.1) was lost with the
// env-reset and is unreachable without GitHub credentials. This build continues
// the version sequence but is a fresh implementation; the full 47-action donor
// registry is NOT claimed here (see actions.ts / capabilities note).
export const VERSION = "0.58.0-r81-recovery";
export const ROUND = "R81-PHASE0";
export const BOOT_SPAN_MS = 30_000;
export const STARTED_AT = new Date().toISOString();
export const REST_PORT = 3041;
export const WS_PORT = 3040;
