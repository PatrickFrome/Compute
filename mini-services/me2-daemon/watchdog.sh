#!/usr/bin/env bash
# ME2 daemon watchdog — long-run guard: health check каждые 10s, auto-restart.
# Запуск: setsid nohup bash /home/z/my-project/mini-services/me2-daemon/watchdog.sh > watchdog.log 2>&1 &
DAEMON_DIR=/home/z/my-project/mini-services/me2-daemon
LOG=$DAEMON_DIR/daemon.log
while true; do
  if ! curl -sf --max-time 5 http://localhost:3041/health > /dev/null 2>&1; then
    echo "[$(date -Is)] daemon DOWN — restarting" >> $DAEMON_DIR/watchdog.log
    pkill -f "bun index.ts" 2>/dev/null
    sleep 1
    cd $DAEMON_DIR && setsid nohup bun index.ts >> $LOG 2>&1 &
    echo "[$(date -Is)] restarted (pid $!)" >> $DAEMON_DIR/watchdog.log
  fi
  sleep 10
done
