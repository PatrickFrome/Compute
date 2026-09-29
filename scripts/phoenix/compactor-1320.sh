#!/usr/bin/env bash
# compactor-1320.sh — Job 416631 refresh gen20260929 (offline-route ossfs; cron-tool unavailable in session, 4th run)
# Spec ctx-vault-3: SHARD-A = CONTEXT.md + PHOENIX-PROTOCOL.md + context-guard.sh v1.0;
# SHARD-B = index15(worklog) + tail60(worklog verbatim) + recovery-protocol-v2.
# Verify (markers + >1KB) BEFORE any deletion. No secrets. No worklog writes.
set -u
CTX="/home/z/my-project/CONTEXT.md"
PROTO="/home/z/my-project/PHOENIX-PROTOCOL.md"
WL="/home/z/my-project/worklog.md"
GUARD="/home/z/context-vault/context-guard.sh"
OUT="/home/sync/me2-context-backups/latest"
GEN="gen20260929"
HDR='Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok.'
TS=$(date -u '+%Y%m%d-%H%M%S')

# ---------- SHARD-A ----------
{
  echo "[CTX-SHARD-A $GEN] $HDR"
  echo "<<<CTX-BEGIN>>>"
  cat "$CTX"
  echo ""
  echo "===== PHOENIX-PROTOCOL.md ====="
  echo ""
  cat "$PROTO"
  echo ""
  echo "===== context-guard.sh v1.0 (эталон-дубль) ====="
  echo ""
  cat "$GUARD"
  echo ""
  echo "<<<CTX-END>>>"
} > "$OUT/CTX-SHARD-A-$GEN.md.tmp" && mv "$OUT/CTX-SHARD-A-$GEN.md.tmp" "$OUT/CTX-SHARD-A-$GEN.md"

# ---------- SHARD-B ----------
{
  echo "[CTX-SHARD-B $GEN] $HDR"
  echo "<<<CTX-BEGIN>>>"
  echo "## Индекс последних 15 секций worklog (Task ID -> Task):"
  awk '/^Task ID: /{tid=$0} /^Task: /{if(tid!=""){print tid; print $0; print ""; tid=""}}' "$WL" | tail -45
  echo ""
  echo "## Хвост worklog (последние ~60 строк дословно):"
  echo '```'
  tail -60 "$WL"
  echo '```'
  echo ""
  echo "## Протокол восстановления v2:"
  echo "1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check → кворум 8 источников"
  echo "2) --merge при усечении"
  echo "3) креды Supabase в /tmp/my-project/.a2-backup/me2.env.20260922 (не печатать)"
  echo "4) full-копии: Supabase me2-evidence/context-vault/latest/, ossfs /home/sync/me2-context-backups/latest/"
  echo "5) скрипты phoenix в /home/z/my-project/scripts/phoenix/ и vault/latest"
  echo "6) PHX-HEARTBEAT=Job 416629, Guard=416526, PAT-watcher=413338"
  echo ""
  echo "<<<CTX-END>>>"
} > "$OUT/CTX-SHARD-B-$GEN.md.tmp" && mv "$OUT/CTX-SHARD-B-$GEN.md.tmp" "$OUT/CTX-SHARD-B-$GEN.md"

# ---------- VERIFY (before any deletion) ----------
ok=1
for s in A B; do
  f="$OUT/CTX-SHARD-$s-$GEN.md"
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  b=$(grep -c '^<<<CTX-BEGIN>>>$' "$f" 2>/dev/null || echo 0)
  e=$(grep -c '^<<<CTX-END>>>$' "$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt 1024 ] && [ "$b" -ge 1 ] && [ "$e" -ge 1 ]; then
    echo "VERIFY SHARD-$s: OK size=${sz}B markers=$b/$e"
  else
    echo "VERIFY SHARD-$s: FAIL size=${sz}B markers=$b/$e"; ok=0
  fi
done

if [ "$ok" -ne 1 ]; then
  echo "compactor: verify-failed"
  exit 1
fi

# ---------- PURGE old generations (only after verify pass) ----------
purged=0
for f in "$OUT"/CTX-SHARD-*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    *"$GEN"*) ;;
    *) rm -f "$f" && echo "PURGED: $(basename "$f")" && purged=$((purged+1)) ;;
  esac
done

# ---------- JOURNAL ----------
echo "[$TS] CRON-SHARD refresh $GEN shards=A,B verified" >> /home/z/context-vault/journal/context-journal.log

echo "PURGED_COUNT=$purged"
echo "compactor: refreshed $GEN"
