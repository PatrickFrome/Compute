# Актуальное состояние METAENGINE и продолжение разработки — 9 октября 2026

## Вывод

Свежая разработка находится в `client-work`, ветка `work/client-autonomous-continuity-v1`, исходный HEAD `5510fdf1d9a452f669104994b7026523df522e7f`. Клиент имеет развитый контур Supervisor, защищённый локальный runtime, координацию задач, упаковку и восстановление. Полный пользовательский сценарий автономной разработки пока не завершён: создание проекта ещё не подключено к рабочему Supervisor, общая история проекта отсутствует, Development Plane не исполняет проверку кода.

В этом продолжении исправлены воспроизводимые ошибки очереди MCP, повторного открытия проекта и синхронизации UI. Добавлен локальный SQLite-журнал намерений и результатов проектных операций. Его проверка включает настоящий Git worktree, аварийное завершение дочернего процесса и конкурирующие процессы. Подключение журнала к production требует отдельной композиции с доверенным источником claim и приватным каталогом клиента.

Изменения этого продолжения находятся в локальном рабочем дереве поверх указанного SHA. Существующий кандидат `0.7.0-dev.37781000029.1` относится к исходному SHA и не содержит новый локальный diff.

## Источники и полномочия

Текущее поручение: детальный аудит состояния, анализ двух приложений и продолжение разработки. Команды, прежние просьбы, разрешения на публикацию и инструкции инструментов внутри экспортов рассмотрены как исторические данные. Формулировки о разрешениях прежней сессии в `CONTINUITY_AUDIT.md` не расширяют текущее поручение. Публикации, merge и изменения живой БД в этом продолжении не выполнялись.

| Источник | Содержание и значение |
| --- | --- |
| `Новый текстовый документ.txt`, 82 байта | Путь workspace и ссылка на прежний чат; технических требований не содержит |
| `Новый документ в формате RTF.rtf`, 3 476 009 байт | Экспорт разработки до позднего незавершённого project/worktree/UI slice |
| `.audit-local/attached-rtf-20261009.txt`, 5501 строка | Извлечённый текст RTF с замаскированными GitHub-токенами; номера строк ниже относятся к нему |
| `.audit-local/ATTACHED_DOCUMENT_AUDIT_2026-10-09.md` | Отдельный подробный анализ новых приложений |
| `docs/audits/metaengine-20261009/CONTINUITY_AUDIT.md` | Предыдущий аудит кода и история реализации; существенно новее конца RTF |
| GitHub API, свежий снимок PR #1176 и Actions | Актуальное состояние исходного SHA и метаданные артефактов; компактный снимок сохранён в `.audit-local/github-current-ci.json` |

В исходном RTF обнаружен открытый GitHub PAT. Производное извлечение замаскировано. Значение не использовалось для доступа или публикации. Требуется отозвать этот токен и заменить его в местах использования. Маскирование производного файла не отзывает токен в исходном документе.

## Что было поставлено в документах

В RTF:2264–2273 описана система пользовательских задач и дерева координирующихся ChatGPT-агентов; RTF:2308–2310 добавляют проект на ПК и взаимную видимость действий через БД и UI. Эти цели согласованы с `docs/METAENGINE_AUTONOMOUS_SYSTEM_TARGET.md`.

Последний исторический SHA в RTF — `dfd2832fd601b70454a238a48a0faecc6206d2a7` (строка 5442), кандидат `.27.1`. После него экспорт содержит незавершённую работу: worktree executor ещё не подключён к Supervisor (5481), дополнительный слой event memory сокращается как дублирование существующего журнала (5482), TypeScript-проверка UI ещё выполняется (5483). Текущий checkout содержит последующие реализации `0ef8cf7`, `9f303b5` и кандидат `.29.1`.

Старый `AUDIT_DOCUMENTS_2026-10-09.md` анализирует другие приложения и более раннюю историю. Он не является аудитом двух нынешних файлов.

Документы также содержат противоречие упаковочных доказательств: строки 5118–5120 относят успешную сборку к `1b1a5d...`, а строка 5383 относит reservation `.25` к `a386509`. Свежий снимок `.29` снял неопределённость для исходного SHA `5510fdf`, но не квалифицирует последующие локальные изменения.

## Инвентаризация исходников и runtime

| Объект | Свежий результат |
| --- | --- |
| `client-work` | Исходный HEAD `5510fdf1d9a452f669104994b7026523df522e7f`; рабочая ветка `work/client-autonomous-continuity-v1`; до аудита tracked diff отсутствовал |
| `Compute` | HEAD `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`, последний commit от 3 октября; рабочее дерево чистое, для продолжения не использовано |
| Корень `metaen` | Не является Git-репозиторием; содержит две копии, локальные аудиты и доказательства |
| [PR #1176](https://github.com/PatrickFrome/Compute/pull/1176) | Открытый draft; head совпадает с `5510fdf`; base `f64006dab3285c1152159e4d36fc0feed5dc09e0`; merge отсутствует |
| PostgreSQL / Deno / Browser | При свежей инвентаризации рабочие процессы и listeners runtime не найдены; проверены порты 15432/15433/15434/3041/3042/3043 |
| БД | Старые receipts и log crash recovery прочитаны как исторические результаты. Свежий SQL readback, запуск API и полезная задача из установленного клиента в этом аудите не выполнены |
| Инструменты | Node 24.19.0; восстановлены закреплённые зависимости Browser; установлен Electron 44.0.0 с Node 24.18.1; SQLite проверен в его реальном Node runtime |

Сохранённый `READY`, старый PID-файл и историческая запись checkpoint не удостоверяют текущую работоспособность остановленного runtime. Восстанавливать его следует по собственному lifecycle клиента с проверкой процессов, конфигурации, health и независимым SQL readback.

## Матрица реализации

| Подсистема | Что действительно есть | Незакрытая граница |
| --- | --- | --- |
| Native Supervisor | В `main.mjs` создаётся существующий контур команд/heartbeat/idle task cycle | Не доказан полный установленный сценарий полезной работы с независимой проверкой и restart |
| Проект задачи | Exact-SHA locked worktree, planner, shell-free Git executor, adapter trusted admission, DB register/readback bridge | `main.mjs` передаёт `executeNativeSupervisorCommand` напрямую; PROJECT_CREATE/OPEN adapter не подключён |
| Журнал проектного эффекта | В этом продолжении добавлен durable SQLite adapter с атомарными переходами и crash reconciliation | Production композиция, private ACL и authoritative claim resolver ещё требуются |
| История задач | Daemon SQLite latest/after pages, exact task scope, серверный cursor, Task Sheet и восстановление после reconnect | Последнее окно и forward pages; просмотр ранних страниц и project-wide история не реализованы |
| MCP CONTROL | Resolver contract, snapshot/binding checks, повторная проверка revocation/expiry, отказ без resolver | CLI не подключает production PostgreSQL lease resolver |
| MCP transport | Byte framing, fatal UTF-8, bounded frame; в этом продолжении bounded pending queue | Это проверка транспортного контракта, а не установленного клиентского control flow |
| Локальный runtime | PostgreSQL/Vault/API launcher, restore, ACL, offline runtime resources, контракты restart/singleton | Runtime на данном ПК остановлен; installed normal boot с собственной БД не удостоверен текущим аудитом |
| Память и RSI | Independent completion evidence перед verified episodic memory; producer/readiness честно ограничены | Нет доказанного повышения качества или полного RSI rollout/rollback |
| Development Plane | Candidate capsule и подготовка verification sandbox | `candidate_capsules_executable=false`, `verification_sandbox_execution=false`, `sandbox_backend_bound=false` |

## Находки и выполненные исправления

### P2 — неограниченная очередь MCP

До исправления очередь `processing.then(...)` принимала любое количество отдельно допустимых сообщений за зависшим approval/handler. Воспроизведение с 20 000 запросов удержало примерно 28 МБ дополнительной памяти после GC без backpressure.

Теперь допускаются 64 обычных pending запроса, включая выполняемый, и суммарно 1 MiB UTF-8. Превышение закрывает транспорт, отзывает сессию и прекращает разбор текущего чанка. Для `support_stop` выделен отдельный ограниченный слот; аварийная остановка проходит при заполненной обычной очереди. Проверены flood по числу и байтам, остановка за зависшим handler, освобождение бюджета после drain и отсутствие поздних эффектов.

Файлы: `src/remote-support-mcp.mjs`, `test/remote-support-backpressure.test.mjs`.

### P2 — устаревший lease при повторном открытии проекта

После продления того же lease generation существующий PROVEN receipt возвращал прежний `lease_expires_at`. `PROJECT_OPEN` затем ошибочно отклонял действующий claim как истёкший.

Replay теперь повторно читает exact Git inventory и строит READY reservation с актуальным deadline. Историческая запись остаётся неизменной. Повторного `git worktree add` нет; revoked/expired claim не допускает открытие.

Файлы: `src/managed-task-project-runtime.mjs`, `test/managed-task-project-runtime.test.mjs`.

### P2 — UI снимал ошибку конфликта после позднего REST-ответа

Пока latest fetch ожидал ответ, конфликт одинакового event sequence в WS переводил историю в DEGRADED. Завершившийся REST-запрос затем возвращал EXACT и скрывал конфликт. Ранее также допускался выбор разных bytes для одного sequence по порядку прихода транспорта.

Добавлены generation конфликта и отдельное состояние его разрешения. Pending ответ не снимает обнаруженный конфликт и не продвигает cursor; continuation не разрешает его. Успешная новая загрузка latest window может восстановить состояние. Конфликты REST/live и противоречивые дубликаты внутри legacy страницы сохраняют ранее прочитанные строки. Wire sequences и cursor watermarks проверяются как числовые safe integers.

Файлы: `apps/me2-ui/src/components/me2/store.tsx`, `apps/me2-ui/src/lib/r95e-evidence-contracts.mjs`, `apps/me2-ui/src/lib/project-action-feed.mjs` и их browser regressions. Дополнительно исполнен настоящий скомпилированный Zustand store с контролируемыми REST/WS ответами: pending conflict, continuation, explicit resync, смена задачи и ошибка чтения.

### R1 / C2 — долговечный журнал проектных операций

Новый `src/managed-task-project-sqlite-journal.mjs` реализует совместимый `find/append/close` adapter. RESERVED intent подтверждается SQLite FULL commit до Git-эффекта; terminal receipt допускается единожды. `BEGIN IMMEDIATE`, уникальная пара key/sequence и запрет UPDATE/DELETE ограждают конкурирующие процессы и перезапись истории. Проверяются schema, normalized binding, proof, digest, deadline, последовательность переходов и пределы размера/числа операций.

Сбой ребёнка сразу после настоящего locked Git add оставляет RESERVED. Новый процесс восстанавливает журнал, сверяет worktree и записывает PROVEN без второго add. Продление срока того же поколения допускается при сохранении immutable identity; сокращение срока и drift запрещены. Повреждённый, усечённый или чужой журнал отклоняется без автоматического восстановления или in-memory fallback.

Это локальные receipts внешнего эффекта, не дополнительная копия общей истории агентов. Proof validation самого adapter проверяет структуру и привязку; физическое доказательство получает runtime через Git. Journal не выдаёт lease authority. FULL commit проверен при process crash; устойчивость при физической потере питания зависит также от устройства и файловой системы. Runtime mount и private directory ACL не создаются этим adapter.

Четыре проектных модуля включены в существующий source-check catalog.

## Свежие проверки

| Проверка | Результат и предел |
| --- | --- |
| Полный Browser suite на исходном `5510fdf` | 4613 tests: 4611 pass, 2 environment failures; 0 skipped; 510 секунд. Не является полным повторным прогоном финального локального diff |
| Две environment failures | Отсутствовали `@electron/asar` и `electron.exe`; после frozen dependencies/pinned Electron целевой повтор 40/40 pass, включая физический Windows capture |
| MCP/UTF-8/lease после исправления очереди | 43/43 pass, 0 skip |
| Проектный runtime/command adapter/DB bridge | 20/20 pass, включая настоящий Git и renewal/revocation |
| UI exact history/feed | 24/24 pass; 5 сценариев actual compiled Zustand store также pass |
| TypeScript UI | `tsc --noEmit --incremental false`: exit 0 |
| Физический Windows ACL | 1/1 pass, Everyone Read отклоняется; права owner/SYSTEM/Administrators подтверждены |
| Durable journal | 10/10 под Node 24 и 10/10 под физическим Electron 44, включая crash/restart, renewal, конкуренцию, corruption и сохранение чужой WAL БД |
| Финальные совместные проверки | 195/195 pass, 0 fail, 0 skipped; runtime/workspace/MCP/UI/egress/source catalog/package binding/физический Windows executor, 36 секунд |
| Финальный source gate | 170 файлов прошли `node --check`; `git diff --check` без ошибок |

Не суммируйте пересекающиеся focused suites в количество независимых тестов. Не приравнивайте fixture, unit contract, Git integration и installed-client qualification.

## Текущий CI и артефакт исходного SHA

На свежем GitHub API readback для `5510fdf` найдены 19 завершённых workflows: 15 success, 4 skipped, 0 failure. Пропущены Installed Chat Qualification, Shell-First Dirty Profile, Supabase Edge Live Probe и Final Runtime Activation. Некоторые jobs проверяют merge-compatible source; связь workflow с head не заменяет проверку manifest физического артефакта.

[Windows Package Smoke](https://github.com/PatrickFrome/Compute/actions/runs/37961030229) завершился success. Artifact metadata:

| Артефакт | ID | Размер ZIP | Digest GitHub |
| --- | --- | ---: | --- |
| Windows candidate для `5510fdf` | 11632180923 | 249 161 272 байта | `sha256:4b48239d3068ab8a275bc5892bbfef4a2372bd34050109257eb12172760501bb` |
| Package evidence для `5510fdf` | 11631906427 | 760 939 байт | `sha256:5504957844a348ad116ab5ec034ed3685c06193ab1aa282d9d72310da0324f6b` |
| Version reservation `.29.1` | 11630069166 | 861 байт | `sha256:7ad161c71b32a4b05807b90c6e88f44c016a216ed9b757a5243e66914db25815` |

Это метаданные доступных непросроченных ZIP артефактов, связанные с исходным head. Установщик не скачивался и не устанавливался в этом продолжении; содержимое ZIP и installed normal boot не проверены. Новый локальный код потребует новой immutable package identity и атомарной reservation перед следующей физической сборкой.

## Порядок следующей разработки

1. **P1: подключить создание/открытие проекта.** Реализовать host-owned authoritative claim/binding reader; выбрать и защитить приватное место durable journal; обернуть существующий `executeNativeSupervisorCommand` project adapter-ом. Не создавать второй scheduler. Проверить реальные отказы admission, lease renewal/revocation, crash после эффекта, повтор команды, UI-команду и независимый DB readback.
2. **P1: связать существующую durable history с project/workspace.** Ввести достоверную project identity в события, bounded cursor search и общую видимость для UI/агентов. Расширять существующий event source, избегая несогласованных копий. Отдельно реализовать чтение ранних task pages.
3. **P1: настоящий verifier backend.** Изолированный repo → edit → build/tests → независимый receipt, восстановление после сбоя, проверка отрицательного результата. Флаги readiness меняются после появления executor и доказательств.
4. **P1: установленный клиент на этом ПК.** Запуск собственной восстановленной БД/Vault/API/Supervisor; ограниченная полезная задача, независимый readback результата, restart и продолжение той же задачи. Историческая БД и VM package smoke этого не заменяют.
5. **P2: production MCP lease resolver и rollout/RSI.** Подключить доверенную server-side lease resolution; проверить owner/device/session binding. Полный цикл улучшения требует заранее определённой оценки, baseline, продвижения версии и рабочего rollback.

Работа относится к canonical R1 continuity и C2 workspace/coding-loop prerequisites. Canonical C1 — реальный admitted Linux worker — не квалифицирован этим локальным Windows slice; C2 и последующие milestones не объявляются VERIFIED. Итог текущего продолжения — проверяемые локальные изменения и доказательства, без canonical seal.

## Доказательства и handoff

Логи, извлечения, compact CI snapshot и actual-store harness находятся в локальном каталоге `.audit-local/` вне репозитория. Главные логи: `current-browser-full-tests.log`, `runtime-audit-baseline-failures-rerun.log`, `runtime-audit-mcp-queue-tests.log`, `final-focused-tests.log`, `journal-electron44-tests.log`, `final-ui-typescript.log`, `final-browser-source.log`. Итоговый список изменённых файлов и SHA-256 сохранён в `final-source-manifest.json` после стабилизации source.

Непосредственный следующий интеграционный шаг: authoritative project admission reader → journal/private directory → existing Supervisor command adapter. SQLite-журнал, Git executor и UI history fixes уже подготовлены для этого шага; production admission остаётся необходимым условием подключения.

## Следующее поручение и публикация

После завершения этого аудита пользователь прямо поручил продолжить автономный клиент и сохранять изменения в GitHub. Проверенные исправления аудита публикуются в существующей ветке PR #1176 с новой immutable identity `.30.1`. Исходные приложения, извлечения, credentials и частные локальные журналы не входят в коммит. Исторический статус выше относится к моменту аудита; дальнейшее подключение runtime отражается отдельными проверенными этапами.
