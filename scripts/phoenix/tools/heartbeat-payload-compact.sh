#!/usr/bin/env bash
# phoenix-heartbeat v2.2 compact (cron last-resort; full: scripts/phoenix ≡ vault/latest ≡ ossfs/Supabase). flock; JWT via header-file (no ps leak); retry 3x+backoff; masked err-body; auth-breaker (401/403 or body-auth in 400); staleness 6h.
# NOTE: strings kept ASCII on purpose — cron payload is length-limited with \u-escaping.
set -u
exec 9>/tmp/.phx-hb.lock; flock -n 9 || exit 0
PROJ="/home/z/my-project"; VAULT="/home/z/context-vault"; ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
SYNC="/home/sync/me2-context-backups"; TMPM="/tmp/context-vault-mirror"; PFSM="/tmp/my-project/context-vault-mirror"
WL="$PROJ/worklog.md"; CTX="$PROJ/CONTEXT.md"; PROTO="$PROJ/PHOENIX-PROTOCOL.md"; DIG="$PROJ/CONTEXT-CURRENT.md"
DEDUP="/tmp/.phx-dedup"; LOG="$VAULT/journal/phoenix.log"; INC="$VAULT/journal/incidents.log"
ts="$(date +%Y%m%d-%H%M%S)"; now_ep="$(date +%s)"
mkdir -p "$DEDUP" "$VAULT/latest" "$VAULT/journal" "$TMPM" "$SYNC/latest" "$SYNC/versioned" "$PFSM" 2>/dev/null
sha_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
size_of() { stat -c%s "$1" 2>/dev/null || echo 0; }
aw() { printf '%s' "$2" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"; }
SU=""; SJ=""
[ -s "$ENVF" ] && { SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"; SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"; }
SB_ENABLED=1; { [ -n "$SU" ] && [ -n "$SJ" ]; } || SB_ENABLED=0
SB_AUTH_BROKEN=""; SB_HDR="$(mktemp /tmp/.phx-hdr.XXXXXX)"; chmod 600 "$SB_HDR" 2>/dev/null
[ "$SB_ENABLED" -eq 1 ] && printf 'Authorization: Bearer %s\napikey: %s\nx-upsert: true\nContent-Type: text/markdown\n' "$SJ" "$SJ" > "$SB_HDR"
SB_ERR_FILE="$DEDUP/sb-err.last"
sb_up() {
  : > "$SB_ERR_FILE" 2>/dev/null
  [ "$SB_ENABLED" -eq 1 ] && [ -s "$1" ] || { echo 000; return; }
  local code="" try
  for try in 1 2 3; do
    code="$(curl -s -o "$SB_HDR.body" -w '%{http_code}' -X POST -H @"$SB_HDR" --data-binary @"$1" --max-time 90 "$SU/storage/v1/object/me2-evidence/context-vault/$2" 2>/dev/null)"; code="${code:-000}"
    case "$code" in 2??) echo "$code"; return ;; 000|5*) [ "$try" -lt 3 ] && sleep $((try*5)) ;; *) break ;; esac
  done
  head -c 300 "$SB_HDR.body" 2>/dev/null | tr -d '\n' | sed -E 's/[A-Za-z0-9_.\/+-]{40,}/<masked>/g' > "$SB_ERR_FILE" 2>/dev/null
  echo "${code:-000}"
}
if [ -s "$WL" ]; then
  wlsz="$(size_of "$WL")"; wlsha="$(sha_of "$WL")"
  { echo "# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)"; echo ""
    echo "gen: $(date -u '+%Y-%m-%dT%H:%M:%SZ') | worklog: ${wlsz}B / $(wc -l < "$WL" | tr -d ' ')L | sha12=${wlsha:0:12}"; echo ""
    echo "## RECOVERY: 1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check (quorum 8; --merge if truncated) 2) read /home/z/my-project/CONTEXT.md + PHOENIX-PROTOCOL.md 3) tail of worklog.md (canonical journal) 4) Supabase diagnostics: tail $LOG (HB-SB-FAIL has masked err-body)"
    echo "CHANNELS of worklog (${wlsz}B, sha12=${wlsha:0:12}): Supabase me2-evidence/context-vault/latest/ | ossfs $SYNC/latest/ | vault /home/z/context-vault/{latest,repo} | cron-KV CTX-SHARD-A/B"
    echo "CRON: 413338 PAT(15m) | 416526 Guard(15m) | PHX-HEARTBEAT(30m) | COMPACTOR(1h)"; echo ""
    awk '/^Task ID: /{tid=substr($0,10)} /^Task: /{if(tid!=""){print "- " tid " -> " substr($0,7); tid=""}}' "$WL" | tail -15
    echo ""; tail -40 "$WL"; } > "$DIG.tmp" && mv "$DIG.tmp" "$DIG"
else echo "[$ts] HB-WL-MISSING: worklog empty - run phoenix-restore.sh --merge" >> "$INC" 2>/dev/null || true; fi
cp_ok=0
for pair in "$WL:$VAULT/latest/worklog.md" "$CTX:$VAULT/latest/CONTEXT.md" "$DIG:$VAULT/latest/CONTEXT-CURRENT.md" "$PROTO:$VAULT/latest/PHOENIX-PROTOCOL.md" "$PROJ/scripts/phoenix/phoenix-heartbeat.sh:$VAULT/latest/phoenix-heartbeat.sh" "$PROJ/scripts/phoenix/phoenix-restore.sh:$VAULT/latest/phoenix-restore.sh" "$PROJ/scripts/phoenix/phoenix-snapshot.sh:$VAULT/latest/phoenix-snapshot.sh" "$VAULT/context-guard.sh:$VAULT/latest/context-guard.sh" "$VAULT/supabase-persist.sh:$VAULT/latest/supabase-persist.sh" "$VAULT/journal/context-journal.log:$VAULT/latest/journal-context.log" "$VAULT/journal/incidents.log:$VAULT/latest/journal-incidents.log"; do
  src="${pair%%:*}"; dst="${pair#*:}"; [ "$src" = "$dst" ] && continue
  [ -s "$src" ] || continue
  cp "$src" "$dst" 2>/dev/null && cp_ok=$((cp_ok+1)) || echo "[$ts] HB-MIRROR-FAIL dst=$dst" >> "$LOG" 2>/dev/null || true
  cp "$src" "$TMPM/$(basename "$dst")" 2>/dev/null || true; cp "$src" "$PFSM/$(basename "$dst")" 2>/dev/null || true
done
sb_ok=0; sb_fail=0; sb_skip=0; sb_abs=0; stale_forced=0; FORCE_STALE_SECS=21600
up_latest() {
  [ -s "$1" ] || { sb_abs=$((sb_abs+1)); return 0; }
  local sum="$(sha_of "$1")" ded="$DEDUP/$2.sha" dts="$DEDUP/$2.ts" code ots
  ots="$(cat "$dts" 2>/dev/null || echo 0)"; ots="${ots:-0}"
  if [ "$(cat "$ded" 2>/dev/null || echo)" = "$sum" ] && [ $((now_ep - ots)) -lt "$FORCE_STALE_SECS" ]; then sb_skip=$((sb_skip+1)); return 0; fi
  [ "$(cat "$ded" 2>/dev/null || echo)" = "$sum" ] && stale_forced=$((stale_forced+1))
  code="$(sb_up "$1" "$2")"
  case "$code" in
    2??) mkdir -p "$DEDUP/$(dirname "$2")"; aw "$ded" "$sum"; aw "$dts" "$now_ep"; sb_ok=$((sb_ok+1)) ;;
    *) sb_fail=$((sb_fail+1)); echo "[$ts] HB-SB-FAIL $2 HTTP=$code err=$(cat "$SB_ERR_FILE" 2>/dev/null || echo none)" >> "$LOG" 2>/dev/null || true
       case "$code" in 401|403) SB_AUTH_BROKEN="$code" ;; esac
       if [ -z "$SB_AUTH_BROKEN" ] && grep -qE 'Invalid Compact JWS|AccessDenied|Unauthorized|invalid_jwt|InvalidJWT' "$SB_ERR_FILE" 2>/dev/null; then SB_AUTH_BROKEN="$code(body-auth)"; fi
       if [ -n "$SB_AUTH_BROKEN" ]; then SB_ENABLED=0; echo "[$ts] HB-SB-AUTH-FAIL HTTP=$code - Supabase disabled until next run" >> "$LOG" 2>/dev/null || true; fi ;;
  esac
}
up_latest "$WL" "latest/worklog.md"
up_latest "$CTX" "latest/CONTEXT.md"
up_latest "$DIG" "latest/CONTEXT-CURRENT.md"
up_latest "$PROTO" "latest/PHOENIX-PROTOCOL.md"
up_latest "$VAULT/latest/phoenix-heartbeat.sh" "latest/phoenix-heartbeat.sh"
up_latest "$VAULT/latest/phoenix-restore.sh" "latest/phoenix-restore.sh"
up_latest "$VAULT/latest/phoenix-snapshot.sh" "latest/phoenix-snapshot.sh"
up_latest "$VAULT/latest/context-guard.sh" "latest/context-guard.sh"
up_latest "$VAULT/latest/supabase-persist.sh" "latest/supabase-persist.sh"
up_latest "$VAULT/latest/journal-context.log" "latest/journal-context.log"
up_latest "$VAULT/latest/journal-incidents.log" "latest/journal-incidents.log"
ver="n"   # versioning lives in full heartbeat / phoenix-snapshot (compact skips it)
sync_ok=0
if [ -d "$SYNC/latest" ]; then
  for f in "$WL" "$CTX" "$DIG" "$PROTO"; do [ -s "$f" ] && cp "$f" "$SYNC/latest/$(basename "$f")" 2>/dev/null && sync_ok=$((sync_ok+1)) || true; done
  for f in "$VAULT"/latest/phoenix-*.sh "$VAULT"/latest/context-guard.sh; do [ -s "$f" ] && cp "$f" "$SYNC/latest/$(basename "$f")" 2>/dev/null && sync_ok=$((sync_ok+1)) || true; done
fi
if [ "$SB_ENABLED" -eq 0 ] && { [ -z "$SU" ] || [ -z "$SJ" ]; }; then sbstat="disabled"
elif [ -n "$SB_AUTH_BROKEN" ]; then sbstat="auth-fail(HTTP $SB_AUTH_BROKEN)"
else sbstat="${sb_ok}ok/${sb_fail}fail/${sb_skip}skip"; fi
cur_sb="ok"; case "$sbstat" in disabled|auth-fail*) cur_sb="degraded" ;; esac
if [ "$cur_sb" != "$(cat "$DEDUP/sb-state" 2>/dev/null || echo unknown)" ]; then
  [ "$cur_sb" = "degraded" ] && echo "[$ts] HB-SB-DEGRADED sb=$sbstat" >> "$INC" 2>/dev/null || true
  aw "$DEDUP/sb-state" "$cur_sb"
fi
echo "[$ts] HB bytes=$(size_of "$WL") sha12=$(sha_of "$WL" | cut -c1-12) sb=$sbstat stale=$stale_forced abs=$sb_abs ver=$ver sync=$sync_ok" >> "$LOG" 2>/dev/null || true
rm -f "$SB_HDR" "$SB_HDR.body" 2>/dev/null
echo "heartbeat ok: wb=$(size_of "$WL") sha12=$(sha_of "$WL" | cut -c1-12) sb=$sbstat ver=$ver sync=$sync_ok cp=$cp_ok stale=$stale_forced abs=$sb_abs v=2.2"
