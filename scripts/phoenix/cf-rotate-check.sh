#!/usr/bin/env bash
# cf-rotate-check.sh — phoenix helper (Job 416759).
# Ищет живой CF_API_TOKEN в запечатанных bootstrap-носителях; если кандидат отличается
# от me2.env и проходит tokens/verify (HTTP 200) — сходит строку CF_API_TOKEN в me2.env.
# ИНВАРИАНТ: значений секретов не печатает. Файл не коммитится (untracked, repo-safe).
set -u
F=/tmp/my-project/.a2-backup/me2.env.20260922
CANDS=(
  /home/z/my-project/scripts/phoenix/phoenix-secrets-restore.sealed.sh
  /tmp/my-project/phoenix-sealed/secrets-bootstrap.sh
  /tmp/context-vault-mirror/phoenix-sealed/secrets-bootstrap.sh
  /home/sync/me2-context-backups/phoenix-sealed/secrets-bootstrap.sh
)
extract() { # $1=key $2=file -> value (stdout), empty if absent
  grep -m1 -oE "(^|[[:space:]\"'])$1=[^[:space:]\"']+" "$2" 2>/dev/null | head -1 | sed -E "s/^.*$1=//" | tr -d '"'"'"''
}
cur=$(extract CF_API_TOKEN "$F")
[ -n "$cur" ] || { echo "me2.env CF_API_TOKEN: ABSENT"; exit 0; }
cur_code=$(curl -s -o /dev/null -w '%{http_code}' -m 12 -H "Authorization: Bearer $cur" https://api.cloudflare.com/client/v4/user/tokens/verify)
echo "current me2.env CF_API_TOKEN: verify=$cur_code"
fixed=0
for c in "${CANDS[@]}"; do
  if [ -s "$c" ]; then
    cand=$(extract CF_API_TOKEN "$c")
    if [ -z "$cand" ]; then st="no-CF-key"; cf="n/a";
    elif [ "$cand" = "$cur" ]; then st="same-as-file"; cf="$cur_code";
    else
      cf=$(curl -s -o /dev/null -w '%{http_code}' -m 12 -H "Authorization: Bearer $cand" https://api.cloudflare.com/client/v4/user/tokens/verify)
      st="differs"
      if [ "$cf" = "200" ]; then
        sed -i "s|^CF_API_TOKEN=.*|CF_API_TOKEN=${cand}|" "$F"; chmod 600 "$F"; cur="$cand"; fixed=1
        st="CONVERGED->file"
      fi
    fi
    echo "candidate $(basename "$c") [$(dirname "$c" | cut -c1-40)]: exists, CF=$st verify=$cf"
  else
    echo "candidate $c: ABSENT"
  fi
done
new=$(extract CF_API_TOKEN "$F")
new_code=$(curl -s -o /dev/null -w '%{http_code}' -m 12 -H "Authorization: Bearer $new" https://api.cloudflare.com/client/v4/user/tokens/verify)
echo "final me2.env CF_API_TOKEN: verify=$new_code (rotated=$fixed)"
# R2/CF_AI в кандидатах: только факт наличия/совпадения, без верификации (нет дешёвого verify-эндпоинта)
for k in CF_R2_ACCESS_KEY_ID CF_AI_WORKER_TOKEN; do
  same=0; diff=0
  for c in "${CANDS[@]}"; do
    [ -s "$c" ] || continue
    v=$(extract "$k" "$c"); [ -n "$v" ] || continue
    fv=$(extract "$k" "$F")
    if [ "$v" = "$fv" ]; then same=$((same+1)); else diff=$((diff+1)); fi
  done
  echo "key $k: candidates_same_with_file=$same differs=$diff"
done
