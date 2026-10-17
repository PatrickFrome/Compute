# SECURITY-ROTATION — компрометация секретов в me2.db (аудит 2026-10-18, CRITICAL C1)

## Что случилось

В публичном репозитории `PatrickFrome/Compute` git-трекалась runtime-база
демона `apps/me2-daemon/data/me2.db` (SHA головы ветки PR #1312:
`59dbfdc7a13caf4698074f4b475800df662e3066`). Таблица `tokens` содержала
**6 реальных секретов в plaintext**:

| Имя в vault | Что это | Куда ротировать |
|---|---|---|
| `GITHUB_TOKEN_ADMIN` | GitHub PAT (`ghp_…`, 40 симв.) | GitHub → Settings → Developer settings → PAT → Revoke + новый |
| `SUPABASE_SERVICE_ROLE_JWT` | service-role JWT (обход RLS) | Supabase Dashboard → Project Settings → API → Rotate JWT secret / пере-выпуск ключей |
| `SUPABASE_JWT_SECRET` | секрет подписи всех JWT проекта | Supabase → rotate JWT secret (инвалидирует все сессии — запланировать окно) |
| `GITHUB_WEBHOOK_SECRET` | HMAC webhooks | GitHub → репозиторий → Settings → Webhooks → Update secret (+ обновить в daemon `/tokens`) |
| `VERCEL_AI_GATEWAY_API_KEY` | `vck_…` ключ AI Gateway | Vercel → AI Gateway → ключи → revoke + новый |
| `SUPABASE_URL` | публичный URL проекта | не секрет, но сменить при пере-создании проекта |

Дополнительно токен доступа, выданный для этого аудита, считайте
скомпрометированным — он засветился в чате/истории сессии.

## Порядок действий (строго по порядку)

1. **Ротировать все секреты (сегодня).** Переписывание истории НЕ отменяет
   компрометацию: репозиторий публичный, клонировать могли до чистки.
2. **Очистить историю** — `scripts/security/scrub-git-history.sh <fresh-clone>`
   (git filter-repo, удаляет блобы `me2.db`/`-wal`/`-shm`/`daemon.log` из всех
   коммитов), затем force-push ветки PR #1312.
3. **Проверить журнал доступа**: GitHub → Settings → Security log (чужие
   использования PAT), Supabase → Audit logs (аномальные service-role вызовы),
   Vercel → usage аномалии.
4. **Закрыть вход для повторения**: fixpack уже (а) снял `data/*.db`,
   `daemon.log`, `node_modules` с трекинга, (б) добавил их в `.gitignore`,
   (в) удалил секреты из локальной БД. При старте daemon `tokensEnsure()`
   честно сообщит `missing` — заполняйте vault новыми значениями через
   `POST /tokens {op:"set"}` (loopback) или env-файл `/home/z/.a2`.

## Что уже сделано fixpack'ом (аудит 2026-10-18)

- `data/me2.db` очищен от 6 секретных строк, WAL/SHM обнулены и удалены.
- Файлы сняты с git-трекинга, `.gitignore` дополнен (`*.db`, `*.log`, `node_modules/`).
- C2: REST/WS-плоскость демона аутентифицирована (см. ниже).

## Аутентификация REST/WS (C2) — как пользоваться

- По умолчанию разрешены только **loopback**-клиенты (UI, `probe.sh`, gate).
- Удалённый доступ: `export ME2_API_TOKEN="$(openssl rand -hex 32)"` перед
  стартом daemon; клиенты шлют `Authorization: Bearer <token>`
  (socket.io — `auth: { token }`).
- Кросс-доменное чтение из браузера: `ME2_ALLOWED_ORIGINS="https://ui.example.org"`.
- Публичные поверхности: `GET /health`, `GET /ui`, `POST /hooks/github`
  (верифицирует HMAC-подпись GitHub внутри).

## Если PR #1312 уже смёржили/переливают

После чистки истории история ветки меняется (SHA пересчитываются) —
перезалейте ветку PR и предупредите всех, кто успел склонировать:
им нужно переклонировать репозиторий, их локальные копии содержат секретные блобы.
