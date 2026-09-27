# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-27T01:52:13Z | worklog: 1890241B / 10354L | sha12=744de4c4e03f

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (1890241B)
| Канал | Путь | Переживает env-reset |
|-------|------|---------------------|
| Supabase Storage | me2-evidence/context-vault/latest/worklog.md | ДА (внешний) |
| OSS (ossfs) | /home/sync/me2-context-backups/latest/worklog.md | ДА (сетевой) |
| Vault | /home/z/context-vault/{latest,snapshots,repo}/ | частично |
| cron-KV | шарды CTX-SHARD-A/B (payload cron-задач) | ДА (серверный) |

## ПОСТОЯННЫЕ CRON-ЗАДАЧИ КОНТЕКСТА
- 413338: PAT watcher (15m) — при появлении GITHUB_TOKEN_ADMIN в /home/z/.a2/.github.env делает push-pending
- 416526: Context Guard (15m) — снапшоты/детект усечения/авторестор/феникс (скрипт в payload задачи)
- PHX-HEARTBEAT: (30m) — этот digest + Supabase/ossfs пульс (скрипт в payload задачи)
- CTX-VAULT-COMPACTOR: (1h) — обновляет KV-шарды CTX-SHARD-A/B

## ПОСЛЕДНИЕ 15 СЕКЦИЙ worklog (Task ID → Task)
- R85-LIVE-AUDIT → фиксация состояния R85 qualification: exact head 35cacda4, PR #987, test-drift, Package Smoke #2422
- R85-INSTALLER-FORGE-20260927 → закрыть audit-loop R85 и реализовать архитектурный срез build-once installer provenance
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R86-BUILD-ONCE-PROVENANCE-20260927 → Полноценная разработка браузера (директива оператора: не мониторинг/аудит): закрыть следующий архитектурный срез «build once → immutable installer SHA/provenance → downstream gates тестируют одни и те же bytes» (устранить 4× дублирование NSIS-сборки), НЕ мешая R85 visual capture.
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- EVOLVE-ROUND-12 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-FOOTER] sticky footer (min-h-screen flex flex-col + mt-auto), safe-area insets
- R12-EV-FOOTER-20260927 → SELF-EVOLVE tick (Job 416839, round=12, v=1.25): EV-FOOTER — sticky footer (min-h-screen flex flex-col + mt-auto), safe-area insets
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R80-DEVLOOP-MIGRATION-20260927 → Директива оператора: преобразовать Job 413338 (R80 push watcher) в полноценный комплексный dev-цикл (аудит веток → desktop-разработка механизмы/контракты/UI → DB-sync → самоулучшение скрипта → повтор)
- R80-final-413338 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R87-CI-PIPELINE-WATCHERS-20260927 → ME2 DEV-LOOP v1, тик 1. Приоритет оператора: desktop-клиент (не консоль). Аудит веток /home/z/me2-desktop → разработка механизмов конвейера: (1) ci-race-check.sh, (2) ci-run-stats.sh; PR-ветка заморожена CI-гонкой.
- R87-SCAN-GATE-INCIDENT-20260927 → Разбор срабатывания секрет-скана в тике R87 (коммит fa7ce1e4 → рельса 2116bb22)
- R87-WAVE-VALIDATION-RECONCILE-20260927 → Тик 2. DEVLOOP-EVOLVE применён: старт с ci-race-check.sh → проверка outcomes первой build-once-волны 4ed9ae49 → сверка с параллельной r86-installer-provenance-v1 (приоритет (a) прошлого тика)
- R81-DESKTOP-GUARDIAN-20260927 → Директива оператора «разрабатываем НЕ КОНСОЛЬ, а DESKTOP КЛИЕНТ metaengine в GITHUB» → раунд desktop-клиента: GAP #2 Guardian-parity light в PatrickFrome/Compute (apps/me2-desktop, ветка me2/r78-desktop-from-scratch)

## ХВОСТ worklog (последние 40 строк, вербатим)
```

Stage Summary:
- Инцидент закрыт как false positive; рельса 2116bb22 чиста (проверка git show: только литерал паттерна); скан-гейт тика захарденен — правило попадает в DEVLOOP-EVOLVE следующего тика
---
Task ID: R87-WAVE-VALIDATION-RECONCILE-20260927
Agent: devloop-417497
Task: Тик 2. DEVLOOP-EVOLVE применён: старт с ci-race-check.sh → проверка outcomes первой build-once-волны 4ed9ae49 → сверка с параллельной r86-installer-provenance-v1 (приоритет (a) прошлого тика)

Work Log:
- Шаг 0: PAT=200; push-pending-r80.sh ok; рельса поглотила cron-дрейф (deef1127) → sandbox/me2-os=44f614b0, ls-remote ok
- Шаг 1: ci-race-check.sh → RACE=1 (единственный in-flight Self Update E2E 36285508848; Package Smoke/consumers завершились) → пуш в PR-ветку заморожен по физике cancel-in-progress
- ВАЛИДАЦИЯ R86 (первая build-once волна 4ed9ae49): 10/11 гейтов SUCCESS — Package Smoke (продюсер, 9.4м) + Installed Chat 11.2м + Final Runtime 10.8м + Soak 11.7м (все consumer-acquire) + Shell/DirtyProfile/CriticalAudit/Orchestrator/TypedWorkspaces/R84Convergence; в работе Self Update E2E; installer_provenance_*-ошибок нет
- Acquire-шаги на уровне jobs: «Acquire provenanced exact-head installer from Package Smoke» → success в installed-chat (36285508707) и final-runtime (36285508743); soak — run-level success (job-list >10, обрезано per_page)
- Сверка provenance-подходов: r86-installer-provenance-v1 — НЕЗАВИСИМАЯ реализация (4ed9ae49 не предок; workflows diff 174+/167- по 4 файлам; их installer-provenance.mjs ≈918 diff-строк, тест ≈839); их база 04da6b19 (до нашего приземления); идеи: bind consumers to producer receipt (PowerShell-гейт provenance.producer_run_id ≠ acquire.producer_run_id → fail), pin single-producer topology, freeze canonical producer run + artifact cardinality
- Вердикт: НЕ мержить параллельную ветку целиком (затрёт нашу валидированную схему); ПОРТИРОВАТЬ 3 идеи отдельными малыми коммитами на PR-head в окне тишины: (1) тест consumer-fail при producer_run_id mismatch, (2) pin single-producer workflow topology, (3) pin artifact cardinality
- dev.log чист; секрет-скан по захардененному регэкспу (порог длины) = 0; page.tsx/daemon не тронуты

Stage Summary:
- R86 ПОДТВЕРЖДЁН ПРОДАКШЕНОМ: первая build-once волна зелёная, single NSIS-builder + acquire fail-closed работают;consumer длительности ~11м (poll+работа) против таймаутов 75/80/90
- Сверка подходов закрыта вердиктом «port, не merge»; рецепт порта в backlog
- DEVLOOP-EVOLVE: следующий тик: (ш.1) ci-race-check.sh; (ш.2) если RACE=0 — подготовить и запушить 3 порта-харденнинга (тест producer_run_id mismatch / topology pin / cardinality pin) одним малым коммитом на PR-head ПОСЛЕ того как Self Update E2E завершится, секрет-скан до коммита по регэкспу с порогом {20,}/{40,} в if-гейте; (ш.3) если RACE=1 — EV-A11Y в apps/metaengine-browser локально (подготовить коммит без пуша); CSV-статистику обновлять раз в 2-3 тика, не каждый
- Backlog: 3 порта-харденнинга; EV-A11Y; таймауты 75/80/90 → рекомендация 2×p95+producer-grace (~40/45/55) по факту 3-5 стабильных волн; watcher параллельных веток r87/r88/r89

---
Task ID: R81-DESKTOP-GUARDIAN-20260927
Agent: Z.ai Code (main)
Task: Директива оператора «разрабатываем НЕ КОНСОЛЬ, а DESKTOP КЛИЕНТ metaengine в GITHUB» → раунд desktop-клиента: GAP #2 Guardian-parity light в PatrickFrome/Compute (apps/me2-desktop, ветка me2/r78-desktop-from-scratch)

Work Log:
- Аудит: daemon 0.21.0 (47/47, last_seq 226); me2-desktop HEAD 8d276feb (R80 #1a, 86/86); worktree r86 @ 4ed9ae49 — ОБНАРУЖЕН УЖЕ ЗАПУШЕННЫМ в work/r85-control-room-ui-v1 (CI Self Update E2E in-flight на нём; PR-ветку не трогал)
- GAP-ROADMAP desktop-клиента: курсор 5.5/8, R81 = #2 Guardian-parity лайт — реализовано полностью
- Код: GUARDIAN-константы (me2-constants.mjs), guardian-contract.mjs (pure: makeBeacon/validateBeacon/evaluateBeacon/nextBackoffMs/decideRestart/computeRestartsInWindow), scripts/guardian.mjs (внешний watchdog zero-dep, CLI + createGuardian с инъекциями), main.mjs (+beacon-writer после plane_up, SMOKE не бьётся, clean_exit в before-quit)
- Тесты: test/guardian.test.mjs — 27 pure+интеграционных (tmp-файлы, инъекции spawnImpl/aliveImpl); SUITE 113/113 GREEN; check-syntax 37 файлов OK
- Версия 0.8.3-dev.0.1; GAP-ROADMAP: #2 → 🔄 parity-лайт (курсор 6/8), условие PR оператора: 3/3 зелёных gate ВЫПОЛНЕНО
- Пуш: 82a44902 + ad872b98 + b8ed647e → me2/r78-desktop-from-scratch (PAT-паттерн, remote URL чист, grep секретов 0); ME2 Desktop Gate: SUCCESS (3-й подряд); ls-remote/api верифицировано

Stage Summary:
- Desktop-клиент продвинут: GAP #2 закрыт до parity-лайт, честные инварианты (clean-exit не воюется, cap 8/ч, свидетельства в журнале переживают рестарт guardian'а)
- Backlog R82: #8 brain-адаптер + #4 native-supervisor client (после ≥1 недели живой обкатки guardian); Xvfb-интеграционный smoke guardian
- Freeze соблюдён: work/r85-control-room-ui-v1 не тронут
```
