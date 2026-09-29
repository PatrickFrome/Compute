#!/usr/bin/env bash
# ME2 relay watchdog (R73, долг R69.1/R70): релей me2-webhook-relay исчезал молча
# (R70: процесс пропал без ошибки в логе). Каждые 30s проверяем health :3044 —
# при падении честный setsid-рестарт (stateful SSE-потребитель БЕЗ --hot — урок R70
# про зомби-инкарнации). Лог: watchdog.log рядом с relay.log.
cd "$(dirname "$0")"
SELFDIR="$(pwd)"
while true; do
  if ! curl -sf -m 4 http://127.0.0.1:3044/health >/dev/null 2>&1; then
    echo "[$(date -Is)] relay DOWN — setsid-рестарт" >> watchdog.log
    setsid nohup bun index.ts >> relay.log 2>&1 &
    sleep 3
    if curl -sf -m 4 http://127.0.0.1:3044/health >/dev/null 2>&1; then
      echo "[$(date -Is)] relay восстановлен" >> watchdog.log
    else
      echo "[$(date -Is)] relay НЕ поднялся после рестарта (повтор через 30с)" >> watchdog.log
    fi
  fi
  sleep 30
done
