# ME2 smart merge R51 — фаза C: единый monorepo (C6) + unified gate

## Что входит

1. **`apps/me2-daemon/`** — пакет daemon'а (v0.43.0) перенесён из dev-интеграционной
   ветки (`sandbox/me2-os` ← `mini-services/me2-daemon`): ядро шины 47/47, контракт
   `me2-daemon-contract.v1` (R49), eval v18 (53 проверки), vault токенов в SQLite (R47).
2. **`apps/me2-ui/`** — панельный Mission Control v5 (Next + Tailwind + shadcn):
   исходники UI, совместимы с `me2-ui-host` (R50) — `ME2_UI_DIR`/`resources/me2-ui`.
3. **`.github/workflows/me2-unified-gate.yml`** — контрактный гейт единой системы.

## Изоляция инстансов (новая поверхность daemon v0.43.0)

По образцу `code --user-data-dir` (VS Code smoke-тесты в CI) daemon принимает env:
- `ME2_WS_PORT` / `ME2_REST_PORT` — порты WS (:3040) и REST (:3041) по умолчанию;
- `ME2_DATA_DIR` — каталог SQLite (по умолчанию `data/` рядом с daemon'ом);
- `ME2_LOCK_FILE` — lockfile стража инкарнаций (E3/R34; по умолчанию `/tmp/me2-daemon.lock`);
- `ME2_LEGACY_MIRROR_PORT` (:3021) / `ME2_SCREENCEAST_PORT` (:3043);
- `ME2_BOOT_MODE=probe` — инкарнация «только контракт»: REST+socket+eval подняты,
  LLM-приводы отключены (worker/GLM-проба/demand/cron/supervisor-тики/selfupdate).

Поведение production не меняется (все дефолты прежние).

## Gate: `apps/me2-daemon` → `bun run check` (scripts/probe.sh)

Поднимает изолированный инстанс на девственной SQLite (mktemp-каталог, свободные
порты), ждёт `/health`, требует `eval` вердикт **PASS** (ретраи ≤30с, честный лог).
Локально проверен: `GATE PASS: daemon boot + eval 53/53`.

## Реальные баги, найденные gate-тестом (и исправленные)

1. **`idx_eval_runs_started` создавался до таблицы `eval_runs`** (тихий провал
   CREATE INDEX в dbhygiene.ts при холодной DB; production-индекс — историческое
   наследие). Фикс: индекс создаётся в схеме eval.ts рядом с таблицей.
2. **`memory.db_file` статаивал захардкоженный путь** `../data/me2.db` — на
   ином `ME2_DATA_DIR` persistence-пруф давал 0KB (critical FAIL). Фикс: единый
   источник пути `DB_FILE` в store.ts.
3. **`eval memory.rows` на девственной DB** зависел от «повезёт ли с ранними
   событиями». Фикс: boot-запись памяти (`incarnation:<ts>`) — persistence-пруф
   с первой секунды каждой инкарнации.

## Честные границы (не в этом PR)

- Сборка `next build` для `apps/me2-ui` и упаковка в `resources/me2-ui` — R52 (C7,
  шаг autorelease-конвейера); сейчас ui-gate проверяет только разрешение зависимостей.
- `desktop/` исходники в release-ветке не дублируются: механизмы уже перенесены
  в me2-плоскость (R50: gateway → me2-ui-gateway, updater DEPRECATED).
- `main` монорепо остаётся замороженным; dev-интеграция — `sandbox/me2-os`.

## Проверки

- `bun run check` (probe): PASS 53/53, повторно на чистом `node_modules`.
- production-daemon v0.43.0 (живая интеграция): eval PASS 53/53, контракт v1.
- `bun build --no-bundle` синтаксис всех изменённых модулей — OK.
