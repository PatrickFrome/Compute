#!/usr/bin/env bash
# Watchdog для Next dev :3000 — лечение повторяющейся тихой смерти.
# Single-instance через lock-файл; рестарт только detached-подоболочкой.
set -u
LOCK=/tmp/dev-watchdog.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
cd /home/z/my-project
while true; do
  if ! curl -sf -m 6 http://localhost:3000/ >/dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] :3000 down — restarting dev (watchdog pid $$)" >> dev-watchdog.log
    pkill -f "next dev" 2>/dev/null || true
    sleep 1
    ( setsid nohup env NODE_OPTIONS="--max-old-space-size=1024" bun run dev > dev.log 2>&1 & )
    for _ in $(seq 1 12); do
      sleep 5
      curl -sf -m 6 http://localhost:3000/ >/dev/null 2>&1 && break
    done
    curl -sf -m 6 http://localhost:3000/ >/dev/null 2>&1 \
      && echo "[$(date -u +%FT%TZ)] :3000 RECOVERED" >> dev-watchdog.log \
      || echo "[$(date -u +%FT%TZ)] :3000 still down after 60s" >> dev-watchdog.log
  fi
  sleep 15
done
