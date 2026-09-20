# 01 — КРЕДЕНЦИАЛЫ, ТОКЕНЫ, ЭНДОИНТЫ (по прямому распоряжению оператора от 2026-09-21)

⚠️ Файл содержит секреты уровня admin. Хранить вне публичного доступа. Всё это — собственность оператора (Patrick Frome).

## GitHub (ГЛАВНЫЙ рабочий токен — жив, проверен 2026-09-21)

- **Репозиторий:** `PatrickFrome/Compute` (монорепо; браузер в `apps/metaengine-browser/`)
- **Admin token (classic, 40 символов):** извлечён из git-remote checkout'а. Значение в конце этого файла (добавлено автоматически, без печати в чат).
- **Источник восстановления, если файл потерян:** remote-URL git-checkout'ов:
  `/home/z/my-project/rsi-work/Compute-r/.git/config` (и другие checkout'ы в `scripts/*_git/`) — там `https://PatrickFrome:<TOKEN>@github.com/...`
  Извлечение: `grep -o 'https://PatrickFrome:[^@]*@github.com' <config> | sed 's|https://PatrickFrome:||;s|@github.com||'`
- **Использование:** `curl -H "Authorization: token <TOKEN>" https://api.github.com/repos/PatrickFrome/Compute/...` — merge PR, релизы, ветки, contents. Права admin (merge/управление).
- **Git push:** remote уже содержит токен в URL — `git push origin <branch>` работает из checkout'ов.

## Supabase cloud (проект УДАЛЁН — секреты исторические, для восстановления контекста)

- Project ref: `xpeibufgzjknrhbhpffp` (URL `https://xpeibufgzjknrhbhpffp.supabase.co` — DNS мёртв с 2026-09-20)
- service_role secret key (новый формат): `sb_secret_0h3AK1TIb4ecxVjduIojLw_H42jFqZ9` (принимался как `apikey:`; хранится в песочнице в `scripts/witness-agent.py`, `scripts/v4-supabase-verify.py`, `scripts/glm-worker.mjs`)
- DB password: `87rehefiS!!`
- Бывший session pooler: `aws-0-us-east-2.pooler.supabase.com:5432`, user `postgres.xpeibufgzjknrhbhpffp` (tenant more не существует)
- Linked project meta: `/home/z/my-project/supabase/.temp/linked-project.json`

## Pigsty / локальный PostgreSQL (интеграция в репо, PR #936)

- Архитектура: rootless PG 17.11, superuser `postgres`, пароль `postgres`, порт **55432**, база `postgres`
- Строки подключения:
  - direct (для edge `DB_URL`): `postgres://postgres:postgres@<host>:55432/postgres` — ТОЛЬКО direct, не pooler (иначе pg_notify-подписки ломаются)
  - psql: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres`
- Управление: `source infra/pigsty/bin/env.sh; pg-start|pg-stop|pg-restart|pg-status`; health: `infra/pigsty/smoke.sh` (13 проверок)
- Состояние кластера на момент смерти песочницы: 272 таблицы, cron жив (5 задач), wal_level=logical, publication supabase_realtime, расширения pg_cron/pgmq/pg_net/supabase_vault
- Кластер в песочнице УМЕР при сбросе 2026-09-20/21 → восстановление: `infra/pigsty/bootstrap/01→02→03` + dump от оператора (`supabase-backup-20260920.tar.gz`, 38 МБ — full-snapshot-consistent.dump + манифесты + storage + edge-исходники + migrate-кит; либо оригинальный `uploaded.clean.sql` 217 МБ)

## Cloudflare (токены fabric-worker плоскости — значения НЕ сохранились в песочнице)

- Account ID начинается с `d9186d31` (полное значение у оператора)
- Токены типа `cfat_…` / `cfut_…` были выданы оператором в сессии 2026-09-20 — полные значения есть ТОЛЬКО у оператора (в чат были вставлены, в файлы не попали). При необходимости — запросить у него заново.
- Workers в аккаунте: `enginetest`, `metaengine-fabric-worker-h205f21r4`, `metaengine-h205f22-aop1` (AOP1 fabric worker; его deploy-тело сохранено в песочнице: `scripts/aop1_worker.js`)
- Назначение: fabric-worker плоскость (НЕ Supabase command-плоскость)

## Идентификаторы/прочее

- Witness/supervisor bind user ID: `d8e897a3-4cec-4746-a47d-c34b31f001cb` (`scripts/witness-agent.py`)
- Пара A2 chat-bridge pairing-токенов: в `download/a2-chat-bridge-v0.5.0-handoff/PAIRING_TOKEN.txt` (исторические)
- Loopback RPC браузера (на машине оператора после запуска): `~/.a2/supervisor-loopback.json` — там URL (127.0.0.1) + сессионный bearer 256-bit; метод `supervisor.command` идёт через fenced executor, authority_effect passthrough

## Эндпоинты/URL — сводка

| Что | URL | Состояние |
|---|---|---|
| GitHub repo | https://github.com/PatrickFrome/Compute | ЖИВ |
| GitHub API | https://api.github.com/repos/PatrickFrome/Compute | ЖИВ (токен ниже) |
| Инсталлятор установленной сборки | https://github.com/PatrickFrome/Compute/releases/download/v0.7.0-dev.35532004761.1/METAENGINE-Browser-Test-Setup-0.7.0-dev.35532004761.1-x64.exe | ЖИВ |
| Cloud Supabase REST/edge/auth | https://xpeibufgzjknrhbhpffp.supabase.co/... | МЁРТВ (DNS) |
| Pooler | aws-0-us-east-2.pooler.supabase.com:5432 | МЁРТВ (tenant not found) |
| Pigsty (sandbox) | 127.0.0.1:55432 | кластер умер при сбросе; восстановим из bootstrap+dump |
| Edge (когда поднимут) | см. reference-from-rail/docs_push-wake-edge-deploy-runbook.md | не развёрнут |

## GITHUB ADMIN TOKEN (значение)

См. строку ниже (GHTOKEN=):
GHTOKEN=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
