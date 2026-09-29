// Shared Supabase env loader — NO secrets in the repo.
// Reads operator vault /home/z/.a2/supabase-cloud.env (KEY=VALUE dotenv-style).
import { readFileSync } from "node:fs";

function loadVault(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of ["/home/z/.a2/supabase-cloud.env"]) {
    try {
      const txt = readFileSync(p, "utf8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
        if (m) out[m[1]] = m[2];
      }
      if (out.SUPABASE_SERVICE_ROLE_JWT) return out;
    } catch {
      /* try next */
    }
  }
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_JWT"]) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

const env = loadVault();
export const SB = env.SUPABASE_URL ?? "";
export const KEY = env.SUPABASE_SERVICE_ROLE_JWT ?? "";
export const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
if (!KEY) console.error("[sb-env] JWT missing: /home/z/.a2/supabase-cloud.env not found");
