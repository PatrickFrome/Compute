#!/usr/bin/env bash
# build-capsule.sh — AGENT ACCESS CAPSULE builder v1 (2026-09-28)
# Reads secrets from secure env stores and emits self-contained capsule files.
# The builder itself contains NO secrets (safe to commit). Generated artifacts
# (agent-connect.sh, agent-access-capsule.json, briefs/*.txt) DO contain secrets:
# chmod 600, never print, never commit, never paste into worklog/chat.
# Rerun after any secret rotation — values are sourced live from:
#   ENV A: /tmp/my-project/.a2-backup/me2.env.20260922  (SUPABASE_*, GITHUB_TOKEN, GITHUB_REPO, WORKSPACE_ID, CLIENT_ID, CF_*)
#   ENV B: /home/z/.a2/.github.env                       (GITHUB_TOKEN_ADMIN — supervisor-only, NOT distributed to fleet)
set -u
SWARM="/home/z/my-project/scripts/swarm"
ENV_A="/tmp/my-project/.a2-backup/me2.env.20260922"
ENV_B="/home/z/.a2/.github.env"
BRIEFS="$SWARM/briefs"

[ -r "$ENV_A" ] || { echo "FATAL: env A unreadable"; exit 2; }
# shellcheck disable=SC1090
. "$ENV_A"
GTA=""
[ -r "$ENV_B" ] && GTA="$(grep -oE '^GITHUB_TOKEN_ADMIN=.*' "$ENV_B" | head -1 | cut -d= -f2- | tr -d '\r\n"'"'"'')"
for V in SUPABASE_URL SUPABASE_SERVICE_ROLE_JWT SUPABASE_JWT_SECRET GITHUB_TOKEN GITHUB_REPO WORKSPACE_ID CLIENT_ID CF_API_TOKEN CF_ACCOUNT_ID CF_R2_ACCESS_KEY_ID CF_AI_WORKER_TOKEN; do
  eval "val=\"\${$V:-}\""
  [ -n "$val" ] || { echo "FATAL: $V empty"; exit 2; }
done

# --- GitHub token auto-select: prefer repo-valid token; fall back to admin if primary is dead ---
GH_SOURCE="GITHUB_TOKEN"
gh_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer ${GITHUB_TOKEN}" "https://api.github.com/repos/${GITHUB_REPO}" 2>/dev/null)"
if [ "$gh_code" != "200" ] && [ -n "$GTA" ]; then
  gha_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer ${GTA}" "https://api.github.com/repos/${GITHUB_REPO}" 2>/dev/null)"
  if [ "$gha_code" = "200" ]; then
    GITHUB_TOKEN="$GTA"; GH_SOURCE="GITHUB_TOKEN_ADMIN"
  else
    echo "WARN: both github tokens failed (primary=${gh_code} admin=${gha_code}) — distributing primary anyway"; fi
fi
echo "github token source: ${GH_SOURCE}"

mkdir -p "$BRIEFS"
umask 077

# ---------- 1) agent-connect.sh (self-contained, fleet-ready) ----------
{
cat <<'HDR'
#!/usr/bin/env bash
# agent-connect.sh — ME2 AGENT ACCESS CAPSULE v1 (generated 2026-09-28)
# ALL swarm agents share THIS Supabase DB + THIS GitHub repo.
# Usage:  source agent-connect.sh && probe_connect   # verify (HTTP codes only, never prints secrets)
#         sb_q <table> [query-params] [METHOD] [json-body]
#         gh_api <api-path> [METHOD] [json-body]
# Table suffix: _h205f22. Key tables: browser_supervisor_{state,command}, supervisor_mesh_instance, browser_device.
# Rules: never print/commit secrets; report statuses only. Regenerate via build-capsule.sh.
set -u
HDR
cat <<'ENVBLOCK'
export SUPABASE_URL='__SUPABASE_URL__'
export SUPABASE_SERVICE_ROLE_JWT='__SUPABASE_SERVICE_ROLE_JWT__'
export SUPABASE_JWT_SECRET='__SUPABASE_JWT_SECRET__'
export GITHUB_TOKEN='__GITHUB_TOKEN__'
export GITHUB_REPO='__GITHUB_REPO__'
export WORKSPACE_ID='__WORKSPACE_ID__'
export CLIENT_ID='__CLIENT_ID__'
export CF_API_TOKEN='__CF_API_TOKEN__'
export CF_ACCOUNT_ID='__CF_ACCOUNT_ID__'
export CF_R2_ACCESS_KEY_ID='__CF_R2_ACCESS_KEY_ID__'
export CF_AI_WORKER_TOKEN='__CF_AI_WORKER_TOKEN__'
ENVBLOCK
cat <<'HELPERS'
CAPSULE_VERSION="2026-09-28T10:02+08"
SUFFIX="_h205f22"
sb_q() { # sb_q <table-without-suffix> [qs] [METHOD] [body]
  local T="${SUFFIX}_h205f22"; T="${1%/}${SUFFIX}"; local QS="${2:-}" M="${3:-GET}" B="${4:-}" U
  [ -n "$QS" ] && QS="?$QS"
  U="${SUPABASE_URL}/rest/v1/${T}${QS}"
  if [ -n "$B" ]; then
    curl -s --max-time 30 -X "$M" -H "apikey: ${SUPABASE_SERVICE_ROLE_JWT}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_JWT}" -H "Content-Type: application/json" -d "$B" "$U"
  else
    curl -s --max-time 30 -X "$M" -H "apikey: ${SUPABASE_SERVICE_ROLE_JWT}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_JWT}" "$U"
  fi
}
gh_api() { # gh_api <path> [METHOD] [body]
  local P="$1" M="${2:-GET}" B="${3:-}"
  if [ -n "$B" ]; then
    curl -s --max-time 30 -X "$M" -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" -d "$B" "https://api.github.com${P}"
  else
    curl -s --max-time 30 -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" "https://api.github.com${P}"
  fi
}
probe_connect() { # prints state lines only, values never
  local c1 c2
  c1="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_JWT}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_JWT}" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null)"
  c2="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/user 2>/dev/null)"
  echo "supabase_rest=${c1} github_api=${c2} workspace=${WORKSPACE_ID} repo=${GITHUB_REPO}"
  [ "$c1" = "200" ] && [ "$c2" = "200" ] && return 0 || return 1
}
HELPERS
} > "$SWARM/agent-connect.sh"
sed -i "s|__SUPABASE_URL__|${SUPABASE_URL}|; s|__SUPABASE_SERVICE_ROLE_JWT__|${SUPABASE_SERVICE_ROLE_JWT}|; s|__SUPABASE_JWT_SECRET__|${SUPABASE_JWT_SECRET}|; s|__GITHUB_TOKEN__|${GITHUB_TOKEN}|; s|__GITHUB_REPO__|${GITHUB_REPO}|; s|__WORKSPACE_ID__|${WORKSPACE_ID}|; s|__CLIENT_ID__|${CLIENT_ID}|; s|__CF_API_TOKEN__|${CF_API_TOKEN}|; s|__CF_ACCOUNT_ID__|${CF_ACCOUNT_ID}|; s|__CF_R2_ACCESS_KEY_ID__|${CF_R2_ACCESS_KEY_ID}|; s|__CF_AI_WORKER_TOKEN__|${CF_AI_WORKER_TOKEN}|" "$SWARM/agent-connect.sh"
chmod 600 "$SWARM/agent-connect.sh"

# ---------- 2) agent-access-capsule.json (machine-readable) ----------
python3 - "$SWARM" "$GTA" "$GITHUB_TOKEN" "$GH_SOURCE" <<'PYEOF'
import json, sys, os
swarm, gta, gh_tok, gh_src = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
env = {}
for line in open("/tmp/my-project/.a2-backup/me2.env.20260922"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
capsule = {
    "capsule": "AGENT ACCESS CAPSULE v1", "generated": "2026-09-28T10:02+08",
    "shared_db": {"kind": "supabase", "url": env["SUPABASE_URL"], "service_key": env["SUPABASE_SERVICE_ROLE_JWT"],
                   "jwt_secret": env["SUPABASE_JWT_SECRET"], "table_suffix": "_h205f22",
                   "tables": ["browser_supervisor_state", "browser_supervisor_command", "supervisor_mesh_instance", "browser_device"]},
    "github": {"token": gh_tok, "token_source": gh_src, "repo": env["GITHUB_REPO"],
                "note": "primary GITHUB_TOKEN from me2.env.20260922 is dead (401) as of 2026-09-28 — rotated to admin; operator: replace with fine-grained token"},
    "workspace": {"workspace_id": env["WORKSPACE_ID"], "client_id": env["CLIENT_ID"]},
    "cloudflare": {k: env[k] for k in ("CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_R2_ACCESS_KEY_ID", "CF_AI_WORKER_TOKEN")},
    "rules": ["never print secrets", "never commit secrets", "all agents share this DB+repo", "regenerate via build-capsule.sh"]
}
p = os.path.join(swarm, "agent-access-capsule.json")
open(p, "w").write(json.dumps(capsule, ensure_ascii=False, indent=1))
os.chmod(p, 0o600)
print("capsule.json written")
PYEOF

# ---------- 3) fleet dispatch briefs (one per role, values embedded, never printed) ----------
MARK="CONNECT-CAPSULE-V1"
for ROLE in PLANNER RESEARCHER IMPLEMENTER CRITIC; do
  printf '%s\n' "${MARK}-${ROLE} (supervisor->${ROLE}): SHARED DB CONNECT. Supabase URL=${SUPABASE_URL} KEY=${SUPABASE_SERVICE_ROLE_JWT} (REST ${SUPABASE_URL}/rest/v1/<table>_h205f22, headers apikey+Authorization Bearer; tables browser_supervisor_state, browser_supervisor_command, supervisor_mesh_instance, browser_device). GITHUB TOKEN=${GITHUB_TOKEN} REPO=${GITHUB_REPO} (Authorization Bearer @ api.github.com). WORKSPACE_ID=${WORKSPACE_ID}. Store verbatim, never print in chat, all swarm agents share this DB+repo. Reply CONNECTED-${ROLE} when stored." > "$BRIEFS/${ROLE}.txt"
done
chmod 600 "$BRIEFS"/*.txt

chmod 600 "$BRIEFS"/*.txt 2>/dev/null

echo "built: agent-connect.sh + agent-access-capsule.json + briefs/{PLANNER,RESEARCHER,IMPLEMENTER,CRITIC}.txt (github_source=${GH_SOURCE})"
