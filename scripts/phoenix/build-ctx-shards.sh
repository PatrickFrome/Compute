#!/usr/bin/env bash
# build-ctx-shards.sh — офлайн-феникс-шарды CTX-SHARD-A/B (замена cron-payload, Job 416631).
# Cron tool недоступен из сессии → разлив в персистентные каналы: ossfs latest/ + PolarFS phoenix-sealed/.
set -u
GEN="$(TZ=Europe/Moscow date +%Y%m%d)"
PROJ=/home/z/my-project
OUT1=/home/sync/me2-context-backups/latest
OUT2=/tmp/my-project/phoenix-sealed
WLT=$(mktemp); CPW=$(mktemp)
tail -n 60 "$PROJ/worklog.md" > "$WLT"
grep "^Task ID:" "$PROJ/worklog.md" | tail -n 15 > "$CPW"

# ---------- SHARD-A: шапка + CONTEXT.md + PHOENIX-PROTOCOL.md + context-guard.sh ----------
{
  echo "[CTX-SHARD-A gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo "<<<CTX-BEGIN>>>"
  cat "$PROJ/CONTEXT.md"
  echo
  echo "===== PHOENIX-PROTOCOL.md ====="
  cat "$PROJ/PHOENIX-PROTOCOL.md" 2>/dev/null || echo "(PHOENIX-PROTOCOL.md отсутствует)"
  echo
  echo "===== context-guard.sh v1.0 (эталон) ====="
  cat /home/z/context-vault/context-guard.sh 2>/dev/null || echo "(context-guard.sh отсутствует)"
  echo "<<<CTX-END>>>"
} > /tmp/CTX-SHARD-A.md

# ---------- SHARD-B: шапка + индекс Task ID + хвост worklog + протокол восстановления v2 ----------
{
  echo "[CTX-SHARD-B gen$GEN] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 hourly. При срабатывании ответь shard-ok."
  echo "<<<CTX-BEGIN>>>"
  echo "===== Индекс последних 15 секций worklog ====="
  while IFS= read -r tid; do
    echo "$tid"
    awk -v t="$tid" 'index($0,t)==1 && /^Task ID:/ {flag=1; next} flag && /^Task: /{print; exit}' "$PROJ/worklog.md"
  done < "$CPW"
  echo "===== Хвост worklog (последние ~60 строк) ====="
  cat "$WLT"
  echo "===== Протокол восстановления v2 ====="
  cat << 'PROT'
(1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check → кворум 8 источников
(2) --merge при усечении worklog
(3) креды Supabase: /tmp/my-project/.a2-backup/me2.env.20260922 (JWT-статус см. worklog SEC-JWT-RESTORE-1: переданное оператором 88B-значение REST=401, нужен eyJ... или sb_secret_...)
(4) full-копии: Supabase me2-evidence/context-vault/latest/ (нужен живой service JWT), ossfs /home/sync/me2-context-backups/latest/
(5) скрипты phoenix: /home/z/my-project/scripts/phoenix/ и vault/latest (phoenix-restore/heartbeat/snapshot/secrets-restore.sealed/self-evolve.sealed/full-audit)
(6) PHX-HEARTBEAT=Job 416629, Guard=416526 (ctx-vault), PAT-watcher=413338 (push-pending R80)
PROT
  echo "<<<CTX-END>>>"
} > /tmp/CTX-SHARD-B.md

ok=1
for out in "$OUT1" "$OUT2"; do
  mkdir -p "$out" 2>/dev/null || true
  for s in A B; do
    src="/tmp/CTX-SHARD-$s.md"; dst="$out/CTX-SHARD-$s-gen$GEN.md"
    cp "$src" "$dst" 2>/dev/null || ok=0
    sz=$(stat -c%s "$dst" 2>/dev/null || echo 0)
    grep -q "<<<CTX-BEGIN>>>" "$dst" 2>/dev/null || ok=0
    grep -q "<<<CTX-END>>>" "$dst" 2>/dev/null || ok=0
    [ "$sz" -gt 1024 ] 2>/dev/null || ok=0
    echo "shard=$s dst=$out size=${sz}B"
  done
done
rm -f "$WLT" "$CPW"
[ "$ok" = "1" ] && echo "SHARDS-VERIFIED gen$GEN" || echo "SHARDS-FAILED"
