# METAENGINE — поток 6 из семи рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат координирует интеграцию; всего предусмотрены семь рабочих потоков и координатор. Выполни задачу ниже: исследуй, создай необходимые изменения и проверки в собственной ветке и передай проверяемый результат через GitHub. Не ограничивайся планом.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя issue:** https://github.com/PatrickFrome/Compute/issues/1361

**Координация:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-artifacts-20261027`

**Общий BASE_SHA:** `9d7527683060e314eb1d39fec9ce2304a57103c4`

**PR base:** `work/preinstall-closure-20261027`

## Задача

Подготовить недостающий producer-bound sidecar для потока2 (#1356): проверенный распакованный candidate image, его inventory и digest NSIS-generated uninstaller. Sidecar должен происходить из того же единственного Package Smoke run, что и immutable installer.

Ветка: `work/preinstall-artifacts-20261027`.

## Подтверждённый входной пробел

На базовом SHA Package Smoke публикует immutable candidate до fresh install; список candidate artifact не содержит полного win-unpacked tree и producer-pinned uninstaller hash. `compareQaInstalledImage()` требует candidateRoot и внешний expectedUninstallerSha256; вычислить ожидаемый hash из самого проверяемого successor недостаточно. Дописывать уже опубликованный immutable candidate нельзя.

Текущий run40412019931 на9d752768 завершился `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED` для .178 до build. Это ожидаемая граница потреблённой версии; исправлять её повторной сборкой или сменой версии в своей ветке запрещено.

## Делегированная область

- Новый `apps/metaengine-browser/scripts/qa-forward-candidate-evidence.mjs`, его unit/negative tests и отдельный consumer helper/contract для sidecar.
- Узкие capture/upload steps в `.github/workflows/browser-windows-package-smoke.yml` после существующего успешного fresh install. Эта область специально делегирована потоку6; coordinator сохраняет владение всем остальным producer lifecycle.
- При необходимости совместимое additive binding в `apps/metaengine-browser/scripts/qualified-installer-consumer.ps1` — сначала зафиксировать точный diff в DEPENDENCY_REQUEST #1354, поскольку helper общий.
- Отдельная документация схемы и отчёт `docs/audits/preinstall-stream6-artifacts-20261027.md`.

Не менять package manifests, versions/reservation/history/seals, signing/release policy, существующие installer gates и migration implementation. Не запускать package producer вручную и не создавать второй build. Не использовать `latest` вместо закреплённых IDs.

## Работа и критерии приёмки

1. Определить минимальную versioned schema и согласовать входной контракт с потоком2 через issue, не ожидая его полного harness.
2. После fresh install того же installer публиковать отдельный immutable sidecar: unpacked image + inventory, source SHA/version, producer run ID/number/attempt/event, candidate artifact ID/digest, installer/ASAR/runtime SHA и uninstaller SHA, прочитанный из этого fresh install.
3. Выполнить producer-side installed-tree comparison. Не доверять uninstaller/hash из consumer successor; не включать uninstaller в исходное win-unpacked дерево.
4. Consumer проверяет одно соответствующее artifact, совпадение run/attempt/source/version и всех перекрёстных hashes. Требует terminal SUCCESS именно исходного producer; missing/pending/failed/ambiguous не квалифицируют artifact.
5. Отрицательные tests: чужой или stale run/attempt/SHA/version; подмена installer/tree/ASAR/runtime/uninstaller; отсутствующий/дублированный artifact; неверный digest; path traversal, абсолютные пути, aliasing, case-collision и превышение лимитов распаковки при materialization; валидный receipt при failed producer. Исправления должны сохранять уже существующий строгий installer contract.
6. До выдачи координатором свежей версии проверить schema/binding на изолированных fixtures. Реальный producer evidence оставить явно BLOCKED, не выдавая synthetic receipt за собранный installer.

Результат: узкий PR, consumer-readable схема/пример без секретов, негативные tests и понятный контракт, который разблокирует физическую migration после центральной сборки.

## Общая база и координация

Репозиторий: https://github.com/PatrickFrome/Compute . Штаб: #1354.
**BASE_SHA / ANCHOR_SHA: `9d7527683060e314eb1d39fec9ce2304a57103c4`.**
PR base: `work/preinstall-closure-20261027`. Это расширение до семи рабочих потоков и одного координатора. Четыре предыдущих задания #1355–#1358 и их база сохраняются.

Работайте в отдельном worktree/checkout. До правок опубликуйте CLAIMED в своей issue: BASE_SHA, ветка, планируемые файлы. Выполняйте работу до проверяемого результата и открывайте draft PR в интеграционную ветку. Самостоятельно PR не сливайте. Вне своей области оставляйте DEPENDENCY_REQUEST в #1354 с точным путём, изменением и критерием приёмки; продолжайте независимую часть работы.

Прочитайте на базовом SHA `docs/audits/preinstall-closure-20261027.md` и исходный `coordination/operator-control/preinstall-five-streams-20261027.md`; актуальное расширение и исключения владения указаны в #1354 и этой issue. Число «пять» в первом документе описывает первую волну.

Координатор сохраняет владение Browser package.json/package-lock.json, версиями, reservation/history, closure manifest/seals, интеграцией и итоговой приёмкой. Версия `0.7.0-dev.1784381341133.1` уже потреблена; её нельзя пересобирать. Все installed consumers получают один immutable installer одного producer. Профильные тесты рабочей ветки и окончательный source seal после интеграции — разные проверки: worker не отключает seal и не меняет общий manifest ради зелёного CI.

Пользовательские Browser, Owner, PostgreSQL, Guardian и registry не являются тестовой средой. Физические проверки — только на disposable Windows и новых fixture-данных. Не ослабляйте RequireFreshInstall; не используйте старый uninstaller, широкие process kill, поддельные receipts или автоматический retry неоднозначного эффекта. Не публикуйте ключи, пароли, raw payloads или содержимое пользовательских данных.

## Формат результата

В issue фиксируйте STATUS (CLAIMED / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW), BASE_SHA, HEAD_SHA, BRANCH, PR, FILES, точные команды, PASS/FAIL/SKIP, ссылки на CI/artifacts, source/version/run/attempt и hashes где применимо. Разделяйте наблюдения и гипотезы. Указывайте оставшиеся неизвестные и следующий безопасный шаг. DONE/ACCEPTED ставит координатор после приёмки.

Между чатами нет автоматического обмена памятью: решения и зависимости передаются через GitHub. Если доступа к записи нет, подготовьте патч и Markdown-отчёт координатору; не утверждайте, что issue comment или PR опубликованы.

## Первые действия

1. Прочитай #1354 и свою issue; проверь новые комментарии и зависимости. Общая исходная точка остаётся указанным полным SHA, даже если документация или ветка интеграции уже продвинулась.
2. Проверь доступ к репозиторию и чистоту выбранного checkout. Создай отдельный worktree/ветку от BASE_SHA; не переключай и не очищай чужой рабочий каталог.
3. Напиши CLAIMED в своей issue и перечисли планируемые файлы. При отсутствии доступа сообщи конкретный блокер, не придумывая состояние репозитория.
4. Выполняй работу, публикуй существенные результаты/блокеры и открой draft PR в интеграционную ветку. Сообщи HEAD_SHA, команды и доказательства, не скрывай SKIP или недостающие prerequisites.
5. Оставь READY_FOR_REVIEW только с проверяемым результатом; source-ready и physical/installed-qualified указывай отдельно. Интеграцию, package producer и закрытие задачи выполняет координатор.
