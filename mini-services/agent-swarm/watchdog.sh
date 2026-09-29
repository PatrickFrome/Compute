#!/usr/bin/env bash
# ME2 CHAT-SWARM watchdog (по образцу me2-webhook-relay/watchdog.sh, урок R70):
# рой исчезал молча при фон-запуске (очистка process-group после Bash-сессии).
# Каждые 30s проверяем REST :3046/state — при падении честный setsid-рестарт
# БЕЗ --hot (правка исходника под --hot замораживает петли — урок BROWSER-TEST-20260929).
# Память/родословная в sqlite переживают рестарт: рой бессмертен на уровне процесса.
cd "$(dirname "$0")"
SELFDIR="$(pwd)"
while true; do
  if ! curl -sf -m 4 http://127.0.0.1:3046/state >/dev/null 2>&1; then
    echo "[$(date -Is)] swarm DOWN — setsid-рестарт" >> watchdog.log
    setsid nohup bun src/index.ts >> /home/z/my-project/agent-swarm.log 2>&1 < /dev/null &
    sleep 4
    if curl -sf -m 4 http://127.0.0.1:3046/state >/dev/null 2>&1; then
      echo "[$(date -Is)] swarm восстановлен" >> watchdog.log
    else
      echo "[$(date -Is)] swarm НЕ поднялся после рестарта (повтор через 30с)" >> watchdog.log
    fi
  fi
  sleep 30
done
