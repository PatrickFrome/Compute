#!/bin/bash
# ME2 self-heal — idempotent; safe to call from any agent session/cron round.
# Ensures Next dev server (:3000) and me2-daemon (:3021) are answering.
# The in-app watchdog (src/instrumentation.ts) revives the daemon every 5s
# as long as next-server lives, so reviving :3000 is the critical path.
set -u

if ! curl -s -m 2 http://127.0.0.1:3000/ >/dev/null 2>&1; then
  cd /home/z/my-project
  setsid nohup bun run dev >> dev.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s -m 2 http://127.0.0.1:3000/ >/dev/null 2>&1 && break
    sleep 1
  done
fi

for _ in $(seq 1 10); do
  curl -s -m 2 http://127.0.0.1:3021/health >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -s -m 2 http://127.0.0.1:3021/health >/dev/null 2>&1; then
  cd /home/z/my-project/mini-services/me2-daemon
  setsid nohup bun index.ts >> daemon.log 2>&1 &
  sleep 2
fi

NEXT=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)
DAEMON=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3021/health 2>/dev/null)
echo "keepalive: next=${NEXT} daemon=${DAEMON}"
