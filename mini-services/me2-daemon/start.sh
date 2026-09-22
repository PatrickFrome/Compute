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
# 2) прибить живой daemon по cwd (надёжнее шаблона cmdline: процесс запускается как «bun --hot index.ts»,
#    а рядом живут чужие сервисы — a2-edge-local; трогаем только свой каталог)
SELFDIR="$(pwd)"
for p in $(pgrep -f "index.ts" 2>/dev/null); do
  [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$SELFDIR" ] && kill -9 "$p" 2>/dev/null
done

# 3) дождаться освобождения портов (до 8s)
for i in $(seq 1 16); do
  if ! curl -sf --max-time 1 http://localhost:3041/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done

# 4) старт — AGENT_BROWSER_STREAM_PORT наследуется daemon'ом и его agent-browser-детьми:
#    при любом респавне agent-browser стрим сам поднимется на :3042 (дока стрима, "pins the port for the whole daemon")
export AGENT_BROWSER_STREAM_PORT=3042
setsid nohup bun index.ts >> daemon.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# 4.5) закрепить agent-browser stream WS на :3042 (скринкаст консоли; идемпотентно, вне бюджета шины)
SP=$(agent-browser stream status --json 2>/dev/null | grep -o '"port":[0-9]*' | head -1 | cut -d: -f2)
if [ "$SP" != "3042" ]; then
  agent-browser stream disable >/dev/null 2>&1
  agent-browser stream enable --port 3042 >/dev/null 2>&1
fi

# 5) дождаться health (до 10s)
for i in $(seq 1 20); do
  H=$(curl -sf --max-time 1 http://localhost:3041/health 2>/dev/null)
  if [ -n "$H" ]; then echo "STARTED: $H"; exit 0; fi
  sleep 0.5
done
echo "FAILED to start — see daemon.log"; exit 1
