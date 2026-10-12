# Аудит разработки METAENGINE — 10 октября 2026 года

Рабочая линия: `work/client-autonomous-continuity-v1`, исходный HEAD
`1406e3a82ea631263a75597460818d1bed8c67ca`.
Продолжение выполняется поверх имеющихся незакоммиченных изменений.
[PR #1176](https://github.com/PatrickFrome/Compute/pull/1176) остаётся draft;
локальные изменения этого этапа не считаются опубликованными в remote.
Дата отчёта соответствует пользовательской временной зоне Europe/Moscow.

## Источники и границы аудита

- Приложенный экспорт предыдущего чата прочитан как история разработки.
- Источником фактического состояния служат текущие исходники и выполненные проверки.
- [Целевая автономная модель](../../METAENGINE_AUTONOMOUS_SYSTEM_TARGET.md) сохранена.
- [Аудит 9 октября](../metaengine-20261009/CONTINUITY_AUDIT.md) описывает более ранний срез.
- Проверены project runtime, host, CLI, authority, SQL admission, UI и точки подключения.
- Исходные незавершённые изменения сохранены; checkout не сбрасывался.
- Аудит не является построчной проверкой всего репозитория или всех прежних веток.
- Работа исходников и тестов не приравнивается к квалификации установленного клиента.

## Состояние на входе

Предыдущий отчёт называл project adapter неподключённым. Текущее дерево уже
содержало mount в `main.mjs`, private host storage, SQLite FULL journal,
device-signed transport, authoritative PostgreSQL resolver и repository provisioning.
Эти компоненты нельзя повторно считать отсутствующими по старому документу.

При этом `main.mjs` импортировал отсутствующий
`managed-task-project-client-control.mjs`. Статический import создавал реальный
startup blocker до запуска приложения. Product API и UI не имели завершённой
согласованной цепочки создания/открытия зарегистрированного workspace.

Development verifier prerequisites также присутствовали в незавершённых изменениях.
Их наличие не означало подключённый production executor или готовый RSI цикл.

## Реализованное продолжение

| Область | Результат | Проверяемая граница |
| --- | --- | --- |
| Product control | Добавлен отсутствующий control module, status/create/open и проверка актуального observation | Renderer выбирает только зарегистрированный workspace ID |
| IPC и preload | Dedicated API использует shell sender fence и запрещает caller claims/paths | Generic произвольная команда не нужна product UI |
| UI | Подключены действия создания/открытия зарегистрированного проекта и состояния доступности | Новый task, claim или binding интерфейс не создаёт |
| Идемпотентность | CLI, UI и host используют один canonical effect key | Caller key не выбирает второй durable эффект |
| Git executor | Из child environment удаляются все `GIT_*` без учёта регистра | Ambient overrides не перенаправляют effect в другой repository |
| Receipts | CLI/control сверяют identity, generation, HEAD и физический proof | AMBIGUOUS и несовпадающие результаты не объявляются завершением |
| SQL admission | Устранён конфликт с действительным CONTROL heartbeat state | Доверие определяется подписанной transport identity и DB grant |

Основные исходники:

- [Product control](../../../apps/metaengine-browser/src/managed-task-project-client-control.mjs).
- [Host](../../../apps/metaengine-browser/src/managed-task-project-host.mjs).
- [Authority resolver и canonical key](../../../apps/metaengine-browser/src/managed-task-project-authority-resolver.mjs).
- [Git runtime](../../../apps/metaengine-browser/src/managed-task-project-runtime.mjs).
- [CLI](../../../apps/metaengine-browser/scripts/run-managed-project.mjs).
- [SQL migration](../../../supabase/migrations/20261009194157_managed_project_admission_v1.sql).
- [Контракт host](../../../apps/metaengine-browser/docs/managed-task-project-host.md).

## Полномочия, запись и восстановление

SQLite фиксирует local write-ahead intent до Git-эффекта и terminal receipt после
физического readback. Journal не предоставляет полномочий scheduler или task claim.
Production effect требует текущий MUTATING claim, точную DB binding, действующий
device grant, свежую fleet identity и повторную проверку перед физическим действием.

Host вычисляет `project:<workspace_id>:g<workspace_generation>:l<lease_generation>`
после строгой нормализации identity. CREATE и OPEN разделяют один effect key.
Другие caller keys не создают новый эффект. Изменение task/agent/repository/claim
при прежнем key отвергается по binding digest. Lease renewal в той же generation
не требует второго Git add и не переписывает первоначальный receipt.

Host READY описывает private local storage и journal. Это не свидетельство
текущего допуска задачи. Snapshot `lease_current` отражает deadline; окончательный
допуск проверяется свежим signed DB admission при каждом effect.
При закрытии host прекращает intake, дренирует pending effects и затем закрывает
journal. `main.mjs` использует тот же host для Supervisor и loopback commands.

SQL раньше требовал внешний `authority_effect=false` у сохранённого heartbeat,
тогда как штатный CONTROL heartbeat сохраняется с другим внешним значением.
Проверка исправлена на точную transport identity, device/profile/key/grant epoch
и актуальную DB authority. Внешний telemetry flag сам по себе не выдаёт полномочий.

## Подтверждённые проверки

Результаты ниже относятся к конкретным focused запускам; они пересекаются и
не складываются в общий счётчик независимых тестов.

| Проверка | Результат | Локальный лог |
| --- | --- | --- |
| Project baseline перед исправлениями | 54/54 PASS, без skips | `audit-runtime-20261010.log` |
| Git environment fence + runtime/SQLite/host/CLI | 37/37 PASS, без skips | `audit-runtime-env-20261010.log` |
| Усиленные CLI receipts | 7/7 PASS | `audit-runtime-cli-20261010.log` |
| Canonical key + физический host restart + CLI/authority | 17/17 PASS | `audit-runtime-canonical-20261010.log` |
| Финальные strict helper и CLI/authority | 11/11 PASS | `audit-runtime-canonical-helper-20261010.log` |
| Первичный независимый review product control | 7/7 PASS | `audit-client-control-review-20261010.log` |

Логи хранятся в локальном `.audit-local` рядом с checkout и не публикуются как
сырые экспорты окружения. `git diff --check` изменённых tracked runtime файлов прошёл.
Физические проверки включают настоящий Git, owner ACL, SQLite process crash,
конкурентные процессы и восстановление без повторного worktree add.

Регрессия CLI→restart→UI подтверждает один Git add, один canonical PROVEN receipt
и отсутствие journal entry под первоначальным arbitrary caller key.
Disposable PostgreSQL integration дополнен настоящим Git/host/loopback/CLI путем.
Этот composition test не квалифицирует remote signature verification как production proof.

## Итоговые проверки текущего продолжения

| Проверка | Результат и граница |
| --- | --- |
| Локальный state-runtime unit suite | 163/163 PASS, 0 skipped |
| UI + настоящий product control | 16/16 PASS, 0 skipped; включает 9 UI и 7 control tests |
| UI TypeScript | `tsc --noEmit --incremental false`, exit 0 |
| Verifier prerequisites + SQLite | 21/21 PASS, 0 skipped; production isolation этим не доказана |
| PostgreSQL 17.11 composition | 1/1 PASS: реальные routes/RPC, Git, private Windows ACL, SQLite, bearer 401, restart/open; Git add выполнен один раз |
| DB API | 16/16 PASS |
| Package identity/reservation contracts | 25/25 PASS после выбора новой identity `.31.1` |
| Browser source catalog | 180 файлов прошли `node --check` |
| Полный первый Browser прогон | 4689 tests: 4687 PASS, 2 FAIL, 0 skipped, 711,65 секунды; выполнялся до последних исправлений тестовых границ |
| RSI + полный repository scanner после исправления | 10/10 PASS, 3,2 секунды; 4466 tracked файлов, 4433 текстовых |
| Физический Windows executor повторно отдельно | 36/36 PASS, включая exact-window capture; 16,6 секунды |
| Финальный полный Browser прогон | 4699 tests: 4697 PASS, 2 FAIL, 0 skipped, 336,31 секунды; обе нестабильные host fixture проверки затем исправлены и повторены отдельно |
| Host-controller после последних исправлений fixtures | 11/11 PASS, 0 skipped, 2,53 секунды |

Первый полный Browser прогон выявил две проблемы проверок. RSI test включал
в проверяемый callback соседнюю композицию project host; граница исправлена,
а запрет Browser executor внутри RSI callback сохранён. Windows capture превысил
свой фиксированный срок под общей нагрузкой; production deadline не увеличен,
повтор отдельного физического сценария прошёл.

Финальный общий Browser прогон полностью завершён с `--test-concurrency=8` и
включает новые UI/control и canonical-key regressions. Его два failures относятся
к прежним host-controller fixtures: положительный запуск inert child использовал
3-секундный срок, а crash проверялся после фиксированной паузы 250 ms. Во втором
случае общий прогон прочитал состояние до обработки события выхода. Все 11
host-controller tests прошли отдельно. Test-only cold-start budget установлен в
30 секунд, crash assertion ожидает наблюдаемый результат с предельным сроком 10 секунд;
production startup deadline и отдельный отрицательный timeout test не меняются.
Повтор после этих test-only изменений: 11/11 PASS, 0 skipped.
Полный прогон после этих последних test-only изменений повторно не заявлен.

Три ранних отдельных verifier failures оказались истечением секундного срока
положительных BUILD/TEST fixtures, что было прямо видно в receipts. Production
правильно возвращал FAILED. Для положительных fixtures использован обычный
30-секундный бюджет; отдельная проверка TEST timeout 100 ms и обязательный exit 73
crash child сохранены. Финальные 21 тест подтверждают поведение и восстановление.

Repository scanner выполнял serial stat/read всех tracked файлов. Теперь 16
ограниченных workers читают те же файлы с прежними size/binary/provider правилами;
покрытие не сокращено. Процессы первого полного прогона не прерывались.

## Исходники, GitHub и выпуск

Новая локальная package identity — `0.7.0-dev.37781000031.1`; `.30.1` относится
к предыдущему source head и не может быть переиспользована для изменённых байтов.
Package/build reservation contracts проходят; физическое резервирование новой
identity, сборка установщика и installed-client qualification ещё не выполнены.

Свежий публичный GitHub readback подтверждает draft PR #1176 на исходном
`1406e3a82ea631263a75597460818d1bed8c67ca`. Его полный Browser CI завершился success,
а Windows NSIS package job — cancelled. Это CI предыдущего head, не свидетельство
локальных изменений. Текущее продолжение остаётся в рабочем дереве; публикация,
merge, установка клиента и изменение пользовательской БД не выполнялись.

## Оставшиеся границы и следующие приоритеты

1. **Migration packaging и обновление схемы.** До квалификации установленной
   функции нужен проверенный изолированный путь доставки migration SQL/tool и
   обновления схемы. Новая migration зарегистрирована в `LOCAL_RUNTIME_MIGRATIONS`,
   но default sealed runtime/source closure включает edge routes и не включает
   `local-runtime-migrations.mjs` или динамически читаемый SQL. Source fixture
   не доказывает наличие схемы в deployed или пользовательской БД; этот этап
   пользовательскую БД не мигрировал.
2. **Общая история проекта.** Нужен durable project-scoped event feed с cursor,
   причинными связями и единым чтением для UI и агентов после reconnect.
3. **Полезная задача и agent fan-out.** Связать создание дочерних агентов с durable
   queue, lease/epoch, bounded capacity, интеграцией изменений и crash recovery.
4. **Квалифицированный verifier.** Подключить реально изолированный executor к
   Development Plane; выполнить edit/build/tests и независимую оценку результата.
5. **Продолжение проекта после смены владельца.** Lease takeover/new generation
   и reconciliation старых journals с arbitrary keys пока требуют отдельного контракта.
6. **Установленный клиент.** Проверить одну реальную coding-задачу, project/DB
   readback, принудительный сбой, restart и продолжение без дублирования effect.
7. **Remote PROJECT issuance.** Текущий завершённый путь — local loopback/CLI и
   dedicated shell IPC. Стандартный native PostgreSQL issuer и `CHAT_COMMAND_ACTIONS`
   пока не принимают `PROJECT_CREATE`/`PROJECT_OPEN`; shared executor mount не
   означает завершённую remote queue функцию. Runtime capability attestation
   отдельный managed-project feature также не объявляет.

Verifier runtime и durable journal остаются prerequisites. Trusted subprocess
executor из test fixtures не является production isolation provider; prepare-only
flags Development Plane не заменены декларацией готовности.
Полный RSI rollout, доказанное улучшение качества, rollback и непрерывное полезное
исполнение после обновления в этом этапе не квалифицированы.

## Продолжение: SQL история проекта и рекурсивное дерево задач

Добавлена `20261010100000_project_continuity_history_v1.sql`: отдельный стабильный
project ID связывает исходный goal request, неизменяемую root task, дочерние задачи,
предложения и последовательную историю. Серверный device grant и точный текущий
claim ограничивают новые предложения; caller не задаёт root, agent или filesystem
authority. Budget wait сохраняет предложение и допускает позднее продолжение после
операторского изменения политики; null budget снимает логический предел. CODER и
INTEGRATOR нормализуются в существующие IMPLEMENTER и SYNTHESIZER. READY создаёт
видимый demand для существующего fleet governor, без второго scheduler и без выдачи
lease на маршруте spawn.

Маршруты `/v1/devos/project/{register,snapshot,history,spawn,activity,policy,reconcile}`
смонтированы после проверки подписи устройства. Snapshot возвращает selected_task
независимо от первой страницы tasks, непосредственных детей, truthful truncation
flags и состояние всего дерева. SQL не допускает COMPLETED родителя до завершения
потомков, pending proposals и независимого CRITIC ACCEPT с точным digest субъекта;
для CRITICAL нужен и FALSIFIER. Reconcile использует существующий enqueue и
ограниченный device-scoped sweep, чтобы завершённая RESULT_READY root не ожидала
несуществующую running parent. Эти доказательства связывают полученный claim с
durable origin/result receipts; сами model/history content остаются недоверенными.

На временной PostgreSQL 17 получен **1/1 PASS** нового integration test:
root → child → grandchild, budget resume, replay/collision, completion guard,
независимые критики каждого результата, root completion только после всего дерева,
device sweep, пагинация, concurrent append с удерживаемым lower seq, rollback без
пропуска истории, RPC grants и отзыв admin epoch. SHA-256 проверенной миграции:
`a984ab96c2a4735eb1c883d969ad4f782e9eee9e9927cbbe4e27044d94b42ac8`.
Focused маршруты и DB API: **19/19 PASS**. Integration использует synthetic
post-authentication identity и origin/result receipts; реальная signature сеть,
качество работы моделей и installed-client coding task этим не доказаны.
Пользовательская и удалённая БД не изменялись.
