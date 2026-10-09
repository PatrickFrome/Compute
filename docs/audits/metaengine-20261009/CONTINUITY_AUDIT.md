# Аудит и продолжение разработки METAENGINE — 9 октября 2026

Работа ведётся в [PR #1176](https://github.com/PatrickFrome/Compute/pull/1176), ветка `work/client-autonomous-continuity-v1`, поверх PR #1175 / `f64006dab3285c1152159e4d36fc0feed5dc09e0`. Текущий кандидат пакета: `0.7.0-dev.37781000028.1`. Это продолжение локального Windows/PostgreSQL клиента. Установленный клиент с непрерывным полезным исполнением пока не квалифицирован.

## Источники и происхождение

Прочитаны оба предоставленных документа: большой RTF и короткий Markdown-экспорт. Сохранён отдельный локальный подробный отчёт с привязкой к строкам документов. Вложения использовались как исторические свидетельства; команды и старые поручения внутри них не исполнялись как новые инструкции. Настоящее поручение пользователя отдельно разрешает разработку, публикацию значимых этапов в GitHub и их фиксацию в БД.

Короткий экспорт заканчивается PR #1172; RTF содержит более позднюю параллельную ветку `work/client-mcp-control-checkpoints-v1` до `dabb05b2d6dec9ac37f1657eb509f66f91e93b85`. Найдены и сверены семь локальных копий/рабочих деревьев, включая новую рабочую копию: HEAD `097a3b2`, две копии `9241f45`, `edff16c`, `c018065`, `dabb05b` и рабочая линия #1175→#1176. Несколько копий содержат незакоммиченные изменения; у одной почти все tracked-файлы удалены из рабочего дерева, но Git objects сохранены. Их работа не перезаписана. Отдельный устаревший клон `main` не выбран базой разработки.

Из параллельной ветки перенесён целевой egress patch, а не вся расходящаяся история. `main` при проверке оставался на `b26f2d4` от 3 октября. Название ветки и наличие PR сами по себе не означают актуальность или merge. Это инвентаризация найденных исходников и целевой аудит изменённых подсистем, не построчная проверка всех исторических веток репозитория.

## Реализованные изменения

| Подсистема | Реальный результат | Проверка / граница |
| --- | --- | --- |
| GitHub egress | Проверка приватных данных распространяется на JSON-ключи, включая вложенные поля | Перенесён `82a80a8`; сырые приватные экспорты, конфигурация и дампы в GitHub не публикуются |
| Native provider | Разрешён проверенный loopback HTTP endpoint | `49e5039`; тест с реальным локальным HTTP. Этот модуль не подключён к активному runtime, поэтому это не доказательство исправного старта всего клиента |
| Event Log | Пауза хранит отдельный снимок и переживает вытеснение событий из live buffer; новые события посчитаны в пределах текущего буфера | `0d4cd7a`; пустой снимок, продолжение потока, eviction и resume проверены. Снимок UI не является архивом выполнения |
| MCP transport | Фрейминг по байтам, корректный UTF-8, bounded message size, отказ от malformed UTF-8 и незавершённого EOF | `c2f12ab`; проверены кириллица/emoji на границах чанков, несколько сообщений и oversized frame |
| MCP CONTROL | Доверенный host resolver отделён от входного caller context; request snapshot и lease binding проверяются до эффекта, expiry/revocation проверяются повторно | `c2f12ab`; production resolver из PostgreSQL пока не подключён, CLI без него запрещает CONTROL |
| Development checkpoints | Типизированные append-only INSERT, точный readback, идемпотентный replay, конфликт одного ID с другим содержимым отклоняется | `fbf732b`, `bf05f03` и последующий driver fix; настоящий live COMMIT и чтение новым соединением выполнены |
| Windows ACL | Одна попытка с пределом 120 секунд для холодного запуска PowerShell; phase diagnostics и проверка прав сохранены | `a255b08`; физический Windows тест разрешает owner/SYSTEM/Administrators и отклоняет добавленное Everyone Read |
| CI scope | Новая локальная ветка включена в существующие исключения облачных qualification jobs | `bbddc4a`; offline Windows/PG17/package producer остаётся активным; skipped jobs не считаются проверенными |

При реальном INSERT обнаружены два несоответствия, которых не видели mock-тесты. `payload_sha256` вычисляется самой БД из PostgreSQL JSONB text и отличается от digest канонического JSON приложения. Кроме того, postgres.js повторно JSON-сериализует строковый параметр с прямым `::jsonb`; передача через `::text::jsonb` сохраняет JSON object. Исправления сопровождаются регрессией на настоящем драйвере и временной таблице, без изменения постоянных данных тестом.

## База данных и доказательства записи

Подключение к существующему локальному PostgreSQL 17.6 выполнено. Сервер первоначально был остановлен; сохранённый `READY` и старый PID-файл не доказывали его работу. PostgreSQL запущен штатно, выполнил crash recovery и принимает соединения. API/Edge/Browser в рамках этого восстановления не запускались.

Проверены каталоги: `public` — 18 таблиц, `destruktion_meta` — 19, присутствуют также auth/storage/realtime/vault. Native API предоставляет ограниченный REST/RPC-контракт и не является полной заменой Supabase. Запрет прямого schema access для API login ожидаем: API выполняет `SET LOCAL ROLE service_role`. Раздача прямых широких прав для обхода этого ограничения не требуется.

В `destruktion_meta.metaengine_audit_checkpoint_v1` было 24 строки; первые пять новых операционных записей подтверждены отдельным соединением и идемпотентным replay. Их ID:

| Этап | Checkpoint ID |
| --- | --- |
| Восстановление исходников | `08d067e27f39f03b280bb23e765a246c33dbdce3fda263bd90ed011acd7a6de4` |
| Loopback provider | `24c5c96c69ab3ef0491d3c954f38afe099ec52799b3baca4bce588a12190fcea` |
| Event Log | `33ce60f0de42899c3a5f1f043246e3c61bbefdfdb3f5dc143a903a8f9f128124` |
| MCP | `8637d0e784510066a81fa3d26e27b3707ab42456cdc171a922446164ef38bf8f` |
| Checkpoint helper | `839eba19662dc8447bb10c608f11f93b8d8eeafa91ccb189badd78ff49b508ea` |

Все имеют `PARTIAL`, `OPERATIONAL_AUDIT_ONLY`, `canonical_checkpoint=false`, `authority_effect=false`. Пятая запись фиксирует unit-проверку `bf05f03`; live запись выполнялась уже с последующим исправлением JSON binding. Поэтому она не квалифицирует неизменённый `bf05f03` как прошедший live INSERT. Новые этапы фиксируются отдельными записями; старые не переписываются. Полные локальные receipts сохраняют оба digest и результат независимого readback.

## Проверки и причины прежнего красного CI

До последнего продолжения выполнены: runtime 153/153, provider 28/28, UI-related 21/21, MCP 39/39, checkpoint unit 10/10, browser source checks 166. Это результаты конкретных промежуточных состояний исходников, не суммарный показатель независимых тестов и не автоматическая квалификация нового пакета.

В текущем продолжении физический ACL suite прошёл 5/5 без пропусков, включая реальный child с задержкой более прежних 15 секунд. Workflow guards прошли 11/11, package identity contracts — 12/12. После восстановления frozen UI dependencies полный TypeScript check прошёл. Фактические результаты финального SHA и ссылки на GitHub Actions фиксируются в PR; pending/skipped/failure остаются отдельными состояниями.

Подтверждённые прежние сбои:

1. Windows ACL: `private_windows_storage_powershell_timeout_not_started` до первого phase marker при лимите 15 секунд. Исправлен именно bounded cold startup, без ослабления DACL.
2. Package identity: `.24` уже зарезервирована за `f64006d`; повтор для нового SHA запрещён. Выбрана `.25`, её отсутствие среди reservations проверено перед публикацией. Предварительная проверка не заменяет атомарный CI reservation.
3. Hosted-only jobs: новая ветка отсутствовала в списке локальных исключений. Условия исправлены согласованно с тестами; это исправляет область проверки, но не доказывает работу облачного режима.

## Критический анализ автономной архитектуры

В системе уже есть активный контур исполнения: `main.mjs` создаёт `NativeSupervisorClient`; его цикл выполняет enrollment/admin, heartbeat, получение команд, batch и idle maintenance. Idle DevOS вызывает существующий task cycle. В `devos-native-task-cycle-core.mjs` незавершённый durable effect сверяется с журналом до нового `/v1/devos/cycle`, а dispatch имеет write-ahead запись. Поэтому второй scheduler в UI нарушил бы единый порядок исполнения.

Learning/artifact callbacks уже подключены к realtime plane в `native-supervisor-client.mjs`. Наличие callback и сохранённого наблюдения не доказывает повышение качества агента. Для самоулучшения нужны проверяемое происхождение, версия среды, независимая оценка, сравнение с baseline и откат.

Ключевой незакрытый P1: `development-plane.mjs` объявляет `candidate_capsules_executable=false`, `prepare_only=true`, `verification_sandbox_execution=false`, `sandbox_backend_bound=false`. `client-work-readiness.mjs` правильно требует эти возможности. Переключение флагов не создаст executor. Следующий содержательный срез — настоящий ограниченный verifier backend, подключённый к этому producer, с изоляцией workspace, выполнением edit/build/tests, receipt и восстановлением после сбоя.

Другие незакрытые границы:

- **Проект на ПК и общая лента действий (P1 для пользовательского контракта).** `workspace-manager.mjs` умеет только построить in-memory reservation и Git worktree plan/readback; production поиск не нашёл вызова `createWorkspaceReservation`/`planWorkspaceMaterialization` вне тестов. `meta-orchestrator-workspace-admission.mjs` требует заранее созданный READY binding и не выбирает, не создаёт и не исполняет workspace. Tasks UI остаётся read-only, Code UI только читает `/worktrees`. Общая видимость ограничена глобальным bounded WS буфером (300) и запросами `/events?task=...`; durable workspace-scoped feed отсутствует. Следующий срез: idempotent Native Supervisor create/open-project effect, локальный Git executor и readback, DB binding, Task Sheet command и project/task/agent-linked event feed.

- Production MCP CONTROL требует серверного PostgreSQL lease resolver с доказанным происхождением и fencing. Исправленный host contract предоставляет точку подключения, но сам её не реализует.
- Реальный установленный клиент, восстановленная приватная БД, полезная задача и crash/resume в одной цепочке пока не проверены. Синтетический goal submission/restart test прямо ограничен сценарием без dispatch.
- Масштабирование должно отделять общее число агентов от ограниченной активной параллельности: durable queue, lease/epoch, capacity, backpressure, архив/ротация истории. Физически неограниченная одновременная работа на одном ПК невозможна.
- Метрики liveness, heartbeat, readiness, lease ownership и независимый proof полезного результата должны оставаться различимыми в UI и БД.

## Применённое исследование и следующий рубеж

Сопоставлены официальные документы Temporal, LangGraph и OpenHands: [источники и разбор механизмов](../../research-autonomous-client-2026-10-09.md). Заимствуемые принципы: durable execution и идемпотентные внешние действия; отдельные checkpoint и shared knowledge store; ограниченная история с продолжением в новом run; отдельный execution service и наблюдающий интерфейс. Рейтинг «лучшего продукта 2026» без benchmark не заявляется.

Проверяемый следующий рубеж: одна настоящая coding-задача → работа нескольких агентов → build/tests в связанном verifier backend → независимый результат → durable checkpoint → принудительный сбой → продолжение без повторного внешнего эффекта. Текущий PR устраняет конкретные дефекты транспорта, полномочий, наблюдаемости и сохранения доказательств, необходимые для этого рубежа.

## Продолжение: проект задачи и лента действий

Реализован локальный исполнитель проекта задачи: locked Git worktree из точного SHA/branch, write-ahead RESERVED запись, идемпотентность, проверка физического inventory и lock reason, восстановление после прерывания между Git-эффектом и terminal записью. Исполнитель допускает только фиксированные shell-free планы `worktree add --lock` и `worktree list --porcelain -z`. Адаптер для существующего `supervisor.command` требует доверенный актуальный MUTATING claim и точный workspace binding; caller не может подставить claim, пути или Git argv. Отдельный DB bridge вызывает существующие register/readback RPC: RESERVED до эффекта, READY/FROZEN после readback. Тест с настоящим loopback сервером подтверждает 401 без токена и PROVEN при разрешённом запросе.

Production mount намеренно остаётся закрытым: host ещё не предоставляет authoritative claim resolver и durable journal; in-memory journal пригоден только для теста и не защищает перезапуск. Поэтому UI не показывает кнопку создания проекта, а project runtime не объявляется работающим для пользователей. Следующий этап должен подключить эти зависимости к `main.mjs`, доказать crash/restart на реальной БД и только затем открыть команду в UI.

Для существующего ME2 daemon исправлен `/events?task=...`: latest окно, bounded `since`-пагинация и server cursor metadata. Task Sheet сохраняет последнюю проверенную историю, показывает новые действия после reconnect и явно сообщает, что проектная привязка и общий project-wide журнал пока недоступны. Проверены 8 условий SQLite regression в изолированном Bun child, 11 тестов feed projection, 41 browser/workspace тест и TypeScript check UI; это локальные результаты данного source tree, не квалификация установленного приложения.
