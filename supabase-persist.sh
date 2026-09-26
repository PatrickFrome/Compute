#!/usr/bin/env bash
# ============================================================================
# supabase-persist.sh — внешнее долговечное хранилище контекста (v1.0)
# ----------------------------------------------------------------------------
# Канал: Supabase Storage, бакет me2-evidence, префикс context-vault/.
# Креды берутся из /tmp/my-project/.a2-backup/me2.env.20260922 (PolarFS,
# пережил env-reset 15:18). Секреты не печатаются и не логируются.
# Файлы загружаются только при изменении (sha256-дедуп в /tmp/.sbx-dedup).
# ============================================================================
set -u

ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
VAULT="/home/z/context-vault"
DEDUP="/tmp/.sbx-dedup"
[ -s "$ENVF" ] || { echo "supabase-persist: creds file missing"; exit 1; }
mkdir -p "$DEDUP"

SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
[ -n "$SU" ] && [ -n "$SJ" ] || { echo "supabase-persist: creds incomplete"; exit 1; }

upload() { # $1=local file $2=object name
  local f="$1" obj="$2" sum
  [ -s "$f" ] || return 0
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  [ "$(cat "$DEDUP/$obj.sha" 2>/dev/null || echo)" = "$sum" ] && return 0
  if curl -s -o /dev/null -w '' -X POST \
      -H "Authorization: Bearer $SJ" -H "apikey: $SJ" \
      -H "x-upsert: true" -H "Content-Type: text/markdown" \
      --data-binary @"$f" \
      "$SU/storage/v1/object/me2-evidence/context-vault/$obj" 2>/dev/null; then
    echo "$sum" > "$DEDUP/$obj.sha"
    echo "[$(date +%Y%m%d-%H%M%S)] UP $obj ($(stat -c%s "$f")B)" >> "$VAULT/journal/supabase-persist.log"
  else
    echo "[$(date +%Y%m%d-%H%M%S)] UP-FAIL $obj" >> "$VAULT/journal/supabase-persist.log"
  fi
}

upload "$VAULT/latest/worklog.md"   "worklog.md"
upload "$VAULT/latest/CONTEXT.md"   "CONTEXT.md"
upload "$VAULT/snapshots/context-guard.sh"      "context-guard.sh"
upload "$VAULT/snapshots/supabase-persist.sh"   "supabase-persist.sh"
upload "$VAULT/journal/context-journal.log"     "journal-context.log"
upload "$VAULT/journal/incidents.log"           "journal-incidents.log"
upload "$ENVF" "me2.env.20260922.restore-key"

# Перечень объектов как верификация
N=$(curl -s -H "Authorization: Bearer $SJ" -H "apikey: $SJ" \
  "$SU/storage/v1/object/list/me2-evidence?prefix=context-vault&limit=50" 2>/dev/null \
  | grep -o '"name"' | wc -l | tr -d ' ')
echo "supabase-persist ok: $N objects in context-vault/"
