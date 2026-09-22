#!/usr/bin/env bash
# ME2 daemon start — надёжный: убивает старые по pidfile, ждёт освобождения портов, стартует setsid.
cd "$(dirname "$0")"
PIDFILE=/tmp/me2-daemon.pid

# 1) убить предыдущий инстанс по pidfile
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    kill "$OLDPID" 2>/dev/null; sleep 1
    kill -9 "$OLDPID" 2>/dev/null
  fi
  rm -f "$PIDFILE"
fi
# 2) прибить случайные выжившие bun index.ts (кроме себя)
for p in $(pgrep -f "bun index.ts" 2>/dev/null); do [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null; done

# 3) дождаться освобождения портов (до 8s)
for i in $(seq 1 16); do
  if ! curl -sf --max-time 1 http://localhost:3041/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done

# 4) старт
setsid nohup bun index.ts >> daemon.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# 5) дождаться health (до 10s)
for i in $(seq 1 20); do
  H=$(curl -sf --max-time 1 http://localhost:3041/health 2>/dev/null)
  if [ -n "$H" ]; then echo "STARTED: $H"; exit 0; fi
  sleep 0.5
done
echo "FAILED to start — see daemon.log"; exit 1
