#!/usr/bin/env bash
# ============================================================================
# phoenix-snapshot.sh v2.0 — write-ahead снапшот контекста
# ----------------------------------------------------------------------------
# ЗАЧЕМ: guard снапшотит по факту изменения (каждые 15 мин), но между изменением
# и guard-тиком есть окно. Write-ahead закрывает его: ВЫЗЫВАТЬ ПЕРЕД любой
# правкой worklog.md / CONTEXT.md (append, merge, реставрация).
# Использование:
#   bash scripts/phoenix/phoenix-snapshot.sh              # worklog + CONTEXT
#   bash scripts/phoenix/phoenix-snapshot.sh <файл>       # произвольный файл
# Дедуп по sha256 (не создаёт дубль), ротация 60, секреты не логируются.
# ============================================================================
set -u
VAULT="/home/z/context-vault"
WA="$VAULT/snapshots-wa"
JOUR="$VAULT/journal/phoenix.log"
mkdir -p "$WA" "$VAULT/journal" 2>/dev/null

ts="$(date +%Y%m%d-%H%M%S)"
made=0
for f in "$@"; do :; done
targets=("$@")
if [ ${#targets[@]} -eq 0 ] || [ -z "${targets[0]:-}" ]; then
  targets=("/home/z/my-project/worklog.md" "/home/z/my-project/CONTEXT.md")
fi

for f in "${targets[@]}"; do
  [ -s "$f" ] || continue
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  base="$(basename "$f" | sed 's/\.[^.]*$//')"
  # дедуп: тот же sha уже есть в wa-снапшотах этого имени — пропустить
  if [ -n "$(sha256sum "$WA/${base}-"*".md" 2>/dev/null | grep "^$sum" | head -1 || true)" ]; then
    continue
  fi
  cp "$f" "$WA/${base}-wa-${ts}.md" || continue
  echo "$sum" > "$WA/.last-${base}.sha"
  echo "[$ts] WA-SNAP ${base} bytes=$(stat -c%s "$f") sha12=${sum:0:12}" >> "$JOUR"
  made=$((made+1))
done

# ротация: 60 на каждое имя
for base in worklog CONTEXT; do
  ls -1t "$WA/${base}-wa-"*".md" 2>/dev/null | tail -n +61 | xargs -r rm -f
done
echo "snapshot ok: made=$made dir=$WA"
