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
# R53 (инструкция оператора): SQL-зеркало включено — daemon держит WARMUP до DDL и сам
# перейдёт LIVE, как только применятся sql/0001..0003 (проба ≤ раз в 10 мин, без штормов).
export ME2_SQL_MIRROR="${ME2_SQL_MIRROR:-1}"
# R53: самоприменение миграций, когда оператор положит SUPABASE_DB_URL в supabase-cloud.env
# (идемпотентно; без URL — честный HONEST-SKIP, старт не блокируется)
if [ -f /home/z/.a2/supabase-cloud.env ] && grep -qE '^SUPABASE_DB_URL=' /home/z/.a2/supabase-cloud.env 2>/dev/null; then
  bash "$(pwd)/scripts/apply-sql-migrations.sh" || echo "[start] apply-sql: честный провал — см. лог выше (старт продолжается, WARMUP-протокол держит)"
fi
setsid nohup bun index.ts >> daemon.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# 4.5) закрепить agent-browser stream WS на :3042 (скринкаст консоли; идемпотентно, вне бюджета шины)
SP=$(agent-browser stream status --json 2>/dev/null | grep -o '"port":[0-9]*' | head -1 | cut -d: -f2)
if [ "$SP" != "3042" ]; then
  agent-browser stream disable >/dev/null 2>&1
  agent-browser stream enable --port 3042 >/dev/null 2>&1
fi

# 5) R73: watchdog релея webhooks (релей исчезал молча — инцидент R70); без дублей
WD="$SELFDIR/../me2-webhook-relay/watchdog.sh"
if [ -f "$WD" ] && ! pgrep -f "me2-webhook-relay/watchdog.sh" >/dev/null 2>&1; then
  setsid nohup bash "$WD" >/dev/null 2>&1 &
fi

# 6) дождаться health (до 10s)
for i in $(seq 1 20); do
  H=$(curl -sf --max-time 1 http://localhost:3041/health 2>/dev/null)
  if [ -n "$H" ]; then echo "STARTED: $H"; exit 0; fi
  sleep 0.5
done
echo "FAILED to start — see daemon.log"; exit 1
