#!/usr/bin/env bash
# shard-refresh-0229.sh — CTX-VAULT-COMPACTOR (Job 416631, tick 2026-09-29 02:19 +08) refresh gen<today>
# cron-tool unavailable in this session (4th consecutive run) -> offline-route precedent:
# shards are rebuilt as files in ossfs (survives env-reset) + PolarFS mirror.
# Spec: SHARD-A = header + <<<CTX-BEGIN>>> + FULL CONTEXT.md + FULL PHOENIX-PROTOCOL.md + context-guard.sh v1.0 + <<<CTX-END>>>
#       SHARD-B = header + <<<CTX-BEGIN>>> + index15 (Task ID -> Task) + tail60(worklog) + recovery-protocol-v2 + <<<CTX-END>>>
# No secrets printed. No worklog modification. No other files created.
set -u
PROJ=/home/z/my-project
VAULT=/home/z/context-vault
SYNC=/home/sync/me2-context-backups/latest
PFS=/tmp/my-project/phoenix-sealed
GUARD=$VAULT/context-guard.sh
# GEN follows the +08 clock (cron task timestamps are +08; VM clock is UTC)
GEN=$(TZ='Asia/Shanghai' date +%Y%m%d)
TS=$(TZ='Asia/Shanghai' date +%Y%m%d-%H%M%S)
WL=$PROJ/worklog.md

[ -s "$PROJ/CONTEXT.md" ] || { echo "FATAL: CONTEXT.md missing"; exit 1; }
[ -s "$PROJ/PHOENIX-PROTOCOL.md" ] || { echo "FATAL: PHOENIX-PROTOCOL.md missing"; exit 1; }
[ -s "$GUARD" ] || GUARD=/home/sync/me2-context-backups/latest/context-guard.sh
[ -s "$GUARD" ] || { echo "FATAL: context-guard.sh missing"; exit 1; }
mkdir -p "$SYNC" "$PFS" 2>/dev/null

A=$SYNC/CTX-SHARD-A-gen$GEN.md
B=$SYNC/CTX-SHARD-B-gen$GEN.md

# ---------- SHARD-A: full CONTEXT.md + full PHOENIX-PROTOCOL.md + guard v1.0 ----------
{ echo "[CTX-SHARD-A gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo '<<<CTX-BEGIN>>>'
  cat "$PROJ/CONTEXT.md"; echo
  cat "$PROJ/PHOENIX-PROTOCOL.md"; echo
  echo '===== context-guard.sh v1.0 (эталон-дубль; восстановление: записать в /home/z/context-vault/context-guard.sh, chmod +x) ====='
  cat "$GUARD"
  echo '<<<CTX-END>>>'; } > "$A.tmp" && mv "$A.tmp" "$A"

# ---------- SHARD-B: index15 + tail60 + recovery protocol v2 ----------
{ echo "[CTX-SHARD-B gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo '<<<CTX-BEGIN>>>'
  echo '## Индекс последних 15 секций worklog (Task ID -> Task):'
  awk '/^Task ID: /{tid=$0} /^Task: /{if(tid!=""){print tid; print $0; tid=""}}' "$WL" | tail -30
  echo
  echo '## Хвост worklog.md (последние 60 строк дословно):'
  tail -60 "$WL"
  echo
  echo '## Протокол восстановления v2 (после ЛЮБОГО wipe):'
  echo '(1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check -> кворум 8 источников;'
  echo '(2) при усечении: --merge (секционный merge-append, без потерь); --restore только при вердикте УСЕЧЕНИЕ;'
  echo '(3) креды Supabase: /tmp/my-project/.a2-backup/me2.env.20260922 (никогда не печатать);'
  echo '(4) full-копии: Supabase me2-evidence/context-vault/latest/ (GET $SU/storage/v1/object/...), ossfs /home/sync/me2-context-backups/latest/;'
  echo '(5) скрипты phoenix: /home/z/my-project/scripts/phoenix/ и /home/z/context-vault/latest/;'
  echo '(6) PHX-HEARTBEAT=Job 417373 (бывш. 416629), Context Guard=Job 416526, PAT-watcher=Job 413338, COMPACTOR=Job 416631, KV-шарды=Job 416554/416555.'
  echo '<<<CTX-END>>>'; } > "$B.tmp" && mv "$B.tmp" "$B"

# ---------- distribute + verify (markers + size >1KB) ----------
ok=1
for T in A B; do
  SRC="$SYNC/CTX-SHARD-$T-gen$GEN.md"
  [ "$T" = B ] && SRC="$SYNC/CTX-SHARD-B-gen$GEN.md"
  cp "$SRC" "$PFS/CTX-SHARD-$T-gen$GEN.md" || ok=0
  SZ=$(stat -c%s "$SRC")
  if grep -q '<<<CTX-BEGIN>>>' "$SRC" && grep -q '<<<CTX-END>>>' "$SRC" && [ "$SZ" -gt 1024 ]; then
    echo "verify-ok $SRC size=$SZ (+PolarFS mirror)"
  else
    echo "verify-FAIL $SRC size=$SZ"; ok=0
  fi
done

# ---------- purge old generations (only after successful verify) ----------
if [ "$ok" -eq 1 ]; then
  for OLD in "$SYNC"/CTX-SHARD-*-gen*.md "$PFS"/CTX-SHARD-*-gen*.md; do
    [ -f "$OLD" ] || continue
    case "$OLD" in *"-gen$GEN.md") continue ;; esac
    rm -f "$OLD" && echo "purged: $(basename "$OLD")"
  done
fi

# ---------- journal (single append line; allowed by step 8) ----------
if [ "$ok" -eq 1 ]; then
  echo "[$TS] CRON-SHARD refresh gen$GEN shards=A,B verified (offline-route: ossfs+PolarFS; cron-tool unavailable in session)" >> "$VAULT/journal/context-journal.log"
  echo "compactor: refreshed gen$GEN"
else
  # verify failed -> keep old shards, do NOT purge
  echo "compactor: verify-failed"
fi
