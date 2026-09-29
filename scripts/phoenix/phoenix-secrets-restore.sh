#!/usr/bin/env bash
# phoenix-secrets-restore.sh — v2-recreated (2026-09-28, post-reset rebuild by SECRETS-PHOENIX tick)
# Functional equivalent: verifies sealed secrets, reports HTTP statuses only. NEVER prints values.
# NOTE: original script lost in sandbox reset 2026-09-28 ~00:00 +08 (not in ossfs/versioned mirrors,
# not in git, not on GitHub). AUTO-AUDIT passthrough kept only if full-audit.sh exists (honest mode).
set -u
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
GH="/home/z/.a2/.github.env"
AUDIT="/home/z/my-project/scripts/phoenix/full-audit.sh"
echo "== phoenix-secrets-restore (v2-recreated) =="

# --- 1) me2.env reference keys ---
miss=""
for K in SUPABASE_URL CF_API_TOKEN CF_ACCOUNT_ID CF_R2_ACCESS_KEY_ID CF_AI_WORKER_TOKEN; do
  grep -q "^${K}=" "$ENVF" 2>/dev/null || miss="$miss $K"
done
if [ -z "$miss" ]; then
  echo "state: me2.env.20260922 present, reference keys complete (kept)"
else
  echo "state: me2.env.20260922 MISSING KEYS:$miss"
fi

# --- 2) github.env validity (API code only) ---
gh_code="000"
if [ -s "$GH" ]; then
  # shellcheck disable=SC1090
  . "$GH"
  if [ -n "${GITHUB_TOKEN_ADMIN:-}" ]; then
    gh_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -H "Authorization: Bearer ${GITHUB_TOKEN_ADMIN}" https://api.github.com/user 2>/dev/null)"
    gh_code="${gh_code:-000}"
  fi
fi
echo "state: github.env present (api=${gh_code})"

# --- 3) Supabase REST probe (JWT may be the lost one) ---
SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\n "')"
SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\n "')"
sb_code="no-jwt"
if [ -n "$SU" ] && [ -n "$SJ" ]; then
  sb_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "apikey: ${SJ}" -H "Authorization: Bearer ${SJ}" "${SU}/rest/v1/" 2>/dev/null)"
  sb_code="${sb_code:-000}"
fi
if [ "$sb_code" = "200" ]; then
  echo "state: supabase REST=${sb_code} (JWT restored)"
elif [ "$sb_code" = "no-jwt" ]; then
  echo "state: supabase BLOCKED — JWT pending operator"
else
  echo "state: supabase REST=${sb_code} (degraded)"
fi

# --- 4) audit passthrough (only if audit script survived) ---
if [ -s "$AUDIT" ]; then
  echo "== AUTO-AUDIT =="
  bash "$AUDIT" 2>&1 | tail -6
else
  echo "audit: full-audit.sh missing (lost in reset 2026-09-28) — audit passthrough skipped"
fi
