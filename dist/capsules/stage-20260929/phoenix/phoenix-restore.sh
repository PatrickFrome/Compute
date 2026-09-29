#!/usr/bin/env bash
# ============================================================================
# phoenix-restore.sh v2.0 — кворум-рестор + секционный merge-append worklog
# ----------------------------------------------------------------------------
# РЕЖИМЫ:
#   --check            только отчёт по 8 источникам + вердикт (без изменений)
#   --restore          рестор worklog из лучшего (наибольшего) источника
#                      (текущий локальный архивируется как truncated-*)
#   --merge            СЕКЦИОННЫЙ merge-append: добавляет только те секции
#                      (блоки «--- / Task ID:»), которых нет локально.
#                      БЕЗОПАСНО для мульти-чатов: ничего не удаляет/не меняет.
#   [файл]             опционально: работать с другим файлом (по умолчанию worklog.md)
# Примеры:
#   bash scripts/phoenix/phoenix-restore.sh --check
#   bash scripts/phoenix/phoenix-restore.sh --merge
# ============================================================================
set -u
PROJ="/home/z/my-project"
VAULT="/home/z/context-vault"
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
SYNC="/home/sync/me2-context-backups"
TMPM="/tmp/context-vault-mirror"
PFSM="/tmp/my-project/context-vault-mirror"
DEDUP="/tmp/.phx-dedup"
CACHE="/tmp/.phx-restore-cache"
JOUR="$VAULT/journal/phoenix.log"
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CACHE" "$VAULT/journal" 2>/dev/null

MODE="${1:---check}"
FILE=""
case "$MODE" in
  --check|--restore|--merge) shift || true ;;
  *) FILE="$MODE"; MODE="--check"; shift || true ;;
esac
if [ -z "$FILE" ]; then FILE="${1:-$PROJ/worklog.md}"; fi
BASE="$(basename "$FILE")"

sha_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
size_of() { stat -c%s "$1" 2>/dev/null || echo 0; }

# --- Supabase download (креды из PolarFS-бэкапа) ---
sb_get() { # $1=object $2=dest -> http code
  local SU="" SJ=""
  [ -s "$ENVF" ] && {
    SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
    SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
  }
  [ -n "$SU" ] && [ -n "$SJ" ] || { echo "000"; return; }
  curl -s -o "$2" -w '%{http_code}' --max-time 120 \
    -H "Authorization: Bearer $SJ" -H "apikey: $SJ" \
    "$SU/storage/v1/object/me2-evidence/context-vault/$1" 2>/dev/null || echo "000"
}

# =========================================================
# Сбор кандидатов
# =========================================================
declare -a SRC_PATHS=()
declare -a SRC_LABELS=()
add_src() { [ -s "$1" ] && SRC_PATHS+=("$1") && SRC_LABELS+=("$2") && return 0; }

[ -s "$FILE" ] && add_src "$FILE" "local:$FILE"
add_src "$VAULT/latest/$BASE" "vault-latest"
newest_snap="$(ls -1t "$VAULT/snapshots/${BASE%.*}-"*".${BASE##*.}" 2>/dev/null | head -1 || true)"
[ -n "${newest_snap:-}" ] && [ -s "$newest_snap" ] && add_src "$newest_snap" "vault-snapshot:$(basename "$newest_snap")"
add_src "$VAULT/repo/$BASE" "vault-git-repo"
add_src "$TMPM/$BASE" "tmp-mirror"
add_src "$PFSM/$BASE" "polarfs-mirror"
add_src "$SYNC/latest/$BASE" "ossfs-latest"
CACHE_TTL=1800; [ "$MODE" = "--check" ] && CACHE_TTL=300  # check требует свежести вердикта
if [ ! -s "$CACHE/sb-$BASE" ] || [ $(( $(date +%s) - $(stat -c%Y "$CACHE/sb-$BASE" 2>/dev/null || echo 0) )) -gt "$CACHE_TTL" ]; then
  code="$(sb_get "latest/$BASE" "$CACHE/sb-$BASE.tmp")"
  if [ "$code" = "200" ] && [ -s "$CACHE/sb-$BASE.tmp" ]; then mv "$CACHE/sb-$BASE.tmp" "$CACHE/sb-$BASE"; fi
  rm -f "$CACHE/sb-$BASE.tmp"
fi
[ -s "$CACHE/sb-$BASE" ] && add_src "$CACHE/sb-$BASE" "supabase-latest"

# =========================================================
# --check: таблица + вердикт
# =========================================================
if [ "$MODE" = "--check" ]; then
  echo "== PHOENIX CHECK: $BASE ($(date -u '+%Y-%m-%dT%H:%M:%SZ')) =="
  best=0; bestlbl="-"
  i=0
  for p in "${SRC_PATHS[@]}"; do
    sz="$(size_of "$p")"; sh="$(sha_of "$p" | cut -c1-12)"; mt="$(stat -c%y "$p" 2>/dev/null | cut -d. -f1)"
    printf '%-34s %10sB sha12=%s mtime=%s\n' "${SRC_LABELS[$i]}" "$sz" "$sh" "$mt"
    if [ "$sz" -gt "$best" ]; then best="$sz"; bestlbl="${SRC_LABELS[$i]}"; fi
    i=$((i+1))
  done
  [ $i -eq 0 ] && { echo "ВЕРДИКТ: НЕТ НИ ОДНОЙ КОПИИ — критическая потеря, запусти Context Guard (cron 416526) для феникс-пересоздания"; exit 2; }
  lsz="$(size_of "$FILE" 2>/dev/null || echo 0)"
  if [ "$lsz" -ge "$best" ]; then
    echo "ВЕРДИКТ: OK — локальная копия полная или каноническая ($lsz B)"
  elif [ "$lsz" -lt $((best * 60 / 100)) ]; then
    echo "ВЕРДИКТ: УСЕЧЕНИЕ — локально $lsz B, максимум $best B ($bestlbl). Выполни: $0 --restore"
  else
    echo "ВЕРДИКТ: НЕПОЛНАЯ — локально $lsz B < $best B ($bestlbl). Выполни: $0 --merge (добавит отсутствующие секции)"
  fi
  exit 0
fi

# =========================================================
# Секционный парсер: блок = «---» + следующая строка «Task ID: …»
# =========================================================
split_sections() { # $1=file $2=outdir -> echo count (blk-0000 = заголовок, не merge)
  local file="$1" outdir="$2"
  mkdir -p "$outdir"; rm -f "$outdir"/blk-*.txt
  local lines=() i=0 n=0 idx=0 buf=""
  mapfile -t lines < "$file" 2>/dev/null || return 0
  n=${#lines[@]}
  while (( i < n )); do
    if [[ "${lines[$i]}" == "---" ]] && (( i+1 < n )) && [[ "${lines[$((i+1))]}" == "Task ID: "* ]]; then
      if (( idx > 0 )) && [ -n "$buf" ]; then printf '%s\n' "$buf" > "$outdir/$(printf 'blk-%04d.txt' "$idx")"; fi
      idx=$((idx+1)); buf="${lines[$i]}"
    else
      if [ -z "$buf" ]; then buf="${lines[$i]}"; else buf+=$'\n'"${lines[$i]}"; fi
    fi
    i=$((i+1))
  done
  if (( idx > 0 )) && [ -n "$buf" ]; then printf '%s\n' "$buf" > "$outdir/$(printf 'blk-%04d.txt' "$idx")"; fi
  echo "$idx"
}

# =========================================================
# --restore: рестор из наибольшего источника
# =========================================================
if [ "$MODE" = "--restore" ]; then
  best=0; bestp=""
  for p in "${SRC_PATHS[@]}"; do
    [ "$p" = "$FILE" ] && continue
    sz="$(size_of "$p")"
    if [ "$sz" -gt "$best" ]; then best="$sz"; bestp="$p"; fi
  done
  if [ -z "$bestp" ] || [ "$best" -le "$(size_of "$FILE" 2>/dev/null || echo 0)" ]; then
    echo "restore: локальная копия уже максимальная — рестор не нужен"; exit 0
  fi
  [ -f "$FILE" ] && cp "$FILE" "$VAULT/snapshots/truncated-${ts}.$$.md"
  cp "$bestp" "$FILE" || { echo "restore FAILED"; exit 1; }
  echo "[$ts] PHX-RESTORE: $BASE восстановлен из $bestp ($best B; было $(size_of "$VAULT/snapshots/truncated-${ts}.$$.md" 2>/dev/null || echo 0) B)" >> "$JOUR"
  echo "restore ok: из $bestp ($best B); прежний файл в $VAULT/snapshots/truncated-${ts}.$$.md"
  exit 0
fi

# =========================================================
# --merge: секционный merge-append (мульти-чат-безопасный)
# =========================================================
if [ "$MODE" = "--merge" ]; then
  [ -s "$FILE" ] || { echo "merge: локального файла нет — используй --restore"; exit 1; }
  lsz="$(size_of "$FILE")"; lsha="$(sha_of "$FILE")"
  LDIR="$CACHE/loc-$$"; mkdir -p "$LDIR"
  split_sections "$FILE" "$LDIR" >/dev/null
  # ключи локальных секций: sha тела (dedup ТОЛЬКО по телу —
  # одноимённые Task ID из разных чатов НЕ теряются)
  : > "$LDIR/keys"
  for blk in "$LDIR"/blk-*.txt; do
    [ -f "$blk" ] || continue
    echo "S:$(sha_of "$blk")" >> "$LDIR/keys"
  done
  loc_sections="$(grep -c '^Task ID: ' "$FILE" 2>/dev/null || echo 0)"
  hdr_done=""
  total_missing=0; merged_from=""
  # источники: только БОЛЬШЕ локального, по возрастанию mtime (старые вперёд)
  mapfile -t cands < <(for p in "${SRC_PATHS[@]}"; do
    [ "$p" = "$FILE" ] && continue
    sz="$(size_of "$p")"
    [ "$sz" -gt "$lsz" ] && echo "$(stat -c%Y "$p") $p"
  done | sort -n | cut -d' ' -f2-)
  for src in "${cands[@]:-}"; do
    [ -n "${src:-}" ] && [ -s "$src" ] || continue
    SDIR="$CACHE/src-$$-$(basename "$src" | tr -c 'A-Za-z0-9._-' '_')"; mkdir -p "$SDIR"
    split_sections "$src" "$SDIR" >/dev/null
    # blk-0000 (заголовок до первой секции) переносим ТОЛЬКО если локально
    # ещё нет ни одной секции (восстановление wiped-файла)
    if [ -z "$hdr_done" ] && [ "$loc_sections" = "0" ] && [ -s "$SDIR/blk-0000.txt" ]; then
      hsha="$(sha_of "$SDIR/blk-0000.txt")"
      grep -qxF "S:$hsha" "$LDIR/keys" || { cat "$SDIR/blk-0000.txt" >> "$FILE"; echo "S:$hsha" >> "$LDIR/keys"; hdr_done=1; }
    fi
    miss=0
    for blk in "$SDIR"/blk-*.txt; do
      [ -f "$blk" ] || continue
      case "$(basename "$blk")" in blk-0000.txt) continue ;; esac
      tid="$(grep -m1 '^Task ID: ' "$blk" | sed 's/^Task ID: //')"
      bsha="$(sha_of "$blk")"
      grep -qxF "S:$bsha" "$LDIR/keys" && continue
      # добавить в конец локального файла (варианты с тем же Task ID сохраняются)
      printf '\n%s\n' "$(cat "$blk")" >> "$FILE"
      echo "S:$bsha" >> "$LDIR/keys"
      miss=$((miss+1))
    done
    if [ "$miss" -gt 0 ]; then
      total_missing=$((total_missing+miss))
      merged_from="$merged_from $(basename "$src"):+$miss"
    fi
    rm -rf "$SDIR"
  done
  rm -rf "$LDIR"
  nsz="$(size_of "$FILE")"
  if [ "$total_missing" -gt 0 ]; then
    echo "[$ts] PHX-MERGE: $BASE +$total_missing секций из:$merged_from ($lsz → $nsz B)" >> "$JOUR"
    echo "merge ok: +$total_missing секций ($lsz → $nsz B) из:$merged_from"
  else
    echo "merge ok: локальная копия уже содержит все секции источников ($lsz B)"
  fi
  exit 0
fi

echo "usage: $0 [--check|--restore|--merge] [file]"
exit 1
