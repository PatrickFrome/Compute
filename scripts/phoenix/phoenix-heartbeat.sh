#!/usr/bin/env bash
# ============================================================================
# phoenix-heartbeat.sh v2.2 — внешняя пульсация контекста (reset-immune)
# ----------------------------------------------------------------------------
# КАЖДЫЕ 30 МИН (cron PHX-HEARTBEAT): выносит контекст за пределы песочницы:
#   1. Строит /home/z/my-project/CONTEXT-CURRENT.md — digest «как получить
#      полный контекст» (каналы + последние 15 секций + хвост 40 строк).
#   2. Загружает в Supabase Storage (бакет me2-evidence, context-vault/):
#      latest/* (дедуп по sha + staleness-revalidation 6ч) +
#      versioned/<ts>/worklog.md (не чаще 1 раза в 3ч).
#   3. Зеркалит в ossfs /home/sync/me2-context-backups/{latest,versioned}.
#   4. Локальные зеркала: vault/latest, /tmp/context-vault-mirror, PolarFS.
# Секрета не печатает и не логирует. Самодостаточен (только bash+curl) —
# полный текст встроен в cron-задачу PHX-HEARTBEAT (феникс-свойство: при wipe
# песочницы cron пересоздаёт скрипт из payload).
#
# v2.2 changelog — MERGE двух независимых веток аудита v2.0:
#   [ветка A: self-evolution v2.1]
#   + flock: одиночный инстанс (worst-case рантайм > интервала cron)
#   + fast-path: без SU/SJ — весь Supabase-блок пропускается (sb=disabled)
#   + sb_up: 3 попытки с backoff для 000/5xx; 4xx — ретраи бессмысленны
#   + fix off-by-one в awk-парсере дайджеста (substr($0,8)→substr($0,7)):
#     первая буква Task-строки больше не съедается
#   + отсутствие/усечение worklog: дайджест НЕ затирается пустышкой,
#     инцидент в incidents.log
#   + отказы зеркалирования (cp) логируются; ротация versioned (ossfs 40,
#     Supabase >21д раз в сутки, журнал last-1000)
#   [ветка B: критический аудит v2.0]
#   + sb_up: заголовки через curl -H @file — JWT больше не светится в `ps`
#   + sb_up: успех = любой 2xx (не только 200 — 201 «Created» не считаем
#     провалом: дедуп не писался, объект перезаливался вечно)
#   + sb_up: при не-2xx тело ошибки (обезличенное, ≤300B, длинные строки
#     маскируются) в phoenix.log — v2.0 видела только «HTTP=400» без причины
#     (реальный кейс: Supabase вернул 400 с телом Invalid Compact JWS —
#     причина лежала невидимой неделями)
#   + up_latest: abs (файла нет) отделён от skip (дедуп-совпадение)
#   + up_latest: staleness-revalidation — объект, не подтверждённый успешной
#     загрузкой >6ч, принудительно перезаливается даже при совпавшем sha
#     (лечит «мёртвый дедуп»: v2.0 показывала 7skip при полностью мёртвом
#     Supabase — дедуп-файлы пережили потерю JWT и маскировали деградацию)
#   + auth-предохранитель расширен: срабатывает не только на HTTP 401/403,
#     но и на auth-отказ в ТЕЛЕ ответа (реальный кейс: HTTP 400 c телом
#     statusCode:403 Invalid Compact JWS — ветка-A-предохранитель молчал)
#   + дедуп-записи атомарны (tmp+mv); incidents.log: HB-SB-DEGRADED /
#     HB-SB-RECOVERED только при СМЕНЕ состояния (без спама каждые 30 мин)
#   + stdout обратно-совместим: префикс «heartbeat ok:» сохранён, добавлены
#     stale=/abs=; в ротации Supabase-листа заголовки пока на командной
#     строке (1 раз/сутки — принятый остаточный риск)
# ============================================================================
set -u

# --- одиночный инстанс (worst-case рантайм > интервала cron) ---
LOCK="/tmp/.phx-heartbeat.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK" || true
  flock -n 9 || { echo "heartbeat FAIL: параллельный инстанс ещё работает"; exit 0; }
fi

PROJ="/home/z/my-project"
VAULT="/home/z/context-vault"
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
SYNC="/home/sync/me2-context-backups"
TMPM="/tmp/context-vault-mirror"
PFSM="/tmp/my-project/context-vault-mirror"
WL="$PROJ/worklog.md"
CTX="$PROJ/CONTEXT.md"
PROTO="$PROJ/PHOENIX-PROTOCOL.md"
DIG="$PROJ/CONTEXT-CURRENT.md"
DEDUP="/tmp/.phx-dedup"
LOG="$VAULT/journal/phoenix.log"
INC="$VAULT/journal/incidents.log"
ts="$(date +%Y%m%d-%H%M%S)"
now_ep="$(date +%s)"
FORCE_STALE_SECS=21600   # 6ч без успешного подтверждения → форс-перезалив
mkdir -p "$DEDUP" "$VAULT/latest" "$VAULT/journal" "$TMPM" \
         "$SYNC/latest" "$SYNC/versioned" "$PFSM" 2>/dev/null

sha_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
size_of() { stat -c%s "$1" 2>/dev/null || echo 0; }
aw() { printf '%s' "$2" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"; }  # atomic write

# --- Supabase креды (значения не выводятся) ---
SU=""; SJ=""
[ -s "$ENVF" ] && {
  SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
  SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n \"')"
}
SB_ENABLED=1;  [ -n "$SU" ] && [ -n "$SJ" ] || SB_ENABLED=0
SB_AUTH_BROKEN=""

# --- Заголовки в файле (JWT не виден в `ps`); тело ошибки — в файле ---
SB_HDR="$(mktemp /tmp/.phx-hdr.XXXXXX)"
chmod 600 "$SB_HDR" 2>/dev/null
[ "$SB_ENABLED" -eq 1 ] && printf 'Authorization: Bearer %s\napikey: %s\nx-upsert: true\nContent-Type: text/markdown\n' "$SJ" "$SJ" > "$SB_HDR"
SB_ERR_FILE="$DEDUP/sb-err.last"

sb_up() { # $1=local file $2=object name -> prints http code (3 попытки, backoff)
  : > "$SB_ERR_FILE" 2>/dev/null
  [ -n "$SU" ] && [ -n "$SJ" ] && [ -s "$1" ] || { echo "000"; return; }
  local code="" try
  for try in 1 2 3; do
    code="$(curl -s -o "$SB_HDR.body" -w '%{http_code}' -X POST \
      -H @"$SB_HDR" --data-binary @"$1" --max-time 90 \
      "$SU/storage/v1/object/me2-evidence/context-vault/$2" 2>/dev/null)"
    code="${code:-000}"
    case "$code" in
      2??) echo "$code"; return ;;
      000|5*) [ "$try" -lt 3 ] && sleep $((try*5)) ;;
      *) break ;;  # 4xx и прочее — ретраи бессмысленны
    esac
  done
  # обезличенное тело ошибки (диагностика без утечки секретов)
  head -c 300 "$SB_HDR.body" 2>/dev/null | tr -d '\n' \
    | sed -E 's/[A-Za-z0-9_.\/+-]{40,}/<masked>/g' > "$SB_ERR_FILE" 2>/dev/null
  echo "${code:-000}"
}

# =========================================================
# 1. CONTEXT-CURRENT.md — digest для старта ЛЮБОЙ сессии
# =========================================================
if [ -s "$WL" ]; then
  wlsz="$(size_of "$WL")"; wlln="$(wc -l < "$WL" | tr -d ' ')"; wlsha="$(sha_of "$WL")"
  {
    echo "# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)"
    echo ""
    echo "gen: $(date -u '+%Y-%m-%dT%H:%M:%SZ') | worklog: ${wlsz}B / ${wlln}L | sha12=${wlsha:0:12}"
    echo ""
    echo "## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)"
    echo "1. \`bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check\` — кворум 8 источников, вердикт целостности"
    echo "2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md"
    echo "3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов"
    echo "4. Если локальный worklog усечён/отсутствует: \`phoenix-restore.sh --merge\` (секционный merge-append без потерь)"
    echo "5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)"
    echo ""
    echo "## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (${wlsz}B)"
    echo "| Канал | Путь | Переживает env-reset |"
    echo "|-------|------|---------------------|"
    echo "| Supabase Storage | me2-evidence/context-vault/latest/worklog.md | ДА (внешний) |"
    echo "| OSS (ossfs) | /home/sync/me2-context-backups/latest/worklog.md | ДА (сетевой) |"
    echo "| Vault | /home/z/context-vault/{latest,snapshots,repo}/ | частично |"
    echo "| cron-KV | шарды CTX-SHARD-A/B (payload cron-задач) | ДА (серверный) |"
    echo ""
    echo "## ПОСТОЯННЫЕ CRON-ЗАДАЧИ КОНТЕКСТА"
    echo "- 413338: PAT watcher (15m) — при появлении GITHUB_TOKEN_ADMIN в /home/z/.a2/.github.env делает push-pending"
    echo "- 416526: Context Guard (15m) — снапшоты/детект усечения/авторестор/феникс (скрипт в payload задачи)"
    echo "- PHX-HEARTBEAT: (30m) — этот digest + Supabase/ossfs пульс (скрипт в payload задачи)"
    echo "- CTX-VAULT-COMPACTOR: (1h) — обновляет KV-шарды CTX-SHARD-A/B"
    echo ""
    echo "## ПОСЛЕДНИЕ 15 СЕКЦИЙ worklog (Task ID → Task)"
    awk '/^Task ID: /{tid=substr($0,10)} /^Task: /{if(tid!=""){print "- " tid " → " substr($0,7); tid=""}}' "$WL" | tail -15
    echo ""
    echo "## ХВОСТ worklog (последние 40 строк, вербатим)"
    echo '```'
    tail -40 "$WL"
    echo '```'
  } > "$DIG.tmp" && mv "$DIG.tmp" "$DIG"
else
  # v2.1: не затираем хороший дайджест пустышкой — фиксируем инцидент
  echo "[$ts] HB-WL-MISSING: worklog отсутствует/пуст — дайджест сохранён прежний, нужен restore --merge" \
    >> "$INC" 2>/dev/null || true
fi

# =========================================================
# 2. Локальные зеркала (vault/latest + /tmp + PolarFS)
# =========================================================
cp_ok=0
for pair in "$WL:$VAULT/latest/worklog.md" "$CTX:$VAULT/latest/CONTEXT.md" \
            "$DIG:$VAULT/latest/CONTEXT-CURRENT.md" "$PROTO:$VAULT/latest/PHOENIX-PROTOCOL.md" \
            "$PROJ/scripts/phoenix/phoenix-heartbeat.sh:$VAULT/latest/phoenix-heartbeat.sh" \
            "$PROJ/scripts/phoenix/phoenix-restore.sh:$VAULT/latest/phoenix-restore.sh" \
            "$PROJ/scripts/phoenix/phoenix-snapshot.sh:$VAULT/latest/phoenix-snapshot.sh" \
            "$VAULT/context-guard.sh:$VAULT/latest/context-guard.sh" \
            "$VAULT/supabase-persist.sh:$VAULT/latest/supabase-persist.sh" \
            "$VAULT/journal/context-journal.log:$VAULT/latest/journal-context.log" \
            "$VAULT/journal/incidents.log:$VAULT/latest/journal-incidents.log"; do
  src="${pair%%:*}"; dst="${pair#*:}"
  [ "$src" = "$dst" ] && continue
  if [ -s "$src" ]; then
    if cp "$src" "$dst" 2>/dev/null; then cp_ok=$((cp_ok+1))
    else echo "[$ts] HB-MIRROR-FAIL dst=$dst" >> "$LOG" 2>/dev/null || true; fi
    cp "$src" "$TMPM/$(basename "$dst")" 2>/dev/null || true
    cp "$src" "$PFSM/$(basename "$dst")" 2>/dev/null || true
  fi
done

# =========================================================
# 3. Supabase upload (latest/ — дедуп по sha + staleness-revalidation)
# =========================================================
sb_ok=0; sb_fail=0; sb_skip=0; sb_abs=0; stale_forced=0
up_latest() { # $1=local $2=obj
  [ "$SB_ENABLED" -eq 1 ] || return 0          # fast-path: без кредов/после auth-отказа
  [ -s "$1" ] || { sb_abs=$((sb_abs+1)); return 0; }
  local sum="$(sha_of "$1")" code ots=0 ded="$DEDUP/$2.sha" dts="$DEDUP/$2.ts"
  [ -f "$dts" ] && ots="$(cat "$dts" 2>/dev/null || echo 0)"
  if [ "$(cat "$ded" 2>/dev/null || echo)" = "$sum" ] && [ $((now_ep - ots)) -lt "$FORCE_STALE_SECS" ]; then
    sb_skip=$((sb_skip+1)); return 0
  fi
  [ "$(cat "$ded" 2>/dev/null || echo)" = "$sum" ] && stale_forced=$((stale_forced+1))
  code="$(sb_up "$1" "$2")"
  case "$code" in
    2??)
      mkdir -p "$DEDUP/$(dirname "$2")"
      aw "$ded" "$sum"; aw "$dts" "$now_ep"
      sb_ok=$((sb_ok+1))
      ;;
    *)
      sb_fail=$((sb_fail+1))
      echo "[$ts] HB-SB-FAIL $2 HTTP=$code err=$(cat "$SB_ERR_FILE" 2>/dev/null || echo none)" >> "$LOG" 2>/dev/null || true
      case "$code" in 401|403) SB_AUTH_BROKEN="$code" ;; esac
      # auth-отказ может быть завёрнут в HTTP 400 (реальный кейс Invalid Compact JWS)
      if [ -z "$SB_AUTH_BROKEN" ] && grep -qE 'Invalid Compact JWS|AccessDenied|Unauthorized|invalid_jwt|InvalidJWT' "$SB_ERR_FILE" 2>/dev/null; then
        SB_AUTH_BROKEN="$code(body-auth)"
      fi
      if [ -n "$SB_AUTH_BROKEN" ]; then
        SB_ENABLED=0
        echo "[$ts] HB-SB-AUTH-FAIL HTTP=$code — Supabase отключён до следующего запуска" >> "$LOG" 2>/dev/null || true
      fi
      ;;
  esac
}
up_latest "$WL" "latest/worklog.md"
up_latest "$CTX" "latest/CONTEXT.md"
up_latest "$DIG" "latest/CONTEXT-CURRENT.md"
up_latest "$PROTO" "latest/PHOENIX-PROTOCOL.md"
up_latest "$VAULT/latest/phoenix-heartbeat.sh" "latest/phoenix-heartbeat.sh"
up_latest "$VAULT/latest/phoenix-restore.sh" "latest/phoenix-restore.sh"
up_latest "$VAULT/latest/phoenix-snapshot.sh" "latest/phoenix-snapshot.sh"
up_latest "$VAULT/latest/context-guard.sh" "latest/context-guard.sh"
up_latest "$VAULT/latest/supabase-persist.sh" "latest/supabase-persist.sh"
up_latest "$VAULT/latest/journal-context.log" "latest/journal-context.log"
up_latest "$VAULT/latest/journal-incidents.log" "latest/journal-incidents.log"

# versioned worklog: только если sha изменился и прошло ≥3ч с прошлой версии
ver="n"
if [ -s "$WL" ] && [ "$SB_ENABLED" -eq 1 ]; then
  cur="$(sha_of "$WL")"
  last="$(cat "$DEDUP/last-ver.sha" 2>/dev/null || echo x)"
  if [ "$cur" != "$last" ]; then
    lvt=0; [ -f "$DEDUP/last-ver.ts" ] && lvt="$(cat "$DEDUP/last-ver.ts")"
    if [ $((now_ep - lvt)) -ge 10800 ]; then
      c1="$(sb_up "$WL" "versioned/${ts}/worklog.md")"
      case "$c1" in
        2??)
          ver="y"; aw "$DEDUP/last-ver.sha" "$cur"; aw "$DEDUP/last-ver.ts" "$now_ep"
          mkdir -p "$SYNC/versioned/$ts" && cp "$WL" "$SYNC/versioned/$ts/worklog.md" 2>/dev/null || true
          echo "[$ts] HB-VERSIONED ${ts} bytes=$(size_of "$WL")" >> "$LOG" 2>/dev/null || true
          ;;
        *)
          echo "[$ts] HB-VER-FAIL HTTP=$c1 err=$(cat "$SB_ERR_FILE" 2>/dev/null || echo none)" >> "$LOG" 2>/dev/null || true
          ;;
      esac
    fi
  fi
fi
# ротация versioned в ossfs: последние 40
ls -1t "$SYNC/versioned" 2>/dev/null | tail -n +41 | while read -r d; do rm -rf "$SYNC/versioned/$d"; done

# v2.1: ротация Supabase versioned/ старше 21 дня (раз в сутки, best-effort)
if [ "$SB_ENABLED" -eq 1 ]; then
  today="$(date +%Y%m%d)"
  [ "$today" = "$(cat "$DEDUP/last-rotate.day" 2>/dev/null || echo)" ] || {
    echo "$today" > "$DEDUP/last-rotate.day" 2>/dev/null || true
    resp="$(curl -s --max-time 60 -X POST "$SU/storage/v1/object/list/me2-evidence" \
      -H "Authorization: Bearer $SJ" -H "apikey: $SJ" -H "Content-Type: application/json" \
      -d '{"prefix":"context-vault/versioned/","limit":100,"offset":0}' 2>/dev/null)" || resp=""
    cutoff="$(date -d '21 days ago' +%Y%m%d 2>/dev/null || echo "")"
    if [ -n "$resp" ] && [ -n "$cutoff" ]; then
      del_n=0
      for fpath in $(printf '%s' "$resp" | grep -oE '"name"\s*:\s*"context-vault/versioned/[^"]+"' | sed -E 's/.*"context-vault\/versioned\///; s/"$//' | sort -u); do
        ddir="${fpath%%/*}"; dday="${ddir%%-*}"
        case "$dday" in ''|*[!0-9]*) continue ;; esac
        if [ "$dday" -lt "$cutoff" ] 2>/dev/null; then
          ccode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X DELETE \
            -H "Authorization: Bearer $SJ" -H "apikey: $SJ" \
            "$SU/storage/v1/object/me2-evidence/context-vault/versioned/$fpath" 2>/dev/null)"
          { [ "$ccode" = "200" ] || [ "$ccode" = "204" ]; } && del_n=$((del_n+1))
        fi
      done
      [ $del_n -gt 0 ] && echo "[$ts] HB-ROTATE deleted=$del_n (age>21d)" >> "$LOG" 2>/dev/null || true
    fi
  }
fi

# =========================================================
# 4. ossfs mirror (latest/)
# =========================================================
sync_ok=0
if [ -d "$SYNC/latest" ]; then
  for f in "$WL" "$CTX" "$DIG" "$PROTO"; do
    [ -s "$f" ] && cp "$f" "$SYNC/latest/$(basename "$f")" 2>/dev/null && sync_ok=$((sync_ok+1)) || true
  done
  for f in "$VAULT"/latest/phoenix-*.sh "$VAULT"/latest/context-guard.sh; do
    [ -s "$f" ] && cp "$f" "$SYNC/latest/$(basename "$f")" 2>/dev/null && sync_ok=$((sync_ok+1)) || true
  done
fi

# v2.1: ротация собственного журнала (keep last 1000 строк)
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -n 1000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null || true
fi

# --- v2.2: итоговое состояние канала + incident state-machine ---
if [ "$SB_ENABLED" -eq 0 ] && [ -z "$SU" -o -z "$SJ" ]; then sbstat="disabled"
elif [ -n "$SB_AUTH_BROKEN" ]; then sbstat="auth-fail(HTTP $SB_AUTH_BROKEN)"
else sbstat="${sb_ok}ok/${sb_fail}fail/${sb_skip}skip"; fi
case "$sbstat" in
  disabled|auth-fail*) cur_sb="degraded" ;;
  *)                   cur_sb="ok" ;;
esac
prev_sb="$(cat "$DEDUP/sb-state" 2>/dev/null || echo unknown)"
if [ "$cur_sb" != "$prev_sb" ]; then
  if [ "$cur_sb" = "degraded" ]; then
    echo "[$ts] HB-SB-DEGRADED sb=$sbstat err=$(cat "$SB_ERR_FILE" 2>/dev/null || echo см.phoenix.log)" >> "$INC" 2>/dev/null || true
  elif [ "$prev_sb" != "unknown" ]; then
    echo "[$ts] HB-SB-RECOVERED (было: $prev_sb)" >> "$INC" 2>/dev/null || true
  fi
  aw "$DEDUP/sb-state" "$cur_sb"
fi

echo "[$ts] HB bytes=$(size_of "$WL") sha12=$(sha_of "$WL" | cut -c1-12) sb=$sbstat stale=$stale_forced abs=$sb_abs ver=$ver sync=$sync_ok" >> "$LOG" 2>/dev/null || true
rm -f "$SB_HDR" "$SB_HDR.body" "$SB_ERR_FILE" 2>/dev/null
echo "heartbeat ok: wb=$(size_of "$WL") sha12=$(sha_of "$WL" | cut -c1-12) sb=$sbstat ver=$ver sync=$sync_ok cp=$cp_ok stale=$stale_forced abs=$sb_abs v=2.2"
