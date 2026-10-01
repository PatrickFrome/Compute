# METAENGINE Client — критический аудит и следующий качественный шаг

Дата: 1 октября 2026, Moscow/UTC. Source checkpoint: `93c64424525e00444a97abc151ef05bd386da3d7`, PR #1085. Новая bounded-ветка: `work/client-v1-work-readiness-recovery-v1`.

## Вывод

Главный скачок качества сейчас — переход от живого установленного клиента к одному повторяемому циклу полезной разработки. Для этого уже есть сильное ядро. Основные разрывы лежат между владельцами состояния: подключение, workspace admission, Supervisor conversation, Agent origin, задача и проверенный результат. Интерфейс должен показывать эти границы достоверно, а recovery — давать проверяемый выход из блокировки.

Увеличение числа агентов, очередной dashboard и переписывание runtime до первого такого цикла увеличат площадь изменений. Текущий срез восстанавливает недостающую authority и делает готовность исполнения наблюдаемой. Следующий обязательный шаг — физический Agent/recovery/useful-work gate.

## Документ: сильные выводы и устаревшие основания

Исходный `аудиты.docx`: SHA-256 `903bdc169f4db9da9a15d57fb0ae17fd3c36250738bb41bc1e9c548f478c171f`, 3,149 непустых paragraphs, 28 таблиц, 122 страницы после рендера. Это компиляция повторяющихся срезов, преимущественно R109. Повторение одной диагностики не является независимым подтверждением. Paragraph indices ниже относятся к последовательному XML extraction, включая таблицы.

| Тезис документа | Оценка по текущим данным |
|---|---|
| Один Native Fleet / Supervisor / DevOS authority, убрать параллельные mutation paths (§1361–1439, 2001–2020) | Сохраняется. Narrow typed IPC уже существует в 93c; делать его заново не нужно. |
| R109/ff95… надо заморозить; R83 red (§1014–1020, 3133–3137) | Исторический snapshot. Квалифицированный продукт продвинулся до 93c с 20 успешными workflow. Новый срез строится от него. |
| Build once; tested artifact equals released artifact (§3136) | Верно; уже реализовано для package/install/soak/self-update в 93c. Сохраняем producer/consumer pipeline. |
| Зелёный CI и масштаб synthetic Brain не доказывают автономную разработку (§2021–2037, 2422–2459) | Верно. Личный Browser соединён, но полезный Agent/coding loop всё ещё не доказан. |
| 730 веток; старый main как authority (§2039+, 2653+) | Исторические числа. Свежий полный census: 752 ветки. `main` теперь содержит новые swarm-журналы и остаётся divergent. |
| Перевести UI на static embedded renderer (§2733–2742, 3139) | Хорошая цель уменьшения процессов/портов, после product-control/useful-work baseline и positive replacement всех нужных consumers. |
| Memory должна менять дальнейшее решение (§2453–2459, 2683–2691) | Верно. Требуется influence benchmark; объём памяти и throughput не являются таким доказательством. |
| Каждому safety invariant нужен positive capability (§2484) | Применено: SQL тестирует правильный lease и resume рядом с отказами; UI readiness имеет положительный и отрицательные cases. |

Документ верно определяет sequencing, но его R-ID и состояния нельзя применять как свежую source authority. Фиксированное «≤10 PR» полезно как WIP policy, а не как доказательство качества runtime. Публичные claims о превосходстве над другими системами без сопоставимого benchmark не используются.

## Проверенное текущее состояние

PR #1085 OPEN/DRAFT, exact source 93c. Все 20 exact-head workflow завершились SUCCESS. Пользователь установлен на `0.7.0-dev.36760350225.1`. Соединение подтверждено signed enrollment, свежим heartbeat и завершённой физической read-only SYSTEM_TELEMETRY командой. Это не визуальная инспекция его Windows-окна и не доказательство z.ai Agent submission.

Meta: `jhriwwsryeqsvvvufkok`. Stable v9 имеет узкий compatibility route только для ранее утверждённого пользовательского клиента в canary v25. Это не fleet-wide promotion. Другой исторический Supabase project не является current authority.

Свежий census относительно 93c: 193 CONTAINED, 550 DIVERGENT, 6 UNRELATED_HISTORY, 2 DESCENDANT, 1 EXACT_HEAD. Полный машинный inventory: `coordination/client-v1/evidence/WORK_READINESS_BRANCH_AUDIT_2026-10-01.json`. Классификация ancestry не является автоматически разрешением на merge/delete. Qualified Browser и исторический release/main имеют разные роли.

Перед repair: ACTIVE=0, BOUND_UNVERIFIED=4, Supervisor `ROLLOVER_AMBIGUOUS`, cycle 2109. В профиле durable admission floor 28. В Meta отсутствовала строка runtime-control, а getter возвращал подставной floor 0. Native runtime правильно отклонял регрессию. Resume RPC отсутствовал. Серверная fresh-project lease implementation не проверяла runtime-control/admission floor. SYSTEM_TELEMETRY получала неполный main state и показывала null lifecycle, несмотря на настоящий живой Supervisor.

После atomic SQL qualification и закрытого bootstrap: authority существует, floor 28, `CLOSED`, authoritative=true. Installed heartbeat это уже принял. Восемь historical tasks остаются FENCED; claims=0; fixtures=0. Rollover и cycle 2109 сохранены. Принимать этот repair за автономию нельзя.

## Критика интерфейса

Проверены реальные Windows/Electron captures exact 93c: основной Chat Fleet, Task Status и Runtime Settings. Эти captures используют controlled fixtures, поэтому не доказывают реальные z.ai sessions.

Сильные стороны: один главный workspace, небольшой chrome, плоский agent rail, goal input, отдельный task-status drill-down, отсутствие постоянных KPI-карточек. Смена primary native geometry не требуется.

Слабые стороны:

1. `Admin connected` не сообщает, может ли система исполнять задачу. Transport, admission, Supervisor и Agent proof должны иметь разные значения.
2. Ошибка IPC сохраняла последнюю положительную connection projection без ограничения времени. Зелёный badge мог устареть.
3. Runtime Settings показывали legacy mechanics/capabilities и совет «check daemon connection», хотя packaged compatibility probe не владеет autonomous execution. Это отвлекающая диагностика с неправильным владельцем.
4. Task status содержит exact IDs раньше, чем пользователь видит blocker/следующее действие. После readiness/recovery основной drill-down следует организовать как этап, причина ожидания, текущий agent, подтверждённый результат; IDs оставить в details.
5. Access/Policy/Recovery и некоторые advanced pages ещё содержат legacy probe consumers. Их нельзя автоматически считать работающими control surfaces. Каждую mutation-кнопку переносить в canonical typed API или удалять после consumer census.
6. Стартовая пустая поверхность и выбранный fixture-agent без текущего native view могут давать противоречивую картину. Нужно связывать selection с exact current session readback и объяснять «session unavailable», а не украшать пустое место.

В этом срезе исправлены пункты 1–3: тот же единственный badge сообщает readiness, Runtime показывает bounded native facts; две legacy runtime panels и их REST loops удалены. Не добавляются декоративные иконки, второй dashboard или новая browser geometry.

## Исследование аналогов: конкретные применимые принципы

| Первичный источник | Принцип | Применение |
|---|---|---|
| [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) | Liveness и readiness отвечают на разные вопросы; ошибочный restart может усилить failure | Разделить свежий ADMIN transport и execution readiness. Недоступная authority не является приказом перезапустить процесс. |
| [Temporal durable execution](https://docs.temporal.io/temporal) | Progress/history сохраняются при сбое, восстановление продолжается с известной границы | Использовать существующие checkpoints, leases и EffectJournal; ambiguity требует readback, а не повторения внешнего действия. Не устанавливать второй scheduler. |
| [Cursor Agents Window](https://cursor.com/docs/agent/agents-window) | Агентный workspace объединяет задачи и review; worktrees отделяют изменения | Один goal/task context, компактные агенты, переход к diff/test/artifact. Не копировать model API execution. |
| [Cursor Agent Review](https://cursor.com/docs/agent/agent-review) | Результат разработки должен быть доступен для review | Приоритизировать проверенный diff/tests/artifact над infrastructure counters. |
| [Supabase database functions](https://supabase.com/docs/guides/database/functions) | Privileged RPC требует ограниченных grants и search_path | Recovery и resume — service-only; anon/authenticated не получают доступ. Ключи остаются на сервере. |

Это инженерные выводы из источников, а не обещание одинаковой архитектуры или копирование UI. DaVinci/IDE navigation patterns уже использованы ранее; повторный масштабный визуальный redesign сейчас не устранит missing authority.

## Следующие шаги в существующем roadmap

| Очередность | Работа | Измеримый exit gate |
|---|---|---|
| Сейчас: C3 recovery + UI readiness | Вернуть monotonic workspace authority, server lease admission; объяснить blocker | Fresh signed readback floor≥durable profile, ноль исторических replay, positive/negative SQL и UI cases. Первый bounded срез реализован. |
| Далее: Supervisor/Agent recovery | Найти terminal proof старого rollover, rebind текущего Supervisor; проверить z.ai SPA Agent и GLM-5.3-Flash | Exact current target/generations, одно новое подтверждённое Agent submission/readback; отсутствие coordinate/API fallback и duplicate effect. |
| C4→C5: один useful-work golden path | Goal → lease → real Agent → worktree/diff → намеренно failing test → repair → critic → accepted result | Одна небольшая реальная coding-задача от установленного UI, точная причинная связь всех evidence; затем второй независимый agent. |
| Continuity/update | Restart mid-task, outage, exact installer self-update | Resume той же полезной работы без blind replay и ручной DB/Git surgery; тот же installer hash у всех consumers. |
| Learning, simplification и scale | Outcome→lesson→retrieval→изменившееся решение; затем static UI и удаление compatibility debt | Сначала influence evidence, затем меньший process/port/poller budget при сохранении positive capabilities; elastic 2→4→8 real agents. |

Беспрерывность означает восстановимый полезный progress; она не следует из бесконечного timer. Elastic fleet должна расширяться по реальным ресурсам и provider sessions. Разделяемые действия, результаты и краткие rationale должны иметь provenance; доступ ко всем скрытым внутренним рассуждениям модели нельзя предполагать.

## Реализованная граница и проверки

SQL capsule `WORKSPACE_AUTHORITY_RECOVERY_V1.sql`: getter различает отсутствующую authority и закрытую существующую; bootstrap использует свежий ADMIN DEVOS/RECOVERY witness с exact process/floor, учитывает более высокий durable floor других profiles, отвергает live claims/tasks/effect leases, создаёт только CLOSED и durable event. Resume — exact-floor CAS, без reset/replay. Lease держит admission row FOR SHARE, проверяет обе flags и floor до reconcile/выдачи.

Все 22 PostgreSQL-сценария прошли атомарно с DDL; fixtures откатились. Четыре live function body SHA-256 совпали с checked-in SQL. Security advisor не выдал новых WARNING/ERROR; INFO RLS/no-policy соответствует закрытым service-only tables, публичные grants не открывались.

Native projection теперь снабжает SYSTEM_TELEMETRY настоящим bounded lifecycle/DevOS/heartbeat. Readiness проверяет текущие exact Browser bindings и Agent-origin digest; READY означает готовность dispatch, а не accepted result. Shared UI resource deduplicates consumers, ограничивает IPC deadline, убирает stale positives и останавливает polling без видимых consumers.

113/113 focused/runtime/authority/primary-shell regressions PASS. Полный local Node sweep ограничен sandbox: десять существующих Unix-socket tests получили EPERM, в том числе dependent native attach health assertion. Это не считается PASS и не является основанием ослаблять tests. Требуется полный Windows CI плюс compiled packaged UI на новом exact SHA.

Квалифицированный 93c сохранён. SQL recovery уже принят личным live Browser; новый UI/source ещё требует immutable package/install qualification. Финальный release seal, полный автономный loop и memory influence этим checkpoint не закрыты.

Первый CI-кандидат 763732b4 успешно скомпилировал Next UI и прошёл Shell/Critical Audit/dirty-profile/contracts. Physical visual gate поймал устаревший harness: в нём отсутствовали новые typed IPC fixtures, а Runtime проверялся по удалённому daemon banner. Producer остановился до сборки installer; четыре downstream failure являются отсутствием qualified producer. Исправленный сценарий сохраняет все прежние gates и дополнительно физически проверяет connected≠ready, positive READY, connected/PAUSED и исчезновение stale positive после отказа IPC. Эти controlled captures не подменяют реальные Agent-origin/useful-work proof.

Исправленный 458421de прошёл 11 physical captures и полный Windows Node regression 3776/3776, zero skips. Однако package.json ещё наследовал версию установленного 93c. Это отдельный дефект upgrade identity: новый полезный код не должен поставляться как та же версия. До выдачи installer кандидат получил монотонную `0.7.0-dev.36797279067.1`; exact producer/run/attempt/SHA/hash по-прежнему фиксируются независимо в provenance, и versioned head проходит новый неизменный package/consumer цикл.
