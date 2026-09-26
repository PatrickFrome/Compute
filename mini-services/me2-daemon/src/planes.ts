// Credential-plane liveness — R88-RESILIENCE (live-tested by env-reset #2,
// 2026-09-26T13:42Z: /home/z/.a2/ wiped while the sandbox itself survived).
//
// Contract:
//  - a plane is "ok" iff its env file EXISTS and declares the expected KEY
//    NAME (values are never read, never logged, never returned);
//  - ≥2 missing planes ⇒ suspected env-reset (the sandbox provisions all
//    four files together; losing one alone is an operator action, losing
//    two+ is a reset);
//  - surfaces reading a missing plane must fail closed with their existing
//    machine-coded errors (github_no_token / controlplane_secrets_missing /
//    edge_secrets_missing / mirror_secrets_missing) — this module only makes
//    the aggregated state FIRST-CLASS for /health, /planes and the console
//    banner, it never bypasses the per-surface fail-closed paths.

import { readFileSync } from "node:fs";

export interface PlaneStatus {
  id: string;
  label: string;
  file: string;
  key: string;
  status: "ok" | "missing";
  detail: "present" | "file_missing" | "key_missing";
}

interface PlaneDef {
  id: string;
  label: string;
  file: string;
  key: string;
}

// Key NAMES are public contract (they appear in loader regexes already);
// values stay in the files. supervisor.env is loaded lazily by the command
// fastlane — it gets the same liveness treatment for uniform reporting.
const PLANES: PlaneDef[] = [
  { id: "github", label: "GitHub (PAT · convergence/CI/PR)", file: "/home/z/.a2/.github.env", key: "GITHUB_TOKEN_ADMIN" },
  { id: "supabase", label: "Supabase (service-role · control plane + mirror)", file: "/home/z/.a2/supabase-cloud.env", key: "SUPABASE_URL" },
  { id: "cloudflare", label: "Cloudflare (workers API · edge)", file: "/home/z/.a2/cloudflare.env", key: "CF_API_TOKEN" },
  { id: "supervisor", label: "Supervisor command fastlane (operator)", file: "/home/z/.a2/supervisor.env", key: "SUPERVISOR_TOKEN" },
];

export function planesStatus(): PlaneStatus[] {
  return PLANES.map((p) => {
    let detail: PlaneStatus["detail"] = "present";
    try {
      const txt = readFileSync(p.file, "utf8");
      const hasKey = new RegExp(`^\\s*(?:export\\s+)?${p.key}=`, "m").test(txt);
      if (!hasKey) detail = "key_missing";
    } catch {
      detail = "file_missing";
    }
    return { ...p, status: detail === "present" ? "ok" : "missing", detail };
  });
}

export interface EnvResetState {
  suspected: boolean;
  missing: string[];
  ok: string[];
  checked_at: string;
}

// ≥2 missing credential planes = suspected env-reset. Single-plane loss is
// reported per-plane but does not trip the global banner (could be an
// operator rotating one file).
export function envResetState(planes: PlaneStatus[] = planesStatus()): EnvResetState {
  const missing = planes.filter((p) => p.status === "missing").map((p) => p.id);
  return {
    suspected: missing.length >= 2,
    missing,
    ok: planes.filter((p) => p.status === "ok").map((p) => p.id),
    checked_at: new Date().toISOString(),
  };
}

// Shared classifier for error strings coming from credential-dependent
// surfaces: distinguishes "surface could not run because secrets are gone"
// (env-degraded, amber) from "surface ran and found a REAL problem" (red).
// The mirror verify uses this so a credentials-blocked run never renders as
// a broken contract.
export function secretsClassFromError(message: string | null | undefined): "secrets_missing" | "unknown" {
  if (!message) return "unknown";
  return /\.a2\/|\.env|not found|отсутствует|_secrets_|_no_token/i.test(message) ? "secrets_missing" : "unknown";
}
