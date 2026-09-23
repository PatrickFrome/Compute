# ME2 smart merge R52 — фаза C7: UI-сборка в autorelease + фаза D-prep (SQL-контур, RPC-реестр)

## Что входит

1. **C7 — `apps/me2-ui/scripts/pack-me2-ui.mjs`**: упаковщик production-сборки Next
   (standalone) в самодостаточный каталог `me2-ui-dist/` — контракт `me2-ui-host` (R50):
   `package.json` со скриптом `start` (`bun server.js`), health `GET / → text/html`,
   манифест `me2.ui-bundle-manifest.v1` (build_id, git_sha, размер). Проверен локально:
   сборка → pack (69.4 MiB) → smoke-старт → HTTP 200 HTML «METAENGINE Mission Control».
2. **C7 — `electron-builder.test.json`**: `extraResources: me2-ui-dist → me2-ui` —
   установщик несёт панели Mission Control в `resources/me2-ui` (живой контур R50 их подхватит).
   Fail-open: при сбое UI-сборки workflow кладёт честный README-стаб (без `package.json`,
   чтобы ui-host НЕ пытался усыновить мёртвый каталог) — фолбэк `GET /ui` остаётся.
3. **C7 — `browser-final-runtime-activation-v1.yml`**: шаг «Build and pack ME2 UI (C7, fail-open)»
   перед electron-builder (setup-bun на windows-2025; «один SHA → один релиз» — паттерн VS Code).
4. **C7 — `me2-unified-gate.yml` + job `ui-build`**: независимая required-check пересборка
   (frozen install → next build → pack → verify manifest → smoke-старт → upload-artifact).
5. **D-prep — daemon v0.44.0 `src/sqlmirror.ts`**: H6 SQL-контур (план §D8/D9) — зеркало
   hash-chain событий в SQL-таблицу `me2_event_mirror_h205f22` (PostgREST, idempotent по PK seq,
   `Prefer: resolution=ignore-duplicates`). Operator-gated (`ME2_SQL_MIRROR=1` + ключ из vault R47);
   честные состояния OFF/WARMUP/LIVE/DEGRADED, перепроба отсутствующей таблицы ≤ 1 раз в PROBE_MS
   (PGRST205-протокол, без штормов). `GET /sqlmirror` (read-only, вне шины, 47/47 не тронут).
   Живые пробы: WARMUP на отсутствующей таблице подтверждён (table_missing_404, шторма нет);
   LIVE-путь — после миграции оператора `sql/0001`.
6. **D-prep — K8 матрица версий**: `capabilities.compat` в `GET /state` (contract/daemon/ui_fallback/
   browser_expect/notes) + история контракта в docs (sandbox-ветка: docs/version-matrix.md).
7. **D-prep — `sql/`**: `0001-me2-event-mirror.sql` (таблица зеркала + RLS + индексы) и
   `0002-rpc-registry.sql` (реестр 243 RPC: ACTIVE 24 / CONTROL_PLANE 37 / FREEZE 182 —
   пометить, НЕ удалять; живой инвентарь OpenAPI). Применение — оператором (PGRST205-протокол).

## Гейт

- `bun run check` (daemon-gate): **GATE PASS 53/53** локально на v0.44.0 (boot-probe, свежая SQLite).
- ui-build (новый job): локальный эквивалент пройден целиком (см. п.1).
- Инвариант шины 47/47 сохранён; все новые поверхности — вне шины (maintenance/read-плоскость).

## Следствия для релиза

- Следующий dev-релиз браузера (autorelease) везёт панели v5 внутри установщика →
  живые установки получают единую систему без ручной доставки UI (самообновление).
- Расхождение «браузер без UI» устраняется by-design: stab → честный DEGRADED → `GET /ui`.
