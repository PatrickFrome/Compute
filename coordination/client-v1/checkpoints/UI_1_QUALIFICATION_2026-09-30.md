# UI.1 Проверка нового клиента

Дата: 30 сентября 2026. Репозиторий: PatrickFrome/Compute. PR: #1084.
Проверяемый source SHA: `b1dc649b694bc60478b7b7021e68f1fa6e1d6271`.
Версия кандидата: `0.7.0-dev.36719340135.1`.
Родитель: C4.6 / #1083 / `558a260efc9ee3f9b1fa0219b317428881407501`.

## Результат аудита

Главные слабости затрагивали поведение, а не только оформление: native WebContentsView перекрывал строку задачи; подсветка агента появлялась до подтверждения его native-привязки; узкое окно полностью теряло выбор агентов; Settings предлагал удалённые маршруты; состояние accepted можно было спутать с завершённой работой. В коде также были скрытые ошибки типов, замаскированные `ignoreBuildErrors`.

Исправления объединены в один workbench: строка задачи, searchable fleet и native Agent conversation. Второстепенные инструменты открываются осознанно через Settings или поиск. Главный экран содержит текстовые действия, без декоративных кнопок-иконок. Task Status показывает идентификаторы и отдельные доказательства Agent origin и принятого результата. Чтение прогресса не отправляет задачу повторно.

## Что взято из аналогов

| Система | Применённый принцип | Результат |
| --- | --- | --- |
| Cursor Agents Window | Единое место для сессий, работы и review | Основная поверхность принадлежит выбранному native-агенту; выбор подтверждается точными actor/tab ID. |
| ChatGPT Desktop | Короткий ввод и продолжение разговора | Одна строка задачи, короткий статус и отдельный диалог подробностей. |
| VS Code / IntelliJ | Управляемая плотность и скрываемые вторичные инструменты | Читаемый текст, Settings по назначению, lazy-загрузка инструментов. |
| DaVinci Resolve | Группировать инструменты вокруг выполняемой работы | Пять действующих инструментов вместо постоянной панели из множества страниц. |
| Browserbase | Связывать inspection с доказательствами конкретной сессии | Task/request evidence остаётся точным; fixture не выдаётся за live z.ai execution. |
| WAI-ARIA / Electron | Фокус modal и физические native bounds | Escape возвращает фокус; native view скрывается под диалогом; DOM и main-process bounds совпадают. |

Источники и таблица 23 дефектов: [исследование UI.1](../../../research/METAENGINE_CLIENT_UI_RESEARCH_2026-09-30.md).

## Актуальные ветки

Свежий `git ls-remote --heads` и ancestry-аудит на exact head охватили 746 веток без namespace-фильтра и без shallow history: 192 CONTAINED, 547 DIVERGENT, 6 UNRELATED_HISTORY, 1 EXACT_HEAD, 0 недоступных commit objects. Полная таблица сохранена в `UI1_BRANCH_INVENTORY_2026-09-30.json` (SHA-256 `13756300af8e636bbc64feea268a69f2523287f413a9df57408d74aa2237b6da`).

R109 и C4.1–C4.6 входят в ancestry кандидата. Боковая stable-enrollment ветка имеет два уникальных исторических коммита, но проверка run-attempt уже есть в текущем Edge-коде и `native-supervisor-enrollment-correlation.test.mjs`. Старую C2 evidence-seal ветку не переносили wholesale: текущий immutable physical subject хранится существующим DB evidence rail и не получает promotion authority. Расходящиеся ветки не объявлены ненужными только по ancestry; массовое удаление или merge не выполнялись.

## Приложенные исторические материалы

Проведена инвентаризация 24 вложений. Архитектурные DOCX #13/#14 и exports #15/#17 попарно совпадают по SHA-256. Для сверки использованы R1/W1 capsules, архитектурный аудит 4 сентября, handoff 6 сентября, Fast Control Plane Research и документы продолжения разработки. Их исторические branch/live snapshots не заменяют текущий SHA.

Сохранены полезные инварианты: persisted readback перед успехом, точная target/incarnation identity, один scheduler/effect authority, bounded observation и отсутствие blind retry после AMBIGUOUS. Новый UI не превращает data heartbeat, отправку задачи или восстановленную вкладку в доказательство полезной работы.

Приложенный ZIP содержит старый пакет `0.7.0-dev.1` от `f43c48ca…`, с SHA-256 `0c1837f3f0b4986b8420bd214bd751334ad9ed28954df5eb51c10ff509e21856`. Отдельный EXE `0.6.6-dev.17.5` — другой артефакт. Оба являются историческими материалами и не используются вместо нового кандидата.

## Проверки

Предыдущий immutable checkpoint `c483804246035dd31194ce1e17a20c6bbb6708d1` завершил все 14 workflow успешно. Девять его Windows-снимков просмотрены. Последний снимок выявил отдельный дефект portal: мелкие бледные подписи и декоративные иконки Command Palette не наследовали стиль workbench. Финальный head исправляет это и требует реальных измерений font-size >=12px, контраста >=4.5:1, отсутствия SVG и восстановления фокуса. Также исправлено преждевременное закрытие registry BUDGET_FLUSH до подтверждения. Пакет получил новый монотонный номер до пересборки.


LOCAL: на этапе реализации UI.1 строгий TypeScript, production webpack build и ESLint изменённых компонентов — PASS; 81 UI/persistence и 71 goal/identity contracts — PASS. Финальный palette-срез отдельно прошёл строгие TypeScript/ESLint, 58 UI/authority и 6 identity contracts. Запуск Chromium и IPC/listen в локальной среде ограничен; локальный полный runtime PASS не заявляется.

EXACT CI: на `b1dc649b694bc60478b7b7021e68f1fa6e1d6271` полный Browser suite — 3723/3723 PASS, 0 failures, 0 skips; все 14 mandatory workflow terminal SUCCESS.

| Workflow | Exact-head run | Результат |
| --- | --- | --- |
| METAENGINE Browser Critical Audit V1 | [36723271446](https://github.com/PatrickFrome/Compute/actions/runs/36723271446) | SUCCESS |
| METAENGINE Browser Shell V1 | [36723271657](https://github.com/PatrickFrome/Compute/actions/runs/36723271657) | SUCCESS |
| METAENGINE Browser Shell-First Dirty Profile V1 | [36723271438](https://github.com/PatrickFrome/Compute/actions/runs/36723271438) | SUCCESS |
| Browser Meta Orchestrator V1 | [36723271554](https://github.com/PatrickFrome/Compute/actions/runs/36723271554) | SUCCESS |
| Browser Typed Workspaces V1 | [36723271547](https://github.com/PatrickFrome/Compute/actions/runs/36723271547) | SUCCESS |
| METAENGINE Browser Host Resilience Login Start V1 | [36723271790](https://github.com/PatrickFrome/Compute/actions/runs/36723271790) | SUCCESS |
| R84 Desktop Convergence V1 | [36723271522](https://github.com/PatrickFrome/Compute/actions/runs/36723271522) | SUCCESS |
| Client V1 C4 Goal Contracts | [36723271615](https://github.com/PatrickFrome/Compute/actions/runs/36723271615) | SUCCESS |
| Browser Workspace Reincarnation V1 | [36723271782](https://github.com/PatrickFrome/Compute/actions/runs/36723271782) | SUCCESS |
| Browser Windows Package Smoke | [36723271877](https://github.com/PatrickFrome/Compute/actions/runs/36723271877) | SUCCESS |
| Browser Windows Installed Chat Qualification | [36723271559](https://github.com/PatrickFrome/Compute/actions/runs/36723271559) | SUCCESS |
| METAENGINE Browser Final Runtime Activation V1 | [36723271439](https://github.com/PatrickFrome/Compute/actions/runs/36723271439) | SUCCESS |
| METAENGINE Browser Windows Autonomous Soak V1 | [36723271673](https://github.com/PatrickFrome/Compute/actions/runs/36723271673) | SUCCESS |
| METAENGINE Browser Self Update E2E | [36723271565](https://github.com/PatrickFrome/Compute/actions/runs/36723271565) | SUCCESS |

Windows UI: 9/9 PNG просмотрены; bytes/SHA-256 совпадают с manifest. Actual native bounds `x=288, y=90, width=1152, height=870` совпадают с DOM и production planner. Narrow picker, modal hiding/focus, stale actor acknowledgement, IME guard, exactly-one goal submission, пять Settings routes и bounded offline loading — PASS. В Command Palette измерены 12px minimum и контраст 5.77:1 minimum; SVG count 0; Escape возвращает focus.

Первый кандидат выявил собственные ошибки: clean Windows build нашёл неиспользуемый Prisma import, а trusted updater отверг суффикс `.2`. Модуль удалён; identity исправлена на canonical `.1`; проверки не ослаблены. Оставшиеся assertions старых подписей статуса заменены проверками разделённых Agent/result evidence states.

## Установщик и происхождение байтов

Fresh-install кандидат: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36719340135.1-x64.exe`.

- EXE: 159 527 123 bytes; SHA-256 `5d6c528a880708ebb525c29747875c5331631c395ea7e417e3894487e4670000`.
- Producer: Package Smoke run `36723271877`, number `3016`, attempt `1`, source `b1dc649b…`.
- [Immutable candidate ZIP](https://github.com/PatrickFrome/Compute/actions/runs/36723271877/artifacts/11101647794): 159 696 234 bytes; archive SHA-256 `cb7ac6c54913c912466569437bf79cda9e69fef7a249a301f10fa8fd1dd0cc48`. Это hash ZIP, не EXE.
- [Windows evidence ZIP](https://github.com/PatrickFrome/Compute/actions/runs/36723271877/artifacts/11102253342): SHA-256 `1d00a9fa2b77455db543b17d3d5c2f66b90dbcdbfd445d388e6cb3a892bd47ed`; локальная загрузка и digest проверены.

Installed Chat, Final Runtime и installed 72-activation Soak independently прочитали тот же EXE hash, проверили blockmap/config и дождались terminal SUCCESS именно указанного producer. UI manifest/installed size равны 38 777 042 bytes; daemon `0.57.1` содержит embedded runtime, внешний Bun не требуется. Normal boot, second-instance activation и 190 секунд startup-grace с теми же primary PID/Sentinel token подтверждены.

Self Update E2E завершился SUCCESS на том же source SHA, но использует отдельный target `0.7.0-dev.36723271565.1` / EXE SHA-256 `91bc404116a1f735babd11f9af6dbb8777e6dc98234c8a280038dd5136ad92d8`. Fast update и resident upgrade запустили новые Browser/Sentinel, retry dialog не требовался. Этот workflow не подтверждает self-update именно fresh-install EXE `5d6c528a…`. Это конкретный оставшийся release-seal gap: привести Self Update consumer к Package Smoke artifact или отдельно испытать те же fresh-install байты, сохранив monotonic target и exact producer fencing.

Кандидат unsigned; `published=false`, `promotion_authorized=false`. Установленный пользовательский Browser этим ходом не обновлялся. Полный машинный read model: `UI1_QUALIFICATION_EVIDENCE_2026-09-30.json`.

## Механики и уровень проверки

| Механика | Что доказано на этой ступени | Что остаётся отдельным gate |
| --- | --- | --- |
| Выбор native Agent | Точное actor/tab подтверждение; отказ не меняет выделение; узкое окно сохраняет выбор | Live z.ai Agent origin и создание новой Agent-сессии |
| Строка задачи | Не перекрывается native view; IME не отправляет цель; double-action и observation не повторяют submit | Signed goal → DevOS lease → реальный Agent submit/readback |
| Task Status | Task/request ID и Agent/result evidence разделены; modal скрывает native view и возвращает фокус | Fresh accepted result с exact durable binding |
| Settings | Пять сохранённых инструментов монтируются; offline/loading ограничен; недоступные изменения отключены | Полный physical audit всех legacy-внутренностей каждого инструмента |
| Command Palette | Читаемый portal, scopes, текстовые действия, возврат фокуса; подтверждение FLUSH остаётся открытым | Полный audit всех динамических registry-команд |
| Browser-owned ME2 runtime | Чистая упаковка UI и daemon; no-provider-API/probe contracts сохраняются | Работа пользовательского live-инстанса |
| Recovery/self-update | Exact fresh-install consumers; отдельный same-source self-update target | Обновление пользовательской машины и непрерывный useful loop после него |
| Рой, Supervisor и самообучение | Их authority и proof contracts сохранены, второй runtime/scheduler не добавлен | C4/C5 physical Agent-origin/result и длительная полезная работа |

## Границы доказательства

Локальный WebContentsView fixture подтверждает композицию native/React UI. Это не живой z.ai Agent и не end-to-end исполнение задачи. Installed boot, soak и self-update CI также не подтверждают обновление пользовательской машины. C4/C5 physical Agent-origin/result qualification и непрерывная автономная разработка требуют отдельного живого доказательства.

Остались предметы следующего аудита: self-update на fresh-install байтах, технические legacy-блоки внутри advanced tools, tracked Next build output и объединённая проекция готовности native Supervisor/Fleet. Они не объявлены закрытыми этим UI checkpoint.
