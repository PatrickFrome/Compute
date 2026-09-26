#!/usr/bin/env bash
# ME2 daemon restart — protocol: only via this script (mini-services/me2-daemon/start.sh)
set -euo pipefail
cd "$(dirname "$0")"

# stop previous instance by pidfile
if [ -f daemon.pid ]; then
  OLD="$(cat daemon.pid 2>/dev/null || true)"
  if [ -n "${OLD:-}" ] && kill -0 "$OLD" 2>/dev/null; then
    kill "$OLD" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$OLD" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$OLD" 2>/dev/null || true
  fi
  rm -f daemon.pid
fi

nohup bun --hot src/index.ts > daemon.log 2>&1 &
echo $! > daemon.pid
sleep 1.5

HEALTH="$(curl -s --max-time 4 localhost:3041/health || true)"
if [ -n "$HEALTH" ]; then
  echo "[start.sh] daemon up: $(echo "$HEALTH" | head -c 200)"
else
  echo "[start.sh] WARNING: /health not responding yet; tail of daemon.log:"
  tail -n 20 daemon.log || true
fi
