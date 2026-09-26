// ME2 OS daemon identity — R81-PHASE1.
// Lineage note: donor daemon (sandbox/me2-os, v0.57.1) history is preserved as
// a git ancestor (merge -s ours) and its 57-action manifest is recovered
// verbatim (see donor-registry.ts). This build remains a fresh implementation:
// honest local registry only, no donor surface claimed as implemented.
export const VERSION = "0.60.0-r82";
export const ROUND = "R82";
export const BOOT_SPAN_MS = 30_000;
export const STARTED_AT = new Date().toISOString();
export const REST_PORT = 3041;
export const WS_PORT = 3040;
