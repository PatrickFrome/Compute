#!/usr/bin/env bash
# build-ctx-shards.sh — CTX-VAULT-COMPACTOR builder (v1.1-recreated, 2026-09-28 post-reset)
# Builds offline phoenix shards CTX-SHARD-{A,B}-gen<date> into ossfs latest/ + PolarFS phoenix-sealed/.
# Precedent gen20260927: offline-route keeps FULL documents (cron payload limit 10K applies only to cron-KV).
set -u
PROJ="/home/z/my-project"
SYNC="/home/sync/me2-context-backups/latest"
PFS="/tmp/my-project/phoenix-sealed"
GUARD="/home/z/context-vault/context-guard.sh"
# GEN follows the +08 clock (cron task timestamps are +08; VM clock is UTC — do not use bare date)
GEN="$(TZ='Asia/Shanghai' date +%Y%m%d)"
WL="$PROJ/worklog.md"

mkdir -p "$SYNC" "$PFS" 2>/dev/null
[ -s "$PROJ/CONTEXT.md" ] || { echo "FATAL: CONTEXT.md missing"; exit 1; }
[ -s "$PROJ/PHOENIX-PROTOCOL.md" ] || { echo "FATAL: PHOENIX-PROTOCOL.md missing"; exit 1; }
[ -s "$GUARD" ] || GUARD="/home/sync/me2-context-backups/latest/context-guard.sh"
[ -s "$GUARD" ] || { echo "FATAL: context-guard.sh missing"; exit 1; }

TMPA="$(mktemp /tmp/.shard-a.XXXXXX)"
TMPB="$(mktemp /tmp/.shard-b.XXXXXX)"

# ---------- SHARD-A: CONTEXT.md (full) + PHOENIX-PROTOCOL.md (full) + guard v1.0 ----------
{
  echo "[CTX-SHARD-A gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo "<<<CTX-BEGIN>>>"
  cat "$PROJ/CONTEXT.md"
  echo ""
  cat "$PROJ/PHOENIX-PROTOCOL.md"
  echo ""
  echo "--- context-guard.sh v1.0 (эталон-дубль; восстановление: записать в /home/z/context-vault/context-guard.sh, chmod +x) ---"
  cat "$GUARD"
  echo "<<<CTX-END>>>"
} > "$TMPA"

# ---------- SHARD-B: индекс 15 секций + хвост 60 строк + протокол восстановления v2 ----------
{
  echo "[CTX-SHARD-B gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo "<<<CTX-BEGIN>>>"
  echo "## Индекс последних 15 секций worklog (Task ID → Task):"
  awk '/^Task ID: /{tid=$0} /^Task: /{if(tid!=""){print tid; print $0; tid=""}}' "$WL" | tail -30
  echo ""
  echo "## Хвост worklog.md (последние 60 строк дословно):"
  tail -60 "$WL"
  echo ""
  echo "## Протокол восстановления v2 (кратко):"
  echo "(1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check → кворум 8 источников;"
  echo "(2) --merge при усечении (секционный merge-append, без потерь); --restore при УСЕЧЕНИИ (архив truncated-*);"
  echo "(3) креды Supabase в /tmp/my-project/.a2-backup/me2.env.20260922 (chmod 600, секреты не печатать);"
  echo "(4) full-копии: Supabase me2-evidence/context-vault/latest/, ossfs /home/sync/me2-context-backups/latest/;"
  echo "(5) скрипты phoenix в /home/z/my-project/scripts/phoenix/ и /home/z/context-vault/latest/;"
  echo "(6) PHX-HEARTBEAT=Job 416629, Guard=416526, PAT-watcher=413338."
  echo "ADDENDUM 20260928-0850: worklog 2176181B sha12=e834fbcc (посл. секции: 419718-1530-PHASE3-CONSUMER-MIGRATION, 419718-1615-PHASE3-COMPLETE-ZAI-QUARANTINE, 419718-1615-PHASE3-SWARM-CONVERGENCE); фаза 3 §3-миграции ЗАКРЫТА (5/5 консьюмеров на fleet-readback канале, zai/gateway закварантинены ZAI_QUARANTINED=true, eval 70/70 закрепляет инвариант «ноль model-API»); остаток: worker.ts = 6-й консьюмер (fail-closed до миграции), органический reviewer-прогон ждёт первой TASK_DONE, RESEARCHER 10x silent (TOOL_REQUEST_V1 pending); корневой блокер submit→conversation подтверждён 5 раз — unlock ждёт оператора: очистить composer + localStorage['chat-input-']; LESSONS L20-L24 (L24: bracket-код верифицировать hex, не текстовым рендером)."
  echo "<<<CTX-END>>>"
} > "$TMPB"

# ---------- distribute + verify + purge old ----------
ok=1
for T in A B; do
  SRC="$TMPA"; [ "$T" = "B" ] && SRC="$TMPB"
  for DST in "$SYNC/CTX-SHARD-$T-gen$GEN.md" "$PFS/CTX-SHARD-$T-gen$GEN.md"; do
    cp "$SRC" "$DST" || ok=0
  done
  SIZE=$(stat -c%s "$SRC")
  { grep -q '<<<CTX-BEGIN>>>' "$SRC" && grep -q '<<<CTX-END>>>' "$SRC" && [ "$SIZE" -gt 1024 ]; } || { echo "VERIFY-FAIL shard-$T size=$SIZE"; ok=0; }
  echo "shard-$T gen$GEN: ${SIZE}B -> ossfs+PolarFS"
done
rm -f "$TMPA" "$TMPB"

# purge old generations (both locations)
for OLD in "$SYNC"/CTX-SHARD-*-gen*.md "$PFS"/CTX-SHARD-*-gen*.md; do
  case "$OLD" in *"-gen$GEN.md") continue ;; esac
  [ -f "$OLD" ] && rm -f "$OLD" && echo "purged: $(basename "$OLD")"
done

[ "$ok" -eq 1 ] && echo "BUILD-OK gen$GEN" || { echo "BUILD-FAIL"; exit 1; }
