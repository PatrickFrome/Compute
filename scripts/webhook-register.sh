#!/usr/bin/env bash
# R69: регистрация ME2 webhook в GitHub-репо (PatrickFrome/Compute).
#
# Канон канала: GitHub → gateway :81 → POST /hooks/github (daemon :3041) → event-log → облако.
# Публичный origin знает ТОЛЬКО оператор (адрес preview/gateway) — передаётся через WEBHOOK_URL.
#
# Секрет HMAC: vault daemon'а (таблица tokens, имя GITHUB_WEBHOOK_SECRET) —
# НИКОГДА не печатается и не попадает в логи/аргументы ps (уходит в curl -d через stdin).
# Токен админа: /home/z/.a2/.github.env (GITHUB_TOKEN_ADMIN) — тоже не печатается.
#
# Использование:
#   bash scripts/webhook-register.sh list                     # список хуков репо (наши помечены)
#   WEBHOOK_URL="https://<public>/hooks/github?XTransformPort=3041" \
#     bash scripts/webhook-register.sh register               # создать/обновить СВОЙ хук (idempotent)
#   bash scripts/webhook-register.sh auto                     # origin из живых наблюдений daemon'а (host_candidates);
#                                                             # подходит только НЕ-guarded хост (fcapp.run отфильтрован)
#   HOOK_ID=<id> bash scripts/webhook-register.sh ping        # тестовая доставка ping из GitHub
#
# Идемпотентность: свой хук ищется по точному совпадению config.url с WEBHOOK_URL
# (легаси AppVeyor-хук не трогается). События: ping,push,pull_request,workflow_run.
set -euo pipefail
REPO="PatrickFrome/Compute"
HERE="$(cd "$(dirname "$0")" && pwd)"
API="https://api.github.com/repos/${REPO}/hooks"
set -a; source /home/z/.a2/.github.env 2>/dev/null; set +a
TOKEN="${GITHUB_TOKEN_ADMIN:?нет GITHUB_TOKEN_ADMIN в /home/z/.a2/.github.env — восстанови по R18-0}"

gh() { curl -sS -m 20 -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

# секрет из vault (bun sqlite, только в переменную — не печатаем)
SECRET=$(ME2_DB="$HERE/../mini-services/me2-daemon/data/me2.db" bun -e '
import { Database } from "bun:sqlite";
const db = new Database(process.env.ME2_DB!, { readonly: true });
try {
  const r = db.query("SELECT value FROM tokens WHERE name=?").get("GITHUB_WEBHOOK_SECRET");
  if (r && (r as { value?: string }).value) process.stdout.write(String((r as { value: string }).value));
} finally { db.close(false); }
')
if [ -z "$SECRET" ]; then
  echo "vault: GITHUB_WEBHOOK_SECRET отсутствует — запусти scripts/hooks-selftest.sh (создаст)"; exit 1
fi
echo "vault: GITHUB_WEBHOOK_SECRET найден (значение скрыто)"

OP="${1:-list}"
case "$OP" in
  auto)
    # R69.1: публичный origin из капчи живого трафика daemon'а (meta host_candidates).
    # fcapp.run-кандидаты НЕ годятся: публичный URL платформенного FC-шлюза отключён
    # («function internet URL is disabled»), VPC-алиас требует x-session-id.
    CAND=$(ME2_DB="$HERE/../mini-services/me2-daemon/data/me2.db" bun -e '
      import { Database } from "bun:sqlite";
      const db = new Database(process.env.ME2_DB!, { readonly: true });
      try {
        const raw = db.query("SELECT value FROM meta WHERE key=?").get("host_candidates")?.value ?? "[]";
        const list = JSON.parse(raw) as string[];
        const ok = list.find((h) => h && !h.includes("fcapp.run") && !/^localhost/.test(h) && !h.startsWith("127.0.0.1"));
        process.stdout.write(ok ?? "");
      } finally { db.close(false); }
    ')
    if [ -z "$CAND" ]; then
      echo "auto: наблюдаемых публичных origin НЕТ (fcapp.run-кандидаты отфильтрованы — они guarded)."
      echo "Открой preview-панель (или передай WEBHOOK_URL вручную) — капча в daemon'е постоянна, повтори через ~2 мин."
      exit 2
    fi
    echo "auto: найден наблюдённый origin: $CAND"
    WEBHOOK_URL="https://${CAND}/hooks/github?XTransformPort=3041" exec bash "$0" register
    ;;
  list)
    gh "$API" | ME2_API="$API" bun -e '
      const j = await new Response(Bun.stdin.stream()).json();
      if (!Array.isArray(j)) { console.log("ответ:", JSON.stringify(j).slice(0,200)); process.exit(1); }
      for (const h of j) {
        const mine = typeof h.config?.url === "string" && h.config.url.includes("/hooks/github");
        console.log(`${h.id} active=${h.active} secret=${h.config?.secret ? "set" : "none"} events=${(h.events||[]).join(",")} url=${h.config?.url}${mine ? "  <— ME2 (наш)" : ""}`);
      }'
    ;;
  register)
    WURL="${WEBHOOK_URL:?задай WEBHOOK_URL=\"https://<public-origin>/hooks/github?XTransformPort=3041\"}"
    EVENTS='["ping","push","pull_request","workflow_run"]'
    # idempotent: ищем свой хук по точному URL
    HID=$(WEBHOOK_URL="$WURL" gh "$API" | WEBHOOK_URL="$WURL" bun -e '
      const j = await new Response(Bun.stdin.stream()).json();
      const w = process.env.WEBHOOK_URL!;
      const mine = Array.isArray(j) ? j.find((h) => h.config?.url === w) : null;
      process.stdout.write(mine ? String(mine.id) : "");')
    # тело уходит в curl через --data-binary @- (секрет не в argv)
    BODY=$(HOOK_URL="$WURL" HOOK_SECRET="$SECRET" EVENTS="$EVENTS" bun -e '
      process.stdout.write(JSON.stringify({
        name: "web", active: true,
        events: JSON.parse(process.env.EVENTS!),
        config: { url: process.env.HOOK_URL!, content_type: "json", secret: process.env.HOOK_SECRET!, insecure_ssl: "0" },
      }));')
    if [ -n "$HID" ]; then
      RES=$(printf '%s' "$BODY" | gh -X PATCH "$API/$HID" --data-binary @- | HID="$HID" bun -e '
        const j = await new Response(Bun.stdin.stream()).json();
        console.log(JSON.stringify({ id: j.id, active: j.active, url: j.config?.url, events: j.events }));')
      echo "PATCH hook #$HID → $RES"
    else
      RES=$(printf '%s' "$BODY" | gh -X POST "$API" --data-binary @- | HID="" bun -e '
        const j = await new Response(Bun.stdin.stream()).json();
        console.log(JSON.stringify({ id: j.id, active: j.active, url: j.config?.url, events: j.events }));')
      echo "CREATE → $RES"
    fi
    echo "далее: HOOK_ID=<id> bash scripts/webhook-register.sh ping  (GitHub отправит ping → HOOK_PING в event-log → облако)"
    ;;
  ping)
    HID="${HOOK_ID:?задай HOOK_ID=<id>}"
    CODE=$(gh -o /dev/null -w '%{http_code}' -X POST "$API/$HID/tests")
    echo "ping-тест хука #$HID → HTTP $CODE (204 = GitHub отправил ping на WEBHOOK_URL)"
    echo "проверка: curl http://localhost:3041/hooks | jq '.deliveries'  — ожидай event=ping"
    ;;
  *)
    echo "операции: list | register (нужен WEBHOOK_URL) | ping (нужен HOOK_ID)"; exit 1 ;;
esac
