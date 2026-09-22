#!/usr/bin/env bash
# ME2 watchdog v2 — single-instance + pidfile. Проверяет /health :3041 каждые 10s,
# при сбое перезапускает через start.sh (тот сам гасит старые инстансы).
cd "$(dirname "$0")"
LOCK=/tmp/me2-watchdog.lock

# single-instance: если другой watchdog жив — выходим
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[watchdog] already running (pid $(cat "$LOCK")) — exit" ; exit 0
fi
echo $$ > "$LOCK"
echo "[watchdog] started (pid $$)"

while true; do
  if ! curl -sf --max-time 3 http://localhost:3041/health >/dev/null 2>&1; then
    echo "[watchdog] $(date -Is) daemon down — restarting via start.sh" >> watchdog.log
    bash start.sh >> watchdog.log 2>&1
  fi
  sleep 10
done
